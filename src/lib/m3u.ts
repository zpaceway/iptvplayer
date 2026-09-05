// Robust EXT-M3U IPTV parser. Worker-safe, zero deps, O(n).
import type { Channel, ParseResult, StreamKind, Transport } from '../types';

const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;
const QUAL_RE = /\((\d{3,4}p|4K|8K|HD|SD|FHD|UHD|HEVC[^)]*)\)/i;

function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}

export function classifyUrl(raw: string): { kind: StreamKind; transport: Transport; playable: boolean } {
  const lower = raw.trim().toLowerCase();
  const scheme = lower.split('://')[0];
  if (['rtmp', 'rtsp', 'udp', 'srt', 'mms', 'mmsh', 'mmst'].includes(scheme)) {
    return { kind: 'unknown', transport: scheme as Transport, playable: false };
  }
  if (/\.mpd(\?|#|$)/i.test(raw)) return { kind: 'dash', transport: 'http', playable: true };
  if (/\.m3u8?(\?|#|$)/i.test(raw)) return { kind: 'hls', transport: 'http', playable: true };
  if (/\.(mp4|webm|mkv|mov|m4v|ogv)(\?|#|$)/i.test(raw)) return { kind: 'progressive', transport: 'http', playable: true };
  if (/\.(ts|mts|m2ts)(\?|#|$)/i.test(raw)) return { kind: 'progressive', transport: 'http', playable: true };
  if (/^https?:\/\//i.test(raw)) {
    // extensionless gateways are usually HLS — let the player probe
    return { kind: 'hls', transport: 'http', playable: true };
  }
  return { kind: 'unknown', transport: 'unknown', playable: false };
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export function parseM3U(text: string, baseUrl?: string): ParseResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let epgUrl: string | undefined;

  interface Pending {
    attrs: Record<string, string>;
    name: string;
    line: number;
    vlc: Record<string, string>;
    kodi: Record<string, string>;
    extgrp: string | null;
  }
  let pending: Pending | null = null;

  const abs = (u: string): string | null => {
    const t = u.trim();
    if (!t) return null;
    try {
      if (baseUrl) return new URL(t, baseUrl).href;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return t;
      return t;
    } catch {
      return null;
    }
  };

  if (lines.length > 0 && !lines[0].trim().toUpperCase().startsWith('#EXTM3U')) {
    warnings.push('First line is not #EXTM3U — trying to parse anyway.');
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (raw.toUpperCase().startsWith('#EXTM3U')) {
      const attrs: Record<string, string> = {};
      for (const m of raw.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2];
      epgUrl = attrs['x-tvg-url'] ?? attrs['url-tvg'] ?? undefined;
      continue;
    }
    if (raw.toUpperCase().startsWith('#EXTINF')) {
      const attrs: Record<string, string> = {};
      for (const m of raw.matchAll(ATTR_RE)) attrs[m[1]] = m[2];
      const comma = raw.indexOf(',');
      const name = comma === -1 ? '' : raw.slice(comma + 1).trim();
      if (comma === -1) warnings.push(`Line ${i + 1}: EXTINF without comma.`);
      pending = { attrs, name, line: i + 1, vlc: {}, kodi: {}, extgrp: null };
      continue;
    }
    if (raw.toUpperCase().startsWith('#EXTVLCOPT:')) {
      const body = raw.slice(11);
      const eq = body.indexOf('=');
      const k = (eq === -1 ? body : body.slice(0, eq)).trim().toLowerCase();
      const v = eq === -1 ? '' : body.slice(eq + 1);
      if (!pending) pending = { attrs: {}, name: '', line: i + 1, vlc: {}, kodi: {}, extgrp: null };
      pending.vlc[k] = v;
      continue;
    }
    if (raw.toUpperCase().startsWith('#KODIPROP:')) {
      const body = raw.slice(10);
      const eq = body.indexOf('=');
      if (!pending) pending = { attrs: {}, name: '', line: i + 1, vlc: {}, kodi: {}, extgrp: null };
      if (eq !== -1) pending.kodi[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (raw.toUpperCase().startsWith('#EXTGRP:')) {
      if (pending) pending.extgrp = raw.slice(8).trim();
      continue;
    }
    if (raw.startsWith('#')) continue; // EXT-X-*, comments, PLAYLIST, etc.

    // URL line
    const url = abs(raw);
    if (!url) {
      warnings.push(`Line ${i + 1}: bad URL skipped.`);
      continue;
    }
    const p = pending ?? { attrs: {} as Record<string, string>, name: raw.split('/').pop() ?? raw, line: i + 1, vlc: {}, kodi: {}, extgrp: null };
    const tvgId = p.attrs['tvg-id']?.trim() ? p.attrs['tvg-id'].trim() : null;
    const logo = p.attrs['tvg-logo']?.trim() ? p.attrs['tvg-logo'].trim() : null;
    const rawGroup = p.attrs['group-title']?.trim() || p.extgrp || 'Uncategorized';
    const groups = rawGroup.split(';').map((g) => g.trim()).filter(Boolean);
    if (groups.length === 0) groups.push('Uncategorized');
    const name = p.name || 'Untitled';
    const qm = name.match(QUAL_RE);
    const { kind, transport, playable } = classifyUrl(url);
    const drm = Object.keys(p.kodi).some((k) => k.toLowerCase().includes('license') || k.toLowerCase().includes('drm'));
    const cleanName = name.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim() || name;
    const uid = hashStr(url + '|' + (tvgId ?? '') + '|' + name);
    channels.push({
      uid,
      name,
      cleanName,
      searchBlob: norm(`${name} ${groups.join(' ')} ${tvgId ?? ''}`),
      tvgId,
      logo,
      group: groups[0],
      groups,
      url,
      kind,
      playable,
      transport,
      quality: qm ? qm[1].toUpperCase() : undefined,
      geoBlocked: /\[geo-blocked\]/i.test(name),
      not247: /not 24\/7/i.test(name),
      radio: p.attrs['radio'] === 'true',
      drm,
      sourceLine: p.line,
    });
    pending = null;

    if (channels.length >= 250000) {
      warnings.push('Playlist truncated at 250,000 entries for browser safety.');
      break;
    }
  }

  const groupSet = new Map<string, number>();
  for (const c of channels) for (const g of c.groups) groupSet.set(g, (groupSet.get(g) ?? 0) + 1);
  const groups = [...groupSet.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);

  return { channels, warnings, epgUrl, groups };
}
