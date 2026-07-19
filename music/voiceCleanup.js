// music/voiceCleanup.js
// Handles the two "someone else moved the furniture" cases that
// slash commands and buttons can't catch on their own:
//
//   1) The bot gets disconnected/kicked from voice by a moderator (or
//      Discord itself) - clean up the queue immediately instead of
//      leaving a dead player hanging around.
//   2) Everyone leaves the voice channel while music is playing - wait
//      60 seconds (in case it was a brief disconnect) then leave and
//      clear the queue, like most premium music bots do.

const { queueManager } = require("./queueManager");
const { destroyQueue } = require("./player");

async function handleVoiceStateUpdate(oldState, newState, client) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const queue = queueManager.get(guild.id);
    if (!queue) return;

    // Case 1: the bot itself was disconnected from voice.
    if (oldState.id === client.user.id && oldState.channelId && !newState.channelId) {
        console.log(`[music] 🔌 bot was disconnected from voice in guild ${guild.id} - cleaning up.`);
        await destroyQueue(queue, "I got disconnected from the voice channel.");
        return;
    }

    // Case 2: check whether the bot is now alone in its voice channel.
    const voiceChannel = guild.channels.cache.get(queue.voiceChannelId);
    if (!voiceChannel || !voiceChannel.members) return;

    const humanCount = voiceChannel.members.filter(m => !m.user.bot).size;

    if (humanCount === 0) {
        clearTimeout(queue.aloneTimer);
        queue.aloneTimer = setTimeout(async () => {
            const stillQueue = queueManager.get(guild.id);
            if (!stillQueue) return;
            const stillChannel = guild.channels.cache.get(stillQueue.voiceChannelId);
            const stillHumans = stillChannel?.members?.filter(m => !m.user.bot).size || 0;
            if (stillHumans === 0) {
                console.log(`[music] 👤 everyone left the voice channel in guild ${guild.id} - disconnecting.`);
                await destroyQueue(stillQueue, "Everyone left the voice channel.");
            }
        }, 60 * 1000);
    } else {
        clearTimeout(queue.aloneTimer);
    }
}

module.exports = { handleVoiceStateUpdate };
