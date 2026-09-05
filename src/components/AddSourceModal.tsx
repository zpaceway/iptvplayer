import { FileUp, Link2, TextQuote, X } from 'lucide-react';
import { useState } from 'react';
import { parseM3U } from '../lib/m3u';
import { uid } from '../lib/storage';
import type { Channel, PlaylistSource } from '../types';

interface Props {
  onClose: () => void;
  onAdd: (src: PlaylistSource, channels: Channel[]) => void;
  onSave?: (id: string, patch: { name: string; url?: string }, channels?: Channel[]) => void;
  editing?: PlaylistSource | null;
  proxy: string;
}

type Tab = 'url' | 'text' | 'file';

async function fetchPlaylistText(url: string, proxy: string): Promise<string> {
  let target = url.trim();
  if (proxy.trim()) target = proxy.trim() + encodeURIComponent(target);
  const res = await fetch(target);
  if (!res.ok) throw new Error(`Fetch failed with HTTP ${res.status}. The host may require a CORS proxy.`);
  return res.text();
}

function corsHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|Load failed|NetworkError/i.test(msg)) {
    return 'Fetch blocked — the playlist host refused direct browser access (CORS). Download the .m3u and use Upload, or pick a CORS proxy in Settings.';
  }
  return msg;
}

export default function AddSourceModal({ onClose, onAdd, onSave, editing, proxy }: Props) {
  const isEdit = !!editing;
  const [tab, setTab] = useState<Tab>(editing?.kind ?? 'url');
  const [name, setName] = useState(editing?.name ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const doAdd = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      let raw = '';
      const kind: Tab = tab;
      let base: string | undefined;
      let label = name.trim();
      let fileName: string | undefined;

      if (tab === 'url') {
        if (!url.trim()) throw new Error('Paste a playlist URL first.');
        raw = await fetchPlaylistText(url, proxy);
        base = url.trim();
        if (!label) label = new URL(url.trim()).hostname;
      } else if (tab === 'text') {
        if (!text.trim()) throw new Error('Paste M3U text first.');
        raw = text;
        if (!label) label = 'Pasted playlist';
      } else {
        if (!file) throw new Error('Choose an .m3u / .m3u8 file first.');
        raw = await file.text();
        fileName = file.name;
        if (!label) label = file.name.replace(/\.[^.]+$/, '');
      }

      if (raw.length > 40 * 1024 * 1024) throw new Error('Playlist is larger than 40MB — too big for a browser tab.');
      const parsed = parseM3U(raw, base);
      if (parsed.channels.length === 0) throw new Error('No channels found. Is this a valid #EXTM3U playlist with #EXTINF entries?');
      setPreview(`Found ${parsed.channels.length.toLocaleString()} channels · ${parsed.groups.length} groups${parsed.warnings.length ? ` · ${parsed.warnings.length} warnings` : ''}`);

      const src: PlaylistSource = {
        id: uid(),
        name: label,
        kind,
        url: tab === 'url' ? url.trim() : undefined,
        fileName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        channelCount: parsed.channels.length,
      };
      // brief beat so user sees the count
      setTimeout(() => onAdd(src, parsed.channels), 450);
    } catch (e) {
      setError(corsHint(e));
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (!editing || !onSave) return;
    const label = name.trim() || editing.name;
    // Name-only save for imported (text/file) sources — raw content isn't kept.
    if (editing.kind !== 'url') {
      onSave(editing.id, { name: label });
      return;
    }
    const nextUrl = url.trim();
    if (!nextUrl) {
      setError('Playlist URL cannot be empty.');
      return;
    }
    // Unchanged URL -> rename only, no refetch.
    if (nextUrl === (editing.url ?? '')) {
      onSave(editing.id, { name: label });
      return;
    }
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const raw = await fetchPlaylistText(nextUrl, proxy);
      if (raw.length > 40 * 1024 * 1024) throw new Error('Playlist is larger than 40MB — too big for a browser tab.');
      const parsed = parseM3U(raw, nextUrl);
      if (parsed.channels.length === 0) throw new Error('No channels found. Is this a valid #EXTM3U playlist?');
      setPreview(`Refreshed — ${parsed.channels.length.toLocaleString()} channels · ${parsed.groups.length} groups`);
      setTimeout(() => onSave(editing.id, { name: label, url: nextUrl }, parsed.channels), 450);
    } catch (e) {
      setError(corsHint(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="fade-up w-full max-w-lg rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isEdit ? 'Edit source' : 'Add source'}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">{isEdit ? 'Edit source' : 'Add source'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        {!isEdit && (
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-black/40 p-1">
            {([['url', 'Paste URL', Link2], ['text', 'Paste text', TextQuote], ['file', 'Upload', FileUp]] as [Tab, string, typeof Link2][]).map(([t, label, Icon]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold ${tab === t ? 'bg-[#CCFF00] text-black' : 'text-zinc-400 hover:text-white'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        )}

        {(!isEdit && tab === 'url') || (isEdit && editing?.kind === 'url') ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
            spellCheck={false}
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#CCFF00]/60 focus:outline-none"
          />
        ) : null}
        {!isEdit && tab === 'text' && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-logo=… group-title=…,Channel&#10;https://…/index.m3u8"
            rows={7}
            spellCheck={false}
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-[#CCFF00]/60 focus:outline-none"
          />
        )}
        {!isEdit && tab === 'file' && (
          <label className="mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/40 px-4 py-8 text-center transition hover:border-[#CCFF00]/50">
            <FileUp size={20} className="text-zinc-500" />
            <span className="text-sm text-zinc-300">{file ? file.name : 'Drop .m3u / .m3u8 here or click to browse'}</span>
            <input type="file" accept=".m3u,.m3u8,.txt,.m3u8,.mpd" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {isEdit && editing?.kind !== 'url' && (
          <p className="mb-3 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500">
            {editing?.kind === 'file' ? `Imported from file “${editing.fileName ?? 'upload'}”.` : 'Imported from pasted text.'} Playlist
            content isn't kept — only the name can be changed here. To replace channels, delete and re-add the source.
          </p>
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isEdit ? 'Source name' : 'Name (optional)'}
          className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#CCFF00]/60 focus:outline-none"
        />

        {preview && <p className="mb-2 text-xs font-semibold text-[#CCFF00]">✓ {preview}</p>}
        {error && <p className="mb-2 rounded-xl border border-[#FF5C5C]/30 bg-[#FF5C5C]/10 px-3 py-2 text-xs leading-relaxed text-[#FF8A8A]">⚠ {error}</p>}

        {!isEdit && (
          <p className="mb-4 text-[11px] leading-relaxed text-zinc-600">
            Stored only in this browser. Nothing is uploaded anywhere — the playlist is fetched directly from the provider.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
          <button
            onClick={isEdit ? doSave : doAdd}
            disabled={busy}
            className="rounded-full bg-[#CCFF00] px-5 py-2 text-sm font-bold text-black transition hover:shadow-[0_0_24px_-4px_rgba(204,255,0,0.4)] disabled:opacity-50"
          >
            {isEdit ? (busy ? 'Saving…' : 'Save changes') : busy ? (preview ? 'Adding…' : 'Parsing…') : 'Add & Watch →'}
          </button>
        </div>
      </div>
    </div>
  );
}
