// music/lavalink.js
// Handles the Lavalink connection for the Discord bot

const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {

    const host = process.env.LAVALINK_HOST;
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const password = process.env.LAVALINK_PASSWORD;
    const secure = process.env.LAVALINK_SECURE === "true";

    console.log("🎵 Lavalink configuration:");
    console.log(`Host: ${host}`);
    console.log(`Port: ${port}`);
    console.log(`Secure: ${secure}`);

    if (!host || !password) {
        console.error(
            "❌ Missing Lavalink variables. Need LAVALINK_HOST and LAVALINK_PASSWORD."
        );
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
            reconnectTries: 20,
            reconnectInterval: 5000,
            moveOnDisconnect: false,
            resume: true,
            resumeTimeout: 60,
            restTimeout: 15000
        }
    );


    shoukaku.on("ready", (name, resumed) => {
        console.log(
            `🎶 Lavalink connected: ${name}` +
            (resumed ? " (session resumed)" : "")
        );
    });


    shoukaku.on("error", (name, error) => {
        console.error(
            `❌ Lavalink node error (${name}):`,
            error?.message || error
        );
    });


    shoukaku.on("close", (name, code, reason) => {
        console.warn(
            `⚠️ Lavalink closed (${name}) Code: ${code} ${reason || ""}`
        );
    });


    shoukaku.on("disconnect", (name) => {
        console.warn(
            `⚠️ Lavalink disconnected: ${name}`
        );
    });


    shoukaku.on("reconnecting", (name, tries, interval) => {
        console.log(
            `🔄 Reconnecting Lavalink ${name} (${tries}) every ${interval}ms`
        );
    });


    return shoukaku;
}

module.exports = { initLavalink };
