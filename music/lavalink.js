const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku;

function initLavalink(client) {
    const nodes = [
        {
            name: "railway",
            url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
            auth: process.env.LAVALINK_PASSWORD,
            secure: process.env.LAVALINK_SECURE === "true"
        }
    ];

    console.log("🎵 Lavalink connection:");
    console.log("Host:", process.env.LAVALINK_HOST);
    console.log("Port:", process.env.LAVALINK_PORT);
    console.log("Secure:", process.env.LAVALINK_SECURE);

    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        nodes,
        {
            reconnectTries: 10,
            reconnectInterval: 5000
        }
    );

    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink node ${name} connected`);
    });

    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink ${name} error:`, error);
    });

    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink ${name} closed`, code, reason);
    });

    return shoukaku;
}

module.exports = { initLavalink };
