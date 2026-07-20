const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku;

function initLavalink(client) {

    const node = {
        name: "railway",
        url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
        auth: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE === "true"
    };

    console.log("🎵 Lavalink:");
    console.log("Host:", node.url);
    console.log("Secure:", node.secure);
    console.log("Password:", node.auth ? "Loaded" : "Missing");


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        [node],
        {
            reconnectTries: Infinity,
            reconnectInterval: 5000,
            resume: true
        }
    );


    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });


    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`, error);
    });


    shoukaku.on("disconnect", (name, count) => {
        console.log(`⚠️ Lavalink disconnected ${name} (${count})`);
    });


    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink closed ${name}`, code, reason);
    });


    return shoukaku;
}


module.exports = {
    initLavalink
};
