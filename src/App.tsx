import { History, Pencil, Plus, Settings as SettingsIcon, Signal, Star, Trash2, Tv, X } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import AddSourceModal from './components/AddSourceModal';
import ChannelGrid from './components/ChannelGrid';
import { parseHash, pushRoute, replaceRoute } from './lib/history';
import type { RouteState } from './lib/history';
import { PROXY_PRESETS, presetIdFor } from './lib/proxies';
import { loadConfig, saveConfig } from './lib/storage';
import type { Channel, LocalConfig, PlaylistSource } from './types';

const VideoPlayer = lazy(() => import('./components/VideoPlayer'));

function initialConfig(): LocalConfig {
  const c = loadConfig();
  // Deep link wins over stored active source (same-browser back/forward + reload + share)
  try {
    const r = parseHash(window.location.hash);
    if (r.sourceId && c.sources.some((s) => s.id === r.sourceId)) c.activeSourceId = r.sourceId;
  } catch { /* non-browser env */ }
  return c;
}

function initialRoute(): RouteState {
  try {
    return parseHash(window.location.hash);
  } catch {
    return { sourceId: null, channelUid: null, q: '', group: 'All', fav: false, view: 'grid' };
  }
}

export default function App() {
  const [cfg, setCfg] = useState<LocalConfig>(initialConfig);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentUid, setCurrentUid] = useState<string | null>(() => initialRoute().channelUid);
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null);
  const notify = (msg: string) => setToast((t) => ({ msg, n: (t?.n ?? 0) + 1 }));
  const [editingSource, setEditingSource] = useState<PlaylistSource | null>(null);
  // Library filters are URL-owned so back/forward restores them
  const [query, setQuery] = useState(() => initialRoute().q);
  const [group, setGroup] = useState(() => initialRoute().group);
  const [favOnly, setFavOnly] = useState(() => initialRoute().fav);
  const [view, setView] = useState<'grid' | 'list'>(() => initialRoute().view);

  // Live snapshot of the route for push/replace writers (avoids stale closures)
  const routeRef = useRef<RouteState>({ sourceId: null, channelUid: null, q: '', group: 'All', fav: false, view: 'grid' });
  routeRef.current = { sourceId: cfg.activeSourceId, channelUid: currentUid, q: query, group, fav: favOnly, view };
  // Guards so history traversal doesn't echo back into history
  const applyingRef = useRef(false);
  const navKeyRef = useRef(`${cfg.activeSourceId ?? ''}|${currentUid ?? ''}`);

  useEffect(() => {
    try {
      saveConfig(cfg);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Storage write failed');
    }
  }, [cfg]);

  // Toasts dismiss themselves after a few seconds (manual dismiss still available)
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ---- history: back/forward traversal restores source/channel/filters ----
  useEffect(() => {
    const resolveSource = (prev: LocalConfig, id: string | null): string | null => {
      if (!id) return prev.activeSourceId;
      if (prev.sources.some((s) => s.id === id)) return id;
      // cross-device share fallback: match by source name
      const byName = prev.sources.find((s) => s.name === id);
      return byName?.id ?? prev.activeSourceId;
    };
    const apply = () => {
      const r = parseHash(window.location.hash);
      applyingRef.current = true;
      setCfg((prev) => {
        const id = resolveSource(prev, r.sourceId);
        return id === prev.activeSourceId ? prev : { ...prev, activeSourceId: id };
      });
      setCurrentUid(r.channelUid);
      setQuery(r.q);
      setGroup(r.group);
      setFavOnly(r.fav);
      setView(r.view);
      navKeyRef.current = `${r.sourceId ?? ''}|${r.channelUid ?? ''}`;
      window.setTimeout(() => { applyingRef.current = false; }, 0);
    };
    window.addEventListener('popstate', apply);
    window.addEventListener('hashchange', apply);
    return () => {
      window.removeEventListener('popstate', apply);
      window.removeEventListener('hashchange', apply);
    };
  }, []);

  // Discrete navigation (channel zap, source switch) -> PUSH a history entry
  useEffect(() => {
    const key = `${cfg.activeSourceId ?? ''}|${currentUid ?? ''}`;
    if (key === navKeyRef.current) return;
    navKeyRef.current = key;
    if (applyingRef.current) return;
    pushRoute(routeRef.current);
  }, [cfg.activeSourceId, currentUid]);

  // Filter drift (search typing, category, favs, view) -> debounced REPLACE
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (applyingRef.current) return;
      replaceRoute(routeRef.current);
    }, 450);
    return () => window.clearTimeout(t);
  }, [query, group, favOnly, view, cfg.activeSourceId, currentUid]);

  // / to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const channels: Channel[] = useMemo(() => {
    if (!cfg.activeSourceId) return [];
    return cfg.channelCache[cfg.activeSourceId] ?? [];
  }, [cfg.activeSourceId, cfg.channelCache]);

  const current: Channel | null = useMemo(
    () => channels.find((c) => c.uid === currentUid) ?? null,
    [channels, currentUid]
  );

  const activeSource = cfg.sources.find((s) => s.id === cfg.activeSourceId) ?? null;

  // Tab title follows playback for nice history entries
  useEffect(() => {
    document.title = current
      ? `${current.cleanName} — iptvplayer`
      : activeSource
        ? `${activeSource.name} — iptvplayer`
        : 'iptvplayer — your M3U, your TV';
  }, [current, activeSource]);

  // Stale link guard: URL names a channel missing from this source (removed
  // playlist entry, or share opened without the same source loaded). Clear it
  // locally and let the debounced REPLACE normalize the entry in place, so the
  // back/forward chain stays intact (no push -> no back-button trap).
  const staleNoticed = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUid || current || channels.length === 0) return;
    if (staleNoticed.current === currentUid) return;
    staleNoticed.current = currentUid;
    notify('Channel from the link is not in this source — pick another channel.');
    navKeyRef.current = `${cfg.activeSourceId ?? ''}|`;
    setCurrentUid(null);
  }, [currentUid, current, channels.length, cfg.activeSourceId]);

  const select = (c: Channel) => {
    setCurrentUid(c.uid);
    setCfg((prev) => ({
      ...prev,
      recents: [c.uid, ...prev.recents.filter((u) => u !== c.uid)].slice(0, 50),
    }));
  };

  const next = () => {
    if (channels.length === 0) return;
    const i = channels.findIndex((c) => c.uid === currentUid);
    select(channels[(i + 1 + channels.length) % channels.length]);
  };

  const toggleFav = (uid: string) =>
    setCfg((prev) => ({
      ...prev,
      favorites: prev.favorites.includes(uid) ? prev.favorites.filter((f) => f !== uid) : [...prev.favorites, uid],
    }));

  const addSource = (src: PlaylistSource, chs: Channel[]) => {
    setCfg((prev) => ({
      ...prev,
      sources: [...prev.sources, src],
      activeSourceId: src.id,
      channelCache: { ...prev.channelCache, [src.id]: chs },
    }));
    setCurrentUid(chs[0]?.uid ?? null);
    setShowAdd(false);
    notify(`Added “${src.name}” — ${chs.length.toLocaleString()} channels`);
  };

  const updateSource = (id: string, patch: { name: string; url?: string }, channels?: Channel[]) => {
    setCfg((prev) => ({
      ...prev,
      sources: prev.sources.map((s) =>
        s.id === id
          ? { ...s, name: patch.name, url: patch.url ?? s.url, updatedAt: Date.now(), channelCount: channels ? channels.length : s.channelCount }
          : s
      ),
      channelCache: channels ? { ...prev.channelCache, [id]: channels } : prev.channelCache,
    }));
    if (channels) setCurrentUid(channels[0]?.uid ?? null);
    setEditingSource(null);
    notify(channels ? `“${patch.name}” refreshed — ${channels.length.toLocaleString()} channels` : `Source renamed to “${patch.name}”`);
  };

  const removeRecent = (uid: string) =>
    setCfg((prev) => ({ ...prev, recents: prev.recents.filter((r) => r !== uid) }));

  const clearRecents = () => setCfg((prev) => ({ ...prev, recents: [] }));

  const removeSource = (id: string) => {
    setCfg((prev) => {
      const sources = prev.sources.filter((s) => s.id !== id);
      const cache = { ...prev.channelCache };
      delete cache[id];
      return {
        ...prev,
        sources,
        channelCache: cache,
        activeSourceId: prev.activeSourceId === id ? (sources[0]?.id ?? null) : prev.activeSourceId,
      };
    });
    setCurrentUid(null);
  };

  const setVolume = (volume: number, muted: boolean) =>
    setCfg((prev) => ({ ...prev, settings: { ...prev.settings, volume, muted } }));

  const recentChannels = useMemo(() => {
    const byId = new Map(channels.map((c) => [c.uid, c]));
    return cfg.recents.map((u) => byId.get(u)).filter((c): c is Channel => !!c).slice(0, 8);
  }, [channels, cfg.recents]);

  const favChannels = useMemo(() => channels.filter((c) => cfg.favorites.includes(c.uid)), [channels, cfg.favorites]);

  return (
    <div className="flex h-full flex-col bg-[#050506] text-zinc-100">
      {/* topbar */}
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-white/5 bg-[#0A0A0B]/90 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#CCFF00] text-xl font-black text-black">◉</span>
          <span className="font-display text-lg tracking-tight">
            <span className="font-bold text-white">iptv</span>
            <span className="font-medium text-[#CCFF00]">player</span>
          </span>
        </div>

        {activeSource && (
          <select
            value={cfg.activeSourceId ?? ''}
            onChange={(e) => { setCfg((p) => ({ ...p, activeSourceId: e.target.value })); setCurrentUid(null); }}
            className="ml-2 min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1.5 text-xs text-zinc-300 sm:max-w-52 sm:flex-none"
            aria-label="Active source"
          >
            {cfg.sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.channelCount?.toLocaleString() ?? '?'})</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-full bg-[#CCFF00] px-4 py-2 text-xs font-bold text-black transition hover:shadow-[0_0_24px_-4px_rgba(204,255,0,0.4)]">
            <Plus size={14} /> Source
          </button>
          <button onClick={() => setShowSettings(true)} className="rounded-full border border-white/10 p-2.5 text-zinc-400 hover:text-white" aria-label="Settings">
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* body */}
      {cfg.sources.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,1fr)_minmax(380px,460px)]">
          {/* sidebar */}
          <aside className="hidden min-h-0 flex-col gap-4 overflow-auto lg:flex">
            <div className="rounded-2xl border border-white/5 bg-[#0A0A0B] p-3">
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-zinc-600">Sources</p>
              {cfg.sources.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { setCfg((p) => ({ ...p, activeSourceId: s.id })); setCurrentUid(null); }}
                  className={`mb-1 flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] ${s.id === cfg.activeSourceId ? 'bg-[#CCFF00]/10 font-semibold text-[#CCFF00]' : 'text-zinc-300 hover:bg-white/5'}`}
                >
                  <Signal size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{s.channelCount?.toLocaleString()}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingSource(s); }}
                    className="rounded p-1 text-zinc-600 hover:text-[#CCFF00]"
                    aria-label={`Edit ${s.name}`}
                    title={`Edit ${s.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSource(s.id); }}
                    className="rounded p-1 text-zinc-600 hover:text-red-400"
                    aria-label={`Remove ${s.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {favChannels.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0A0A0B] p-3">
                <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-zinc-600"><Star size={11} /> Favorites</p>
                {favChannels.slice(0, 6).map((c) => (
                  <MiniRow key={c.uid} c={c} onClick={() => select(c)} active={c.uid === currentUid} />
                ))}
              </div>
            )}

            {recentChannels.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#0A0A0B] p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-600"><History size={11} /> Recent</p>
                  <button onClick={clearRecents} className="text-[11px] font-semibold text-zinc-600 hover:text-red-400" title="Clear all recent history">
                    Clear all
                  </button>
                </div>
                {recentChannels.map((c) => (
                  <MiniRow key={c.uid} c={c} onClick={() => select(c)} active={c.uid === currentUid} onRemove={() => removeRecent(c.uid)} />
                ))}
              </div>
            )}
          </aside>

          {/* channel library */}
          <main className={`min-h-[320px] rounded-2xl border border-white/5 bg-[#0A0A0B] p-3 max-lg:h-[62vh] lg:min-h-0 ${cfg.settings.theater ? 'lg:hidden xl:block' : ''}`}>
            <ChannelGrid
              channels={channels}
              activeUid={currentUid}
              favorites={cfg.favorites}
              query={query}
              group={group}
              favOnly={favOnly}
              view={view}
              onQuery={setQuery}
              onGroup={setGroup}
              onFavOnly={setFavOnly}
              onView={setView}
              onSelect={select}
              onToggleFav={toggleFav}
            />
          </main>

          {/* player */}
          <section className={`min-h-0 overflow-auto max-lg:order-first ${cfg.settings.theater ? 'lg:col-start-2 lg:col-span-2 xl:col-start-auto xl:col-span-1' : ''}`}>
            <Suspense fallback={<div className="skeleton-shimmer aspect-video w-full rounded-2xl" />}>
              <VideoPlayer
              channel={current}
              volume={cfg.settings.volume}
              muted={cfg.settings.muted}
              autoplay={cfg.settings.autoplay}
              showStats={cfg.settings.showStats}
              corsProxy={cfg.settings.corsProxyPrefix}
              theater={cfg.settings.theater}
              onVolume={setVolume}
              onToggleStats={() => setCfg((p) => ({ ...p, settings: { ...p.settings, showStats: !p.settings.showStats } }))}
              onToggleTheater={() => setCfg((p) => ({ ...p, settings: { ...p.settings, theater: !p.settings.theater } }))}
              onNext={next}
              />
            </Suspense>
            {current && (
              <div className="mt-3 rounded-2xl border border-white/5 bg-[#0A0A0B] p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-white">{current.cleanName}</p>
                  <button
                    onClick={() => {
                      try {
                        navigator.clipboard?.writeText(window.location.href);
                        notify('Link to this channel copied — back/forward and reload restore it.');
                      } catch {
                        notify('Copy failed — copy the address bar URL instead.');
                      }
                    }}
                    className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-[11px] font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
                    title="Copy a link that restores this source, channel and search"
                  >
                    Copy link
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{current.group} · {current.url.slice(0, 72)}{current.url.length > 72 ? '…' : ''}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[current.quality, current.kind.toUpperCase(), current.geoBlocked && 'GEO-BLOCKED', current.not247 && 'NOT 24/7', !current.playable && `${current.transport.toUpperCase()} ONLY`].filter(Boolean).map((t) => (
                    <span key={String(t)} className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-zinc-400">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* mobile bottom padding for mini layout */}
      {(showAdd || editingSource) && (
        <AddSourceModal
          key={editingSource ? `edit-${editingSource.id}` : 'add'}
          onClose={() => { setShowAdd(false); setEditingSource(null); }}
          onAdd={addSource}
          onSave={updateSource}
          editing={editingSource}
          proxy={cfg.settings.corsProxyPrefix}
        />
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="fade-up w-full max-w-md rounded-2xl border border-white/10 bg-[#111113] p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="rounded-lg p-1.5 text-zinc-500 hover:text-white" aria-label="Close"><X size={18} /></button>
            </div>
            <label className="mb-1 block text-xs font-semibold text-zinc-400">CORS proxy</label>
            <ProxyPicker
              prefix={cfg.settings.corsProxyPrefix}
              onPick={(prefix) => setCfg((p) => ({ ...p, settings: { ...p.settings, corsProxyPrefix: prefix } }))}
            />
            <Toggle label="Autoplay on select" value={cfg.settings.autoplay} onChange={(v) => setCfg((p) => ({ ...p, settings: { ...p.settings, autoplay: v } }))} />
            <Toggle label="Theater layout" value={cfg.settings.theater} onChange={(v) => setCfg((p) => ({ ...p, settings: { ...p.settings, theater: v } }))} />
            <Toggle label="Stats for nerds" value={cfg.settings.showStats} onChange={(v) => setCfg((p) => ({ ...p, settings: { ...p.settings, showStats: v } }))} />
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-zinc-500">Volume</span>
              <input type="range" min={0} max={1} step={0.05} value={cfg.settings.volume} onChange={(e) => setVolume(Number(e.target.value), false)} className="h-1 flex-1 accent-[#CCFF00]" />
            </div>
            <button
              onClick={() => { localStorage.clear(); location.reload(); }}
              className="mt-5 w-full rounded-xl border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20"
            >
              Clear all local data
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.n} className="fade-up fixed bottom-5 left-5 z-50 flex max-w-sm items-center gap-3 rounded-2xl border border-[#CCFF00]/30 bg-[#111113] px-4 py-3 shadow-xl" role="status">
          <span className="text-[#CCFF00]">✓</span>
          <p className="flex-1 text-[13px] text-zinc-200">{toast.msg}</p>
          <button onClick={() => setToast(null)} className="text-zinc-500 hover:text-white" aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-[#CCFF00]/10 text-4xl">◉</div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">No signal yet.</h1>
      <p className="max-w-md text-sm leading-relaxed text-zinc-500">
        We never ship channels — it's your TV. Paste an M3U playlist URL, paste raw text, or upload a file to get started.
      </p>
      <button onClick={onAdd} className="flex items-center gap-2 rounded-full bg-[#CCFF00] px-6 py-3 text-sm font-bold text-black transition hover:shadow-[0_0_32px_-4px_rgba(204,255,0,0.5)]">
        <Plus size={16} /> Add your first source
      </button>
      <p className="max-w-sm text-[11px] leading-relaxed text-zinc-600">
        Stored in localStorage only · HLS via hls.js + Safari native · quality / audio / subtitle pickers per channel · infinite virtualized grid
      </p>
    </div>
  );
}

function MiniRow({ c, onClick, active, onRemove }: { c: Channel; onClick: () => void; active: boolean; onRemove?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`group/row mb-1 flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[12px] ${active ? 'bg-[#CCFF00]/10 text-[#CCFF00]' : 'text-zinc-300 hover:bg-white/5'}`}
    >
      {c.logo ? (
        <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} className="h-6 w-9 shrink-0 rounded bg-black object-contain" />
      ) : (
        <span className="flex h-6 w-9 shrink-0 items-center justify-center rounded bg-black"><Tv size={12} className="text-zinc-600" /></span>
      )}
      <span className="min-w-0 flex-1 truncate">{c.cleanName}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 rounded p-1 text-zinc-700 opacity-0 hover:text-red-400 focus:opacity-100 group-hover/row:opacity-100"
          aria-label={`Remove ${c.cleanName} from recent`}
          title="Remove from recent"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function ProxyPicker({ prefix, onPick }: { prefix: string; onPick: (prefix: string) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const pid = presetIdFor(prefix);
  const showCustom = customOpen || pid === 'custom';
  const activeHint = showCustom
    ? PROXY_PRESETS.find((x) => x.id === 'custom')?.hint
    : PROXY_PRESETS.find((x) => x.id === pid)?.hint;
  return (
    <>
      <select
        value={showCustom ? 'custom' : pid}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onPick(PROXY_PRESETS.find((x) => x.id === v)?.prefix ?? '');
        }}
        className="mb-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 focus:border-[#CCFF00]/60 focus:outline-none"
      >
        {PROXY_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>{preset.label}</option>
        ))}
      </select>
      {showCustom && (
        <input
          value={prefix}
          onChange={(e) => onPick(e.target.value)}
          placeholder="https://my-worker.dev/?url="
          spellCheck={false}
          className="mb-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-[#CCFF00]/60 focus:outline-none"
        />
      )}
      <p className="-mt-0.5 mb-4 text-[11px] leading-relaxed text-zinc-600">
        {activeHint} Public proxies are best-effort and may throttle video — for reliability, self-host a worker and paste its prefix via Custom.
      </p>
    </>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="mb-2 flex w-full items-center justify-between rounded-xl bg-black/40 px-3.5 py-2.5 text-sm">
      <span className="text-zinc-300">{label}</span>
      <span className={`flex h-6 w-11 items-center rounded-full px-1 transition ${value ? 'justify-end bg-[#CCFF00]' : 'justify-start bg-white/10'}`}>
        <span className={`h-4 w-4 rounded-full ${value ? 'bg-black' : 'bg-zinc-400'}`} />
      </span>
    </button>
  );
}
