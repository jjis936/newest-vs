// music/embeds.js
// Builds the two embeds the music system posts: the premium "Now Playing"
// card (with progress bar, artwork, requester, etc.) and the paginated
// queue list (with a running estimated-wait-time per song).

const { EmbedBuilder } = require("discord.js");
const { formatTime, progressBar, loopLabel } = require("./util");

const MUSIC_COLOR = "#B30000";

function buildNowPlayingEmbed(queue) {
    const track = queue.current;
    const position = queue.shoukakuPlayer?.position || 0;

    const embed = new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setAuthor({ name: "🎵 Now Playing" })
        .setTitle(track.title)
        .setDescription(`by **${track.author}**`)
        .addFields(
            { name: "⏱ Duration", value: track.isStream ? "LIVE" : formatTime(track.length), inline: true },
            { name: "👤 Requested by", value: `<@${track.requester.id}>`, inline: true },
            { name: "🔊 Source", value: track.sourceName || "Unknown", inline: true },
            { name: "📜 Up Next", value: `${queue.tracks.length} song(s)`, inline: true },
            { name: "🔁 Loop", value: loopLabel(queue.loop), inline: true },
            { name: "🔊 Volume", value: `${queue.volume}%`, inline: true }
        )
        .setFooter({ text: "Sinner Services Music" })
        .setTimestamp();

    if (!track.isStream) {
        embed.addFields({ name: "\u200b", value: progressBar(position, track.length) });
    }
    if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

    return embed;
}

function buildQueueEmbed(queue, page = 1) {
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(queue.tracks.length / perPage));
    page = Math.min(Math.max(page, 1), totalPages);
    const start = (page - 1) * perPage;
    const slice = queue.tracks.slice(start, start + perPage);

    // Running "estimated wait time" counter - starts with whatever time is
    // left on the currently playing track, then adds each queued song's
    // length in order so every entry shows how long until it's up.
    let runningMs = 0;
    if (queue.current && !queue.current.isStream) {
        runningMs = Math.max((queue.current.length || 0) - (queue.shoukakuPlayer?.position || 0), 0);
    }
    for (let i = 0; i < start; i++) runningMs += queue.tracks[i]?.length || 0;

    const lines = slice.map((t, i) => {
        const line = `**${start + i + 1}.** ${t.title} — *${t.author}* \`${t.isStream ? "LIVE" : formatTime(t.length)}\` • ETA \`${formatTime(runningMs)}\` • <@${t.requester.id}>`;
        runningMs += t.length || 0;
        return line;
    });

    const embed = new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setTitle("📜 Music Queue")
        .setFooter({ text: `Page ${page}/${totalPages} • ${queue.tracks.length} song(s) queued • Loop: ${loopLabel(queue.loop)}` })
        .setTimestamp();

    if (queue.current) {
        embed.addFields({
            name: "▶️ Now Playing",
            value: `${queue.current.title} — *${queue.current.author}*\n${progressBar(queue.shoukakuPlayer?.position || 0, queue.current.length)}`
        });
    }

    embed.addFields({
        name: "Up Next",
        value: lines.length ? lines.join("\n") : "*Nothing queued - add more with /play*"
    });

    return embed;
}

module.exports = { buildNowPlayingEmbed, buildQueueEmbed };
