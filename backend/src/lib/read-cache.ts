import { AppError } from "../utils/app-error";

// Immutable serialized responses; limits include UTF-8 payload and key bytes.
export class ReadCache {
  private entries = new Map<string, { value: string; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<string>>();
  private bytes = 0;
  hits = 0; misses = 0; coalesced = 0;
  constructor(private budget = 32 * 1024 * 1024, private ttl = 5000, private maxEntries = 2000) {}
  async get(key: string, load: () => Promise<string>): Promise<string> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) {
      this.hits++; this.entries.delete(key); this.entries.set(key, cached); return cached.value;
    }
    if (cached) this.remove(key);
    const current = this.pending.get(key);
    if (current) { this.coalesced++; return current; }
    if (this.pending.size >= 1024) throw new AppError("Read service busy; retry later", 503);
    this.misses++;
    const result = Promise.resolve().then(load).then(value => {
      const bytes = Buffer.byteLength(value) + Buffer.byteLength(key);
      if (bytes <= Math.min(this.budget, 1024 * 1024)) {
        while (this.entries.size && (this.bytes + bytes > this.budget || this.entries.size >= this.maxEntries)) this.remove(this.entries.keys().next().value!);
        this.entries.set(key, { value, bytes, expires: Date.now() + this.ttl }); this.bytes += bytes;
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, result); return result;
  }
  private remove(key: string) { this.bytes -= this.entries.get(key)?.bytes ?? 0; this.entries.delete(key); }
  get metrics() { return { hits: this.hits, misses: this.misses, coalesced: this.coalesced, bytes: this.bytes, entries: this.entries.size, inflight: this.pending.size }; }
}
export const readCache = new ReadCache();
