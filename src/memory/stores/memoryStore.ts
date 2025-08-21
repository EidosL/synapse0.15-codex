import { MemoryRecord, SearchQuery } from "../types";
import { MemoryStore } from "./base";

export class InMemoryStore implements MemoryStore {
  private rows: Map<string, MemoryRecord> = new Map();
  async init() {}
  async upsert(r: MemoryRecord) {
    const id = r.id ?? Math.random().toString(36).slice(2);
    const row = { ...r, id, createdAt: r.createdAt ?? Date.now() };
    this.rows.set(id, row);
    return id;
  }
  async search(q: SearchQuery) {
    const arr = [...this.rows.values()];
    return arr.filter(r => {
      if (q.type) {
        const types = Array.isArray(q.type) ? q.type : [q.type];
        if (!types.includes(r.type)) return false;
      }
      if (q.topic && !r.topic.toLowerCase().includes(q.topic.toLowerCase())) return false;
      if (q.text) {
        const t = q.text.toLowerCase();
        if (!r.summary.toLowerCase().includes(t) && !r.content.toLowerCase().includes(t)) return false;
      }
      return true;
    }).sort((a,b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, q.limit ?? 8);
  }
  async prune(now: number) {
    let del = 0;
    for (const [id, r] of this.rows) {
      if (r.ttlMs && r.createdAt! + r.ttlMs < now) { this.rows.delete(id); del++; }
    }
    return del;
  }
}
