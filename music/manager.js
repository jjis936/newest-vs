// music/manager.js
// Sets up the Lavalink connection via Shoukaku. This is the ONLY file that
// touches the raw Lavalink connection - everything else (queue, commands,
// buttons) talks to Lavalink through the shoukaku instance exported here.
//
// Required Railway env vars (you said these are already set):
//   LAVALINK_HOST      e.g. your-lavalink-host.com
//   LAVALINK_PORT      e.g. 443 (or 2333 for non-SSL)
//   LAVALINK_PASSWORD  the password configured in Lavalink's application.yml
//   LAVALINK_SECURE    "true" if your Lavalink node uses SSL/wss, else "false"

const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku = null;

function initMusic(client){

    const nodes = [
        {
            name: "main-node",
            url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
            auth: process.env.LAVALINK_PASSWORD,
            secure: process.env.LAVALINK_SECURE === "true"
        }
    ];

    if(!process.env.LAVALINK_HOST || !process.env.LAVALINK_PORT || !process.env.LAVALINK_PASSWORD){
        console.log("🎵 ⚠️ Lavalink env vars missing (LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD) - music system will not work until these are set.");
    }

    shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
        moveOnDisconnect: false,
        resume: true,
        resumeTimeout: 30,
        reconnectTries: 5,
        reconnectInterval: 5000,
        restTimeout: 15000
    });

    shoukaku.on("ready", (name) => console.log(`🎵 ✅ Lavalink node "${name}" connected`));
    shoukaku.on("error", (name, error) => console.log(`🎵 ❌ Lavalink node "${name}" error: ${error.message}`));
    shoukaku.on("close", (name, code, reason) => console.log(`🎵 ⚠️ Lavalink node "${name}" closed (code ${code}): ${reason || "no reason given"}`));
    shoukaku.on("disconnect", (name, reason) => console.log(`🎵 ⚠️ Lavalink node "${name}" disconnected: ${reason || "unknown"} - Shoukaku will attempt to reconnect automatically`));
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
