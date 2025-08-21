// Optional durable store; fallback is InMemoryStore
import Database from "better-sqlite3";
import { MemoryRecord, SearchQuery } from "../types";
import { MemoryStore } from "./base";

export class SqliteStore implements MemoryStore {
  private db: Database.Database;
  constructor(path = ":memory:") { this.db = new Database(path); }
  async init() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS mem (
      id TEXT PRIMARY KEY,
      type TEXT, role TEXT, topic TEXT,
      summary TEXT, content TEXT,
      createdAt INTEGER, ttlMs INTEGER, weight REAL,
      tags TEXT
    ); CREATE INDEX IF NOT EXISTS idx_mem_topic ON mem(topic);
       CREATE INDEX IF NOT EXISTS idx_mem_type ON mem(type);`);
  }
  async upsert(r: MemoryRecord) {
    const id = r.id ?? Math.random().toString(36).slice(2);
    const createdAt = r.createdAt ?? Date.now();
    const tags = JSON.stringify(r.tags ?? []);
    this.db.prepare(`INSERT OR REPLACE INTO mem (id,type,role,topic,summary,content,createdAt,ttlMs,weight,tags)
      VALUES (@id,@type,@role,@topic,@summary,@content,@createdAt,@ttlMs,@weight,@tags)`).run({ id,
      type: r.type, role: r.role ?? null, topic: r.topic, summary: r.summary, content: r.content,
      createdAt, ttlMs: r.ttlMs ?? null, weight: r.weight ?? 0, tags });
    return id;
  }
  async search(q: SearchQuery) {
    const limit = q.limit ?? 8;
    const types = q.type ? (Array.isArray(q.type) ? q.type : [q.type]) : [];
    const conds: string[] = []; const params: any = {};
    if (types.length) { conds.push(`type IN (${types.map((_,i)=>`@t${i}`).join(',')})`); types.forEach((t,i)=>params[`t${i}`]=t); }
    if (q.topic) { conds.push(`topic LIKE @topic`); params.topic = `%${q.topic}%`; }
    if (q.text) { conds.push(`(summary LIKE @text OR content LIKE @text)`); params.text = `%${q.text}%`; }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : "";
    const rows = this.db.prepare(`SELECT * FROM mem ${where} ORDER BY weight DESC, createdAt DESC LIMIT ${limit}`).all(params);
    return rows.map((r:any)=>({ ...r, tags: JSON.parse(r.tags||"[]") }));
  }
  async prune(now: number) {
    const info = this.db.prepare(`DELETE FROM mem WHERE ttlMs IS NOT NULL AND createdAt + ttlMs < ?`).run(now);
    return info.changes ?? 0;
  }
}
