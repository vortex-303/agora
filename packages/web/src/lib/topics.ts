export interface TopicDef {
  id: string;
  label: string;
  description: string;
}

export const TOPICS: TopicDef[] = [
  { id: 'general', label: 'General', description: 'Anything goes' },
  { id: 'tech', label: 'Tech', description: 'Software, hardware, hacking' },
  { id: 'crypto', label: 'Crypto', description: 'Cryptography, protocols, privacy' },
  { id: 'p2p', label: 'P2P', description: 'Decentralization, mesh networks, protocols' },
  { id: 'ww3', label: 'WW3', description: 'Geopolitics, conflict, world events' },
  { id: 'memes', label: 'Memes', description: 'Internet culture, shitposts' },
  { id: 'art', label: 'Art', description: 'Creative work, music, visuals' },
  { id: 'science', label: 'Science', description: 'Research, papers, discoveries' },
  { id: 'random', label: 'Random', description: 'Off-topic chaos' },
];

export function getTopic(id: string): TopicDef | undefined {
  return TOPICS.find((t) => t.id === id);
}
