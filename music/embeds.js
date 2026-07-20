// music/embeds.js
// Builds the "Now Playing" embed + its buttons. Kept separate from the
// commands/buttons themselves so the look can be tweaked in one place.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { LOOP_OFF, LOOP_TRACK, LOOP_QUEUE } = require("./queue");

function formatTime(ms){
    if(!ms || ms < 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Builds a text progress bar like: 01:12 ━━━━●━━━━━ 02:01
function progressBar(elapsedMs, totalMs, size = 14){
    if(!totalMs || totalMs <= 0){
        return `${formatTime(elapsedMs)} ━━━━━━━━━━━━━━ 🔴 LIVE`;
    }
    const ratio = Math.min(1, Math.max(0, elapsedMs / totalMs));
    const filled = Math.round(ratio * size);
    const bar = "━".repeat(filled) + "●" + "━".repeat(Math.max(0, size - filled));
    return `${formatTime(elapsedMs)} ${bar} ${formatTime(totalMs)}`;
}

function sourceEmoji(sourceName){
    const map = {
        youtube: "▶️", soundcloud: "🟠", spotify: "🟢",
        applemusic: "🍎", deezer: "🎵", bandcamp: "🎸"
    };
    return map[sourceName] || "🎶";
}

function buildNowPlayingEmbed(queue, brandName, brandColor){

    const track = queue.current;
    if(!track) return null;

    const elapsed = Date.now() - queue.startedAt;
    const loopLabel = { [LOOP_OFF]: "Off", [LOOP_TRACK]: "Track", [LOOP_QUEUE]: "Queue" }[queue.loop];

    const embed = new EmbedBuilder()
        .setColor(brandColor || "#B30000")
        .setTitle("🎵 Now Playing")
        .setDescription(`**${track.info.title}**\n${track.info.author}`)
        .addFields(
            { name: "⏱ Duration", value: formatTime(track.info.length), inline: true },
            { name: "👤 Requested by", value: `<@${track.requester}>`, inline: true },
            { name: `${sourceEmoji(track.info.sourceName)} Source`, value: track.info.sourceName || "unknown", inline: true },
            { name: "📜 Up Next", value: `${queue.tracks.length} track(s) in queue`, inline: true },
            { name: "🔁 Loop", value: loopLabel, inline: true },
            { name: "❤️ Likes", value: `${queue.likes.size}`, inline: true },
            { name: "Progress", value: progressBar(elapsed, track.info.length) }
        )
        .setFooter({ text: brandName || "Music" })
        .setTimestamp();

    if(track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

    return embed;
}

function buildMusicButtons(queue){

    const loopLabel = { [LOOP_OFF]: "Off", [LOOP_TRACK]: "Track", [LOOP_QUEUE]: "Queue" }[queue.loop];

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_previous").setEmoji("⏮").setStyle(ButtonStyle.Secondary).setDisabled(queue.history.length === 0),
        new ButtonBuilder().setCustomId("music_pauseresume").setEmoji(queue.paused ? "▶️" : "⏸").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("music_skip").setEmoji("⏭").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_stop").setEmoji("⏹").setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(queue.tracks.length < 2),
        new ButtonBuilder().setCustomId("music_loop").setEmoji("🔁").setLabel(loopLabel).setStyle(queue.loop === LOOP_OFF ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId("music_queue").setEmoji("📜").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_like").setEmoji("❤️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_saveplaylist").setEmoji("💾").setLabel("Save Playlist").setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

module.exports = { buildNowPlayingEmbed, buildMusicButtons, formatTime, progressBar };
