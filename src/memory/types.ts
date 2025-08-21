import { z } from "zod";

export enum MemoryType {
  CORE = "core",
  EPISODIC = "episodic",
  SEMANTIC = "semantic",
  PROCEDURAL = "procedural",
  RESOURCE = "resource",
  VAULT = "vault",
}

export type RoleName = string;

export const RoleCardSchema = z.object({
  role: z.string(),
  beliefs: z.array(z.string()).max(12).default([]),
  goals: z.array(z.string()).max(12).default([]),
  constraints: z.array(z.string()).max(12).default([]),
  decisions: z.array(z.string()).max(50).default([]),
  unknowns: z.array(z.string()).max(50).default([]), // explicit knowledge gaps
  openQuestions: z.array(z.string()).max(50).default([]),
  updatedAt: z.number().default(() => Date.now()),
});
export type RoleCard = z.infer<typeof RoleCardSchema>;

export interface MemoryRecord {
  id?: string;
  type: MemoryType;
  role?: RoleName;           // writer role
  topic: string;             // active-retrieval topic
  summary: string;           // compact 1-2 sentence
  content: string;           // raw or structured snippet
  createdAt?: number;
  ttlMs?: number;            // optional TTL
  weight?: number;           // retrieval/eviction weight
  tags?: string[];
}

export interface SearchQuery {
  topic?: string;
  text?: string;
  type?: MemoryType | MemoryType[];
  limit?: number;
}
