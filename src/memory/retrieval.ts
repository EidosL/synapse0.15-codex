import { MemoryStore } from "./stores/base";
import { MemoryType, RoleCard, SearchQuery } from "./types";

export interface RetrievalPack { topic: string; snippets: string[]; }

export async function activeRetrieve(store: MemoryStore, topic: string): Promise<RetrievalPack> {
  const packs: string[] = [];
  const types: MemoryType[] = [MemoryType.CORE, MemoryType.EPISODIC, MemoryType.SEMANTIC, MemoryType.PROCEDURAL, MemoryType.RESOURCE, MemoryType.VAULT];
  for (const t of types) {
    const rows = await store.search({ topic, type: t, limit: 2 });
    if (rows.length) packs.push(`== ${t} ==\n` + rows.map(r=>`• ${r.summary}`).join("\n"));
  }
  return { topic, snippets: packs };
}

export function buildSystemPrompt(initialTask: string, card: RoleCard, recent: string[], retrieved: RetrievalPack) {
  const head = `Task: ${initialTask}\nRole Card: ${card.role}\n${JSON.stringify({
    goals: card.goals.slice(0,3), constraints: card.constraints.slice(0,3), decisions: card.decisions.slice(-5), unknowns: card.unknowns.slice(0,3)
  })}`;
  const history = recent.join("\n");
  const mem = retrieved.snippets.join("\n");
  return `${head}\n\nRelevant Memory (topic=${retrieved.topic}):\n${mem}\n\nRecent Turns:\n${history}`;
}
