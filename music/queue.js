// music/queue.js
// One GuildQueue per server. Holds the upcoming tracks, what's currently
// playing, loop mode, and a small history stack so /previous works.

const queues = new Map(); // guildId -> GuildQueue

const LOOP_OFF = "off";
const LOOP_TRACK = "track";
const LOOP_QUEUE = "queue";

class GuildQueue {

    constructor(guildId, voiceChannelId, textChannelId){
        this.guildId = guildId;
        this.voiceChannelId = voiceChannelId;
        this.textChannelId = textChannelId;

        this.player = null;       // Shoukaku player instance, set once connected
        this.tracks = [];         // upcoming tracks: { track, info, requester }
        this.history = [];        // played tracks, most recent last - powers /previous
        this.current = null;      // the track object currently playing

        this.loop = LOOP_OFF;     // "off" | "track" | "queue"
        this.volume = 100;        // 0-1000 (Lavalink percentage, 100 = normal)
        this.paused = false;

        this.nowPlayingMessageId = null;
        this.nowPlayingChannelId = null;
        this.startedAt = null;    // timestamp playback of `current` began, for progress bar
        this.likes = new Set();   // userIds who've "liked" the current track
    }

    add(track){
        this.tracks.push(track);
    }

    addMany(tracks){
        this.tracks.push(...tracks);
    }

    // Returns the next track to play, respecting loop mode, and updates
    // history/current accordingly. Returns null if nothing left to play.
    advance(){

        if(this.current){
            this.history.push(this.current);
            if(this.history.length > 50) this.history.shift(); // cap memory use
        }

        if(this.loop === LOOP_TRACK && this.current){
            // Same track again - don't touch the queue
            this.startedAt = Date.now();
            this.likes.clear();
            return this.current;
        }

        if(this.loop === LOOP_QUEUE && this.current){
            // Put the just-finished track at the back of the line
            this.tracks.push(this.current);
        }

        const next = this.tracks.shift() || null;
        this.current = next;
        this.startedAt = next ? Date.now() : null;
        this.likes.clear();
        return next;
    }

    // Steps backward using history - puts the current track back at the
    // front of the queue and pulls the last played track back in.
    previous(){
        const prev = this.history.pop();
        if(!prev) return null;

        if(this.current) this.tracks.unshift(this.current);
        this.current = prev;
        this.startedAt = Date.now();
        this.likes.clear();
        return prev;
    }

    shuffle(){
        for(let i = this.tracks.length - 1; i > 0; i--){
            const j = Math.floor(Math.random() * (i + 1));
            [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
        }
    }

    clear(){
        this.tracks = [];
    }

    remove(position){
        // 1-indexed for user-facing commands
        if(position < 1 || position > this.tracks.length) return null;
        return this.tracks.splice(position - 1, 1)[0];
    }

    cycleLoop(){
        if(this.loop === LOOP_OFF) this.loop = LOOP_TRACK;
        else if(this.loop === LOOP_TRACK) this.loop = LOOP_QUEUE;
        else this.loop = LOOP_OFF;
        return this.loop;
    }

    // Rough estimate: sum of remaining track lengths + time left on current
    estimatedWaitMs(){
        const remainingCurrent = this.current
            ? Math.max(0, this.current.info.length - (Date.now() - this.startedAt))
            : 0;
        const queueTotal = this.tracks.reduce((sum, t) => sum + (t.info.length || 0), 0);
        return remainingCurrent + queueTotal;
    }

    isEmpty(){
        return !this.current && this.tracks.length === 0;
    }

}

function getQueue(guildId){
    return queues.get(guildId) || null;
}

function createQueue(guildId, voiceChannelId, textChannelId){
    const q = new GuildQueue(guildId, voiceChannelId, textChannelId);
    queues.set(guildId, q);
    return q;
}

function deleteQueue(guildId){
    queues.delete(guildId);
}

module.exports = {
    getQueue,
    createQueue,
    deleteQueue,
    LOOP_OFF,
    LOOP_TRACK,
    LOOP_QUEUE
};
