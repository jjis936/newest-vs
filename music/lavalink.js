// music/lavalink.js
// Connects the Discord bot to your Railway Lavalink server through Shoukaku.

const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {

    const host = process.env.LAVALINK_HOST;
    const port = process.env.LAVALINK_PORT || "2333";
    const password = process.env.LAVALINK_PASSWORD;
    const secure = process.env.LAVALINK_SECURE === "true";

    if (!host || !password) {
        console.error(
            "❌ Missing Lavalink variables. Required:\n" +
            "LAVALINK_HOST\n" +
            "LAVALINK_PASSWORD\n" +
            "LAVALINK_PORT"
        );
    }

    console.log("🎵 Lavalink connection:");
    console.log(`Host: ${host}`);
    console.log(`Port: ${port}`);
    console.log(`Secure: ${secure}`);

    const nodes = [
        {
            name: "main",
            url: `${secure ? "https" : "http"}://${host}:${port}`,
            auth: password,
            secure
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
            restTimeout: 30000
        }
    );


    shoukaku.on("ready", (name) => {
        console.log(`✅ [lavalink] Node "${name}" connected and ready`);
    });


    shoukaku.on("error", (name, error) => {
        console.error(
            `❌ [lavalink] Node "${name}" error:`,
            error?.message || error
        );
    });


    shoukaku.on("close", (name, code, reason) => {
        console.warn(
            `⚠️ [lavalink] Node "${name}" closed (${code}) ${reason || ""}`
        );
    });


    shoukaku.on("disconnect", (name) => {
        console.warn(
            `⚠️ [lavalink] Node "${name}" disconnected. Reconnecting...`
        );
    });


    shoukaku.on("reconnecting", (name, tries, interval) => {
        console.log(
            `🔄 [lavalink] Reconnecting "${name}" (${tries} tries left, ${interval}ms)`
        );
    });


    return shoukaku;
}

module.exports = { initLavalink };
