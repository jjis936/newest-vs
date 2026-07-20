// music/voiceCleanup.js
// Handles two situations:
//
// 1) Someone manually disconnects/kicks the bot from voice - without this,
//    the guild's queue object stuck around forever with a dead player and
//    `queue.current` still set, so the next /play would see a truthy queue,
//    assume music was already playing, and just silently append to it
//    instead of rejoining voice. Nothing ever played again until a restart.
//
// 2) The bot ends up alone in the channel - after a grace period, leave,
//    same as most music bots.
//
// IMPORTANT: case 1 used to fire IMMEDIATELY on any old->null channelId
// transition for the bot. Discord's voice gateway occasionally sends a
// transient state blip during voice-server migrations/resumes (not an
// actual disconnect) where the bot briefly reports channelId as null
// before rejoining moments later - that was being read as a real
// disconnect, wiping the queue and silently killing playback mid-song even
// though the bot never actually left. That's almost certainly what "music
// randomly stops" was. Now it waits a few seconds and cancels the cleanup
// if the bot shows back up in a voice channel in that window.

const { getQueue, deleteQueue } = require("./queue");
const { leaveVoiceChannel } = require("./manager");

const aloneTimers = new Map();       // guildId -> Timeout
const disconnectTimers = new Map();  // guildId -> Timeout

const DISCONNECT_GRACE_MS = 5000;    // how long to wait before trusting a "disconnected" state
const ALONE_GRACE_MS = 60 * 1000;    // how long to wait after everyone leaves

async function cleanupQueue(guildId, client, reason){
    const queue = getQueue(guildId);
    if(!queue) return;

    deleteQueue(guildId); // do this FIRST so nothing else can grab the stale queue mid-cleanup

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

    const isBot = (oldState.id === client.user.id) || (newState.id === client.user.id);

    if(isBot){

        // The bot reappeared in a voice channel before the grace timer ran
        // out - it was a blip, not a real disconnect. Cancel the pending
        // cleanup and keep playing.
        if(newState.channelId && disconnectTimers.has(guild.id)){
            clearTimeout(disconnectTimers.get(guild.id));
            disconnectTimers.delete(guild.id);
            console.log(`🎵 ↩️ Bot's voice state recovered in guild ${guild.id} before the grace period ended - ignoring, still playing.`);
        }

        // The bot just went from "in a channel" to "not in a channel".
        // Don't trust it immediately - wait DISCONNECT_GRACE_MS in case
        // this is a resume/migration blip and it comes right back.
        if(oldState.channelId && !newState.channelId && !disconnectTimers.has(guild.id)){
            const timer = setTimeout(async () => {
                disconnectTimers.delete(guild.id);
                // Double check with the guild's cached voice state - if the
                // bot is actually back in a channel by now, skip cleanup.
                const stillOut = !guild.members.me?.voice?.channelId;
                if(stillOut){
                    console.log(`🎵 🔌 Bot was disconnected from voice in guild ${guild.id} - clearing the queue so /play works again.`);
                    await cleanupQueue(guild.id, client, "I got disconnected from the voice channel, so I cleared the queue - use `/play` to start again.");
                }
            }, DISCONNECT_GRACE_MS);
            disconnectTimers.set(guild.id, timer);
        }

    }

    // Case 2: bot is now alone in its channel - give it a grace period (in
    // case it was a brief blip) then leave, same as most music bots.
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
        }, ALONE_GRACE_MS));
    }else{
        clearTimeout(aloneTimers.get(guild.id));
    }
}

module.exports = { handleVoiceStateUpdate };
