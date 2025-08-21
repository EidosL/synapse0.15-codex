import { MemoryRecord, SearchQuery } from "../types";

export interface MemoryStore {
  init(): Promise<void>;
  upsert(r: MemoryRecord): Promise<string>; // returns id
  search(q: SearchQuery): Promise<MemoryRecord[]>;
  prune(now: number): Promise<number>; // returns deleted count
}
