/**
 * Content seeder — bootstraps communities with starter posts.
 * Run: node scripts/seed-content.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('../packages/relay/node_modules/ws');
const { generateIdentity, createObject, sign, toBase64, fromBase64 } = require('../packages/core/dist/index.js');

const RELAY_URL = process.env.RELAY_URL || 'wss://agora-relay.fly.dev';

const SEED_CONTENT = [
  {
    topic: 'general',
    description: 'Anything goes — introduce yourself, share thoughts, ask questions.',
    posts: [
      'Welcome to Agora. This is a decentralized social platform where your identity is a cryptographic key and your messages are encrypted by default. No accounts, no tracking, no permission needed.',
      'If you\'re new here: your 12-word recovery phrase is the **only** way to recover your identity. Write it down. Treat it like a password you can never reset.',
      'Try posting in different communities, replying to posts, and sending encrypted DMs. Everything you do is cryptographically signed — your words are verifiably yours.',
    ],
  },
  {
    topic: 'tech',
    description: 'Software, hardware, hacking, and everything in between.',
    posts: [
      'Agora is built on Ed25519 signatures, SHA-256 content addressing, and X25519 ECDH for encrypted DMs. The entire ranking algorithm is one line: `score = (votes + 1) × (1 + replies × 0.3) / (hours/6 + 1)^1.5`',
      'The relay protocol is simple: JSON over WebSocket. Challenge-response auth with Ed25519. Objects are self-authenticating — any relay can verify any object without trusting the relay that forwarded it.',
      'WebRTC data channels enable browser-to-browser gossip. Posts propagate through the mesh even when relays are offline. The relay is a convenience, not a dependency.',
    ],
  },
  {
    topic: 'crypto',
    description: 'Cryptography, protocols, privacy, and digital sovereignty.',
    posts: [
      'Every DM on Agora uses a fresh ephemeral X25519 keypair for forward secrecy. Even if a relay is fully compromised, past messages cannot be decrypted.',
      'BIP-39 mnemonics → HKDF → Ed25519. Same 12 words produce the same keypair on any device. Your identity is portable, deterministic, and exists entirely on your device.',
    ],
  },
  {
    topic: 'p2p',
    description: 'Decentralization, mesh networks, protocols, and distributed systems.',
    posts: [
      'Agora runs on the same principles that made BitTorrent unkillable: content-addressed data, gossip propagation, and swarm resilience. No tokens attached.',
      'Multi-relay architecture: your client connects to multiple relays simultaneously. Publish to all, subscribe to all, dedup by hash. If one relay disappears, the others have your data.',
    ],
  },
  {
    topic: 'ww3',
    description: 'Geopolitics, conflict, world events, and the information war.',
    posts: [
      'In a world of information warfare, having a communication platform that can\'t be censored, surveilled, or shut down isn\'t a luxury — it\'s a necessity.',
    ],
  },
  {
    topic: 'memes',
    description: 'Internet culture, shitposts, and the lighter side of the decentralized web.',
    posts: [
      'The first rule of decentralized social media: you don\'t need permission to post. The second rule: your posts are cryptographically signed, so maybe think before you post.',
    ],
  },
  {
    topic: 'art',
    description: 'Creative work, music, visuals, and digital art.',
    posts: [
      'In a world where AI can generate anything, cryptographic signatures on creative work become more important. Your art, signed by your key, verifiably yours.',
    ],
  },
  {
    topic: 'science',
    description: 'Research, papers, discoveries, and scientific discussion.',
    posts: [
      'Open access to knowledge is a natural fit for decentralized platforms. No paywalls, no gatekeepers, no publishers extracting rent from publicly funded research.',
    ],
  },
  {
    topic: 'random',
    description: 'Off-topic chaos. Whatever doesn\'t fit elsewhere.',
    posts: [
      'This community is for everything that doesn\'t fit elsewhere. Post whatever — it\'s decentralized, we literally can\'t stop you.',
    ],
  },
];

async function main() {
  const identity = generateIdentity();
  console.log(`Seeder identity: ${identity.publicKeyBase64.slice(0, 12)}...`);
  console.log(`Connecting to ${RELAY_URL}...`);

  const ws = new WebSocket(RELAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('Connected, authenticating...');
      ws.send(JSON.stringify({ action: 'hello', publicKey: identity.publicKeyBase64 }));
    });

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.action === 'challenge') {
        const nonceBytes = fromBase64(msg.nonce);
        const sig = sign(nonceBytes, identity.privateKey);
        ws.send(JSON.stringify({ action: 'auth', signature: toBase64(sig), nonce: msg.nonce }));
      }

      if (msg.action === 'auth_ok') {
        console.log('Authenticated. Seeding content...\n');
        let seq = 1;
        let prevId;

        // Profile
        const profileObj = createObject({
          author: identity.publicKeyBase64, privateKey: identity.privateKey,
          type: 'profile', content: { name: 'Agora Bot' }, seq: seq++, prev: prevId,
        });
        ws.send(JSON.stringify({ action: 'publish', object: profileObj }));
        prevId = profileObj.id;
        console.log('  Published profile: Agora Bot');

        for (const community of SEED_CONTENT) {
          // Claim community
          const comObj = createObject({
            author: identity.publicKeyBase64, privateKey: identity.privateKey,
            type: 'community',
            content: { name: community.topic, description: community.description, moderators: [identity.publicKeyBase64] },
            seq: seq++, prev: prevId,
          });
          ws.send(JSON.stringify({ action: 'publish', object: comObj }));
          prevId = comObj.id;
          console.log(`  Created #${community.topic}`);

          for (const text of community.posts) {
            const postObj = createObject({
              author: identity.publicKeyBase64, privateKey: identity.privateKey,
              type: 'post', content: { text, topic: community.topic },
              seq: seq++, prev: prevId,
            });
            ws.send(JSON.stringify({ action: 'publish', object: postObj }));
            prevId = postObj.id;
            console.log(`    Posted: "${text.slice(0, 50)}..."`);
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        console.log(`\nDone! Seeded ${seq - 1} objects.`);
        setTimeout(() => { ws.close(); resolve(); }, 1000);
      }

      if (msg.action === 'auth_fail') { console.error('Auth failed:', msg.reason); reject(new Error('Auth failed')); }
      if (msg.action === 'error') { console.error('Relay error:', msg.message); }
    });

    ws.on('error', (e) => { console.error('Error:', e.message); reject(e); });
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
