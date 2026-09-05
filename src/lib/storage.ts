import type { LocalConfig } from '../types';

const KEY = 'iptvplayer:v1:config';

const DEFAULTS: LocalConfig = {
  version: 1,
  sources: [],
  activeSourceId: null,
  favorites: [],
  recents: [],
  settings: {
    volume: 0.9,
    muted: false,
    autoplay: true,
    theater: false,
    showStats: false,
    corsProxyPrefix: '',
  },
  channelCache: {},
};

export function loadConfig(): LocalConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
      version: 1,
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(cfg: LocalConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // drop channel cache and retry — config must survive
      const slim = { ...cfg, channelCache: {} };
      try {
        localStorage.setItem(KEY, JSON.stringify(slim));
      } catch {
        /* ignore */
      }
      throw new Error('Storage full — channel cache was cleared. Remove old sources.');
    }
    throw e;
  }
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
