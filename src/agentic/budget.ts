export type Tier = 'free' | 'pro';

export type AgentBudget = {
  maxSteps: number;        // plan/act iterations
  maxToolCalls: number;    // total tool invocations
  contextCapChars: number; // context clamp for LLM calls
  tempPlan: number;        // planner temperature
};

export const AGENT_BUDGET: Record<Tier, AgentBudget> = {
  free: { maxSteps: 0, maxToolCalls: 0, contextCapChars: 3200, tempPlan: 0.2 },
  pro:  { maxSteps: 4, maxToolCalls: 6, contextCapChars: 5200, tempPlan: 0.4 }
};
