import { InMemoryStore } from "../memory/stores/memoryStore";
import { RoleCard, RoleCardSchema, MemoryType } from "../memory/types";
import { updateCardWithOutput, summarizeRoleCard } from "../memory/update";
import { route } from "../memory/router";
import { activeRetrieve, buildSystemPrompt } from "../memory/retrieval";
import { selectRecentTurns } from "../util/tokenBudget";
import { hasConsensus } from "../util/consensus";

// Stub LLM interface (replace with your provider)
async function llmGenerate(system: string, user: string) { return `ACCEPT — stub output for: ${user}`; }
async function llmTopic(user: string) { return (user.match(/#[^\s]+/)?.[0] ?? "general").replace(/^#/,""); }

export async function runConversation(initialTask: string, roles: string[]) {
  const store = new InMemoryStore(); await store.init();
  const cards: Record<string, RoleCard> = Object.fromEntries(roles.map(r=>[r, RoleCardSchema.parse({ role: r })]));
  const chat: string[] = [initialTask];

  for (let step=0; step<20; step++) {
    for (const role of roles) {
      const topic = await llmTopic(chat.at(-1) || initialTask);
      const retrieved = await activeRetrieve(store, topic);
      const sys = buildSystemPrompt(initialTask, cards[role], selectRecentTurns(chat, { maxTokens: 1500, perTurn: 256 }), retrieved);
      const user = `You are ${role}. Continue the discussion. Include ACCEPT if you agree.`;
      const out = await llmGenerate(sys, user);
      chat.push(`${role}: ${out}`);
      // Update role card
      cards[role] = updateCardWithOutput(cards[role], out);
      // Route + store concise record
      const rec = route({ topic, role, summary: out.slice(0,120), content: out.slice(0,500), weight: /ACCEPT/.test(out) ? 1.0 : 0.5, ttlMs: 1000*60*60*24*7 });
      await store.upsert(rec);
      if (hasConsensus(chat)) return { chat, cards };
    }
  }
  return { chat, cards };
}
