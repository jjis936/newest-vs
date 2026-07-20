// music/commands.js
// All 11 music slash commands + autocomplete for /play.
//
// Source resolution strategy for /play:
//   - A direct URL (Spotify/Apple Music/Deezer/SoundCloud/YouTube/Bandcamp)
//     is passed straight to Lavalink, which resolves it using its built-in
//     sources (YouTube, SoundCloud, Bandcamp) or the LavaSrc plugin
//     (Spotify, Apple Music, Deezer) if it's installed on your node.
//   - Plain text first tries "spsearch:" (Spotify catalog search via
//     LavaSrc - best metadata matching), then falls back to "ytsearch:"
//     if that comes back empty (e.g. LavaSrc isn't installed yet).

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getIdealNode, joinVoiceChannel, leaveVoiceChannel } = require("./manager");
const { getQueue, createQueue, deleteQueue, LOOP_OFF, LOOP_TRACK, LOOP_QUEUE } = require("./queue");
const { buildNowPlayingEmbed, buildMusicButtons, formatTime } = require("./embeds");

const URL_PATTERNS = {
    spotify: /open\.spotify\.com/i,
    apple: /music\.apple\.com/i,
    deezer: /deezer\.com/i,
    soundcloud: /soundcloud\.com/i,
    youtube: /(youtube\.com|youtu\.be)/i,
    bandcamp: /bandcamp\.com/i
};

function isUrl(query){
    return /^https?:\/\//i.test(query);
}

// Turns a raw Lavalink track into our internal track object
function wrapTrack(rawTrack, requesterId){
    return {
        track: rawTrack.encoded,
        info: {
            title: rawTrack.info.title,
            author: rawTrack.info.author,
            length: rawTrack.info.length,
            uri: rawTrack.info.uri,
            artworkUrl: rawTrack.info.artworkUrl || null,
            sourceName: rawTrack.info.sourceName,
            isStream: rawTrack.info.isStream
        },
        requester: requesterId
    };
}

// Resolves a search query or URL into an array of wrapped tracks, using
// whichever node is currently healthiest.
async function resolveQuery(query, requesterId){

    const node = getIdealNode();
    if(!node) throw new Error("No Lavalink node is currently connected - music is temporarily unavailable.");

    async function search(identifier){
        const result = await node.rest.resolve(identifier);
        return result;
    }

    let result;

    if(isUrl(query)){
        // Direct link - Lavalink figures out the source itself
        result = await search(query);
    }else{
        // Plain text search - try Spotify matching first (needs LavaSrc),
        // fall back to YouTube search if that yields nothing
        result = await search(`spsearch:${query}`);
        if(!result || result.loadType === "empty" || result.loadType === "error" || (result.loadType === "search" && !result.data?.length)){
            result = await search(`ytsearch:${query}`);
        }
    }

    if(!result || result.loadType === "empty" || result.loadType === "error"){
        return { tracks: [], playlistName: null };
    }

    if(result.loadType === "track"){
        return { tracks: [wrapTrack(result.data, requesterId)], playlistName: null };
    }

    if(result.loadType === "search"){
        return { tracks: result.data.slice(0, 1).map(t => wrapTrack(t, requesterId)), playlistName: null };
    }

    if(result.loadType === "playlist"){
        return {
            tracks: result.data.tracks.map(t => wrapTrack(t, requesterId)),
            playlistName: result.data.info?.name || "Playlist"
        };
    }

    return { tracks: [], playlistName: null };
}

// Shared guard: must be in a voice channel, and if a session is already
// active for this guild, must be in THE SAME voice channel as the bot.
function checkVoiceAccess(interaction){
    const memberVoiceId = interaction.member.voice?.channelId;
    if(!memberVoiceId){
        return { ok: false, reason: "❌ You need to be in a voice channel to do that." };
    }
    const queue = getQueue(interaction.guild.id);
    if(queue && queue.voiceChannelId !== memberVoiceId){
        return { ok: false, reason: "❌ You need to be in the same voice channel as the bot to control music." };
    }
    return { ok: true, memberVoiceId, queue };
}

// Starts playback of the current track in the queue via the Shoukaku player
async function playCurrent(queue){
    if(!queue.current || !queue.player) return;
    await queue.player.playTrack({ track: { encoded: queue.current.track } });
    if(queue.volume !== 100) await queue.player.setGlobalVolume(queue.volume);
}

async function postNowPlaying(queue, channel, brandName, brandColor){
    const embed = buildNowPlayingEmbed(queue, brandName, brandColor);
    if(!embed) return;
    const buttons = buildMusicButtons(queue);
    const msg = await channel.send({ embeds: [embed], components: buttons }).catch(() => null);
    if(msg){
        queue.nowPlayingMessageId = msg.id;
        queue.nowPlayingChannelId = channel.id;
    }
}

// Called whenever a track finishes (naturally, via skip, or got stuck).
// Advances the queue and either plays the next track + reposts the Now
// Playing message, or - if nothing's left - starts a 5 minute idle timer
// before auto-disconnecting.
const idleTimers = new Map(); // guildId -> Timeout

async function handleTrackEnd(guildId, textChannel, brandName, brandColor){

    const queue = getQueue(guildId);
    if(!queue) return;

    const existingTimer = idleTimers.get(guildId);
    if(existingTimer) clearTimeout(existingTimer);

    const next = queue.advance();

    if(!next){
        // Queue's empty - wait 5 minutes before disconnecting in case more
        // songs get added, instead of leaving instantly
        const timer = setTimeout(async () => {
            const stillEmpty = getQueue(guildId);
            if(stillEmpty && stillEmpty.isEmpty()){
                await stillEmpty.player?.stopTrack().catch(() => {});
                await leaveVoiceChannel(guildId).catch(() => {});
                deleteQueue(guildId);
                await textChannel?.send({ content: "👋 Left the voice channel after 5 minutes of inactivity." }).catch(() => {});
            }
        }, 5 * 60000);
        idleTimers.set(guildId, timer);
        return;
    }

    try{
        await playCurrent(queue);
        await postNowPlaying(queue, textChannel, brandName, brandColor);
    }catch(err){
        console.log(`🎵 ❌ Error advancing queue in guild ${guildId}: ${err.message}`);
    }

}

const musicCommands = [

    {
        data: new SlashCommandBuilder()
            .setName("play")
            .setDescription("Play a song or playlist from YouTube, Spotify, Apple Music, SoundCloud, Deezer, or Bandcamp")
            .addStringOption(o => o.setName("query")
                .setDescription("Song name, artist, or a link")
                .setRequired(true)
                .setAutocomplete(true)),

        async execute(interaction, ctx){

            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });

            await interaction.deferReply();

            const query = interaction.options.getString("query");

            let result;
            try{
                result = await resolveQuery(query, interaction.user.id);
            }catch(err){
                return interaction.editReply({ content: `❌ ${err.message}` });
            }

            if(!result.tracks.length){
                return interaction.editReply({ content: `❌ Couldn't find anything for "${query}".` });
            }

            let queue = getQueue(interaction.guild.id);

            if(!queue){
                const node = getIdealNode();
                if(!node) return interaction.editReply({ content: "❌ No Lavalink node connected right now - try again shortly." });

                queue = createQueue(interaction.guild.id, access.memberVoiceId, interaction.channel.id);

                try{
                    queue.player = await joinVoiceChannel({
                        guildId: interaction.guild.id,
                        channelId: access.memberVoiceId,
                        shardId: interaction.guild.shardId ?? 0,
                        deaf: true
                    });
                }catch(err){
                    deleteQueue(interaction.guild.id);
                    return interaction.editReply({ content: `❌ Couldn't join your voice channel: ${err.message}` });
                }

                queue.player.on("end", () => handleTrackEnd(interaction.guild.id, interaction.channel, ctx.brandName, ctx.brandColor));
                queue.player.on("exception", (err) => console.log(`🎵 ❌ Player exception in guild ${interaction.guild.id}: ${err?.exception?.message || err}`));
                queue.player.on("stuck", () => {
                    console.log(`🎵 ⚠️ Track stuck in guild ${interaction.guild.id}, skipping`);
                    handleTrackEnd(interaction.guild.id, interaction.channel, ctx.brandName, ctx.brandColor);
                });
            }

            queue.addMany(result.tracks);

            if(!queue.current){
                queue.advance();
                await playCurrent(queue);
                await postNowPlaying(queue, interaction.channel, ctx.brandName, ctx.brandColor);
                return interaction.editReply({
                    content: result.playlistName
                        ? `✅ Queued **${result.tracks.length}** tracks from **${result.playlistName}**, starting playback.`
                        : `✅ Now playing **${result.tracks[0].info.title}**.`
                });
            }

            await interaction.editReply({
                content: result.playlistName
                    ? `✅ Added **${result.tracks.length}** tracks from **${result.playlistName}** to the queue (position ${queue.tracks.length - result.tracks.length + 1}).`
                    : `✅ Added **${result.tracks[0].info.title}** to the queue (position ${queue.tracks.length}).`
            });

        },

        // Autocomplete: shows up to 25 live suggestions as the user types
        async autocomplete(interaction){
            const focused = interaction.options.getFocused();
            if(!focused || focused.length < 2){
                return interaction.respond([]).catch(() => {});
            }

            const node = getIdealNode();
            if(!node) return interaction.respond([]).catch(() => {});

            try{
                const result = await node.rest.resolve(`spsearch:${focused}`);
                let tracks = (result?.loadType === "search" ? result.data : []) || [];

                if(!tracks.length){
                    const fallback = await node.rest.resolve(`ytsearch:${focused}`);
                    tracks = (fallback?.loadType === "search" ? fallback.data : []) || [];
                }

                const choices = tracks.slice(0, 25).map(t => {
                    const label = `${t.info.title} - ${t.info.author}`.slice(0, 100);
                    return { name: label, value: t.info.uri.slice(0, 100) };
                });

                await interaction.respond(choices);
            }catch(err){
                console.log(`🎵 autocomplete error: ${err.message}`);
                await interaction.respond([]).catch(() => {});
            }
        }
    },

    {
        data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            access.queue.paused = true;
            await access.queue.player.setPaused(true);
            await interaction.reply({ content: "⏸ Paused." });
        }
    },

    {
        data: new SlashCommandBuilder().setName("resume").setDescription("Resume the current track"),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            access.queue.paused = false;
            await access.queue.player.setPaused(false);
            await interaction.reply({ content: "▶️ Resumed." });
        }
    },

    {
        data: new SlashCommandBuilder().setName("skip").setDescription("Skip to the next track"),
        async execute(interaction, ctx){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            await interaction.reply({ content: "⏭ Skipped." });
            await access.queue.player.stopTrack(); // triggers the "end" event -> ctx.onTrackEnd handles advancing
        }
    },

    {
        data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track"),
        async execute(interaction, ctx){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });

            const prev = access.queue?.previous();
            if(!prev) return interaction.reply({ content: "❌ No previous track in history.", ephemeral: true });

            await playCurrent(access.queue);
            await interaction.reply({ content: `⏮ Playing previous track: **${prev.info.title}**` });
            await postNowPlaying(access.queue, interaction.channel, ctx.brandName, ctx.brandColor);
        }
    },

    {
        data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback, clear the queue, and disconnect"),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            await access.queue.player?.stopTrack().catch(() => {});
            await leaveVoiceChannel(interaction.guild.id).catch(() => {});
            deleteQueue(interaction.guild.id);

            await interaction.reply({ content: "⏹ Stopped, queue cleared, and disconnected." });
        }
    },

    {
        data: new SlashCommandBuilder().setName("queue").setDescription("View the current queue")
            .addIntegerOption(o => o.setName("page").setDescription("Page number").setRequired(false)),
        async execute(interaction){
            const queue = getQueue(interaction.guild.id);
            if(!queue || queue.isEmpty()){
                return interaction.reply({ content: "❌ The queue is empty.", ephemeral: true });
            }

            const page = Math.max(1, interaction.options.getInteger("page") || 1);
            const perPage = 10;
            const start = (page - 1) * perPage;
            const pageTracks = queue.tracks.slice(start, start + perPage);

            const lines = pageTracks.map((t, i) =>
                `**${start + i + 1}.** ${t.info.title} - ${t.info.author} \`[${formatTime(t.info.length)}]\` <@${t.requester}>`
            ).join("\n") || "*(no more tracks on this page)*";

            const waitMs = queue.estimatedWaitMs();
            const waitStr = `${Math.floor(waitMs / 60000)}m ${Math.floor((waitMs % 60000) / 1000)}s`;

            await interaction.reply({
                content:
                    `**🎵 Now Playing:** ${queue.current ? `${queue.current.info.title} - ${queue.current.info.author}` : "*nothing*"}\n\n` +
                    `**📜 Up Next** (page ${page}, ${queue.tracks.length} total):\n${lines}\n\n` +
                    `⏳ Estimated time to end of queue: ${waitStr}`,
                ephemeral: true
            });
        }
    },

    {
        data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the upcoming queue"),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue?.tracks.length) return interaction.reply({ content: "❌ Nothing in the queue to shuffle.", ephemeral: true });

            access.queue.shuffle();
            await interaction.reply({ content: "🔀 Queue shuffled." });
        }
    },

    {
        data: new SlashCommandBuilder().setName("loop").setDescription("Cycle loop mode: Off -> Track -> Queue -> Off"),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            const mode = access.queue.cycleLoop();
            const labels = { [LOOP_OFF]: "Off", [LOOP_TRACK]: "Current Track", [LOOP_QUEUE]: "Entire Queue" };
            await interaction.reply({ content: `🔁 Loop mode: **${labels[mode]}**` });
        }
    },

    {
        data: new SlashCommandBuilder().setName("volume").setDescription("Set playback volume (0-200%)")
            .addIntegerOption(o => o.setName("percent").setDescription("Volume percentage").setRequired(true)),
        async execute(interaction){
            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
            if(!access.queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            const percent = Math.min(200, Math.max(0, interaction.options.getInteger("percent")));
            access.queue.volume = percent;
            await access.queue.player.setGlobalVolume(percent);
            await interaction.reply({ content: `🔊 Volume set to ${percent}%.` });
        }
    },

    {
        data: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
        async execute(interaction, ctx){
            const queue = getQueue(interaction.guild.id);
            if(!queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            const embed = buildNowPlayingEmbed(queue, ctx.brandName, ctx.brandColor);
            const buttons = buildMusicButtons(queue);
            await interaction.reply({ embeds: [embed], components: buttons });
        }
    }

];

module.exports = { musicCommands, resolveQuery, playCurrent, postNowPlaying, checkVoiceAccess };
