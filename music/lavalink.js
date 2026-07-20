const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku;

function initLavalink(client) {

    const nodes = [
        {
            name: "railway",
            url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
            auth: process.env.LAVALINK_PASSWORD
        }
    ];

    console.log("🎵 Lavalink:");
    console.log(nodes[0].url);
    console.log("Password:", process.env.LAVALINK_PASSWORD ? "Loaded" : "Missing");


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        nodes,
        {
            reconnectTries: Infinity,
            reconnectInterval: 5000
        }
    );


    shoukaku.on("ready", name => {
        console.log(`✅ Lavalink connected: ${name}`);
    });

    shoukaku.on("error", (name, error) => {
        console.log(`❌ Lavalink error ${name}`);
        console.error(error);
    });

    shoukaku.on("close", (name, code, reason) => {
        console.log(`⚠️ Lavalink closed ${name}`, code, reason);
    });


    return shoukaku;
}

module.exports = { initLavalink };
