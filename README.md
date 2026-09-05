# iptvplayer — your M3U, your TV

A free, **frontend-only** IPTV player. Paste an M3U playlist and zap through
thousands of live channels with per-channel quality, audio-track and subtitle
pickers. No account, no backend, no bundled channels — everything stays in
your browser.

## How it works

```
You paste a source ─▶ parsed in-browser ─▶ channels render in a virtualized grid
                                              │
                                              ▼
                                    hls.js (or Safari native)
                                    plays the stream direct
                                    from the provider
```

1. **Add a source** — playlist URL, pasted M3U text, or `.m3u`/`.m3u8` file
   upload. The playlist is fetched (URL) or read (text/file) and parsed
   locally into channels (name, logo, categories, stream URL, quality flags).
2. **Browse** — search across name + category + tvg-id, filter by category
   chip or favorites, toggle grid/list. The list is virtualized, so 10k+
   channels scroll at 60fps.
3. **Watch** — click a card. The stream URL is handed to hls.js (MSE) on
   Chrome/Firefox/Edge, or played natively on Safari. Quality, audio tracks,
   subtitles and speed are picked up from the stream itself.
4. **State syncs to the URL hash** (`#/watch?source=…&channel=…&q=…`), so the
   browser back/forward buttons zap through channels, reload restores
   everything, and **Copy link** shares the exact view.

### Sources

- **Add**: header **+ Source** (or the empty-state button). For URLs the app
  fetches the playlist directly — if the host blocks browser access (CORS),
  either upload the downloaded `.m3u` file or pick a CORS proxy in Settings.
- **Edit** (pencil icon on a source row): rename any source; for URL sources
  you can also change the URL, which re-fetches and re-parses the playlist.
  Pasted/uploaded sources keep only parsed channels, so their content can't
  be re-edited — delete and re-add to replace them.
- **Remove** (trash icon): deletes the source and its cached channels.

### Recents & favorites

- Every played channel lands in **Recent** (max 50). Hover a row to remove
  a single entry, or **Clear all** in the section header.
- Star any card to keep it in **Favorites**; the `Favs` chip filters the grid.

### CORS & proxies

Many IPTV hosts don't send `Access-Control-Allow-Origin`, so the browser
refuses to load their playlists/segments (VLC works — browsers don't).
Settings → **CORS proxy** offers:

| Option | Notes |
| --- | --- |
| Direct (no proxy) | Fastest. Default. |
| AllOrigins (free, no key) | Volunteer-run, best-effort. |
| CodeTabs (free, no key) | Can be slow under load. |
| corsproxy.io (free tier) | Managed; needs an API key for most calls. |
| Custom… | Paste your own prefix, e.g. `https://my-worker.dev/?url=` |

The prefix is prepended to playlist *and* stream URLs. Public proxies help
playlists load but may throttle video — a self-hosted Cloudflare Worker is
the reliable setup. Mixed `http://` streams on an `https://` page are
blocked by browsers regardless; a proxy (https) also fixes that.

Honest errors are shown per failure: CORS block, mixed-content, unsupported
codec (HEVC / AC-3 fail in Chrome/Firefox MSE — try Safari or VLC),
DRM-protected, DASH-only (`.mpd` needs a DASH engine; this build is HLS).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `M` | Mute |
| `F` | Fullscreen |
| `T` | Theater layout |
| `←` / `→` | Seek ∓10s (VOD) |
| `↑` / `↓` | Volume |
| `/` | Focus search |

### Where data lives

All in `localStorage` under `iptvplayer:v1:config`: source definitions,
active source, favorites, recents, player settings. Parsed channels are
cached alongside (cleared automatically if quota is exceeded). Nothing is
ever uploaded — streams flow straight from provider to your browser.

## Develop

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # static dist/ — host anywhere (GitHub Pages, Netlify, …)
npm run preview
```

Stack: Vite + React 19 + TypeScript + Tailwind v4, `hls.js` (lazy-loaded),
`@tanstack/react-virtual`, `lucide-react`. No router dependency — history
sync is a ~60-line hash module (`src/lib/history.ts`).

```
src/
  App.tsx                 shell: sources, recents, player, settings, toasts
  types.ts                Channel / PlaylistSource / LocalConfig
  lib/m3u.ts              zero-dep EXT-M3U parser
  lib/history.ts          hash route serialize/parse (back-forward support)
  lib/proxies.ts          CORS proxy presets
  lib/storage.ts          localStorage load/save + quota guard
  components/
    VideoPlayer.tsx       hls.js engine: quality/audio/subs/speed/stats/PiP
    ChannelGrid.tsx       virtualized grid + search + category chips
    AddSourceModal.tsx    add + edit source (url / text / file)
```

## Limitations

- Browser-playable streams only: HLS (`.m3u8`) and progressive files. No
  RTMP/RTSP/UDP/SRT, no DRM license handling, no server-side transcoding.
- Single-variant playlists expose one quality — the picker shows Auto only.
- Channel availability depends on providers; dead/geo-blocked entries are
  labeled, not hidden.
