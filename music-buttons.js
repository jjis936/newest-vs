// music/buttons.js
// Handlers for the Now Playing message buttons. Every one of these enforces
// "must be in the same voice channel as the bot" via checkVoiceAccess.

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { getQueue, deleteQueue, LOOP_OFF, LOOP_TRACK, LOOP_QUEUE } = require("./music-queue");
const { getIdealNode, leaveVoiceChannel } = require("./music-manager");
const { buildNowPlayingEmbed, buildMusicButtons } = require("./music-embeds");
const { checkVoiceAccess, playCurrent, startProgressUpdater, stopProgressUpdater } = require("./music-commands");
const { addTrackToPlaylist } = require("./music-playlists");

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
        startProgressUpdater(access.queue, interaction.client, ctx.brandName, ctx.brandColor);
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
        stopProgressUpdater(interaction.guild.id);
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

    async music_addplaylist(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue?.current) return interaction.reply({ content: "❌ Nothing is playing to add.", ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId("playlist_add_form")
            .setTitle("Add to Playlist");

        const nameInput = new TextInputBuilder()
            .setCustomId("playlist_name")
            .setLabel("Playlist name (new or existing)")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(50)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

        await interaction.showModal(modal);
    }

};

const musicModalHandlers = {

    async playlist_add_form(interaction){
        const queue = getQueue(interaction.guild.id);
        if(!queue?.current){
            return interaction.reply({ content: "❌ Nothing was playing by the time you submitted that.", ephemeral: true });
        }

        const playlistName = interaction.fields.getTextInputValue("playlist_name");
        const playlist = addTrackToPlaylist(interaction.user.id, playlistName, queue.current);

        await interaction.reply({
            content: `✅ Added **${queue.current.info.title}** to your playlist **${playlist.name}** (${playlist.tracks.length} track${playlist.tracks.length === 1 ? "" : "s"} total).`,
            ephemeral: true
        });
    }

};

module.exports = { musicButtonHandlers, musicModalHandlers };
