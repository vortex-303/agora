import type { FeedManager } from './feed.js';
import type { SignedObject } from '@agora/core';

const SEED_MODE_KEY = 'riot_seed_mode';
const SEED_STATS_KEY = 'riot_seed_stats';

export interface SeedStats {
  objectsServed: number;
  objectsStored: number;
  peersHelped: number;
  uptimeSeconds: number;
  seedingSince: number | null;
  storedAuthors: number;
}

export class SeedMode {
  private feedManager: FeedManager;
  private enabled = false;
  private uptimeStart: number | null = null;
  private stats: SeedStats;
  private changeHandlers: Array<() => void> = [];
  private uptimeTimer: ReturnType<typeof setInterval> | null = null;
  private discoveredAuthors = new Set<string>();

  constructor(feedManager: FeedManager) {
    this.feedManager = feedManager;
    this.stats = this.loadStats();
    this.enabled = localStorage.getItem(SEED_MODE_KEY) === 'true';
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  init(): void {
    // Track all authors we see
    this.feedManager.onObject((obj: SignedObject) => {
      this.discoveredAuthors.add(obj.body.author);
      if (this.enabled) {
        this.stats.objectsStored++;
      }
    });

    // Track serving stats from gossip
    this.feedManager.swarmManager.onPeerChange(() => {
      if (this.enabled) {
        this.stats.peersHelped++;
      }
    });

    if (this.enabled) {
      this.activate();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    localStorage.setItem(SEED_MODE_KEY, String(this.enabled));

    if (this.enabled) {
      this.activate();
    } else {
      this.deactivate();
    }
    this.emitChange();
  }

  private activate(): void {
    this.uptimeStart = Date.now();
    if (!this.stats.seedingSince) {
      this.stats.seedingSince = Date.now();
    }

    // Join global swarm
    this.feedManager.swarmManager.joinSwarm('riot:global');

    // Join swarms for all discovered authors
    for (const author of this.discoveredAuthors) {
      this.feedManager.joinUserSwarm(author);
    }

    // Track uptime
    this.uptimeTimer = setInterval(() => {
      if (this.uptimeStart) {
        this.stats.uptimeSeconds += 10;
        this.saveStats();
      }
    }, 10_000);

    // Periodically discover new authors and join their swarms
    this.discoveryTimer = setInterval(() => {
      for (const author of this.discoveredAuthors) {
        this.feedManager.joinUserSwarm(author);
      }
      this.stats.storedAuthors = this.discoveredAuthors.size;
      this.emitChange();
    }, 30_000);

    // SeedMode activated
  }

  private deactivate(): void {
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.uptimeTimer = null;
    this.discoveryTimer = null;
    this.uptimeStart = null;
    this.saveStats();
    // SeedMode deactivated
  }

  private discoveryTimer: ReturnType<typeof setInterval> | null = null;

  getStats(): SeedStats {
    return {
      ...this.stats,
      storedAuthors: this.discoveredAuthors.size,
      objectsServed: this.feedManager.getNetworkStats().objectsServed,
    };
  }

  getBadge(): string | null {
    if (!this.stats.seedingSince) return null;
    const days = Math.floor((Date.now() - this.stats.seedingSince) / 86400_000);
    if (days >= 30) return 'Veteran Seeder';
    if (days >= 7) return 'Active Seeder';
    if (days >= 1) return 'Seeder';
    return 'New Seeder';
  }

  private loadStats(): SeedStats {
    try {
      const stored = localStorage.getItem(SEED_STATS_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      objectsServed: 0,
      objectsStored: 0,
      peersHelped: 0,
      uptimeSeconds: 0,
      seedingSince: null,
      storedAuthors: 0,
    };
  }

  private saveStats(): void {
    try {
      localStorage.setItem(SEED_STATS_KEY, JSON.stringify(this.stats));
    } catch {}
  }

  formatUptime(): string {
    const s = this.stats.uptimeSeconds;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  }
}
