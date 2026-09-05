// CORS proxy presets. All use the `prefix + encodeURIComponent(url)` shape.
// Public proxies are best-effort: fine for playlists, may throttle video
// segments. Self-hosted worker remains the reliable option.

export interface ProxyPreset {
  id: string;
  label: string;
  prefix: string;
  hint: string;
}

export const PROXY_PRESETS: ProxyPreset[] = [
  {
    id: 'direct',
    label: 'Direct (no proxy)',
    prefix: '',
    hint: 'Fastest. Fails when the provider blocks browser access (CORS).',
  },
  {
    id: 'allorigins',
    label: 'AllOrigins (free, no key)',
    prefix: 'https://api.allorigins.win/raw?url=',
    hint: 'Volunteer-run, no signup. Best-effort — may throttle heavy video.',
  },
  {
    id: 'codetabs',
    label: 'CodeTabs (free, no key)',
    prefix: 'https://api.codetabs.com/v1/proxy?quest=',
    hint: 'Free, no signup. Can be slow under load.',
  },
  {
    id: 'corsproxy-io',
    label: 'corsproxy.io (free tier, key)',
    prefix: 'https://corsproxy.io/?url=',
    hint: 'Managed, 10k req/mo free — needs an API key for most calls.',
  },
  {
    id: 'custom',
    label: 'Custom…',
    prefix: '',
    hint: 'Your own Cloudflare Worker / self-hosted proxy prefix.',
  },
];

/** Match a stored prefix back to a preset id (for the settings dropdown). */
export function presetIdFor(prefix: string): string {
  if (!prefix) return 'direct';
  const hit = PROXY_PRESETS.find((p) => p.id !== 'direct' && p.id !== 'custom' && p.prefix === prefix);
  return hit ? hit.id : 'custom';
}
