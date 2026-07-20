// music/playlists.js
// Tiny JSON-file store for saved playlists, one per user (playlists are
// personal, not per-server, so a user's playlists follow them between
// servers the bot is in). Mirrors the same read/write pattern the rest of
// the bot uses in commands.js's DATA_DIR.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, "playlists.json");
if(!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({}, null, 2));

function readAll(){
    try{
        return JSON.parse(fs.readFileSync(FILE, "utf8"));
    }catch{
        return {};
    }
}

function writeAll(data){
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// { [userId]: { [playlistName]: { tracks: [{track, info}], createdAt } } }

function getUserPlaylists(userId){
    const all = readAll();
    return all[userId] || {};
}

function getPlaylist(userId, name){
    const playlists = getUserPlaylists(userId);
    return playlists[name] || null;
}

// tracks: array of our internal track objects ({ track, info, requester })
function savePlaylist(userId, name, tracks){
    const all = readAll();
    if(!all[userId]) all[userId] = {};
    all[userId][name] = {
        // only keep the Lavalink encoded string + display info - requester
        // is meaningless once saved, and stripping it keeps the file small
        tracks: tracks.map(t => ({ track: t.track, info: t.info })),
        createdAt: Date.now()
    };
    writeAll(all);
    return all[userId][name];
}

function deletePlaylist(userId, name){
    const all = readAll();
    if(!all[userId] || !all[userId][name]) return false;
    delete all[userId][name];
    writeAll(all);
    return true;
}

module.exports = { getUserPlaylists, getPlaylist, savePlaylist, deletePlaylist };
