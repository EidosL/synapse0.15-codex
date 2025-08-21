import { MemoryRecord, MemoryType, RoleCard } from "./types";

export type RouteHint = Partial<Record<MemoryType, number>>; // weights

export function route(record: Omit<MemoryRecord, "type">, roleCard?: RoleCard, hint?: RouteHint): MemoryRecord {
  // heuristics: prefer VAULT for identifiers; PROCEDURAL for step-by-step; EPISODIC if time-stamped; SEMANTIC for definitions;
  const text = `${record.summary}\n${record.content}`.toLowerCase();
  const tag = (k: string) => text.includes(k);
  const w = { ...{ core: 0, episodic: 0, semantic: 0, procedural: 0, resource: 0, vault: 0 }, ...(hint as any) } as Record<string, number>;

  if (/\b(ssn|passport|address|email|phone)\b/.test(text)) w.vault += 2;
  if (tag("step") || tag("how to") || tag("procedure") || tag("guide")) w.procedural += 1.5;
  if (/\b(yesterday|today|last week|\d{4}-\d{2}-\d{2})\b/.test(text)) w.episodic += 1.2;
  if (tag("is a") || tag("means") || tag("definition") || tag("concept")) w.semantic += 1.0;
  if (tag("file:") || tag("doc:") || tag("http")) w.resource += 1.0;
  // default core for stable prefs, roles, meta
  if (roleCard && (tag("preference") || tag("goal") || tag("constraint"))) w.core += 0.8;

  // choose max
  const best = Object.entries(w).sort((a,b)=>b[1]-a[1])[0]?.[0] as keyof typeof MemoryType | undefined;
  const type = (best && MemoryType[best.toUpperCase() as keyof typeof MemoryType]) || MemoryType.CORE;
  return { ...record, type };
}
