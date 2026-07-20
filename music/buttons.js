// music/buttons.js
// Handlers for the Now Playing message buttons. Every one of these enforces
// "must be in the same voice channel as the bot" via checkVoiceAccess.

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { getQueue, deleteQueue, LOOP_OFF, LOOP_TRACK, LOOP_QUEUE } = require("./queue");
const { getIdealNode, leaveVoiceChannel } = require("./manager");
const { buildNowPlayingEmbed, buildMusicButtons } = require("./embeds");
const { checkVoiceAccess, playCurrent } = require("./commands");
const { savePlaylist } = require("./playlists");

// Re-renders the now playing message in place (used after pause/resume/loop
// changes so the buttons reflect current state without spamming new messages)
async function refreshNowPlaying(interaction, queue, ctx){
    const embed = buildNowPlayingEmbed(queue, ctx.brandName, ctx.brandColor);
    const buttons = buildMusicButtons(queue);
    if(embed){
        await interaction.update({ embeds: [embed], components: buttons }).catch(() => {});
    }
}

const musicButtonHandlers = {

    async music_previous(interaction, ctx){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });

        const prev = access.queue?.previous();
        if(!prev) return interaction.reply({ content: "❌ No previous track in history.", ephemeral: true });

        await playCurrent(access.queue);
        await refreshNowPlaying(interaction, access.queue, ctx);
    },

    async music_pauseresume(interaction, ctx){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
        if(!access.queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

        access.queue.paused = !access.queue.paused;
        await access.queue.player.setPaused(access.queue.paused);
        await refreshNowPlaying(interaction, access.queue, ctx);
    },

    async music_skip(interaction, ctx){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
        if(!access.queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

        await interaction.deferUpdate();
        await access.queue.player.stopTrack(); // "end" event handles advancing + reposting
    },

    async music_stop(interaction){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
        if(!access.queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

        const node = getIdealNode();
        await access.queue.player?.stopTrack().catch(() => {});
        await leaveVoiceChannel(interaction.guild.id).catch(() => {});
        deleteQueue(interaction.guild.id);

        await interaction.update({ content: "⏹ Stopped, queue cleared, and disconnected.", embeds: [], components: [] }).catch(() => {});
    },

    async music_shuffle(interaction, ctx){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
        if(!access.queue?.tracks.length) return interaction.reply({ content: "❌ Nothing in the queue to shuffle.", ephemeral: true });

        access.queue.shuffle();
        await refreshNowPlaying(interaction, access.queue, ctx);
    },

    async music_loop(interaction, ctx){
        const access = checkVoiceAccess(interaction);
        if(!access.ok) return interaction.reply({ content: access.reason, ephemeral: true });
        if(!access.queue) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

        access.queue.cycleLoop();
        await refreshNowPlaying(interaction, access.queue, ctx);
    },

    async music_queue(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue || queue.isEmpty()){
            return interaction.reply({ content: "❌ The queue is empty.", ephemeral: true });
        }

        const lines = queue.tracks.slice(0, 10).map((t, i) =>
            `**${i + 1}.** ${t.info.title} - ${t.info.author}`
        ).join("\n") || "*(queue is empty)*";

        await interaction.reply({
            content: `**📜 Up Next** (${queue.tracks.length} total):\n${lines}`,
            ephemeral: true
        });
    },

    async music_like(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue?.current) return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });

        if(queue.likes.has(interaction.user.id)){
            queue.likes.delete(interaction.user.id);
            await interaction.reply({ content: "💔 Removed your like.", ephemeral: true });
        }else{
            queue.likes.add(interaction.user.id);
            await interaction.reply({ content: `❤️ You liked **${queue.current.info.title}**! (${queue.likes.size} total likes)`, ephemeral: true });
        }
    },

    // Opens a small modal asking for a playlist name - the actual save
    // happens in musicModalHandlers.music_saveplaylist_form below once
    // they submit it.
    async music_saveplaylist(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue || (!queue.current && !queue.tracks.length)){
            return interaction.reply({ content: "❌ Nothing is playing or queued right now.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId("music_saveplaylist_form")
            .setTitle("Save as Playlist");

        const nameInput = new TextInputBuilder()
            .setCustomId("playlist_name")
            .setLabel("Playlist name")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(50)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

        await interaction.showModal(modal);
    }

};

// Separate from musicButtonHandlers because bot.js only merges buttons into
// buttonHandlers - modal submits are routed through their own map, so this
// gets merged into modalHandlers in bot.js instead.
const musicModalHandlers = {

    async music_saveplaylist_form(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue || (!queue.current && !queue.tracks.length)){
            return interaction.reply({ content: "❌ Nothing is playing or queued anymore - nothing to save.", ephemeral: true });
        }

        const name = interaction.fields.getTextInputValue("playlist_name").trim().slice(0, 50);
        if(!name) return interaction.reply({ content: "❌ Playlist name can't be empty.", ephemeral: true });

        const allTracks = [queue.current, ...queue.tracks].filter(Boolean);
        savePlaylist(interaction.user.id, name, allTracks);

        await interaction.reply({
            content: `💾 Saved **${allTracks.length}** track(s) as playlist **${name}**. Use \`/playlistplay\` to queue it up again later, or \`/viewplaylist\` to see it.`,
            ephemeral: true
        });
    }

};

module.exports = { musicButtonHandlers, musicModalHandlers };
