const { Shoukaku, Connectors } = require("shoukaku");

function initLavalink(client) {
    const host = process.env.LAVALINK_HOST;
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const password = process.env.LAVALINK_PASSWORD;
    const secure = process.env.LAVALINK_SECURE === "true";

    console.log("🎵 Lavalink connection:");
    console.log("Host:", host);
    console.log("Port:", port);
    console.log("Secure:", secure);

    if (!host || !password) {
        console.error("❌ Missing Lavalink HOST or PASSWORD");
        return null;
    }

    const shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        [
            {
                name: "main",
                host: host,
                port: port,
                auth: password,
                secure: secure
            }
        ],
        {
            reconnectTries: 10,
            reconnectInterval: 5000,
            restTimeout: 15000
        }
    );

    shoukaku.on("ready", (name) => {
        console.log(`🎶 Lavalink node "${name}" connected and ready`);
    });

    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`, error);
    });

    shoukaku.on("close", (name, code, reason) => {
        console.log(
            `⚠️ Lavalink closed ${name}: ${code} ${reason || ""}`
        );
    });

    shoukaku.on("disconnect", (name) => {
        console.log(`⚠️ Lavalink disconnected: ${name}`);
    });

    return shoukaku;
}

module.exports = { initLavalink };
