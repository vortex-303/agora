import { createHash, randomBytes } from 'node:crypto';
import nodeDatachannel from 'node-datachannel';

const { PeerConnection } = nodeDatachannel;

const TRACKERS = ['wss://tracker.openwebtorrent.com'];
const ANNOUNCE_INTERVAL = 30_000;
const OFFERS_PER_ANNOUNCE = 3;

function topicToInfohash(topic) {
  return createHash('sha1').update(topic).digest('hex');
}

function hexToBinary(hex) {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return s;
}

function randomBinaryId() {
  return Array.from(randomBytes(20), b => String.fromCharCode(b)).join('');
}

class TrackerSwarm {
  constructor(topic, peerId, onPeer) {
    this.topic = topic;
    this.infohash = topicToInfohash(topic);
    this.infohashBinary = hexToBinary(this.infohash);
    this.peerId = peerId;
    this.onPeerCallback = onPeer;
    this.ws = null;
    this.destroyed = false;
    this.pendingOffers = new Map();
    this.activePeers = new Map();
    this.announceTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 2000;
  }

  start() {
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    const url = TRACKERS[0];

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this.reconnectDelay = 2000;
      console.log(`[swarm:${this.topic.slice(0, 30)}] Tracker connected`);
      this.announce();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {}
    });

    this.ws.addEventListener('close', () => {
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.ws?.close();
    });
  }

  scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60_000);
  }

  async announce() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const offers = [];

    for (let i = 0; i < OFFERS_PER_ANNOUNCE; i++) {
      const offerId = randomBinaryId();
      const pc = new PeerConnection('riot-seed', {
        iceServers: ['stun:stun.l.google.com:19302'],
      });

      const sdpPromise = new Promise((resolve) => {
        pc.onLocalDescription((sdp, type) => {
          resolve({ sdp, type });
        });
      });

      const dc = pc.createDataChannel('riot');
      this.pendingOffers.set(offerId, { pc, dc, offerId });

      const desc = await Promise.race([
        sdpPromise,
        new Promise(r => setTimeout(() => r(null), 3000)),
      ]);

      if (desc) {
        offers.push({
          offer: { type: desc.type, sdp: desc.sdp },
          offer_id: offerId,
        });
      }
    }

    if (offers.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      action: 'announce',
      info_hash: this.infohashBinary,
      peer_id: this.peerId,
      numwant: OFFERS_PER_ANNOUNCE,
      uploaded: 0,
      downloaded: 0,
      left: 1,
      offers,
    }));

    console.log(`[swarm:${this.topic.slice(0, 30)}] Announced with ${offers.length} offers`);

    if (!this.destroyed) {
      this.announceTimer = setTimeout(() => this.announce(), ANNOUNCE_INTERVAL);
    }
  }

  async handleMessage(msg) {
    if (msg.action !== 'announce') return;

    if (msg.offer && msg.offer_id && msg.peer_id) {
      await this.handleOffer(msg.peer_id, msg.offer, msg.offer_id);
    } else if (msg.answer && msg.offer_id) {
      this.handleAnswer(msg.peer_id, msg.answer, msg.offer_id);
    } else if (msg.info_hash) {
      console.log(`[swarm:${this.topic.slice(0, 30)}] Tracker: ${msg.incomplete || 0} peers`);
    }
  }

  async handleOffer(remotePeerId, offer, offerId) {
    if (this.activePeers.has(remotePeerId)) return;

    const pc = new PeerConnection('riot-seed', {
      iceServers: ['stun:stun.l.google.com:19302'],
    });

    const answerPromise = new Promise((resolve) => {
      pc.onLocalDescription((sdp, type) => {
        resolve({ sdp, type });
      });
    });

    pc.onDataChannel((dc) => {
      this.setupChannel(remotePeerId, pc, dc);
    });

    pc.setRemoteDescription(offer.sdp, offer.type);

    const answer = await Promise.race([
      answerPromise,
      new Promise(r => setTimeout(() => r(null), 3000)),
    ]);

    if (answer && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'announce',
        info_hash: this.infohashBinary,
        peer_id: this.peerId,
        to_peer_id: remotePeerId,
        answer: { type: answer.type, sdp: answer.sdp },
        offer_id: offerId,
      }));
      console.log(`[swarm:${this.topic.slice(0, 30)}] Sent answer`);
    }
  }

  handleAnswer(remotePeerId, answer, offerId) {
    const pending = this.pendingOffers.get(offerId);
    if (!pending) return;
    this.pendingOffers.delete(offerId);

    pending.pc.setRemoteDescription(answer.sdp, answer.type);
    this.setupChannel(remotePeerId, pending.pc, pending.dc);
  }

  setupChannel(remotePeerId, pc, dc) {
    dc.onOpen(() => {
      if (this.activePeers.has(remotePeerId)) {
        pc.close();
        return;
      }
      this.activePeers.set(remotePeerId, { pc, dc });
      console.log(`[swarm:${this.topic.slice(0, 30)}] PEER CONNECTED`);
      this.onPeerCallback(remotePeerId, dc);
    });

    dc.onClosed(() => {
      this.activePeers.delete(remotePeerId);
    });

    dc.onError((err) => {
      this.activePeers.delete(remotePeerId);
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.announceTimer) clearTimeout(this.announceTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    for (const { pc } of this.pendingOffers.values()) pc.close();
    for (const { pc } of this.activePeers.values()) pc.close();
    this.pendingOffers.clear();
    this.activePeers.clear();
  }
}

export class SwarmNode {
  constructor(store) {
    this.store = store;
    this.peerId = randomBinaryId();
    this.swarms = new Map();
    this.peers = new Map();
    this.served = 0;
    this.received = 0;
  }

  joinSwarm(topic) {
    if (this.swarms.has(topic)) return;

    const swarm = new TrackerSwarm(topic, this.peerId, (peerId, dc) => {
      this.handlePeer(peerId, dc);
    });
    this.swarms.set(topic, swarm);
    swarm.start();
  }

  handlePeer(peerId, dc) {
    if (this.peers.has(peerId)) return;
    this.peers.set(peerId, dc);

    dc.onMessage((data) => {
      try {
        const msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
        this.handleGossipMessage(peerId, msg);
      } catch {}
    });

    dc.onClosed(() => {
      this.peers.delete(peerId);
    });

    // Send watermarks to new peer
    const watermarks = this.store.getWatermarks();
    if (Object.keys(watermarks).length > 0) {
      this.sendToPeer(peerId, { type: 'watermark', authors: watermarks });
    }
  }

  handleGossipMessage(peerId, msg) {
    switch (msg.type) {
      case 'gossip':
        if (msg.object) this.handleGossip(msg.object, peerId);
        break;
      case 'watermark':
        if (msg.authors) this.handleWatermark(peerId, msg.authors);
        break;
      case 'request':
        if (msg.author) this.handleRequest(peerId, msg.author, msg.afterSeq || 0);
        break;
      case 'response':
        if (msg.objects) this.handleResponse(msg.objects);
        break;
    }
  }

  handleGossip(obj, fromPeerId) {
    if (this.store.has(obj.id)) return;
    if (this.store.put(obj)) {
      this.received++;
      // Forward to other peers
      for (const [pid, dc] of this.peers) {
        if (pid !== fromPeerId) {
          this.sendToPeer(pid, { type: 'gossip', object: obj });
        }
      }
    }
  }

  handleWatermark(peerId, peerAuthors) {
    const myWatermarks = this.store.getWatermarks();

    // Request what they have that we don't
    for (const [author, peerSeq] of Object.entries(peerAuthors)) {
      const mySeq = myWatermarks[author] || 0;
      if (peerSeq > mySeq) {
        this.sendToPeer(peerId, { type: 'request', author, afterSeq: mySeq });
      }
    }

    // Send our watermarks back
    if (Object.keys(myWatermarks).length > 0) {
      this.sendToPeer(peerId, { type: 'watermark', authors: myWatermarks });
    }
  }

  handleRequest(peerId, author, afterSeq) {
    const objects = this.store.getByAuthor(author, afterSeq);
    if (objects.length > 0) {
      this.sendToPeer(peerId, { type: 'response', objects });
      this.served += objects.length;
    }
  }

  handleResponse(objects) {
    for (const obj of objects) {
      if (!this.store.has(obj.id)) {
        if (this.store.put(obj)) this.received++;
      }
    }
  }

  sendToPeer(peerId, msg) {
    const dc = this.peers.get(peerId);
    if (dc) {
      try {
        dc.sendMessage(JSON.stringify(msg));
      } catch {}
    }
  }

  getStats() {
    return {
      peers: this.peers.size,
      swarms: this.swarms.size,
      served: this.served,
      received: this.received,
    };
  }

  getTopics() {
    return [...this.swarms.keys()];
  }

  destroy() {
    for (const swarm of this.swarms.values()) swarm.destroy();
    this.swarms.clear();
    this.peers.clear();
  }
}
