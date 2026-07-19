// music/player.js
// The "brain" of playback. Everything that changes what's currently
// playing - starting a track, advancing to the next one, going back to
// the previous one, or tearing the whole session down - happens here.
// Slash commands and buttons both call INTO these functions instead of
// touching the Shoukaku player directly, so there's exactly one place
// that decides "what happens next" and every entry point (auto-advance,
// /skip, the skip button, etc.) behaves identically.

const { queueManager } = require("./queueManager");
const { buildNowPlayingEmbed } = require("./embeds");
const { buildControlRows } = require("./buttons");

// Posts the Now Playing message if there isn't one yet, otherwise edits
// the existing one in place - this is what makes the buttons feel "live"
// instead of spamming a new message per song.
async function sendOrUpdateNowPlaying(queue) {
    if (!queue.current) return;

    const embed = buildNowPlayingEmbed(queue);
    const rows = buildControlRows(queue);

    try {
        if (queue.npMessage) {
            await queue.npMessage.edit({ embeds: [embed], components: rows });
        } else {
            queue.npMessage = await queue.textChannel.send({ embeds: [embed], components: rows });
        }
    } catch (err) {
        console.log(`[music] ⚠️ could not send/update Now Playing message in guild ${queue.guildId}: ${err.message}`);
    }
}

async function playTrack(queue, track) {
    queue.current = track;
    queue.likes = new Set(); // likes are per-track, reset on every new song
    clearTimeout(queue.idleTimer);

    try {
        await queue.shoukakuPlayer.playTrack({ track: { encoded: track.encoded } });
    } catch (err) {
        console.error(`[music] ❌ failed to play "${track.title}" in guild ${queue.guildId}:`, err.message);
        queue.textChannel?.send({ content: `⚠️ Couldn't play **${track.title}** - skipping.` }).catch(() => {});
        await playNext(queue, { respectTrackLoop: false });
    }
}

// Advances the queue. `respectTrackLoop` is true for natural
// end-of-track/error advances (so "loop current song" works), and false
// for a manual /skip or skip button press (a manual skip should always
// move on, even if loop=track is active).
async function playNext(queue, { respectTrackLoop = true } = {}) {
    if (respectTrackLoop && queue.loop === "track" && queue.current) {
        return playTrack(queue, queue.current);
    }

    if (queue.current) {
        queue.previous.push(queue.current);
        if (queue.previous.length > 50) queue.previous.shift(); // cap history so it can't grow forever
        if (queue.loop === "queue") queue.tracks.push(queue.current);
    }

    const next = queue.tracks.shift();

    if (!next) {
        queue.current = null;
        if (queue.npMessage) {
            await queue.npMessage.edit({
                embeds: [{
                    color: 0xB30000,
                    description: "⏹ **Queue finished.** Add more songs with `/play`, or I'll leave the channel in 2 minutes."
                }],
                components: []
            }).catch(() => {});
        }
        scheduleIdleDisconnect(queue);
        return;
    }

    await playTrack(queue, next);
}

// Pops the last played track off history and plays it again, pushing the
// current track back to the front of the upcoming queue.
async function playPrevious(queue) {
    const prev = queue.previous.pop();
    if (!prev) return false;
    if (queue.current) queue.tracks.unshift(queue.current);
    await playTrack(queue, prev);
    return true;
}

// If the queue has been empty (nothing playing) for 2 minutes, leave the
// voice channel - matches how most "premium" music bots behave instead of
// sitting in a channel forever doing nothing.
function scheduleIdleDisconnect(queue) {
    clearTimeout(queue.idleTimer);
    queue.idleTimer = setTimeout(async () => {
        const q = queueManager.get(queue.guildId);
        if (q && !q.current) {
            await destroyQueue(q, "Queue was empty for 2 minutes - disconnecting.");
        }
    }, 2 * 60 * 1000);
}

// Full teardown: stop Lavalink, leave voice, disable the old Now Playing
// message's buttons, and forget this guild's queue entirely.
async function destroyQueue(queue, reason) {
    queue.stopping = true; // tells the 'end' event listener below to ignore what happens next
    clearTimeout(queue.idleTimer);
    clearTimeout(queue.aloneTimer);

    try { await queue.shoukakuPlayer.destroy(); } catch (err) { console.log(`[music] destroy player: ${err.message}`); }
    try { await queue.shoukaku.leaveVoiceChannel(queue.guildId); } catch (err) { console.log(`[music] leave voice: ${err.message}`); }

    if (queue.npMessage) {
        await queue.npMessage.edit({ components: [] }).catch(() => {});
    }
    if (reason && queue.textChannel) {
        queue.textChannel.send({ content: `👋 ${reason}` }).catch(() => {});
    }

    queueManager.delete(queue.guildId);
}

// Wires up the Lavalink player events for a freshly created queue.
// This is where auto-advance, error recovery, and reconnect logging live.
function registerPlayerEvents(queue) {
    const player = queue.shoukakuPlayer;

    player.on("start", () => {
        console.log(`[music] ▶️ now playing "${queue.current?.title}" in guild ${queue.guildId}`);
        sendOrUpdateNowPlaying(queue);
    });

    player.on("end", (data) => {
        // Ignore events caused by US replacing the track on purpose (skip/
        // previous both call playTrack() again, which fires an 'end' event
        // for the OLD track with reason "replaced") or by a deliberate stop.
        if (queue.stopping) return;
        if (data.reason === "replaced") return;

        console.log(`[music] ⏹ track ended in guild ${queue.guildId} (reason: ${data.reason})`);
        playNext(queue, { respectTrackLoop: true }).catch(err =>
            console.error(`[music] ❌ error advancing queue in guild ${queue.guildId}:`, err.message)
        );
    });

    player.on("exception", (data) => {
        console.error(`[music] ❌ track exception in guild ${queue.guildId}:`, data.exception?.message);
        queue.textChannel?.send({
            content: `⚠️ Playback error on **${queue.current?.title || "this track"}**: \`${data.exception?.message || "unknown error"}\` — skipping.`
        }).catch(() => {});
        if (!queue.stopping) playNext(queue, { respectTrackLoop: false }).catch(() => {});
    });

    player.on("stuck", (data) => {
        console.warn(`[music] ⚠️ track stuck in guild ${queue.guildId} (threshold ${data.thresholdMs}ms) — skipping.`);
        if (!queue.stopping) playNext(queue, { respectTrackLoop: false }).catch(() => {});
    });

    player.on("closed", (data) => {
        console.warn(`[music] ⚠️ voice connection closed in guild ${queue.guildId}: code ${data.code} (${data.reason || "no reason given"})`);
    });

    player.on("resumed", () => {
        console.log(`[music] 🔁 player resumed after a Lavalink reconnect in guild ${queue.guildId}`);
    });
}

module.exports = {
    playTrack,
    playNext,
    playPrevious,
    destroyQueue,
    sendOrUpdateNowPlaying,
    scheduleIdleDisconnect,
    registerPlayerEvents
};
