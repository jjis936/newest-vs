// music/playlists.js
// Simple per-user persistent playlists, saved to disk so they survive
// restarts. Independent of the main bot's data layer - self-contained here
// since it's purely a music feature.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "playlists.json");

if(!fs.existsSync(FILE)){
    fs.writeFileSync(FILE, JSON.stringify({}, null, 2));
}

function readAll(){
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function writeAll(data){
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function getUserPlaylists(userId){
    const all = readAll();
    return all[userId] || {};
}

function addTrackToPlaylist(userId, playlistName, track){
    const all = readAll();
    all[userId] = all[userId] || {};

    const key = playlistName.trim().toLowerCase();
    all[userId][key] = all[userId][key] || { name: playlistName.trim(), tracks: [] };
    all[userId][key].tracks.push({
        track: track.track,
        info: track.info
    });

    writeAll(all);
    return all[userId][key];
}

function getPlaylist(userId, playlistName){
    const playlists = getUserPlaylists(userId);
    return playlists[playlistName.trim().toLowerCase()] || null;
}

function deletePlaylist(userId, playlistName){
    const all = readAll();
    const key = playlistName.trim().toLowerCase();
    if(all[userId]?.[key]){
        delete all[userId][key];
        writeAll(all);
        return true;
    }
    return false;
}

module.exports = { getUserPlaylists, addTrackToPlaylist, getPlaylist, deletePlaylist };
