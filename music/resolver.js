// music/resolver.js
// Turns whatever the user typed into /play into a list of standardized,
// playable track objects. This is the "smart search" layer:
//
//   YouTube / YouTube Music / SoundCloud / Bandcamp links
//     -> handed straight to Lavalink, which natively knows how to play them.
//
//   Spotify / Apple Music links
//     -> Lavalink can't stream audio from these directly (no such source
//        exists publicly), so this file:
//          1) tries Lavalink anyway, in case your node has the LavaSrc
//             plugin installed (some hosted Lavalink providers include it) - if
//             so, Lavalink resolves it perfectly and we're done.
//          2) otherwise, for a single track link, reads the song's title
//             and artist off the page/oEmbed data and searches YouTube for
//             the matching audio via Lavalink's `ytsearch:`.
//          3) for Spotify/Apple Music PLAYLISTS or ALBUMS without LavaSrc,
//             we can't reliably scrape a full track list, so we tell the
//             user plainly instead of silently returning junk.
//
//   Deezer links
//     -> Deezer has a genuinely public, no-auth-required JSON API, so
//        track/album/playlist links are fully supported: we pull the real
//        track list from Deezer, then find playable audio for each song
//        via `ytsearch:`.
//
//   Plain text (e.g. "Travis Scott FE!N", "Drake songs")
//     -> straight to Lavalink `ytsearch:`, falling back to `scsearch:`
//        (SoundCloud) if YouTube search comes back empty.

const DEEZER_API = "https://api.deezer.com";

// ---------------------------------------------------------------------------
// Small fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request to ${url} failed (${res.status})`);
    return res.json();
}

async function fetchHtml(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                // A normal browser UA - some pages serve stripped-down HTML to bots.
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            }
        });
        if (!res.ok) throw new Error(`Fetching ${url} failed (${res.status})`);
        return await res.text();
    } finally {
        clearTimeout(timeout);
    }
}

// Pulls a <meta property="X" content="Y"> or <meta content="Y" property="X">
// value out of raw HTML without needing an HTML-parsing dependency.
function extractMeta(html, property) {
    const patterns = [
        new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
        new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, "i")
    ];
    for (const re of patterns) {
        const match = html.match(re);
        if (match) return decodeHtmlEntities(match[1]);
    }
    return null;
}

function decodeHtmlEntities(str) {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

function detectSource(query) {
    let url;
    try {
        url = new URL(query);
    } catch {
        return "search"; // not a URL at all - plain text search
    }

    const host = url.hostname.replace(/^www\./, "");

    if (host.includes("open.spotify.com") || host === "spotify.link") return "spotify";
    if (host.includes("music.apple.com")) return "apple";
    if (host.includes("deezer.com") || host.includes("deezer.page.link")) return "deezer";
    if (host.includes("soundcloud.com")) return "soundcloud";
    if (host.includes("bandcamp.com")) return "bandcamp";
    if (host.includes("youtube.com") || host === "youtu.be" || host.includes("music.youtube.com")) return "youtube";
    return "url"; // some other direct link - let Lavalink try it as-is
}

// ---------------------------------------------------------------------------
// Standardizing a raw Lavalink track into what the rest of the bot expects
// ---------------------------------------------------------------------------

function standardize(lavalinkTrack, requester, sourceLabelOverride) {
    const info = lavalinkTrack.info;
    return {
        encoded: lavalinkTrack.encoded,
        title: info.title,
        author: info.author,
        uri: info.uri,
        length: info.length,
        isStream: info.isStream,
        artworkUrl: info.artworkUrl || null,
        sourceName: sourceLabelOverride || info.sourceName,
        requester
    };
}

function handleLavalinkResponse(res, requester, sourceLabel) {
    if (!res || res.loadType === "empty") {
        throw new Error("No results found for that.");
    }
    if (res.loadType === "error") {
        throw new Error(res.data?.message || "Lavalink failed to load this track.");
    }
    if (res.loadType === "track") {
        return { tracks: [standardize(res.data, requester, sourceLabel)], playlistName: null };
    }
    if (res.loadType === "playlist") {
        return {
            tracks: res.data.tracks.map(t => standardize(t, requester, sourceLabel)),
            playlistName: res.data.info?.name || null
        };
    }
    if (res.loadType === "search") {
        // Take the best (first) match for a plain search.
        if (!res.data.length) throw new Error("No results found for that.");
        return { tracks: [standardize(res.data[0], requester, sourceLabel)], playlistName: null };
    }
    throw new Error("Unexpected response from Lavalink.");
}

// ---------------------------------------------------------------------------
// Resolvers per source
// ---------------------------------------------------------------------------

async function resolveDirect(node, query, requester, sourceLabel) {
    const res = await node.rest.resolve(query);
    return handleLavalinkResponse(res, requester, sourceLabel);
}

async function resolveSearch(node, query, requester) {
    let res = await node.rest.resolve(`ytsearch:${query}`);
    if (!res || res.loadType === "empty" || res.loadType === "error") {
        // Fall back to SoundCloud search if YouTube search turns up nothing
        // (some Lavalink nodes have YouTube search restricted/disabled).
        res = await node.rest.resolve(`scsearch:${query}`);
    }
    return handleLavalinkResponse(res, requester, null);
}

async function resolveSpotify(node, url, requester) {
    // 1) In case the Lavalink node has the LavaSrc plugin, this just works.
    const direct = await node.rest.resolve(url).catch(() => null);
    if (direct && (direct.loadType === "track" || direct.loadType === "playlist")) {
        return handleLavalinkResponse(direct, requester, "Spotify");
    }

    if (!/\/track\//.test(url)) {
        throw new Error(
            "This Spotify playlist/album link needs the LavaSrc plugin on your Lavalink node to import " +
            "directly. Try a single track link instead, or just search by song name."
        );
    }

    // 2) Single track fallback: read title/artist via Spotify's public oEmbed
    //    endpoint (no API key needed), then find playable audio via YouTube search.
    const oembed = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`).catch(() => null);
    let title = oembed?.title || null;

    if (!title) {
        const html = await fetchHtml(url);
        title = extractMeta(html, "og:title");
    }
    if (!title) throw new Error("Could not read track info from that Spotify link.");

    const res = await node.rest.resolve(`ytsearch:${title}`);
    return handleLavalinkResponse(res, requester, "Spotify");
}

async function resolveApple(node, url, requester) {
    const direct = await node.rest.resolve(url).catch(() => null);
    if (direct && (direct.loadType === "track" || direct.loadType === "playlist")) {
        return handleLavalinkResponse(direct, requester, "Apple Music");
    }

    const isAlbumOrPlaylist = /\/(album|playlist)\//.test(url) && !url.includes("?i=");
    if (isAlbumOrPlaylist) {
        throw new Error(
            "This Apple Music album/playlist link needs the LavaSrc plugin on your Lavalink node to import " +
            "directly. Try a single song link instead, or just search by song name."
        );
    }

    const html = await fetchHtml(url);
    const ogTitle = extractMeta(html, "og:title");      // usually the song name
    const ogDescription = extractMeta(html, "og:description"); // usually "Listen to X by Artist on Apple Music."

    let searchQuery = ogTitle || "";
    const byMatch = ogDescription?.match(/by (.+?) on Apple Music/i);
    if (byMatch) searchQuery = `${byMatch[1]} ${ogTitle || ""}`.trim();

    if (!searchQuery) throw new Error("Could not read track info from that Apple Music link.");

    const res = await node.rest.resolve(`ytsearch:${searchQuery}`);
    return handleLavalinkResponse(res, requester, "Apple Music");
}

async function resolveDeezer(node, url, requester) {
    const direct = await node.rest.resolve(url).catch(() => null);
    if (direct && (direct.loadType === "track" || direct.loadType === "playlist")) {
        return handleLavalinkResponse(direct, requester, "Deezer");
    }

    const match = url.match(/deezer\.(?:com|page\.link)\/(?:\w{2}\/)?(track|playlist|album)\/(\d+)/);
    if (!match) throw new Error("Could not understand that Deezer link.");
    const [, kind, id] = match;

    if (kind === "track") {
        const data = await fetchJson(`${DEEZER_API}/track/${id}`);
        const searchQuery = `${data.artist.name} ${data.title}`;
        const res = await node.rest.resolve(`ytsearch:${searchQuery}`);
        return handleLavalinkResponse(res, requester, "Deezer");
    }

    // playlist or album - Deezer's API gives us the real track list for free.
    const data = await fetchJson(`${DEEZER_API}/${kind}/${id}`);
    const items = (data.tracks?.data || []).slice(0, 50); // cap so a huge playlist doesn't hang the command

    const tracks = [];
    for (const item of items) {
        const searchQuery = `${item.artist.name} ${item.title}`;
        const res = await node.rest.resolve(`ytsearch:${searchQuery}`).catch(() => null);
        if (res && res.loadType === "search" && res.data.length) {
            tracks.push(standardize(res.data[0], requester, "Deezer"));
        }
        // (Deliberately sequential, not Promise.all - keeps us from hammering
        // the Lavalink node / YouTube search with 50 requests at once.)
    }

    return { tracks, playlistName: data.title || null };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

async function resolve(node, query, requester) {
    const source = detectSource(query);

    switch (source) {
        case "spotify": return resolveSpotify(node, query, requester);
        case "apple": return resolveApple(node, query, requester);
        case "deezer": return resolveDeezer(node, query, requester);
        case "youtube": return resolveDirect(node, query, requester, "YouTube");
        case "soundcloud": return resolveDirect(node, query, requester, "SoundCloud");
        case "bandcamp": return resolveDirect(node, query, requester, "Bandcamp");
        case "url": return resolveDirect(node, query, requester, null);
        default: return resolveSearch(node, query, requester);
    }
}

module.exports = { resolve, detectSource };
