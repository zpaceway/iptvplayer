import Hls from 'hls.js';
import {
  Captions,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel } from '../types';

interface Props {
  channel: Channel | null;
  volume: number;
  muted: boolean;
  autoplay: boolean;
  showStats: boolean;
  corsProxy: string;
  theater: boolean;
  onVolume: (v: number, m: boolean) => void;
  onToggleStats: () => void;
  onToggleTheater: () => void;
  onNext: () => void;
}

interface Quality { id: number; label: string; height?: number; bitrate?: number }
interface Track { id: number; label: string }

function withProxy(url: string, proxy: string): string {
  if (!proxy.trim()) return url;
  const p = proxy.trim();
  if (url.startsWith(p)) return url;
  return p + encodeURIComponent(url);
}

function classifyError(_channel: Channel, nativeError: string | null): string | null {
  if (!nativeError) return null;
  return nativeError;
}

export default function VideoPlayer(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState<Quality[]>([]);
  const [audios, setAudios] = useState<Track[]>([]);
  const [subs, setSubs] = useState<Track[]>([]);
  const [q, setQ] = useState(-1);
  const [aq, setAq] = useState(-1);
  const [sq, setSq] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errKind, setErrKind] = useState<'cors' | 'mixed' | 'codec' | 'drm' | 'dash' | 'generic' | null>(null);
  const [stats, setStats] = useState('');
  const [showControls, setShowControls] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const hideTimer = useRef<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const destroy = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.removeAttribute('src');
      v.load();
    }
  }, []);

  // ---- load stream ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !p.channel) return;
    const ch = p.channel;
    setErr(null);
    setErrKind(null);
    setLevels([]);
    setAudios([]);
    setSubs([]);
    setQ(-1);
    setAq(-1);
    setSq(-1);
    destroy();

    // Non-http transports / DASH
    if (!ch.playable) {
      setErrKind('generic');
      setErr(`“${ch.name}” uses ${ch.transport.toUpperCase()} which browsers cannot play. Copy the URL into VLC / MPV.`);
      return;
    }
    if (ch.kind === 'dash') {
      setErrKind('dash');
      setErr('This channel is MPEG-DASH (.mpd). This build plays HLS natively — open it in VLC or add a DASH source via a transcoding proxy.');
      return;
    }
    if (ch.drm) {
      setErrKind('drm');
      setErr('This channel looks DRM-protected. A license server is required, which a frontend-only player cannot provide.');
      return;
    }
    if (location.protocol === 'https:' && ch.url.startsWith('http://') && !p.corsProxy) {
      setErrKind('mixed');
      setErr('Mixed-content block: this page is HTTPS but the stream is HTTP. Browsers refuse to load it. Set an HTTPS CORS proxy in Settings, or serve the app over HTTP.');
      return;
    }

    const src = withProxy(ch.url, p.corsProxy);
    video.muted = p.muted;
    video.volume = p.volume;
    video.playbackRate = 1;
    setSpeed(1);

    const fail = (kind: typeof errKind, msg: string) => {
      setErrKind(kind);
      setErr(msg);
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 30,
        capLevelToPlayerSize: true,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const ls: Quality[] = hls.levels.map((l, i) => ({
          id: i,
          label: l.height ? `${l.height}p${l.frameRate ? ` · ${Math.round(l.frameRate)}fps` : ''} · ${(l.bitrate / 1e6).toFixed(1)}M` : `Level ${i + 1} · ${(l.bitrate / 1e6).toFixed(1)}M`,
          height: l.height,
          bitrate: l.bitrate,
        }));
        setLevels(ls);
        setIsLive(hls.latestLevelDetails?.live ?? true);
        if (p.autoplay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setQ(d.level));
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setAudios(hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Audio ${i + 1}` })));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, d) => setAq(d.id));
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        setSubs(hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Sub ${i + 1}` })));
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, d) => setSq(d.id));
      let mediaRetries = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const details = String(data.details ?? '');
          if (/manifest/i.test(details) && (data.response?.code === 0 || data.response?.code === undefined)) {
            fail('cors', 'Stream blocked by CORS or network — the host refused direct browser access (works in VLC, not here). Try another channel, copy the URL to VLC, or set a CORS proxy in Settings.');
          } else if (data.response?.code === 403 || data.response?.code === 401) {
            fail('cors', `Server refused with HTTP ${data.response.code} — likely hotlink / User-Agent / Referer gating or expired token.`);
          } else if (data.response?.code === 404 || data.response?.code === 410) {
            fail('generic', 'Stream URL is dead (404/410). The provider removed it — try another channel.');
          } else {
            hls.startLoad();
            // if still failing after retries, surface
            setTimeout(() => {
              if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                fail('cors', 'Network error loading stream. If it plays in VLC but not here, it is almost certainly CORS.');
              }
            }, 6000);
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRetries === 0) {
            mediaRetries++;
            try { hls.recoverMediaError(); } catch { fail('codec', 'Media error — the codec may be unsupported (HEVC / AC-3 fail in Chrome/Firefox MSE).'); }
          } else {
            fail('codec', 'Browser cannot decode this stream (common culprits: HEVC video or AC-3/E-AC-3 audio in MSE). Try Safari, VLC, or a transcoded source.');
          }
        } else {
          fail('generic', `Playback failed: ${data.details ?? data.type}.`);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src; // Safari native (also more CORS-lenient)
      if (p.autoplay) video.play().catch(() => {});
      setLevels([]);
    } else {
      fail('generic', 'HLS is not supported in this browser.');
    }

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVErr = () => {
      if (!err) {
        // native path errors are opaque; give actionable guess
        fail('cors', classifyError(ch, 'video error') ?? 'Video failed to load. Likely CORS, mixed-content, or an unsupported codec. Check Details below.');
      }
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onVErr);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onVErr);
      destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel?.uid, p.corsProxy]);

  // volume sync
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = p.volume;
      v.muted = p.muted;
    }
  }, [p.volume, p.muted]);

  // stats ticker
  useEffect(() => {
    if (!p.showStats) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const hls = hlsRef.current;
      if (!v) return;
      const lvl = hls && q >= 0 ? hls.levels[q] : hls && hls.levels[hls.currentLevel];
      const qual = (v as unknown as { getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number } }).getVideoPlaybackQuality?.();
      const buf = v.buffered.length ? (v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1) : '0.0';
      setStats(
        `${lvl ? `${lvl.width}x${lvl.height} · ${(lvl.bitrate / 1e6).toFixed(2)}Mb/s · ${lvl.videoCodec ?? ''} ${lvl.audioCodec ?? ''}` : `${v.videoWidth}x${v.videoHeight}`} · buf ${buf}s · drop ${qual?.droppedVideoFrames ?? 0}/${qual?.totalVideoFrames ?? 0} · lat ${hls ? hls.latency.toFixed(1) + 's' : 'n/a'} · bw ${hls ? Math.round(hls.bandwidthEstimate / 1000) + 'k' : 'n/a'}`
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [p.showStats, q]);

  // auto-hide controls
  const poke = () => {
    setShowControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => playing && setShowControls(false), 2800);
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v || !p.channel) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key.toLowerCase() === 'm') p.onVolume(p.volume, !p.muted);
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key.toLowerCase() === 't') p.onToggleTheater();
      else if (e.key === 'ArrowRight') v.currentTime += 10;
      else if (e.key === 'ArrowLeft') v.currentTime -= 10;
      else if (e.key === 'ArrowUp') { e.preventDefault(); p.onVolume(Math.min(1, p.volume + 0.1), false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); p.onVolume(Math.max(0, p.volume - 0.1), false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.volume, p.muted, p.channel?.uid]);

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* ignore */ }
  };

  const setQuality = (id: number) => {
    const hls = hlsRef.current;
    if (hls) hls.nextLevel = id;
    setQ(id);
  };

  if (!p.channel) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-[#0A0A0B] p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#CCFF00]/10 text-3xl">◉</div>
        <p className="font-display text-xl text-zinc-100">No channel selected</p>
        <p className="max-w-sm text-sm text-zinc-500">Search the library and pick a channel. Playback, quality, audio tracks and subtitles will appear here.</p>
      </div>
    );
  }

  const ch = p.channel;

  return (
    <div
      ref={wrapRef}
      onMouseMove={poke}
      className={`group relative overflow-hidden bg-black ${p.theater ? 'rounded-2xl' : 'rounded-2xl'} border border-white/10 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.9)]`}
    >
      <video
        ref={videoRef}
        className="aspect-video w-full bg-black"
        playsInline
        controls={false}
        onClick={() => {
          const v = videoRef.current;
          if (v) (v.paused ? v.play() : v.pause());
        }}
      />

      {/* top bar */}
      <div className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 transition-opacity ${showControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <span className="flex items-center gap-1.5 rounded-full bg-[#FF3B5C] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-white" /> LIVE
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{ch.name}</p>
          <p className="truncate text-[11px] text-zinc-400">{ch.group} · {ch.kind.toUpperCase()} {ch.quality ? `· ${ch.quality}` : ''}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button title="Stats for nerds" onClick={p.onToggleStats} className={`rounded-lg p-2 ${p.showStats ? 'bg-[#CCFF00] text-black' : 'text-zinc-300 hover:bg-white/10'}`}><Gauge size={16} /></button>
          <button title="Subtitles" onClick={() => setMenu((m) => !m)} className="rounded-lg p-2 text-zinc-300 hover:bg-white/10"><Captions size={16} /></button>
          <button title="Theater (T)" onClick={p.onToggleTheater} className={`rounded-lg p-2 ${p.theater ? 'bg-[#CCFF00] text-black' : 'text-zinc-300 hover:bg-white/10'}`}><span className="text-xs font-bold">T</span></button>
          <button title="Picture in picture" onClick={togglePip} className="rounded-lg p-2 text-zinc-300 hover:bg-white/10"><PictureInPicture2 size={16} /></button>
        </div>
      </div>

      {/* stats */}
      {p.showStats && (
        <div className="absolute left-3 top-14 max-w-[90%] rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 font-mono text-[11px] text-[#CCFF00] backdrop-blur-xl">
          {stats || 'collecting…'}
        </div>
      )}

      {/* error overlay */}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="fade-up max-w-md rounded-2xl border border-[#FF5C5C]/30 bg-[#111113] p-5 text-center">
            <p className="mb-1 text-sm font-bold text-[#FF5C5C]">
              {errKind === 'cors' ? 'Blocked by browser (likely CORS)' : errKind === 'mixed' ? 'Mixed-content blocked' : errKind === 'codec' ? 'Unsupported codec' : errKind === 'drm' ? 'Protected stream' : errKind === 'dash' ? 'DASH not supported in this build' : 'Cannot play'}
            </p>
            <p className="mb-4 text-[13px] leading-relaxed text-zinc-400">{err}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(ch.url); }} className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15">Copy URL</button>
              <button onClick={p.onNext} className="rounded-full bg-[#CCFF00] px-4 py-2 text-xs font-bold text-black hover:shadow-[0_0_24px_-4px_rgba(204,255,0,0.4)]">Next channel</button>
              <button onClick={() => setErr(null)} className="rounded-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* settings menu */}
      {menu && !err && (
        <div className="absolute bottom-16 right-3 w-64 rounded-xl border border-white/10 bg-black/85 p-2 backdrop-blur-xl">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Quality</p>
          <div className="max-h-36 overflow-auto">
            <button onClick={() => setQuality(-1)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] ${q === -1 ? 'bg-[#CCFF00] font-bold text-black' : 'text-zinc-200 hover:bg-white/10'}`}><span>Auto</span>{q === -1 && <span>✓</span>}</button>
            {levels.map((l) => (
              <button key={l.id} onClick={() => setQuality(l.id)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] ${q === l.id ? 'bg-[#CCFF00] font-bold text-black' : 'text-zinc-200 hover:bg-white/10'}`}><span>{l.label}</span>{q === l.id && <span>✓</span>}</button>
            ))}
            {levels.length === 0 && <p className="px-2.5 py-1 text-xs text-zinc-500">Single rendition (auto only)</p>}
          </div>
          {audios.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Audio</p>
              {audios.map((t) => (
                <button key={t.id} onClick={() => { hlsRef.current && (hlsRef.current.audioTrack = t.id); setAq(t.id); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] ${aq === t.id ? 'bg-[#CCFF00] font-bold text-black' : 'text-zinc-200 hover:bg-white/10'}`}><span>{t.label}</span>{aq === t.id && <span>✓</span>}</button>
              ))}
            </>
          )}
          {subs.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Subtitles</p>
              <button onClick={() => { if (hlsRef.current) hlsRef.current.subtitleTrack = -1; setSq(-1); }} className={`flex w-full rounded-lg px-2.5 py-1.5 text-[13px] ${sq === -1 ? 'bg-[#CCFF00] font-bold text-black' : 'text-zinc-200 hover:bg-white/10'}`}>Off</button>
              {subs.map((t) => (
                <button key={t.id} onClick={() => { if (hlsRef.current) { hlsRef.current.subtitleTrack = t.id; } setSq(t.id); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] ${sq === t.id ? 'bg-[#CCFF00] font-bold text-black' : 'text-zinc-200 hover:bg-white/10'}`}><span>{t.label}</span>{sq === t.id && <span>✓</span>}</button>
              ))}
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Speed</p>
          <div className="flex gap-1 px-2 pb-1">
            {[0.5, 1, 1.5, 2].map((s) => (
              <button key={s} onClick={() => { setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; }} className={`flex-1 rounded-lg py-1 text-xs font-semibold ${speed === s ? 'bg-[#CCFF00] text-black' : 'bg-white/10 text-zinc-300'}`}>{s}x</button>
            ))}
          </div>
        </div>
      )}

      {/* bottom controls */}
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 transition-opacity ${showControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const v = videoRef.current; if (v) (v.paused ? v.play() : v.pause()); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#CCFF00] text-black transition hover:shadow-[0_0_24px_-4px_rgba(204,255,0,0.4)]"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <button onClick={() => p.onVolume(p.volume, !p.muted)} className="rounded-lg p-2 text-white hover:bg-white/10" aria-label="Mute">
            {p.muted || p.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range" min={0} max={1} step={0.05} value={p.muted ? 0 : p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value), false)}
            className="h-1 w-24 accent-[#CCFF00]"
            aria-label="Volume"
          />
          <span className="hidden items-center gap-1.5 rounded-full bg-[#FF3B5C]/15 px-2 py-0.5 text-[10px] font-bold text-[#FF3B5C] sm:flex">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[#FF3B5C]" /> {isLive ? 'LIVE EDGE' : 'LIVE'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setMenu((m) => !m)} className={`rounded-lg p-2 ${menu ? 'bg-[#CCFF00] text-black' : 'text-white hover:bg-white/10'}`} title="Quality / Audio / Subtitles" aria-label="Playback settings">
              <Settings size={18} />
            </button>
            <button onClick={toggleFullscreen} className="rounded-lg p-2 text-white hover:bg-white/10" title="Fullscreen (F)" aria-label="Fullscreen">
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
