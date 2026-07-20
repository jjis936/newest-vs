// music/manager.js
// Sets up the Lavalink connection via Shoukaku. This is the ONLY file that
// touches the raw Lavalink connection - everything else (queue, commands,
// buttons) talks to Lavalink through the shoukaku instance exported here.
//
// Required Railway env vars:
//   LAVALINK_HOST      e.g. your-lavalink-host.up.railway.app  (NO http(s):// or wss:// prefix)
//   LAVALINK_PORT      e.g. 443 (or 2333 for non-SSL)
//   LAVALINK_PASSWORD  the password configured in Lavalink's application.yml
//   LAVALINK_SECURE    "true" if your Lavalink node uses SSL/wss, else "false"

const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku = null;
let nodeOptions = null; // kept around so the self-heal loop below can re-add it

// People very commonly paste the full URL Railway gives them
// (e.g. "https://my-node.up.railway.app") into LAVALINK_HOST. Shoukaku's
// "url" field wants ONLY host[:port] with no protocol - a protocol prefix
// makes the node fail to connect with a confusing/silent error, which then
// shows up as "no nodes configured" once Shoukaku gives up retrying it.
// This strips it automatically so a copy-paste mistake doesn't break music.
function sanitizeHost(raw){
    if(!raw) return raw;
    return raw
        .trim()
        .replace(/^wss?:\/\//i, "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
}

function buildNodeOptions(){
    const host = sanitizeHost(process.env.LAVALINK_HOST);
    return {
        name: "main-node",
        url: `${host}:${process.env.LAVALINK_PORT}`,
        auth: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE === "true"
    };
}

function initMusic(client){

    if(!process.env.LAVALINK_HOST || !process.env.LAVALINK_PORT || !process.env.LAVALINK_PASSWORD){
        console.log("🎵 ⚠️ Lavalink env vars missing (LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD) - music system will not work until these are set on Railway.");
    }

    nodeOptions = buildNodeOptions();

    console.log(`🎵 Connecting to Lavalink node at ${nodeOptions.secure ? "wss" : "ws"}://${nodeOptions.url} ...`);

    shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [nodeOptions], {
        moveOnDisconnect: false,
        resume: true,
        resumeTimeout: 30,
        reconnectTries: 10,
        reconnectInterval: 5000,
        restTimeout: 15000
    });

    shoukaku.on("ready", (name) => console.log(`🎵 ✅ Lavalink node "${name}" connected`));
    shoukaku.on("error", (name, error) => console.log(`🎵 ❌ Lavalink node "${name}" error: ${error.message}`));
    shoukaku.on("close", (name, code, reason) => console.log(`🎵 ⚠️ Lavalink node "${name}" closed (code ${code}): ${reason || "no reason given"}`));

    shoukaku.on("disconnect", (name, reason) => {
        console.log(`🎵 ⚠️ Lavalink node "${name}" disconnected: ${reason || "unknown"}`);

        // Shoukaku gives up on a node after "reconnectTries" failed attempts
        // and removes it from the pool entirely - that's what makes /status
        // show "no nodes configured" even though the code above always
        // configures one. Rather than staying dead until the bot restarts,
        // keep trying to re-add it every 30s so a Lavalink node that was
        // just restarting (deploy, crash, etc) gets picked back up on its own.
        if(!shoukaku.nodes.has(name)){
            console.log(`🎵 🔄 Node "${name}" was removed from the pool - will keep retrying every 30s in the background.`);
            const retry = setInterval(() => {
                if(shoukaku.nodes.has(name)){
                    clearInterval(retry);
                    return;
                }
                console.log(`🎵 🔄 Retrying connection to Lavalink node "${name}" ...`);
                try{
                    shoukaku.addNode(nodeOptions);
                }catch(err){
                    console.log(`🎵 ❌ Retry failed: ${err.message}`);
                }
            }, 30000);
        }
    });

    shoukaku.on("reconnecting", (name, reconnectsLeft, reconnectInterval) => console.log(`🎵 🔄 Reconnecting to Lavalink node "${name}"... (${reconnectsLeft} attempts left)`));

    return shoukaku;

}

function getShoukaku(){
    return shoukaku;
}

// Delegates to Shoukaku's own built-in ideal-node selection (handles the
// CONNECTED-state filtering and penalty sorting correctly internally -
// no need to reimplement that logic here).
function getIdealNode(){
    if(!shoukaku) return null;
    return shoukaku.getIdealNode();
}

// Joins a voice channel and returns the Player - this lives on the main
// Shoukaku instance, NOT on an individual node.
async function joinVoiceChannel(options){
    if(!shoukaku) throw new Error("Music system isn't initialized.");
    return shoukaku.joinVoiceChannel(options);
}

async function leaveVoiceChannel(guildId){
    if(!shoukaku) return;
    return shoukaku.leaveVoiceChannel(guildId);
}

module.exports = { initMusic, getShoukaku, getIdealNode, joinVoiceChannel, leaveVoiceChannel };
