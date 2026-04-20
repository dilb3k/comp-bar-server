export function createLocalId(prefix: string, seed?: string) {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return [prefix, seed, timestamp, random].filter(Boolean).join("_");
}
