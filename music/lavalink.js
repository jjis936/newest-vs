// music/lavalink.js

const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {

    const host = process.env.LAVALINK_HOST;
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const password = process.env.LAVALINK_PASSWORD;
    const secure = process.env.LAVALINK_SECURE === "true";

    console.log("🎵 Lavalink config:");
    console.log("Host:", host);
    console.log("Port:", port);
    console.log("Secure:", secure);

    if (!host || !password) {
        console.error("❌ Missing Lavalink variables");
        return null;
    }

    const nodes = [
        {
            name: "main",
            url: `${host}:${port}`,
            auth: password,
            secure: secure
        }
    ];

    const shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        nodes,
        {
            reconnectTries: Infinity,
            reconnectInterval: 5000,
            restTimeout: 10000
        }
    );

    shoukaku.on("ready", (name) => {
        console.log(`🎶 Lavalink node connected: ${name}`);
    });

    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`, error);
    });

    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink closed ${name}`, code, reason);
    });

    return shoukaku;
}

module.exports = { initLavalink };
