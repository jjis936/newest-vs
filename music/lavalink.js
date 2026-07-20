// music/lavalink.js

const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku = null;

function initLavalink(client) {

    const node = {
        name: "railway",
        host: process.env.LAVALINK_HOST,
        port: Number(process.env.LAVALINK_PORT || 2333),
        auth: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE === "true"
    };

    console.log("🎵 Lavalink config:");
    console.log("Host:", node.host);
    console.log("Port:", node.port);
    console.log("Secure:", node.secure);
    console.log("Password:", node.auth ? "Loaded" : "Missing");


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        [node],
        {
            moveOnDisconnect: false,
            resume: true,
            reconnectTries: 20,
            reconnectInterval: 5000
        }
    );


    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });


    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error (${name}):`);
        console.error(error);
    });


    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink closed ${name}`, code, reason);
    });


    shoukaku.on("disconnect", (name, count, reason) => {
        console.log(`🔌 Lavalink disconnected ${name}`, count, reason);
    });


    return shoukaku;
}


module.exports = {
    initLavalink
};
