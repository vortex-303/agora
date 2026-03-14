import type { RelayLike } from './relay-interface.js';

export type PeerStatus = 'connecting' | 'connected' | 'disconnected';

export interface PeerInfo {
  publicKey: string;
  status: PeerStatus;
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
}

export type DataHandler = (peerKey: string, data: string) => void;
export type PeerChangeHandler = () => void;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class PeerManager {
  private relay: RelayLike;
  private myPublicKey: string;
  private peers: Map<string, PeerInfo> = new Map();
  private dataHandlers: DataHandler[] = [];
  private changeHandlers: PeerChangeHandler[] = [];

  constructor(relay: RelayLike, publicKey: string) {
    this.relay = relay;
    this.myPublicKey = publicKey;

    // Handle incoming signals
    relay.onSignal((source, signalType, data) => {
      this.handleSignal(source, signalType, data);
    });

    // Poll peers periodically
    relay.onStatusChange((status) => {
      if (status === 'connected') {
        this.relay.requestPeers();
      }
    });
  }

  onData(handler: DataHandler): void { this.dataHandlers.push(handler); }
  onChange(handler: PeerChangeHandler): void { this.changeHandlers.push(handler); }

  private emitData(peerKey: string, data: string): void {
    for (const h of this.dataHandlers) h(peerKey, data);
  }
  private emitChange(): void {
    for (const h of this.changeHandlers) h();
  }

  // Initiate connections to discovered peers
  connectToPeers(peerKeys: string[]): void {
    for (const key of peerKeys) {
      if (key === this.myPublicKey) continue;
      if (this.peers.has(key)) continue;
      // Only initiator with "lower" key creates offer (avoid double-connect)
      if (this.myPublicKey < key) {
        this.createOffer(key);
      }
    }
  }

  private createOffer(peerKey: string): void {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel('agora', { ordered: true });
    const peer: PeerInfo = { publicKey: peerKey, status: 'connecting', connection: pc, channel };
    this.peers.set(peerKey, peer);
    this.emitChange();

    this.setupChannel(peerKey, channel);
    this.setupIce(peerKey, pc);

    pc.createOffer().then((offer) => {
      pc.setLocalDescription(offer);
      this.relay.sendSignal(peerKey, 'offer', offer);
    });
  }

  private async handleSignal(source: string, signalType: string, data: any): Promise<void> {
    if (signalType === 'offer') {
      // Incoming offer — create answer
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: PeerInfo = { publicKey: source, status: 'connecting', connection: pc, channel: null };
      this.peers.set(source, peer);
      this.emitChange();

      pc.ondatachannel = (event) => {
        peer.channel = event.channel;
        this.setupChannel(source, event.channel);
      };

      this.setupIce(source, pc);

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.relay.sendSignal(source, 'answer', answer);
    } else if (signalType === 'answer') {
      const peer = this.peers.get(source);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(data));
      }
    } else if (signalType === 'ice') {
      const peer = this.peers.get(source);
      if (peer && data) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(data));
      }
    }
  }

  private setupIce(peerKey: string, pc: RTCPeerConnection): void {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.relay.sendSignal(peerKey, 'ice', event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      const peer = this.peers.get(peerKey);
      if (!peer) return;

      if (pc.connectionState === 'connected') {
        peer.status = 'connected';
        console.log(`[WebRTC] Connected to ${peerKey.slice(0, 8)}...`);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peer.status = 'disconnected';
        this.peers.delete(peerKey);
        console.log(`[WebRTC] Disconnected from ${peerKey.slice(0, 8)}...`);
      }
      this.emitChange();
    };
  }

  private setupChannel(peerKey: string, channel: RTCDataChannel): void {
    channel.onopen = () => {
      const peer = this.peers.get(peerKey);
      if (peer) {
        peer.status = 'connected';
        peer.channel = channel;
        this.emitChange();
      }
    };

    channel.onmessage = (event) => {
      this.emitData(peerKey, event.data);
    };

    channel.onclose = () => {
      const peer = this.peers.get(peerKey);
      if (peer) {
        peer.status = 'disconnected';
        this.emitChange();
      }
    };
  }

  // Send data to a specific peer
  sendToPeer(peerKey: string, data: string): boolean {
    const peer = this.peers.get(peerKey);
    if (peer?.channel?.readyState === 'open') {
      peer.channel.send(data);
      return true;
    }
    return false;
  }

  // Broadcast data to all connected peers
  broadcast(data: string): number {
    let sent = 0;
    for (const [, peer] of this.peers) {
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(data);
        sent++;
      }
    }
    return sent;
  }

  getPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  getConnectedCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.status === 'connected') count++;
    }
    return count;
  }
}
