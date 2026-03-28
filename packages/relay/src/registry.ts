import { config } from './config.js';

export interface RelayEntry {
  url: string;
  name?: string;
  description?: string;
  contact?: string;
  software?: string;
  version?: string;
  region?: string;
  // Live stats (updated on announce or health check)
  uptime?: number;
  clients?: number;
  authenticated?: number;
  objects?: number;
  countries?: number;
  // Registry metadata
  lastSeen: number;
  online: boolean;
}

const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes without announce = offline
const ANNOUNCE_INTERVAL_MS = 60 * 1000; // announce every 60s
const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000; // health check peers every 2 min
const EVICT_AFTER_MS = 24 * 60 * 60 * 1000; // remove after 24h offline

/**
 * Registry of known relay nodes in the network.
 * Each relay announces itself to peers on boot and periodically.
 * Peers store the announcement and expose the registry via /relays.
 */
export class RelayRegistry {
  private relays: Map<string, RelayEntry> = new Map();
  private announceTimer?: ReturnType<typeof setInterval>;
  private healthTimer?: ReturnType<typeof setInterval>;
  private getInfo: () => any;

  constructor(getInfo: () => any) {
    this.getInfo = getInfo;
  }

  start(): void {
    // Register self
    if (config.relayUrl) {
      this.registerSelf();
    }

    // Announce to peer relays on boot (with delay to let sync connect first)
    setTimeout(() => this.announceToAllPeers(), 5_000);

    // Periodic announce
    this.announceTimer = setInterval(() => this.announceToAllPeers(), ANNOUNCE_INTERVAL_MS);

    // Periodic health check of known relays
    this.healthTimer = setInterval(() => this.healthCheckAll(), HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  /** Register this relay in our own registry */
  private registerSelf(): void {
    const info = this.getInfo();
    this.register({
      url: config.relayUrl,
      name: info.name,
      description: info.description,
      contact: info.contact,
      software: info.software,
      version: info.version,
      region: info.region,
      uptime: info.uptime,
      clients: info.clients,
      authenticated: info.authenticated,
      objects: info.objects,
      countries: info.countries,
      lastSeen: Date.now(),
      online: true,
    });
  }

  /** Register or update a relay in the registry */
  register(entry: RelayEntry): void {
    const existing = this.relays.get(entry.url);
    this.relays.set(entry.url, {
      ...existing,
      ...entry,
      lastSeen: Date.now(),
      online: true,
    });
  }

  /** Handle incoming announce from a peer */
  handleAnnounce(data: any): void {
    if (!data?.url || typeof data.url !== 'string') return;
    this.register({
      url: data.url,
      name: data.name,
      description: data.description,
      contact: data.contact,
      software: data.software,
      version: data.version,
      region: data.region,
      uptime: data.uptime,
      clients: data.clients,
      authenticated: data.authenticated,
      objects: data.objects,
      countries: data.countries,
      lastSeen: Date.now(),
      online: true,
    });
  }

  /** Announce this relay to all configured peer relays via HTTP */
  private async announceToAllPeers(): Promise<void> {
    if (!config.relayUrl) return;

    // Update self stats
    this.registerSelf();

    const info = this.getInfo();
    const payload = JSON.stringify({ ...info, url: config.relayUrl });

    for (const peerWsUrl of config.peerRelays) {
      // Convert wss://host to https://host for HTTP announce
      const httpUrl = peerWsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
      try {
        await fetch(`${httpUrl}/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Peer unreachable — that's fine
      }
    }
  }

  /** Health check all known relays (except self) */
  private async healthCheckAll(): Promise<void> {
    const now = Date.now();

    for (const [url, entry] of this.relays) {
      // Don't health check self
      if (url === config.relayUrl) {
        this.registerSelf();
        continue;
      }

      // Evict relays not seen in 24h
      if (now - entry.lastSeen > EVICT_AFTER_MS) {
        this.relays.delete(url);
        continue;
      }

      // Mark stale relays as offline
      if (now - entry.lastSeen > STALE_AFTER_MS) {
        entry.online = false;
      }

      // Try to fetch /info from the relay
      const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
      try {
        const res = await fetch(`${httpUrl}/info`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          this.register({ ...entry, ...data, url, lastSeen: now, online: true });
        } else {
          entry.online = false;
        }
      } catch {
        entry.online = false;
      }
    }
  }

  /** Get all known relays sorted by online first, then by name */
  getAll(): RelayEntry[] {
    const entries = Array.from(this.relays.values());
    entries.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (a.name || a.url).localeCompare(b.name || b.url);
    });
    return entries;
  }

  get size(): number {
    return this.relays.size;
  }
}
