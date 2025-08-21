import type { Tier, Budget } from '../insight/budget';
import { policyFor as insightPolicyFor, TIERS } from '../insight/budget';

export { TIERS };
export type { Budget };

export const policyFor = (tier: Tier): Budget => insightPolicyFor(tier);
