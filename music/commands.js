// music/commands.js
// All music slash commands (/play, /pause, /resume, /skip, /previous,
// /stop, /queue, /shuffle, /loop, /volume, /nowplaying) plus the
// autocomplete handler for /play. Exported as `musicSlashCommands` in the
// exact same { data, execute } shape your existing commands.js uses, so
// bot.js and deploy-commands.js can merge them in with zero surprises.

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { queueManager } = require("./queueManager");
const { resolve } = require("./resolver");
const { buildNowPlayingEmbed, buildQueueEmbed } = require("./embeds");
const { buildControlRows } = require("./buttons");
const { playNext, playPrevious, destroyQueue, sendOrUpdateNowPlaying, registerPlayerEvents } = require("./player");
const { inSameVoice, cycleLoop, loopLabel } = require("./util");

const MUSIC_COLOR = "#B30000";

async function musicAutocomplete(interaction) {
    const focused = interaction.options.getFocused();
    if (!focused || focused.trim().length < 2) return interaction.respond([]);

    try {
        const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(focused)}&limit=20`);
        const data = await res.json();

        const choices = (data.data || [])
            .slice(0, 25)
            .map(t => {
                const name = `${t.title} — ${t.artist.name}`.slice(0, 100);
                const value = `${t.artist.name} ${t.title}`.slice(0, 100);
                return { name, value };
            });

        await interaction.respond(choices);
    } catch (err) {
        console.log(`[music] ⚠️ autocomplete lookup failed: ${err.message}`);
        await interaction.respond([]).catch(() => {});
    }
}

const musicSlashCommands = [

    // -- /play ---------------------------------------------------------------
    {
        data: new SlashCommandBuilder()
            .setName("play")
            .setDescription("Play a song, playlist, or link from YouTube, Spotify, Apple Music, SoundCloud, Deezer, or Bandcamp")
            .addStringOption(o => o
                .setName("query")
                .setDescription("Song name, artist, or a link")
                .setRequired(true)
                .setAutocomplete(true)),

        async execute(interaction) {

            const voiceChannel = interaction.member.voice?.channel;
            if (!voiceChannel) {
                return interaction.reply({ content: "❌ Join a voice channel first.", ephemeral: true });
            }

            const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
            if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
                return interaction.reply({ content: "❌ I need **Connect** and **Speak** permissions in your voice channel.", ephemeral: true });
            }

            await interaction.deferReply();

            const shoukaku = interaction.client.shoukaku;
            const node = shoukaku?.getIdealNode();
            if (!node) {
                return interaction.editReply("❌ No Lavalink music node is currently connected. Check your Lavalink connection and try again in a moment.");
            }

            let queue = queueManager.get(interaction.guildId);

            // Create a fresh queue + join voice if this guild doesn't have one yet,
            // or if the previous player somehow died without cleaning up.
            if (!queue || !queue.shoukakuPlayer) {
                let player;
                try {
                    player = await shoukaku.joinVoiceChannel({
                        guildId: interaction.guildId,
                        channelId: voiceChannel.id,
                        shardId: interaction.guild.shardId ?? 0,
                        deaf: true
                    });
                } catch (err) {
                    console.error(`[music] ❌ failed to join voice channel in guild ${interaction.guildId}:`, err.message);
                    return interaction.editReply(`❌ Couldn't join your voice channel: \`${err.message}\``);
                }

                queue = queueManager.create({
                    guildId: interaction.guildId,
                    voiceChannelId: voiceChannel.id,
                    textChannel: interaction.channel,
                    shoukaku,
                    shoukakuPlayer: player
                });
                registerPlayerEvents(queue);
            }

            const query = interaction.options.getString("query", true);

            let result;
            try {
                result = await resolve(queue.shoukakuPlayer.node, query, { id: interaction.user.id, tag: interaction.user.tag });
            } catch (err) {
                console.error(`[music] ❌ resolve error for "${query}" in guild ${interaction.guildId}:`, err.message);
                return interaction.editReply(`❌ ${err.message}`);
            }

            if (!result.tracks.length) {
                return interaction.editReply("❌ No playable results found for that.");
            }

            queue.tracks.push(...result.tracks);

            const wasIdle = !queue.current;
            if (wasIdle) await playNext(queue, { respectTrackLoop: false });

            const embed = new EmbedBuilder()
                .setColor(MUSIC_COLOR)
                .setDescription(
                    result.tracks.length === 1
                        ? `✅ Added **${result.tracks[0].title}** to the queue${wasIdle ? "" : ` (position #${queue.tracks.length})`}`
                        : `✅ Added **${result.tracks.length} tracks**${result.playlistName ? ` from **${result.playlistName}**` : ""} to the queue`
                );

            await interaction.editReply({ embeds: [embed] });
        }
    },

    // -- /pause ----------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || !queue.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            await queue.shoukakuPlayer.setPaused(true);
            await sendOrUpdateNowPlaying(queue);
            await interaction.reply({ content: "⏸ Paused.", ephemeral: true });
        }
    },

    // -- /resume -----------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("resume").setDescription("Resume the current song"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || !queue.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            await queue.shoukakuPlayer.setPaused(false);
            await sendOrUpdateNowPlaying(queue);
            await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
        }
    },

    // -- /skip -----------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || !queue.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            const skipped = queue.current;
            await playNext(queue, { respectTrackLoop: false });
            await interaction.reply({ content: `⏭ Skipped **${skipped.title}**.`, ephemeral: true });
        }
    },

    // -- /previous ---------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous song"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            const ok = await playPrevious(queue);
            await interaction.reply({ content: ok ? "⏮ Playing the previous track." : "❌ No previous track in history.", ephemeral: true });
        }
    },

    // -- /stop -----------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("stop").setDescription("Stop music, clear the queue, and disconnect"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            queue.tracks = [];
            await destroyQueue(queue, `Stopped by ${interaction.user.tag}.`);
            await interaction.reply({ content: "⏹ Stopped and disconnected.", ephemeral: true });
        }
    },

    // -- /queue ------------------------------------------------------------------
    {
        data: new SlashCommandBuilder()
            .setName("queue")
            .setDescription("Show the music queue")
            .addIntegerOption(o => o.setName("page").setDescription("Page number").setMinValue(1)),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || (!queue.current && queue.tracks.length === 0)) {
                return interaction.reply({ content: "❌ The queue is empty.", ephemeral: true });
            }
            const page = interaction.options.getInteger("page") || 1;
            await interaction.reply({ embeds: [buildQueueEmbed(queue, page)] });
        }
    },

    // -- /shuffle ----------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || queue.tracks.length < 2) return interaction.reply({ content: "❌ Not enough songs queued to shuffle.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            for (let i = queue.tracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
            }

            await sendOrUpdateNowPlaying(queue);
            await interaction.reply({ content: "🔀 Queue shuffled.", ephemeral: true });
        }
    },

    // -- /loop -------------------------------------------------------------------
    {
        data: new SlashCommandBuilder()
            .setName("loop")
            .setDescription("Set the loop mode")
            .addStringOption(o => o
                .setName("mode")
                .setDescription("Loop mode (leave blank to cycle through modes)")
                .addChoices(
                    { name: "Off", value: "off" },
                    { name: "Current Song", value: "track" },
                    { name: "Entire Queue", value: "queue" }
                )),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            const chosen = interaction.options.getString("mode");
            queue.loop = chosen || cycleLoop(queue.loop);
            await sendOrUpdateNowPlaying(queue);
            await interaction.reply({ content: `🔁 Loop mode: **${loopLabel(queue.loop)}**`, ephemeral: true });
        }
    },

    // -- /volume -----------------------------------------------------------------
    {
        data: new SlashCommandBuilder()
            .setName("volume")
            .setDescription("Set or view the playback volume")
            .addIntegerOption(o => o.setName("percent").setDescription("0-200").setMinValue(0).setMaxValue(200)),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            const percent = interaction.options.getInteger("percent");
            if (percent === null) {
                return interaction.reply({ content: `🔊 Current volume: **${queue.volume}%**`, ephemeral: true });
            }
            if (!inSameVoice(interaction, queue)) return interaction.reply({ content: "❌ You need to be in the same voice channel.", ephemeral: true });

            queue.volume = percent;
            await queue.shoukakuPlayer.setGlobalVolume(percent);
            await sendOrUpdateNowPlaying(queue);
            await interaction.reply({ content: `🔊 Volume set to **${percent}%**`, ephemeral: true });
        }
    },

    // -- /nowplaying ---------------------------------------------------------------
    {
        data: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the currently playing song"),
        async execute(interaction) {
            const queue = queueManager.get(interaction.guildId);
            if (!queue || !queue.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

            await interaction.reply({ embeds: [buildNowPlayingEmbed(queue)], components: buildControlRows(queue) });
        }
    }

];

module.exports = { musicSlashCommands, musicAutocomplete };
