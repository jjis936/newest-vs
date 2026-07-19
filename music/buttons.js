// music/buttons.js
// Builds the two rows of interactive buttons shown under the Now Playing
// embed, and handles clicks on them. Exported `musicButtonHandlers` gets
// merged into bot.js's existing button-handler lookup, so these just work
// alongside all of your existing buttons (leave_vouch, giveaway_enter, etc).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { queueManager } = require("./queueManager");
const { inSameVoice, cycleLoop, loopLabel } = require("./util");
const { buildQueueEmbed } = require("./embeds");

function buildControlRows(queue) {
    const paused = !!queue.shoukakuPlayer?.paused;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_previous")
            .setEmoji("⏮")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queue.previous.length === 0),
        new ButtonBuilder()
            .setCustomId("music_pauseresume")
            .setEmoji(paused ? "▶️" : "⏸")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("music_skip")
            .setEmoji("⏭")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("music_stop")
            .setEmoji("⏹")
            .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_shuffle")
            .setEmoji("🔀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queue.tracks.length < 2),
        new ButtonBuilder()
            .setCustomId("music_loop")
            .setEmoji("🔁")
            .setLabel(loopLabel(queue.loop))
            .setStyle(queue.loop === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("music_queue")
            .setEmoji("📜")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("music_like")
            .setEmoji("❤️")
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

// Shared guard: makes sure a queue exists and the clicking user is in the
// same voice channel as the bot before letting them control playback.
async function guard(interaction) {
    const queue = queueManager.get(interaction.guildId);
    if (!queue) {
        await interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
        return null;
    }
    if (!inSameVoice(interaction, queue)) {
        await interaction.reply({ content: "❌ You need to be in the same voice channel as the bot to do that.", ephemeral: true });
        return null;
    }
    return queue;
}

const musicButtonHandlers = {

    async music_previous(interaction) {
        // Lazy-require to avoid a circular require between player.js <-> buttons.js
        const { playPrevious } = require("./player");
        const queue = await guard(interaction);
        if (!queue) return;
        const ok = await playPrevious(queue);
        await interaction.reply({ content: ok ? "⏮ Playing the previous track." : "❌ No previous track in history.", ephemeral: true });
    },

    async music_pauseresume(interaction) {
        const queue = await guard(interaction);
        if (!queue || !queue.current) return;
        const { sendOrUpdateNowPlaying } = require("./player");
        const nowPaused = !queue.shoukakuPlayer.paused;
        await queue.shoukakuPlayer.setPaused(nowPaused);
        await sendOrUpdateNowPlaying(queue);
        await interaction.reply({ content: nowPaused ? "⏸ Paused." : "▶️ Resumed.", ephemeral: true });
    },

    async music_skip(interaction) {
        const queue = await guard(interaction);
        if (!queue || !queue.current) return;
        const { playNext } = require("./player");
        const skipped = queue.current;
        await playNext(queue, { respectTrackLoop: false });
        await interaction.reply({ content: `⏭ Skipped **${skipped.title}**.`, ephemeral: true });
    },

    async music_stop(interaction) {
        const queue = await guard(interaction);
        if (!queue) return;
        const { destroyQueue } = require("./player");
        queue.tracks = [];
        await destroyQueue(queue, `Stopped by ${interaction.user.tag}.`);
        await interaction.reply({ content: "⏹ Stopped and disconnected.", ephemeral: true });
    },

    async music_shuffle(interaction) {
        const queue = await guard(interaction);
        if (!queue) return;
        if (queue.tracks.length < 2) {
            return interaction.reply({ content: "❌ Not enough songs queued to shuffle.", ephemeral: true });
        }
        for (let i = queue.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
        const { sendOrUpdateNowPlaying } = require("./player");
        await sendOrUpdateNowPlaying(queue);
        await interaction.reply({ content: "🔀 Queue shuffled.", ephemeral: true });
    },

    async music_loop(interaction) {
        const queue = await guard(interaction);
        if (!queue) return;
        queue.loop = cycleLoop(queue.loop);
        const { sendOrUpdateNowPlaying } = require("./player");
        await sendOrUpdateNowPlaying(queue);
        await interaction.reply({ content: `🔁 Loop mode: **${loopLabel(queue.loop)}**`, ephemeral: true });
    },

    async music_queue(interaction) {
        const queue = queueManager.get(interaction.guildId);
        if (!queue || (!queue.current && queue.tracks.length === 0)) {
            return interaction.reply({ content: "❌ The queue is empty.", ephemeral: true });
        }
        await interaction.reply({ embeds: [buildQueueEmbed(queue, 1)], ephemeral: true });
    },

    async music_like(interaction) {
        const queue = queueManager.get(interaction.guildId);
        if (!queue || !queue.current) {
            return interaction.reply({ content: "❌ Nothing is playing.", ephemeral: true });
        }
        if (queue.likes.has(interaction.user.id)) {
            queue.likes.delete(interaction.user.id);
            await interaction.reply({ content: "💔 Removed from your likes.", ephemeral: true });
        } else {
            queue.likes.add(interaction.user.id);
            await interaction.reply({
                content: `❤️ Liked **${queue.current.title}**! (${queue.likes.size} like${queue.likes.size === 1 ? "" : "s"})`,
                ephemeral: true
            });
        }
    }

};

module.exports = { buildControlRows, musicButtonHandlers };
