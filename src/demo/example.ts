import { runConversation } from "../agents/agentLoop";

runConversation(
  "Design a privacy‑preserving analytics pipeline for a mobile app.",
  ["Business", "Data", "Infra", "ML"]
).then(r => {
  console.log("Final cards:", r.cards);
  console.log("Chat tail:", r.chat.slice(-6));
});
