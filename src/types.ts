export type StreamKind = 'hls' | 'dash' | 'progressive' | 'unknown';
export type Transport = 'http' | 'rtmp' | 'rtsp' | 'udp' | 'srt' | 'mms' | 'unknown';

export interface Channel {
  uid: string;
  name: string;
  cleanName: string;
  searchBlob: string;
  tvgId: string | null;
  logo: string | null;
  group: string;
  groups: string[];
  url: string;
  kind: StreamKind;
  playable: boolean;
  transport: Transport;
  quality?: string;
  geoBlocked: boolean;
  not247: boolean;
  radio: boolean;
  drm: boolean;
  sourceLine: number;
}

export type SourceKind = 'url' | 'text' | 'file';

export interface PlaylistSource {
  id: string;
  name: string;
  kind: SourceKind;
  url?: string;
  fileName?: string;
  createdAt: number;
  updatedAt: number;
  channelCount?: number;
}

export interface PlayerSettings {
  volume: number;
  muted: boolean;
  autoplay: boolean;
  theater: boolean;
  showStats: boolean;
  corsProxyPrefix: string;
}

export interface LocalConfig {
  version: 1;
  sources: PlaylistSource[];
  activeSourceId: string | null;
  favorites: string[]; // channel uids
  recents: string[];
  settings: PlayerSettings;
  channelCache: Record<string, Channel[]>; // sourceId -> channels (small enough for demo; large lists truncated warning)
}

export interface ParseResult {
  channels: Channel[];
  warnings: string[];
  epgUrl?: string;
  groups: string[];
}
