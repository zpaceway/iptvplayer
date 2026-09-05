// Hash-based route serialization for back/forward + deep links + share.
// Format: #/watch?source=<id>&channel=<uid>&q=<text>&group=<name>&fav=1&view=list
// Only non-default params are emitted so URLs stay clean.
// Static-host and file:// safe (hash never hits the server).

export interface RouteState {
  sourceId: string | null;
  channelUid: string | null;
  q: string;
  group: string; // 'All' = default
  fav: boolean;
  view: 'grid' | 'list';
}

export const DEFAULT_ROUTE: RouteState = {
  sourceId: null,
  channelUid: null,
  q: '',
  group: 'All',
  fav: false,
  view: 'grid',
};

const PREFIX = '#/watch';

export function parseHash(hash: string): RouteState {
  const out: RouteState = { ...DEFAULT_ROUTE };
  if (!hash) return out;
  // Accept '#/watch?...', '#watch?...', or bare '?...' / '#?...'
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return out;
  try {
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const source = params.get('source');
    const channel = params.get('channel');
    const q = params.get('q');
    const group = params.get('group');
    const fav = params.get('fav');
    const view = params.get('view');
    if (source) out.sourceId = source;
    if (channel) out.channelUid = channel;
    if (q) out.q = q;
    if (group) out.group = group;
    if (fav === '1') out.fav = true;
    if (view === 'list' || view === 'grid') out.view = view;
  } catch {
    /* malformed hash -> defaults */
  }
  return out;
}

export function buildHash(r: RouteState): string {
  // No source -> root (keeps empty-state URL clean)
  if (!r.sourceId) return '#/';
  const params = new URLSearchParams();
  params.set('source', r.sourceId);
  if (r.channelUid) params.set('channel', r.channelUid);
  if (r.q.trim()) params.set('q', r.q.trim());
  if (r.group && r.group !== 'All') params.set('group', r.group);
  if (r.fav) params.set('fav', '1');
  if (r.view !== 'grid') params.set('view', r.view);
  const qs = params.toString();
  return qs ? `${PREFIX}?${qs}` : PREFIX;
}

/** Push only when the hash actually changes (avoids duplicate entries). */
export function pushRoute(r: RouteState) {
  const h = buildHash(r);
  if (window.location.hash === h) return;
  window.history.pushState({ ...r }, '', h);
}

/** Replace without growing history (for debounced filter typing). */
export function replaceRoute(r: RouteState) {
  const h = buildHash(r);
  if (window.location.hash === h) return;
  window.history.replaceState({ ...r }, '', h);
}
