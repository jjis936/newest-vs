// music/index.js
// Single entry point so bot.js and deploy-commands.js only need one
// require("./music") line instead of reaching into every file in here.

const { initLavalink } = require("./lavalink");
const { musicSlashCommands, musicAutocomplete } = require("./commands");
const { musicButtonHandlers } = require("./buttons");
const { handleVoiceStateUpdate } = require("./voiceCleanup");

module.exports = {
    initLavalink,
    musicSlashCommands,
    musicAutocomplete,
    musicButtonHandlers,
    handleVoiceStateUpdate
};
