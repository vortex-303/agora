import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from '@noble/hashes/utils';

const TRACKER_URL = 'wss://tracker.openwebtorrent.com';
const ANNOUNCE_INTERVAL = 30_000;
const OFFERS_PER_ANNOUNCE = 3;
const ICE_TIMEOUT = 500;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function topicToInfohash(topic: string): string {
  return bytesToHex(sha1(topic));
}

function hexToBinary(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return s;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function randomBinaryId(): string {
  return Array.from(randomBytes(20), b => String.fromCharCode(b)).join('');
}

interface PendingOffer {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  offerId: string;
  infohashBinary: string;
}

type PeerHandler = (peerId: string, channel: RTCDataChannel) => void;

/**
 * Shared tracker connection — all swarms multiplex over one WebSocket.
 */
class TrackerConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private connected = false;
  private messageHandlers: Array<(msg: any) => void> = [];
  private statusHandlers: Array<(connected: boolean) => void> = [];

  onMessage(handler: (msg: any) => void): void { this.messageHandlers.push(handler); }
  onStatus(handler: (connected: boolean) => void): void { this.statusHandlers.push(handler); }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(TRACKER_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.connected = true;
      console.log('[Tracker] Connected');
      for (const h of this.statusHandlers) h(true);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const h of this.messageHandlers) h(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => { this.ws?.close(); };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  isConnected(): boolean { return this.connected; }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export class SwarmManager {
  private tracker: TrackerConnection;
  private peerId: string;
  private swarmInfohashes = new Map<string, string>(); // topic → infohashBinary
  private pendingOffers = new Map<string, PendingOffer>(); // offerId → PendingOffer
  private activePeers = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel }>();
  private dataHandlers: Array<(peerId: string, data: string) => void> = [];
  private peerChangeHandlers: Array<() => void> = [];
  private statusHandlers: Array<(connected: boolean) => void> = [];
  private connectedPeers = new Map<string, RTCDataChannel>();
  private announceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(publicKey: string) {
    this.peerId = randomBinaryId();
    this.tracker = new TrackerConnection();

    this.tracker.onMessage((msg) => this.handleTrackerMessage(msg));
    this.tracker.onStatus((connected) => {
      for (const h of this.statusHandlers) h(connected);
      if (connected) {
        // Re-announce all swarms on reconnect
        for (const [topic, ihBin] of this.swarmInfohashes) {
          this.announce(ihBin);
        }
      }
    });

    this.tracker.connect();
  }

  onData(handler: (peerId: string, data: string) => void): void { this.dataHandlers.push(handler); }
  onPeerChange(handler: () => void): void { this.peerChangeHandlers.push(handler); }
  onStatus(handler: (connected: boolean) => void): void { this.statusHandlers.push(handler); }

  joinSwarm(topic: string): void {
    if (this.swarmInfohashes.has(topic)) return;
    const infohash = topicToInfohash(topic);
    const infohashBinary = hexToBinary(infohash);
    this.swarmInfohashes.set(topic, infohashBinary);
    console.log(`[SwarmManager] Joining: ${topic.slice(0, 40)}`);

    if (this.tracker.isConnected()) {
      this.announce(infohashBinary);
    }
  }

  leaveSwarm(topic: string): void {
    const ihBin = this.swarmInfohashes.get(topic);
    if (!ihBin) return;
    this.swarmInfohashes.delete(topic);
    const timer = this.announceTimers.get(ihBin);
    if (timer) { clearTimeout(timer); this.announceTimers.delete(ihBin); }
    console.log(`[SwarmManager] Leaving: ${topic.slice(0, 40)}`);
  }

  private async announce(infohashBinary: string): Promise<void> {
    if (!this.tracker.isConnected()) return;

    // Create offers in parallel
    const offerPromises = Array.from({ length: OFFERS_PER_ANNOUNCE }, () => this.createOffer(infohashBinary));
    const offers = (await Promise.all(offerPromises)).filter(Boolean) as Array<{ offer: RTCSessionDescriptionInit; offer_id: string }>;

    if (offers.length === 0) return;

    this.tracker.send({
      action: 'announce',
      info_hash: infohashBinary,
      peer_id: this.peerId,
      numwant: OFFERS_PER_ANNOUNCE,
      uploaded: 0,
      downloaded: 0,
      left: 1,
      offers,
    });

    // Schedule re-announce
    const existing = this.announceTimers.get(infohashBinary);
    if (existing) clearTimeout(existing);
    this.announceTimers.set(infohashBinary, setTimeout(() => this.announce(infohashBinary), ANNOUNCE_INTERVAL));
  }

  private async createOffer(infohashBinary: string): Promise<{ offer: RTCSessionDescriptionInit; offer_id: string } | null> {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel('riot', { ordered: true });
    const offerId = randomBinaryId();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    this.pendingOffers.set(offerId, { pc, channel, offerId, infohashBinary });
    return { offer: pc.localDescription!, offer_id: offerId };
  }

  private async handleTrackerMessage(msg: any): Promise<void> {
    if (msg.action !== 'announce') return;

    if (msg.offer && msg.offer_id && msg.peer_id) {
      // Incoming offer — find which swarm it's for
      const ihBin = msg.info_hash;
      await this.handleOffer(msg.peer_id, msg.offer, msg.offer_id, ihBin);
    } else if (msg.answer && msg.offer_id) {
      this.handleAnswer(msg.peer_id, msg.answer, msg.offer_id);
    }
  }

  private async handleOffer(remotePeerId: string, offer: RTCSessionDescriptionInit, offerId: string, infohashBinary: string): Promise<void> {
    if (this.connectedPeers.has(remotePeerId)) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.ondatachannel = (event) => {
      this.setupChannel(remotePeerId, pc, event.channel);
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);

      this.tracker.send({
        action: 'announce',
        info_hash: infohashBinary || this.peerId, // fallback
        peer_id: this.peerId,
        to_peer_id: remotePeerId,
        answer: pc.localDescription!,
        offer_id: offerId,
      });
    } catch {
      pc.close();
    }
  }

  private handleAnswer(remotePeerId: string, answer: RTCSessionDescriptionInit, offerId: string): void {
    const pending = this.pendingOffers.get(offerId);
    if (!pending) return;
    this.pendingOffers.delete(offerId);

    pending.pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
    this.setupChannel(remotePeerId, pending.pc, pending.channel);
  }

  private setupChannel(remotePeerId: string, pc: RTCPeerConnection, channel: RTCDataChannel): void {
    channel.onopen = () => {
      if (this.connectedPeers.has(remotePeerId)) {
        pc.close();
        return;
      }
      this.connectedPeers.set(remotePeerId, channel);
      console.log(`[SwarmManager] PEER CONNECTED (${this.connectedPeers.size} total)`);

      channel.onmessage = (event) => {
        for (const h of this.dataHandlers) h(remotePeerId, event.data);
      };

      channel.onclose = () => {
        this.connectedPeers.delete(remotePeerId);
        for (const h of this.peerChangeHandlers) h();
      };

      for (const h of this.peerChangeHandlers) h();
    };
  }

  broadcast(data: string): number {
    let sent = 0;
    for (const [, channel] of this.connectedPeers) {
      if (channel.readyState === 'open') {
        channel.send(data);
        sent++;
      }
    }
    return sent;
  }

  sendToPeer(peerId: string, data: string): boolean {
    const channel = this.connectedPeers.get(peerId);
    if (channel?.readyState === 'open') {
      channel.send(data);
      return true;
    }
    return false;
  }

  getConnectedCount(): number {
    let count = 0;
    for (const ch of this.connectedPeers.values()) {
      if (ch.readyState === 'open') count++;
    }
    return count;
  }

  getSwarmTopics(): string[] {
    return [...this.swarmInfohashes.keys()];
  }

  destroy(): void {
    for (const timer of this.announceTimers.values()) clearTimeout(timer);
    this.tracker.destroy();
    for (const pending of this.pendingOffers.values()) pending.pc.close();
    for (const peer of this.activePeers.values()) peer.pc.close();
    this.pendingOffers.clear();
    this.activePeers.clear();
    this.connectedPeers.clear();
  }
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const timeout = setTimeout(resolve, ICE_TIMEOUT);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}

export function riotTopic(type: 'user' | 'dm' | 'global', id?: string): string {
  if (type === 'global') return 'riot:global';
  return `riot:${type}:${id}`;
}

export function dmTopic(pubkeyA: string, pubkeyB: string): string {
  const sorted = [pubkeyA, pubkeyB].sort();
  return riotTopic('dm', sorted.join(':'));
}
