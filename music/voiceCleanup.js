// music/voiceCleanup.js
// THE FIX for "I disconnected the bot and then it stopped working":
//
// When someone manually disconnects/kicks the bot from a voice channel,
// nothing was listening for that - the guild's queue object stuck around
// forever with a dead player and `queue.current` still set. The next
// /play would see that (truthy) queue, assume music was already playing,
// and just silently append to it instead of rejoining voice. Nothing ever
// played again until the whole process was restarted.
//
// This file listens for that disconnect directly and throws the stale
// queue away immediately, so the next /play rejoins voice and starts
// fresh like normal. It also handles the "bot is alone in the channel"
// case the same way, after a short grace period.

const { getQueue, deleteQueue } = require("./queue");
const { leaveVoiceChannel } = require("./manager");
const { stopProgressUpdater } = require("./commands");

const aloneTimers = new Map(); // guildId -> Timeout

async function cleanupQueue(guildId, client, reason){
    const queue = getQueue(guildId);
    if(!queue) return;

    deleteQueue(guildId); // do this FIRST so nothing else can grab the stale queue mid-cleanup
    stopProgressUpdater(guildId);

    try{ await queue.player?.stopTrack(); }catch{ /* connection's already dead, that's fine */ }
    try{ await leaveVoiceChannel(guildId); }catch{ /* already gone, that's fine too */ }

    // Disable the buttons on the last Now Playing message instead of
    // leaving a dead, still-clickable button row sitting in the channel.
    if(queue.nowPlayingChannelId && queue.nowPlayingMessageId){
        try{
            const channel = await client.channels.fetch(queue.nowPlayingChannelId);
            const msg = await channel?.messages.fetch(queue.nowPlayingMessageId);
            await msg?.edit({ components: [] });
            if(reason) await channel?.send({ content: `👋 ${reason}` }).catch(() => {});
        }catch{ /* message/channel might be gone, don't care */ }
    }
}

async function handleVoiceStateUpdate(oldState, newState, client){
    const guild = newState.guild || oldState.guild;
    if(!guild) return;

    // Case 1: the BOT itself got disconnected, kicked, or moved out.
    if(oldState.id === client.user.id && oldState.channelId && !newState.channelId){
        console.log(`🎵 🔌 Bot was disconnected from voice in guild ${guild.id} - clearing the queue so /play works again.`);
        await cleanupQueue(guild.id, client, "I got disconnected from the voice channel, so I cleared the queue - use `/play` to start again.");
        return;
    }

    // Case 2: bot is now alone in its channel - give it 60s (in case it
    // was a brief blip) then leave, same as most music bots.
    const queue = getQueue(guild.id);
    if(!queue) return;

    const voiceChannel = guild.channels.cache.get(queue.voiceChannelId);
    if(!voiceChannel?.members) return;

    const humans = voiceChannel.members.filter(m => !m.user.bot).size;

    if(humans === 0){
        clearTimeout(aloneTimers.get(guild.id));
        aloneTimers.set(guild.id, setTimeout(async () => {
            const stillChannel = guild.channels.cache.get(queue.voiceChannelId);
            const stillHumans = stillChannel?.members?.filter(m => !m.user.bot).size || 0;
            if(stillHumans === 0){
                console.log(`🎵 👤 Everyone left the voice channel in guild ${guild.id} - disconnecting.`);
                await cleanupQueue(guild.id, client, "Everyone left the voice channel, so I disconnected.");
            }
        }, 60 * 1000));
    }else{
        clearTimeout(aloneTimers.get(guild.id));
    }
}

module.exports = { handleVoiceStateUpdate };
