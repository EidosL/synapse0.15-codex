import type { PlanStep, ToolResult } from '../types';

export interface Tool {
  name: string;
  execute(step: PlanStep): Promise<ToolResult>;
}
