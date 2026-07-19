// music/lavalink.js
// Handles the Discord bot -> Lavalink connection through Shoukaku

const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {

    const host = process.env.LAVALINK_HOST;
    const port = Number(process.env.LAVALINK_PORT || 443);
    const password = process.env.LAVALINK_PASSWORD;
    const secure = String(process.env.LAVALINK_SECURE).toLowerCase() === "true";

    if (!host || !password) {
        console.error(
            "❌ Missing Lavalink variables:\n" +
            "LAVALINK_HOST\n" +
            "LAVALINK_PASSWORD"
        );
        return null;
    }

    console.log("🎵 Lavalink config:");
    console.log("Host:", host);
    console.log("Port:", port);
    console.log("Secure:", secure);

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
            moveOnDisconnect: false,
            resume: true,
            resumeTimeout: 60,
            reconnectTries: 20,
            reconnectInterval: 5000,
            restTimeout: 15000
        }
    );

    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });

    shoukaku.on("error", (name, error) => {
        console.error(
            `❌ Lavalink error on ${name}:`,
            error.message || error
        );
    });

    shoukaku.on("close", (name, code, reason) => {
        console.log(
            `⚠️ Lavalink closed ${name}:`,
            code,
            reason || "No reason"
        );
    });

    shoukaku.on("disconnect", (name) => {
        console.log(`⚠️ Lavalink disconnected: ${name}`);
    });

    shoukaku.on("reconnecting", (name) => {
        console.log(`🔄 Lavalink reconnecting: ${name}`);
    });

    return shoukaku;
}

module.exports = { initLavalink };
