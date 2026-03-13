export const config = {
  port: parseInt(process.env.PORT || '9800', 10),
  dataDir: process.env.DATA_DIR || './data',
  maxObjects: parseInt(process.env.MAX_OBJECTS || '10000', 10),
  maxObjectsPerAuthor: parseInt(process.env.MAX_OBJECTS_PER_AUTHOR || '1000', 10),
  objectTTL: parseInt(process.env.OBJECT_TTL || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days
};
