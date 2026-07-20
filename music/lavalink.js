// music/lavalink.js

const { Shoukaku, Connectors } = require("shoukaku");

let shoukaku;

function initLavalink(client) {

    const node = {
        name: "railway",

        host: process.env.LAVALINK_HOST,

        port: Number(process.env.LAVALINK_PORT || 443),

        auth: process.env.LAVALINK_PASSWORD,

        secure: true
    };


    console.log("🎵 Lavalink:");
    console.log(`${node.host}:${node.port}`);
    console.log("Secure:", node.secure);
    console.log(
        "Password:",
        node.auth ? "Loaded" : "Missing"
    );


    shoukaku = new Shoukaku(
        new Connectors.DiscordJS(client),
        [node],
        {

            reconnectTries: Infinity,

            reconnectInterval: 5000,

            resume: true,

            resumeTimeout: 60,

            moveOnDisconnect: false

        }
    );


    shoukaku.on("ready", (name) => {

        console.log(
            `✅ Lavalink connected: ${name}`
        );

    });


    shoukaku.on("error", (name, error) => {

        console.error(
            `❌ Lavalink error ${name}`
        );

        console.error(error);

    });


    shoukaku.on("disconnect", (name, count) => {

        console.log(
            `⚠️ Lavalink disconnected ${name} (${count})`
        );

    });


    shoukaku.on("close", (name, code, reason) => {

        console.log(
            `⚠️ Lavalink closed ${name}`,
            code,
            reason
        );

    });


    return shoukaku;

}


module.exports = {
    initLavalink
};
