// music/util.js
// Small, dependency-free helpers shared by the rest of the music system.
// Kept in one place so formatting/behaviour stays consistent everywhere
// (the now-playing embed, the queue embed, and slash commands all need
// the same time format and loop-mode logic).

// Formats milliseconds as m:ss or h:mm:ss
function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const ss = String(s).padStart(2, "0");
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
    return `${m}:${ss}`;
}

// Builds a "01:12 ━━━━━━━━━ 02:01" style progress bar.
function progressBar(positionMs, durationMs, size = 18) {
    if (!durationMs || durationMs <= 0) {
        return `🔴 LIVE`;
    }
    const ratio = Math.min(Math.max(positionMs / durationMs, 0), 1);
    const filled = Math.round(ratio * size);
    const bar = "▬".repeat(filled) + "🔘" + "▬".repeat(Math.max(size - filled, 0));
    return `${formatTime(positionMs)} ${bar} ${formatTime(durationMs)}`;
}

// Only users standing in the SAME voice channel as the bot may control
// playback - this stops randoms in other channels/text chat from messing
// with someone else's music session.
function inSameVoice(interaction, queue) {
    const vc = interaction.member?.voice?.channelId;
    return !!vc && !!queue && vc === queue.voiceChannelId;
}

// Loop mode cycles: off -> current song -> entire queue -> off ...
function cycleLoop(current) {
    if (current === "off") return "track";
    if (current === "track") return "queue";
    return "off";
}

function loopLabel(mode) {
    if (mode === "track") return "Current Song";
    if (mode === "queue") return "Entire Queue";
    return "Off";
}

module.exports = { formatTime, progressBar, inSameVoice, cycleLoop, loopLabel };
