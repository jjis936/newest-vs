// music/lavalink.js
// Handles the Discord bot -> Lavalink connection through Shoukaku

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


    // Lavalink successfully connected
    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });


    // Lavalink errors
    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`, error);
    });


    // Lavalink disconnects
    shoukaku.on("disconnect", (name, count) => {
        console.log(`⚠️ Lavalink disconnected ${name} (${count})`);
    });


    // Node connects
    shoukaku.on("connect", (name) => {
        console.log(`🔗 Lavalink node connecting: ${name}`);
    });


    return shoukaku;
}


module.exports = {
    initLavalink
};
