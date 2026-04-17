import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from '@noble/hashes/utils';

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
];

const ANNOUNCE_INTERVAL = 30_000;
const OFFERS_PER_ANNOUNCE = 3;
const ICE_TIMEOUT = 1000;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export type PeerHandler = (peerId: string, channel: RTCDataChannel) => void;
export type StatusHandler = (connected: boolean) => void;

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
}

interface TrackerConn {
  ws: WebSocket | null;
  url: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
}

export class Swarm {
  private topic: string;
  private infohash: string;
  private infohashBinary: string;
  private peerId: string;
  private trackers: TrackerConn[] = [];
  private pendingOffers = new Map<string, PendingOffer>();
  private activePeers = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel }>();
  private peerHandlers: PeerHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private announceTimers: ReturnType<typeof setTimeout>[] = [];
  private destroyed = false;

  constructor(topic: string, peerId: string) {
    this.topic = topic;
    this.infohash = topicToInfohash(topic);
    this.infohashBinary = hexToBinary(this.infohash);
    this.peerId = peerId;
  }

  onPeer(handler: PeerHandler): void { this.peerHandlers.push(handler); }
  onStatus(handler: StatusHandler): void { this.statusHandlers.push(handler); }

  private emitPeer(peerId: string, channel: RTCDataChannel): void {
    for (const h of this.peerHandlers) h(peerId, channel);
  }

  private emitStatus(connected: boolean): void {
    for (const h of this.statusHandlers) h(connected);
  }

  start(): void {
    for (const url of TRACKERS) {
      const tc: TrackerConn = { ws: null, url, reconnectTimer: null, reconnectDelay: 2000 };
      this.trackers.push(tc);
      this.connectTracker(tc);
    }
  }

  private connectTracker(tc: TrackerConn): void {
    if (this.destroyed) return;
    try {
      tc.ws = new WebSocket(tc.url);
    } catch {
      this.scheduleReconnect(tc);
      return;
    }

    tc.ws.onopen = () => {
      tc.reconnectDelay = 2000;
      console.log(`[Swarm:${this.topic.slice(0, 30)}] Connected to tracker`);
      this.emitStatus(true);
      this.announce(tc);
    };

    tc.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleTrackerMessage(tc, msg);
      } catch { /* ignore */ }
    };

    tc.ws.onclose = () => {
      this.scheduleReconnect(tc);
    };

    tc.ws.onerror = () => {
      tc.ws?.close();
    };
  }

  private scheduleReconnect(tc: TrackerConn): void {
    if (this.destroyed) return;
    if (tc.reconnectTimer) return;
    tc.reconnectTimer = setTimeout(() => {
      tc.reconnectTimer = null;
      this.connectTracker(tc);
    }, tc.reconnectDelay);
    tc.reconnectDelay = Math.min(tc.reconnectDelay * 1.5, 60_000);
  }

  private async announce(tc: TrackerConn): Promise<void> {
    if (!tc.ws || tc.ws.readyState !== WebSocket.OPEN) return;

    const offers: Array<{ offer: RTCSessionDescriptionInit; offer_id: string }> = [];

    for (let i = 0; i < OFFERS_PER_ANNOUNCE; i++) {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const channel = pc.createDataChannel('riot', { ordered: true });
      const offerId = randomBinaryId();

      this.setupPeerConnection(pc, offerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIce(pc);

      this.pendingOffers.set(offerId, { pc, channel, offerId });

      offers.push({
        offer: pc.localDescription!,
        offer_id: offerId,
      });
    }

    if (!tc.ws || tc.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      action: 'announce',
      info_hash: this.infohashBinary,
      peer_id: this.peerId,
      numwant: OFFERS_PER_ANNOUNCE,
      uploaded: 0,
      downloaded: 0,
      left: 1,
      offers,
    };

    tc.ws.send(JSON.stringify(msg));
    console.log(`[Swarm:${this.topic.slice(0, 30)}] Announced with ${offers.length} offers`);

    if (!this.destroyed) {
      const timer = setTimeout(() => this.announce(tc), ANNOUNCE_INTERVAL);
      this.announceTimers.push(timer);
    }
  }

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
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

  private async handleTrackerMessage(tc: TrackerConn, msg: any): Promise<void> {
    if (msg.action === 'announce') {
      if (msg.offer && msg.offer_id && msg.peer_id) {
        console.log(`[Swarm:${this.topic.slice(0, 30)}] Got offer from peer`);
        await this.handleOffer(tc, msg.peer_id, msg.offer, msg.offer_id);
      } else if (msg.answer && msg.offer_id) {
        console.log(`[Swarm:${this.topic.slice(0, 30)}] Got answer for our offer`);
        this.handleAnswer(msg.peer_id, msg.answer, msg.offer_id);
      } else if (msg.info_hash) {
        console.log(`[Swarm:${this.topic.slice(0, 30)}] Tracker ack: ${msg.incomplete || 0} peers in swarm`);
      }
    }
  }

  private async handleOffer(tc: TrackerConn, remotePeerId: string, offer: RTCSessionDescriptionInit, offerId: string): Promise<void> {
    if (this.activePeers.has(remotePeerId)) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnection(pc, offerId, remotePeerId);

    pc.ondatachannel = (event) => {
      this.setupChannel(remotePeerId, pc, event.channel);
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitForIce(pc);

      if (tc.ws?.readyState === WebSocket.OPEN) {
        tc.ws.send(JSON.stringify({
          action: 'announce',
          info_hash: this.infohashBinary,
          peer_id: this.peerId,
          to_peer_id: remotePeerId,
          answer: pc.localDescription!,
          offer_id: offerId,
        }));
        console.log(`[Swarm:${this.topic.slice(0, 30)}] Sent answer back`);
      }
    } catch (e) {
      console.warn(`[Swarm] handleOffer error:`, e);
      pc.close();
    }
  }

  private handleAnswer(remotePeerId: string, answer: RTCSessionDescriptionInit, offerId: string): void {
    const pending = this.pendingOffers.get(offerId);
    if (!pending) return;
    this.pendingOffers.delete(offerId);

    pending.pc.setRemoteDescription(new RTCSessionDescription(answer)).catch((e) => {
      console.warn(`[Swarm] setRemoteDescription error:`, e);
    });
    this.setupChannel(remotePeerId, pending.pc, pending.channel);
  }

  private setupPeerConnection(pc: RTCPeerConnection, offerId: string, remotePeerId?: string): void {
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.pendingOffers.delete(offerId);
        if (remotePeerId) {
          this.activePeers.delete(remotePeerId);
        }
      }
    };
  }

  private setupChannel(remotePeerId: string, pc: RTCPeerConnection, channel: RTCDataChannel): void {
    channel.onopen = () => {
      if (this.activePeers.has(remotePeerId)) {
        pc.close();
        return;
      }
      this.activePeers.set(remotePeerId, { pc, channel });
      console.log(`[Swarm:${this.topic.slice(0, 30)}] PEER CONNECTED`);
      this.emitPeer(remotePeerId, channel);
    };

    channel.onclose = () => {
      this.activePeers.delete(remotePeerId);
    };
  }

  getPeerCount(): number {
    return this.activePeers.size;
  }

  getTrackerStatus(): Array<{ url: string; connected: boolean }> {
    return this.trackers.map(tc => ({
      url: tc.url,
      connected: tc.ws?.readyState === WebSocket.OPEN,
    }));
  }

  destroy(): void {
    this.destroyed = true;
    for (const timer of this.announceTimers) clearTimeout(timer);
    for (const tc of this.trackers) {
      if (tc.reconnectTimer) clearTimeout(tc.reconnectTimer);
      tc.ws?.close();
    }
    for (const pending of this.pendingOffers.values()) {
      pending.pc.close();
    }
    for (const peer of this.activePeers.values()) {
      peer.pc.close();
    }
    this.pendingOffers.clear();
    this.activePeers.clear();
  }
}

export class SwarmManager {
  private peerId: string;
  private swarms = new Map<string, Swarm>();
  private dataHandlers: Array<(peerId: string, data: string) => void> = [];
  private peerChangeHandlers: Array<() => void> = [];
  private connectedPeers = new Map<string, RTCDataChannel>();
  private statusHandlers: Array<(connected: boolean) => void> = [];

  constructor(publicKey: string) {
    this.peerId = randomBinaryId();
  }

  onData(handler: (peerId: string, data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onPeerChange(handler: () => void): void {
    this.peerChangeHandlers.push(handler);
  }

  onStatus(handler: (connected: boolean) => void): void {
    this.statusHandlers.push(handler);
  }

  joinSwarm(topic: string): Swarm {
    if (this.swarms.has(topic)) return this.swarms.get(topic)!;

    console.log(`[SwarmManager] Joining: ${topic.slice(0, 40)}`);
    const swarm = new Swarm(topic, this.peerId);
    this.swarms.set(topic, swarm);

    swarm.onPeer((peerId, channel) => {
      if (this.connectedPeers.has(peerId)) return;
      this.connectedPeers.set(peerId, channel);

      channel.onmessage = (event) => {
        for (const h of this.dataHandlers) h(peerId, event.data);
      };

      channel.onclose = () => {
        this.connectedPeers.delete(peerId);
        for (const h of this.peerChangeHandlers) h();
      };

      for (const h of this.peerChangeHandlers) h();
    });

    swarm.onStatus((connected) => {
      for (const h of this.statusHandlers) h(connected);
    });

    swarm.start();
    return swarm;
  }

  leaveSwarm(topic: string): void {
    const swarm = this.swarms.get(topic);
    if (swarm) {
      console.log(`[SwarmManager] Leaving: ${topic.slice(0, 40)}`);
      swarm.destroy();
      this.swarms.delete(topic);
    }
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
    return [...this.swarms.keys()];
  }

  destroy(): void {
    for (const swarm of this.swarms.values()) {
      swarm.destroy();
    }
    this.swarms.clear();
    this.connectedPeers.clear();
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
