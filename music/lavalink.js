// music/lavalink.js

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
    console.log("Password:", process.env.LAVALINK_PASSWORD ? "Loaded" : "Missing");


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        nodes,
        {
            reconnectTries: 10,
            reconnectInterval: 5000,
            resume: true,
            resumeTimeout: 60
        }
    );


    shoukaku.on("ready", (name) => {
        console.log(`✅ Lavalink connected: ${name}`);
    });


    shoukaku.on("error", (name, error) => {
        console.error(`❌ Lavalink error ${name}:`);
        console.error(error);
    });


    shoukaku.on("disconnect", (name, count, reason) => {
        console.log(
            `⚠️ Lavalink disconnected ${name} | Attempts: ${count}`,
            reason || ""
        );
    });


    shoukaku.on("close", (name, code, reason) => {
        console.log(
            `🔴 Lavalink closed ${name} | Code: ${code}`,
            reason || ""
        );
    });


    return shoukaku;
}


module.exports = {
    initLavalink
};
