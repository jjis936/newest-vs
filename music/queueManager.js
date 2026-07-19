// music/queueManager.js
// One GuildQueue instance exists per server that currently has music
// active. It holds everything about that session: the Shoukaku player,
// the upcoming tracks, play history (for /previous), loop mode, volume,
// the live "Now Playing" message, and a couple of cleanup timers.
//
// queueManager is a simple in-memory Map keyed by guildId. Because
// Node.js caches modules, every file that does require("./queueManager")
// gets the exact same Map - so commands.js, buttons.js, player.js etc.
// are all always looking at the same live state. No database needed for
// this since queues don't need to survive a bot restart.

class GuildQueue {
    constructor({ guildId, voiceChannelId, textChannel, shoukaku, shoukakuPlayer }) {
        this.guildId = guildId;
        this.voiceChannelId = voiceChannelId;
        this.textChannel = textChannel;       // discord.js channel to post/edit the Now Playing embed in
        this.shoukaku = shoukaku;             // the Shoukaku manager instance
        this.shoukakuPlayer = shoukakuPlayer; // this guild's Lavalink player

        this.tracks = [];        // upcoming queue (does NOT include the currently playing track)
        this.previous = [];      // stack of previously played tracks, for /previous
        this.current = null;     // the track object currently playing

        this.loop = "off";       // "off" | "track" | "queue"
        this.volume = 100;       // percent, 0-200 (Lavalink's setGlobalVolume range)
        this.likes = new Set();  // userIds who "liked" the CURRENTLY playing track (reset per track)

        this.npMessage = null;   // the live Now Playing message we keep editing

        this.idleTimer = null;   // disconnect timer for "queue finished, nobody added more"
        this.aloneTimer = null;  // disconnect timer for "bot is alone in the voice channel"
        this.stopping = false;  // true while we're deliberately tearing this queue down
                                 // (lets the Lavalink 'end' event handler know to do nothing)
    }
}

const store = new Map();

const queueManager = {
    get(guildId) {
        return store.get(guildId);
    },
    create(options) {
        const queue = new GuildQueue(options);
        store.set(options.guildId, queue);
        return queue;
    },
    delete(guildId) {
        store.delete(guildId);
    },
    all() {
        return store;
    }
};

module.exports = { queueManager, GuildQueue };
