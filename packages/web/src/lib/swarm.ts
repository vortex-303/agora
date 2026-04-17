import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from '@noble/hashes/utils';

const TRACKER_URLS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
];
const NETWORK_TOPIC = 'riot:network:v1';
const ANNOUNCE_INTERVAL = 20_000;
const ICE_TIMEOUT = 3000;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const NETWORK_INFOHASH = hexToBinary(bytesToHex(sha1(NETWORK_TOPIC)));

function hexToBinary(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return s;
}

function randomId(): string {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => String.fromCharCode(b)).join('');
}

function pubkeyToTrackerId(pubkey: string): string {
  // SHA-1 of pubkey, truncated to 20 bytes (tracker peer ID format)
  const hash = sha1(new TextEncoder().encode(pubkey));
  return Array.from(hash.slice(0, 20), b => String.fromCharCode(b)).join('');
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const timeout = setTimeout(resolve, ICE_TIMEOUT);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(timeout); resolve(); }
    };
  });
}

// --- Peer ---

interface Peer {
  trackerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  score: number;        // reliability score: starts at 0, +1 valid object, -5 invalid
  invalidCount: number; // consecutive invalid objects
  pubkey: string | null;
  ready: boolean;
}

// --- SwarmManager ---

export class SwarmManager {
  private ws: WebSocket | null = null;
  private myTrackerId: string;
  private myPubkey: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private trackerConnected = false;

  private peers = new Map<string, Peer>();        // trackerId → Peer
  private pubkeyMap = new Map<string, string>();   // pubkey → trackerId
  private pendingPCs = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel }>(); // offerId → pending

  private dataHandlers: Array<(peerId: string, data: string) => void> = [];
  private peerHandlers: Array<() => void> = [];
  private statusHandlers: Array<(connected: boolean) => void> = [];

  // Keep topic list for getSwarmTopics() compatibility
  private topics = new Set<string>();

  constructor(publicKey: string) {
    // Derive tracker peer ID from pubkey so tiebreaker can't be spoofed
    this.myTrackerId = pubkeyToTrackerId(publicKey);
    this.myPubkey = publicKey;
    this.connectTracker();
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL);
  }

  onData(handler: (peerId: string, data: string) => void): void { this.dataHandlers.push(handler); }
  onPeerChange(handler: () => void): void { this.peerHandlers.push(handler); }
  onStatus(handler: (connected: boolean) => void): void { this.statusHandlers.push(handler); }

  // --- Public API ---

  joinSwarm(topic: string): void {
    this.topics.add(topic);
  }

  leaveSwarm(topic: string): void {
    this.topics.delete(topic);
  }

  sendToPubkey(pubkey: string, data: string): boolean {
    // Try direct send first
    const tid = this.pubkeyMap.get(pubkey);
    if (tid) {
      const peer = this.peers.get(tid);
      if (peer?.ready && this.safeSend(peer.channel, data)) return true;
    }
    // Fallback: relay through any connected peer
    const relayMsg = JSON.stringify({ _relay: { to: pubkey, data } });
    for (const peer of this.peers.values()) {
      if (peer.ready && this.safeSend(peer.channel, relayMsg)) return true;
    }
    return false;
  }

  isPubkeyConnected(pubkey: string): boolean {
    const tid = this.pubkeyMap.get(pubkey);
    if (!tid) return false;
    const peer = this.peers.get(tid);
    return (peer?.ready && peer.channel.readyState === 'open') || false;
  }

  // Check if we can reach a pubkey (directly or via relay)
  canReachPubkey(pubkey: string): boolean {
    if (this.isPubkeyConnected(pubkey)) return true;
    // Can relay through any connected peer
    for (const peer of this.peers.values()) {
      if (peer.ready && peer.channel.readyState === 'open') return true;
    }
    return false;
  }

  private safeSend(channel: RTCDataChannel, data: string): boolean {
    if (channel.readyState !== 'open') return false;
    // Backpressure: don't send if buffer exceeds 1MB
    if (channel.bufferedAmount > 1_048_576) return false;
    try { channel.send(data); return true; }
    catch { return false; }
  }

  broadcast(data: string): number {
    let sent = 0;
    for (const peer of this.peers.values()) {
      if (peer.ready && this.safeSend(peer.channel, data)) sent++;
    }
    return sent;
  }

  sendToPeer(trackerId: string, data: string): boolean {
    const peer = this.peers.get(trackerId);
    if (peer?.ready) return this.safeSend(peer.channel, data);
    return false;
  }

  getConnectedCount(): number {
    let c = 0;
    for (const p of this.peers.values()) if (p.ready && p.channel.readyState === 'open') c++;
    return c;
  }

  getConnectedPubkeys(): string[] {
    return [...this.pubkeyMap.keys()];
  }

  scorePeer(trackerId: string, delta: number): void {
    const peer = this.peers.get(trackerId);
    if (!peer) return;
    peer.score += delta;
    if (delta < 0) {
      peer.invalidCount++;
      // Disconnect peers that send too many invalid objects
      if (peer.invalidCount >= 10) {
        console.warn(`[Swarm] Disconnecting bad peer (score: ${peer.score})`);
        peer.channel.close();
        peer.pc.close();
        this.removePeer(trackerId);
      }
    } else {
      peer.invalidCount = 0;
    }
  }

  getSwarmTopics(): string[] {
    return [...this.topics];
  }

  // --- Tracker WebSocket ---

  private trackerIndex = 0;

  private connectTracker(): void {
    const url = TRACKER_URLS[this.trackerIndex % TRACKER_URLS.length];
    try { this.ws = new WebSocket(url); } catch { this.trackerIndex++; this.scheduleReconnect(); return; }

    const connectTimeout = setTimeout(() => {
      this.ws?.close();
    }, 5000);

    this.ws.onopen = () => {
      clearTimeout(connectTimeout);
      this.reconnectDelay = 1000;
      this.trackerConnected = true;
      console.log(`[Swarm] Tracker connected: ${url}`);
      for (const h of this.statusHandlers) h(true);
      this.announce();
    };

    this.ws.onmessage = (e) => {
      try { this.onTrackerMessage(JSON.parse(e.data)); } catch {}
    };

    this.ws.onclose = () => {
      clearTimeout(connectTimeout);
      this.trackerConnected = false;
      this.trackerIndex++; // try next tracker on reconnect
      this.scheduleReconnect();
    };

    this.ws.onerror = () => { this.ws?.close(); };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectTracker();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // --- Announce (single swarm) ---

  private async announce(): Promise<void> {
    if (!this.trackerConnected) return;

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const channel = pc.createDataChannel('riot', { ordered: true });
      const offerId = randomId();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      this.pendingPCs.set(offerId, { pc, channel });

      this.send({
        action: 'announce',
        info_hash: NETWORK_INFOHASH,
        peer_id: this.myTrackerId,
        numwant: 5,
        uploaded: 0, downloaded: 0, left: 1,
        offers: [{ offer: pc.localDescription!, offer_id: offerId }],
      });
    } catch (e) {
      console.warn('[Swarm] Announce error:', e);
    }
  }

  // --- Tracker message handling ---

  private async onTrackerMessage(msg: any): Promise<void> {
    if (msg.action !== 'announce') return;

    if (msg.offer && msg.peer_id && msg.offer_id) {
      if (this.peers.has(msg.peer_id)) return; // already connected
      await this.handleIncomingOffer(msg.peer_id, msg.offer, msg.offer_id);
    } else if (msg.answer && msg.offer_id) {
      this.handleIncomingAnswer(msg.peer_id, msg.answer, msg.offer_id);
    }
  }

  private async handleIncomingOffer(remoteTid: string, offer: RTCSessionDescriptionInit, offerId: string): Promise<void> {
    // Tiebreaker: if we already have a pending/active connection to this peer,
    // the peer with the LOWER tracker ID wins as offerer.
    // If we're the winner (lower ID), ignore their offer — our offer takes priority.
    if (this.peers.has(remoteTid)) return;
    if (this.myTrackerId < remoteTid) {
      // We have lower ID — our offer wins, ignore theirs
      return;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ondatachannel = (e) => this.activatePeer(remoteTid, pc, e.channel);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);

      this.send({
        action: 'announce',
        info_hash: NETWORK_INFOHASH,
        peer_id: this.myTrackerId,
        to_peer_id: remoteTid,
        answer: pc.localDescription!,
        offer_id: offerId,
      });
    } catch { pc.close(); }
  }

  private handleIncomingAnswer(remoteTid: string, answer: RTCSessionDescriptionInit, offerId: string): void {
    const pending = this.pendingPCs.get(offerId);
    if (!pending) return;
    this.pendingPCs.delete(offerId);

    if (this.peers.has(remoteTid)) {
      pending.pc.close();
      return;
    }

    // Tiebreaker: we offered, they answered.
    // Only accept if we have the lower ID (we're the designated offerer).
    if (this.myTrackerId > remoteTid) {
      // They have lower ID — their offer should win, not ours
      pending.pc.close();
      return;
    }

    pending.pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
    this.activatePeer(remoteTid, pending.pc, pending.channel);
  }

  // --- Peer lifecycle ---

  private activatePeer(trackerId: string, pc: RTCPeerConnection, channel: RTCDataChannel): void {
    if (this.peers.has(trackerId)) return;

    const peer: Peer = { trackerId, pc, channel, pubkey: null, ready: false, score: 0, invalidCount: 0 };

    const onReady = () => {
      if (this.peers.has(trackerId)) return;

      peer.ready = true;
      this.peers.set(trackerId, peer);
      console.log(`[Swarm] Peer connected (${this.peers.size} total)`);

      // Handshake: send our pubkey
      channel.send(JSON.stringify({ _riot_hello: this.myPubkey }));

      channel.onmessage = (event) => {
        const data = event.data as string;

        try {
          const parsed = JSON.parse(data);

          // Pubkey handshake
          if (parsed._riot_hello && !peer.pubkey) {
            peer.pubkey = parsed._riot_hello;
            this.pubkeyMap.set(parsed._riot_hello, trackerId);
            console.log(`[Swarm] Identified: ${parsed._riot_hello.slice(0, 12)}...`);
            for (const h of this.peerHandlers) h();
            return;
          }

          // Relay: forward message to target pubkey
          if (parsed._relay) {
            const target = parsed._relay.to;
            if (target === this.myPubkey) {
              // It's for us — process the inner data
              for (const h of this.dataHandlers) h(trackerId, parsed._relay.data);
            } else {
              // Forward to target if we're connected to them
              const targetTid = this.pubkeyMap.get(target);
              if (targetTid) {
                const targetPeer = this.peers.get(targetTid);
                if (targetPeer?.ready && targetPeer.channel.readyState === 'open') {
                  targetPeer.channel.send(data); // forward as-is
                }
              }
            }
            return;
          }
        } catch {}

        // All other messages → data handlers (gossip)
        for (const h of this.dataHandlers) h(trackerId, data);
      };

      channel.onclose = () => this.removePeer(trackerId);
      channel.onerror = () => this.removePeer(trackerId);

      for (const h of this.peerHandlers) h();
    };

    if (channel.readyState === 'open') onReady();
    else channel.onopen = onReady;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(trackerId);
      }
    };
  }

  private removePeer(trackerId: string): void {
    const peer = this.peers.get(trackerId);
    if (!peer) return;
    if (peer.pubkey) this.pubkeyMap.delete(peer.pubkey);
    this.peers.delete(trackerId);
    console.log(`[Swarm] Peer lost (${this.peers.size} remaining)`);
    for (const h of this.peerHandlers) h();
  }

  destroy(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    for (const p of this.pendingPCs.values()) p.pc.close();
    for (const p of this.peers.values()) p.pc.close();
  }
}

export function riotTopic(type: 'user' | 'dm' | 'global', id?: string): string {
  if (type === 'global') return 'riot:global';
  return `riot:${type}:${id}`;
}

export function dmTopic(pubkeyA: string, pubkeyB: string): string {
  const sorted = [pubkeyA, pubkeyB].sort();
  return riotTopic('dm', sorted.join(':'));
}
