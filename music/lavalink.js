// music/lavalink.js

const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku;

function initLavalink(client) {

    const nodes = [
        {
            name: "railway",
            host: process.env.LAVALINK_HOST,
            port: Number(process.env.LAVALINK_PORT || 2333),
            auth: process.env.LAVALINK_PASSWORD,
            secure: process.env.LAVALINK_SECURE === "true"
        }
    ];

    console.log("🎵 Lavalink connection:");
    console.log("Host:", process.env.LAVALINK_HOST);
    console.log("Port:", process.env.LAVALINK_PORT);
    console.log("Secure:", process.env.LAVALINK_SECURE);
    console.log("Password loaded:", process.env.LAVALINK_PASSWORD ? "YES" : "NO");


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        nodes,
        {
            reconnectTries: 10,
            reconnectInterval: 5000
        }
    );


    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });


    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`, error);
    });


    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink closed ${name}:`, code, reason);
    });


    shoukaku.on("disconnect", (name, count, reason) => {
        console.log(`🔌 Lavalink disconnected ${name}:`, count, reason);
    });


    return shoukaku;
}

module.exports = {
    initLavalink
};
