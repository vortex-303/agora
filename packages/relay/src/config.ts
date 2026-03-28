export const config = {
  port: parseInt(process.env.PORT || '9800', 10),
  dataDir: process.env.DATA_DIR || './data',
  maxObjects: parseInt(process.env.MAX_OBJECTS || '10000', 10),
  maxObjectsPerAuthor: parseInt(process.env.MAX_OBJECTS_PER_AUTHOR || '1000', 10),
  objectTTL: parseInt(process.env.OBJECT_TTL || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days

  // Relay-to-relay sync: comma-separated list of peer relay WebSocket URLs
  peerRelays: (process.env.PEER_RELAYS || '').split(',').filter(Boolean),

  // Relay operator metadata
  relayName: process.env.RELAY_NAME || '',
  relayDescription: process.env.RELAY_DESCRIPTION || '',
  relayContact: process.env.RELAY_CONTACT || '',
  relayUrl: process.env.RELAY_URL || '', // public wss:// URL for this relay

  // Rate limiting
  rateLimit: {
    windowMs: 60_000, // 1 minute window
    maxPublish: parseInt(process.env.RATE_LIMIT_PUBLISH || '30', 10), // max publishes per window
    maxSubscribe: parseInt(process.env.RATE_LIMIT_SUBSCRIBE || '20', 10),
    maxConnections: parseInt(process.env.RATE_LIMIT_CONNECTIONS || '50', 10), // per IP
  },
};
