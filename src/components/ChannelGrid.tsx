import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Star, Tv } from 'lucide-react';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '../types';

interface Props {
  channels: Channel[];
  activeUid: string | null;
  favorites: string[];
  query: string;
  group: string;
  favOnly: boolean;
  view: 'grid' | 'list';
  onQuery: (q: string) => void;
  onGroup: (g: string) => void;
  onFavOnly: (f: boolean) => void;
  onView: (v: 'grid' | 'list') => void;
  onSelect: (c: Channel) => void;
  onToggleFav: (uid: string) => void;
}

const Logo = memo(function Logo({ ch }: { ch: Channel }) {
  const [failed, setFailed] = useState(false);
  if (!ch.logo || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1A1A1E] to-[#0A0A0B]">
        <Tv size={22} className="text-zinc-600" />
      </div>
    );
  }
  return (
    <img
      src={ch.logo}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-contain p-2"
    />
  );
});

export default function ChannelGrid(p: Props) {
  const { query, group, favOnly, view } = p;
  const deferred = useDeferredValue(query);
  const parentRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of p.channels) for (const g of c.groups) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [p.channels]);

  const filtered = useMemo(() => {
    const q = deferred.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const tokens = q ? q.split(/\s+/) : [];
    let arr = p.channels;
    if (favOnly) {
      const fav = new Set(p.favorites);
      arr = arr.filter((c) => fav.has(c.uid));
    }
    if (group !== 'All') arr = arr.filter((c) => c.groups.includes(group));
    if (tokens.length > 0) {
      arr = arr.filter((c) => tokens.every((t) => c.searchBlob.includes(t)));
    }
    return arr;
  }, [p.channels, deferred, group, favOnly, p.favorites]);

  const isGrid = view === 'grid';
  // Columns follow the measured container width (viewport breakpoints lie:
  // the library is a fraction of the window). Chunking always matches the
  // rendered column count so virtual rows never overlap or gap.
  const [colCount, setColCount] = useState(3);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => setColCount(el.clientWidth < 560 ? 2 : 3);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fixed row geometry: thumb 144 + footer 64 + gap 12 = 220 grid;
  // list row 60 + gap 12 = 72. Exact estimates => zero overlap at any width.
  const GRID_ROW = 220;
  const LIST_ROW = 72;

  const rows = useMemo(() => {
    if (!isGrid) return filtered.map((c) => [c]);
    const out: Channel[][] = [];
    for (let i = 0; i < filtered.length; i += colCount) out.push(filtered.slice(i, i + colCount));
    return out;
  }, [filtered, isGrid, colCount]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isGrid ? GRID_ROW : LIST_ROW),
    overscan: 6,
  });

  return (
    <div className="flex h-full flex-col gap-3">
      {/* search + filters */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Search 10,000+ channels…  ( / to focus )"
            className="w-full rounded-xl border border-white/10 bg-[#111113] py-2.5 pl-9 pr-20 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#CCFF00]/60 focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-zinc-600">
            {filtered.length.toLocaleString()} results
          </span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => { p.onGroup('All'); p.onFavOnly(false); }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${group === 'All' && !favOnly ? 'bg-[#CCFF00] text-black' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
          >
            All
          </button>
          <button
            onClick={() => p.onFavOnly(!favOnly)}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${favOnly ? 'bg-[#CCFF00] text-black' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
          >
            <Star size={12} /> Favs ({p.favorites.length})
          </button>
          {groups.slice(0, 30).map(([g, n]) => (
            <button
              key={g}
              onClick={() => { p.onGroup(g); p.onFavOnly(false); }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${group === g && !favOnly ? 'bg-[#CCFF00] text-black' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
            >
              {g} <span className="opacity-60">{n > 999 ? `${(n / 1000).toFixed(1)}k` : n}</span>
            </button>
          ))}
          <div className="ml-auto flex shrink-0 gap-1">
            <button onClick={() => p.onView('grid')} className={`rounded-lg px-2.5 py-1.5 text-xs ${isGrid ? 'bg-[#CCFF00] font-bold text-black' : 'bg-white/5 text-zinc-400'}`}>Grid</button>
            <button onClick={() => p.onView('list')} className={`rounded-lg px-2.5 py-1.5 text-xs ${!isGrid ? 'bg-[#CCFF00] font-bold text-black' : 'bg-white/5 text-zinc-400'}`}>List</button>
          </div>
        </div>
      </div>

      {/* virtual list */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto rounded-xl" role="listbox" aria-label="Channels">
        {filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-semibold text-zinc-300">No channels match</p>
            <p className="text-xs text-zinc-600">Try fewer words, another category, or clear favorites filter.</p>
          </div>
        ) : (
          <div style={{ height: `${virtual.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {virtual.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={vi.key}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  className="pb-3"
                >
                  {isGrid ? (
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                      {row.map((c) => (
                        <Card key={c.uid} c={c} active={c.uid === p.activeUid} fav={p.favorites.includes(c.uid)} onSelect={p.onSelect} onFav={p.onToggleFav} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.map((c) => (
                        <Row key={c.uid} c={c} active={c.uid === p.activeUid} fav={p.favorites.includes(c.uid)} onSelect={p.onSelect} onFav={p.onToggleFav} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ c, active, fav, onSelect, onFav }: { c: Channel; active: boolean; fav: boolean; onSelect: (c: Channel) => void; onFav: (u: string) => void }) {
  return (
    <button
      onClick={() => onSelect(c)}
      role="option"
      aria-selected={active}
      aria-label={`Play ${c.name}`}
      className={`group overflow-hidden rounded-xl border text-left transition-all duration-150 hover:-translate-y-0.5 ${active ? 'border-[#CCFF00] shadow-[0_0_24px_-4px_rgba(204,255,0,0.4)]' : 'border-white/5 bg-[#111113] hover:border-white/15'}`}
    >
      <div className="relative h-36 w-full shrink-0 bg-black">
        <Logo ch={c} />
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-[#CCFF00] backdrop-blur">{c.kind.toUpperCase()}</span>
        {c.geoBlocked && <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-zinc-400">GEO</span>}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#CCFF00] text-lg font-bold text-black">▶</span>
        </span>
      </div>
      <div className="flex h-16 items-start gap-2 overflow-hidden p-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-zinc-100">{c.cleanName}</p>
          <p className="truncate text-[11px] text-zinc-500">{c.group}{c.quality ? ` · ${c.quality}` : ''}</p>
        </div>
        <span
          role="button"
          tabIndex={0}
          aria-label="Toggle favorite"
          onClick={(e) => { e.stopPropagation(); onFav(c.uid); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onFav(c.uid); } }}
          className={`shrink-0 rounded-lg p-1.5 ${fav ? 'text-[#CCFF00]' : 'text-zinc-600 hover:text-zinc-300'}`}
        >
          <Star size={15} fill={fav ? 'currentColor' : 'none'} />
        </span>
      </div>
    </button>
  );
}

function Row({ c, active, fav, onSelect, onFav }: { c: Channel; active: boolean; fav: boolean; onSelect: (c: Channel) => void; onFav: (u: string) => void }) {
  return (
    <div
      onClick={() => onSelect(c)}
      role="option"
      aria-selected={active}
      className={`flex h-[60px] cursor-pointer items-center gap-3 rounded-xl border p-2 transition ${active ? 'border-[#CCFF00] bg-[#CCFF00]/5' : 'border-white/5 bg-[#111113] hover:border-white/15'}`}
    >
      <div className="h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-black">
        <Logo ch={c} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-zinc-100">{c.cleanName}</p>
        <p className="truncate text-[11px] text-zinc-500">{c.group} · {c.kind.toUpperCase()}{c.quality ? ` · ${c.quality}` : ''}</p>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onFav(c.uid); }} className={`shrink-0 rounded-lg p-2 ${fav ? 'text-[#CCFF00]' : 'text-zinc-600 hover:text-zinc-300'}`} aria-label="Toggle favorite">
        <Star size={15} fill={fav ? 'currentColor' : 'none'} />
      </button>
      <span className="shrink-0 rounded-full bg-[#CCFF00] px-3 py-1.5 text-xs font-bold text-black">Play</span>
    </div>
  );
}
