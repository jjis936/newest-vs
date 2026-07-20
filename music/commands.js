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

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getIdealNode, joinVoiceChannel, leaveVoiceChannel } = require("./manager");
const { getQueue, createQueue, deleteQueue, LOOP_OFF, LOOP_TRACK, LOOP_QUEUE } = require("./queue");
const { buildNowPlayingEmbed, buildMusicButtons, formatTime } = require("./embeds");
const { getUserPlaylists, getPlaylist, savePlaylist, deletePlaylist } = require("./playlists");

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
function wrapTrack(rawTrack, requesterId, query){
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
        requester: requesterId,
        // Internal-only bookkeeping used by the auto-retry-on-failure logic
        // below - ignored everywhere else (embeds, playlists, etc just read
        // .info/.track). _query is only set for plain-text searches (a
        // direct URL has no other source to fall back to).
        _query: query || null,
        _started: false
    };
}

// Resolves a search query or URL into an array of wrapped tracks, using
// whichever node is currently healthiest. `excludeSources` lets a failed
// track retry the SAME query while skipping whichever source just failed
// (see retryFailedTrack below) instead of trying that same broken source
// again and getting the same result.
async function resolveQuery(query, requesterId, excludeSources = []){

    const node = getIdealNode();
    if(!node) throw new Error("No Lavalink node is currently connected - music is temporarily unavailable.");

    // Wrapped so a bad/unsupported prefix (e.g. spsearch: when LavaSrc isn't
    // installed) can never throw past this point - it just logs and returns
    // null, letting the caller try the next source instead of crashing out.
    async function search(identifier){
        try{
            const result = await node.rest.resolve(identifier);
            console.log(`🎵 [search] "${identifier}" -> loadType=${result?.loadType}, tracks=${result?.data?.length ?? (result?.data ? 1 : 0)}`);
            return result;
        }catch(err){
            console.log(`🎵 [search] ❌ "${identifier}" failed: ${err.message}`);
            return null;
        }
    }

    function hasResults(result){
        if(!result) return false;
        if(result.loadType === "empty" || result.loadType === "error") return false;
        if(result.loadType === "search" && !result.data?.length) return false;
        return true;
    }

    let result;

    if(isUrl(query)){
        // Direct link - Lavalink figures out the source itself, no
        // fallback chain possible since there's only one URL to try.
        result = await search(query);
    }else{
        // Plain text search - try Spotify matching first (needs LavaSrc),
        // fall back to YouTube, then SoundCloud. Any source already known
        // to have failed for this exact track gets skipped instead of
        // retried, so a track that fails on YouTube playback actually
        // ends up on SoundCloud instead of hitting the same dead end.
        const chain = [
            { prefix: "spsearch:", source: "spotify" },
            { prefix: "ytsearch:", source: "youtube" },
            { prefix: "scsearch:", source: "soundcloud" }
        ].filter(step => !excludeSources.includes(step.source));

        for(const step of chain){
            result = await search(`${step.prefix}${query}`);
            if(hasResults(result)) break;
        }
    }

    if(!hasResults(result)){
        return { tracks: [], playlistName: null };
    }

    if(result.loadType === "track"){
        return { tracks: [wrapTrack(result.data, requesterId, isUrl(query) ? null : query)], playlistName: null };
    }

    if(result.loadType === "search"){
        return { tracks: result.data.slice(0, 1).map(t => wrapTrack(t, requesterId, query)), playlistName: null };
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
    // Reset the "already handling end-of-track" guard for the NEW track -
    // see onPlaybackEnded() below for why this matters.
    queue._endLocked = false;
    await queue.player.playTrack({ track: { encoded: queue.current.track } });
    if(queue.volume !== 100) await queue.player.setGlobalVolume(queue.volume);
}

// If a track fails before it ever actually started playing (a bad/blocked
// source, e.g. YouTube throttling), retry the SAME search on a different
// source instead of just giving up on the song entirely. This is what
// turns "Couldn't play Lucid Dreams - skipping" into it actually playing
// via SoundCloud instead. Returns true if a retry was kicked off (caller
// should NOT also advance the queue), false if there's nothing left to try
// (caller should fall back to skipping as normal).
async function retryFailedTrack(queue, textChannel, brandName, brandColor){

    const failed = queue.current;
    if(!failed) return false;

    // Already actually started playing before it broke (mid-song network
    // blip) - that's not a "bad source" situation, don't retry-loop it.
    if(failed._started) return false;

    // No query to retry with (was a direct URL), or already out of retries.
    if(!failed._query) return false;
    const retriesLeft = failed._retriesLeft ?? 2;
    if(retriesLeft <= 0) return false;

    const excluded = [...(failed._excludedSources || []), failed.info.sourceName];

    let result;
    try{
        result = await resolveQuery(failed._query, failed.requester, excluded);
    }catch(err){
        console.log(`🎵 ❌ Retry search failed: ${err.message}`);
        return false;
    }

    if(!result.tracks.length) return false;

    const next = result.tracks[0];
    next.requester = failed.requester;
    next._excludedSources = excluded;
    next._retriesLeft = retriesLeft - 1;

    queue.current = next;

    try{
        await playCurrent(queue);
    }catch(err){
        console.log(`🎵 ❌ Retry playback failed to start: ${err.message}`);
        return false;
    }

    await postNowPlaying(queue, textChannel, brandName, brandColor);
    textChannel?.send({ content: `🔁 That source failed - retrying **${next.info.title}** via ${next.info.sourceName}.` }).catch(() => {});

    return true;
}

async function postNowPlaying(queue, channel, brandName, brandColor){
    // Disable the buttons on the PREVIOUS now-playing message first, so
    // every song change doesn't leave a trail of old messages whose
    // buttons still look clickable but act on a track that's no longer
    // current.
    if(queue.nowPlayingChannelId && queue.nowPlayingMessageId){
        try{
            const oldChannel = await channel.client.channels.fetch(queue.nowPlayingChannelId).catch(() => null);
            const oldMsg = await oldChannel?.messages.fetch(queue.nowPlayingMessageId).catch(() => null);
            await oldMsg?.edit({ components: [] }).catch(() => {});
        }catch{ /* old message may already be gone - fine */ }
    }

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

// THE ACTUAL FIX for "bot joins and just sits there": Lavalink fires
// separate "end", "exception", and "stuck" events, and it's not guaranteed
// that "end" fires when a track fails to load/play - it can fire ONLY
// "exception" and then go silent forever, since nothing was advancing the
// queue on that event before. This wrapper is what every one of those
// events now goes through, so a failed track ALWAYS gets skipped and the
// user ALWAYS finds out why nothing is playing instead of staring at
// silence with no error.
//
// The _endLocked guard exists because a single failed track can trigger
// BOTH "exception" AND "end" (with reason "loadFailed") depending on the
// Lavalink version/plugin - without the guard that would double-advance
// and skip an extra track. playCurrent() resets the lock for each new track.
async function onPlaybackEnded(guildId, textChannel, brandName, brandColor){
    const queue = getQueue(guildId);
    if(!queue) return;
    if(queue._endLocked) return;
    queue._endLocked = true;
    await handleTrackEnd(guildId, textChannel, brandName, brandColor);
}

// Wires up the player event listeners for a freshly-created queue/player.
// Pulled out into its own function so both /play and /playlistplay (or
// anything else that creates a fresh queue) set these up identically -
// previously this was only inlined inside /play.
function attachPlayerEvents(queue, guildId, textChannel, ctx){

    queue.player.on("start", () => {
        if(queue.current) queue.current._started = true;
    });

    queue.player.on("end", (data) => {
        // A manual /stop or bot disconnect also fires "end" - don't repost
        // a Now Playing message / re-advance in that case.
        if(data?.reason === "replaced") return;
        onPlaybackEnded(guildId, textChannel, ctx.brandName, ctx.brandColor);
    });

    queue.player.on("exception", async (err) => {
        const message = err?.exception?.message || err?.message || "unknown Lavalink error";
        console.log(`🎵 ❌ Player exception in guild ${guildId}: ${message}`);

        const retried = await retryFailedTrack(queue, textChannel, ctx.brandName, ctx.brandColor).catch(() => false);
        if(retried) return;

        const failedTitle = queue.current?.info?.title || "the current track";
        textChannel?.send({ content: `⚠️ Couldn't play **${failedTitle}** (${message}) - skipping to the next track.` }).catch(() => {});
        onPlaybackEnded(guildId, textChannel, ctx.brandName, ctx.brandColor);
    });

    queue.player.on("stuck", async () => {
        console.log(`🎵 ⚠️ Track stuck in guild ${guildId}, skipping`);

        const retried = await retryFailedTrack(queue, textChannel, ctx.brandName, ctx.brandColor).catch(() => false);
        if(retried) return;

        const failedTitle = queue.current?.info?.title || "the current track";
        textChannel?.send({ content: `⚠️ **${failedTitle}** got stuck loading - skipping to the next track.` }).catch(() => {});
        onPlaybackEnded(guildId, textChannel, ctx.brandName, ctx.brandColor);
    });

    queue.player.on("closed", (data) => {
        // The actual queue cleanup happens in music/voiceCleanup.js via the
        // client's voiceStateUpdate event - this is just visibility into WHY.
        console.log(`🎵 ⚠️ Voice connection closed in guild ${guildId}: code ${data.code} (${data.reason || "no reason given"})`);
    });

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

                attachPlayerEvents(queue, interaction.guild.id, interaction.channel, ctx);
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

            async function trySearch(prefix){
                try{
                    const result = await node.rest.resolve(`${prefix}${focused}`);
                    return result?.loadType === "search" ? result.data : [];
                }catch(err){
                    return [];
                }
            }

            try{
                let tracks = await trySearch("spsearch:");
                if(!tracks.length) tracks = await trySearch("ytsearch:");
                if(!tracks.length) tracks = await trySearch("scsearch:");

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
    },

    // -- Playlists ------------------------------------------------------

    {
        data: new SlashCommandBuilder()
            .setName("viewplaylist")
            .setDescription("View your saved playlists, or the tracks inside one")
            .addStringOption(o => o.setName("name")
                .setDescription("A specific playlist to view (leave blank to list all of them)")
                .setRequired(false)
                .setAutocomplete(true)),

        async execute(interaction){
            const name = interaction.options.getString("name");
            const playlists = getUserPlaylists(interaction.user.id);

            if(!name){
                const names = Object.keys(playlists);
                if(!names.length){
                    return interaction.reply({
                        content: "❌ You don't have any saved playlists yet. Hit the 💾 button on a Now Playing message, or use `/playlistsave`, to create one.",
                        ephemeral: true
                    });
                }
                const lines = names.map(n => `**${n}** - ${playlists[n].tracks.length} track(s)`).join("\n");
                return interaction.reply({ content: `**📁 Your Playlists**\n${lines}\n\nUse \`/viewplaylist name:<name>\` to see what's inside one.`, ephemeral: true });
            }

            const playlist = playlists[name];
            if(!playlist) return interaction.reply({ content: `❌ No playlist named **${name}**.`, ephemeral: true });

            // Full track list, not just the first page - built as embed
            // fields (1024 chars each) instead of one plain-text message,
            // since a big playlist blows straight past Discord's 2000 char
            // message limit and either gets rejected or silently cut off.
            const allLines = playlist.tracks.map((t, i) =>
                `**${i + 1}.** ${t.info.title} - ${t.info.author} \`[${formatTime(t.info.length)}]\``
            );

            const fields = [];
            let chunk = [];
            let chunkLen = 0;
            for(const line of allLines){
                if(chunkLen + line.length + 1 > 1000 || fields.length + (chunk.length ? 1 : 0) >= 25){
                    if(chunk.length) fields.push({ name: fields.length === 0 ? "Tracklist" : "\u200b", value: chunk.join("\n") });
                    chunk = [];
                    chunkLen = 0;
                }
                chunk.push(line);
                chunkLen += line.length + 1;
                if(fields.length >= 25) break; // hard embed field cap
            }
            if(chunk.length && fields.length < 25) fields.push({ name: fields.length === 0 ? "Tracklist" : "\u200b", value: chunk.join("\n") });

            const embed = new EmbedBuilder()
                .setColor("#B30000")
                .setTitle(`📁 ${name}`)
                .setDescription(`${playlist.tracks.length} track(s) total`)
                .addFields(fields.length ? fields : [{ name: "\u200b", value: "*(empty)*" }]);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        },

        async autocomplete(interaction){
            const playlists = getUserPlaylists(interaction.user.id);
            const focused = interaction.options.getFocused().toLowerCase();
            const choices = Object.keys(playlists)
                .filter(n => n.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(n => ({ name: `${n} (${playlists[n].tracks.length} tracks)`.slice(0, 100), value: n }));
            await interaction.respond(choices).catch(() => {});
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName("playlistsave")
            .setDescription("Save the current queue (now playing + up next) as a playlist")
            .addStringOption(o => o.setName("name").setDescription("Name for this playlist").setRequired(true)),

        async execute(interaction){
            const queue = getQueue(interaction.guild.id);
            if(!queue || (!queue.current && !queue.tracks.length)){
                return interaction.reply({ content: "❌ Nothing is playing or queued right now - play something first.", ephemeral: true });
            }

            const name = interaction.options.getString("name").slice(0, 50);
            // Includes history too, not just what's left to play - otherwise
            // saving partway through a session only captures the tail end
            // of what was actually queued up.
            const allTracks = [...queue.history, queue.current, ...queue.tracks].filter(Boolean);

            savePlaylist(interaction.user.id, name, allTracks);
            await interaction.reply({ content: `💾 Saved **${allTracks.length}** track(s) as playlist **${name}**. Use \`/playlistplay\` to queue it up later.`, ephemeral: true });
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName("playlistplay")
            .setDescription("Queue up one of your saved playlists")
            .addStringOption(o => o.setName("name").setDescription("Playlist to play").setRequired(true).setAutocomplete(true)),

        async execute(interaction, ctx){

            const access = checkVoiceAccess(interaction);
            if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });

            const name = interaction.options.getString("name");
            const playlist = getPlaylist(interaction.user.id, name);
            if(!playlist || !playlist.tracks.length){
                return interaction.reply({ content: `❌ No playlist named **${name}** (or it's empty).`, ephemeral: true });
            }

            await interaction.deferReply();

            const node = getIdealNode();
            if(!node) return interaction.editReply({ content: "❌ No Lavalink node connected right now - try again shortly." });

            const tracks = playlist.tracks.map(t => ({ track: t.track, info: t.info, requester: interaction.user.id }));

            let queue = getQueue(interaction.guild.id);

            if(!queue){
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

                attachPlayerEvents(queue, interaction.guild.id, interaction.channel, ctx);
            }

            queue.addMany(tracks);

            if(!queue.current){
                queue.advance();
                await playCurrent(queue);
                await postNowPlaying(queue, interaction.channel, ctx.brandName, ctx.brandColor);
                return interaction.editReply({ content: `✅ Playing playlist **${name}** (${tracks.length} track(s)).` });
            }

            await interaction.editReply({ content: `✅ Added **${tracks.length}** track(s) from playlist **${name}** to the queue.` });
        },

        async autocomplete(interaction){
            const playlists = getUserPlaylists(interaction.user.id);
            const focused = interaction.options.getFocused().toLowerCase();
            const choices = Object.keys(playlists)
                .filter(n => n.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(n => ({ name: `${n} (${playlists[n].tracks.length} tracks)`.slice(0, 100), value: n }));
            await interaction.respond(choices).catch(() => {});
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName("playlistdelete")
            .setDescription("Delete one of your saved playlists")
            .addStringOption(o => o.setName("name").setDescription("Playlist to delete").setRequired(true).setAutocomplete(true)),

        async execute(interaction){
            const name = interaction.options.getString("name");
            const ok = deletePlaylist(interaction.user.id, name);
            await interaction.reply({ content: ok ? `🗑 Deleted playlist **${name}**.` : `❌ No playlist named **${name}**.`, ephemeral: true });
        },

        async autocomplete(interaction){
            const playlists = getUserPlaylists(interaction.user.id);
            const focused = interaction.options.getFocused().toLowerCase();
            const choices = Object.keys(playlists)
                .filter(n => n.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(n => ({ name: n, value: n }));
            await interaction.respond(choices).catch(() => {});
        }
    }

];

module.exports = { musicCommands, resolveQuery, playCurrent, postNowPlaying, checkVoiceAccess, attachPlayerEvents };
