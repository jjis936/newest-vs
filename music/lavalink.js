// music/lavalink.js
// Sets up the connection to your Lavalink node using Shoukaku. This is
// the ONLY file that talks to Lavalink directly at the connection level -
// every other music file just uses the `shoukaku` instance this creates
// (via client.shoukaku) to join channels, resolve tracks, and get players.
//
// Reads its connection details from environment variables. Since your
// Lavalink + Railway setup is already done, just make sure these 4
// variables exist in Railway with these exact names (rename them if your
// existing ones are called something else):
//
//   LAVALINK_HOST      e.g. my-lavalink.up.railway.app  (NO protocol, no port)
//   LAVALINK_PORT      e.g. 443 (or 2333 for a typical non-secure node)
//   LAVALINK_PASSWORD  the Lavalink server's "password"/"authorization" value
//   LAVALINK_SECURE    "true" if your node uses https/wss, otherwise "false"

const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {

    const host = process.env.LAVALINK_HOST;
    const port = process.env.LAVALINK_PORT;
    const password = process.env.LAVALINK_PASSWORD;
    const secure = process.env.LAVALINK_SECURE === "true";

    if (!host || !port || !password) {
        console.error(
            "🛑 [music] Missing LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD env vars - " +
            "the music system cannot connect to Lavalink until these are set in Railway."
        );
    }

    const nodes = [
        {
            name: "main",
            url: `${host}:${port}`,
            auth: password,
            secure
        }
    ];

    const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
        moveOnDisconnect: false,   // don't try to move players to another node - we only have one
        resume: true,              // ask Lavalink to keep the session alive briefly on disconnect
        resumeTimeout: 30,
        reconnectTries: 10,        // keep retrying instead of giving up after one failed connection
        reconnectInterval: 5000,   // 5s between reconnect attempts
        restTimeout: 15000
    });

    // ---- Logging + reconnect visibility -----------------------------------
    shoukaku.on("ready", (name, resumedLL, resumedLib) => {
        console.log(`🎶 [lavalink] node "${name}" connected and ready` +
            (resumedLL || resumedLib ? " (session resumed)" : ""));
    });

    shoukaku.on("error", (name, error) => {
        console.error(`❌ [lavalink] node "${name}" error:`, error?.message || error);
    });

    shoukaku.on("close", (name, code, reason) => {
        console.warn(`⚠️ [lavalink] node "${name}" connection closed - code ${code}${reason ? `, reason: ${reason}` : ""}`);
    });

    shoukaku.on("disconnect", (name, playersMovedOrDestroyed) => {
        console.warn(`⚠️ [lavalink] node "${name}" disconnected (${playersMovedOrDestroyed} player(s) affected). Will keep retrying...`);
    });

    shoukaku.on("reconnecting", (name, triesLeft, interval) => {
        console.log(`🔁 [lavalink] reconnecting to node "${name}"... (${triesLeft} tries left, retrying every ${interval}ms)`);
    });

    return shoukaku;
}

module.exports = { initLavalink };
