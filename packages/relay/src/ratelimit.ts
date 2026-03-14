import { config } from './config.js';

interface RateWindow {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  // key → action → window
  private windows = new Map<string, Map<string, RateWindow>>();

  check(key: string, action: string): boolean {
    const limit = action === 'publish' ? config.rateLimit.maxPublish : config.rateLimit.maxSubscribe;
    const now = Date.now();

    let actions = this.windows.get(key);
    if (!actions) { actions = new Map(); this.windows.set(key, actions); }

    let window = actions.get(action);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + config.rateLimit.windowMs };
      actions.set(action, window);
    }

    window.count++;
    return window.count <= limit;
  }

  // Count connections per IP
  private ipConnections = new Map<string, number>();

  addConnection(ip: string): boolean {
    const count = (this.ipConnections.get(ip) || 0) + 1;
    this.ipConnections.set(ip, count);
    return count <= config.rateLimit.maxConnections;
  }

  removeConnection(ip: string): void {
    const count = (this.ipConnections.get(ip) || 1) - 1;
    if (count <= 0) this.ipConnections.delete(ip);
    else this.ipConnections.set(ip, count);
  }

  // Periodic cleanup
  cleanup(): void {
    const now = Date.now();
    for (const [key, actions] of this.windows) {
      for (const [action, window] of actions) {
        if (now > window.resetAt) actions.delete(action);
      }
      if (actions.size === 0) this.windows.delete(key);
    }
  }
}
