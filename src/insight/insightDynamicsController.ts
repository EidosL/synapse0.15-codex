import { clip, rollingMean, eurekaScore, serendipityScore } from '../util/math';
import type { Signals } from './signals';

// [Defaults] from WFGY spec
const DEFAULTS = {
  B_c: 0.85,
  gamma: 0.618,
  theta_c: 0.75,
  zeta_min: 0.10,
  alpha_blend: 0.50,
  omega: 1.0,
  phi_delta: 0.15,
  epsilon: 0.0,
  k_c: 0.25,
  h_anchor: 0.02,
};

// [Zones & Memory]
export type Zone = 'safe' | 'transit' | 'risk' | 'danger';
export type MemoryAction = 'record(hard)' | 'record(exemplar)' | null;
export type LambdaObserve = 'convergent' | 'recursive' | 'divergent' | 'chaotic';

export class InsightDynamicsController {
  // State variables
  private t = 0;
  private delta_s_history: number[] = [];
  private alt = 1; // Reversal term alternator, starts at +1

  // Publicly readable outputs
  public W_c = 0;
  public alpha_blend = DEFAULTS.alpha_blend;
  public lambda_observe: LambdaObserve = 'recursive';
  public zone: Zone = 'safe';
  public memoryAction: MemoryAction = null;
  public eureka = 0;
  public serendipity = 0;

  // Constants for this instance
  private readonly constants = DEFAULTS;

  constructor(params?: Partial<typeof DEFAULTS>) {
    this.constants = { ...DEFAULTS, ...params };
  }

  /**
   * Updates the controller with the new signals.
   * @param simNow The new similarity estimate for the current step.
   * @param signals The signals object for the current step.
   * @param simPrev The similarity estimate from the previous step.
   * @param anchor_delta The change in anchor truth value. Not used yet.
   */
  public update(simNow: number, signals: Signals, simPrev: number, anchor_delta = 0) {
    this.t++;
    const delta_s_now = 1 - simNow;

    // [Eureka and Serendipity]
    this.eureka = eurekaScore(simNow, simPrev, signals.sim_constraints, signals.entropy);
    this.serendipity = serendipityScore(signals.sim_relations, signals.sim_entities, simNow, simPrev, signals.entropy);

    // [Lambda update]
    this.delta_s_history.push(delta_s_now);
    if (this.delta_s_history.length > 3) { // Keep last 3 steps for trend analysis
      this.delta_s_history.shift();
    }
    const delta_s_trend = this.delta_s_history.length > 1 ? rollingMean(this.delta_s_history.slice(-2)) - rollingMean(this.delta_s_history.slice(0, 2)) : 0;

    // Stop (declare Eureka): if eurekaScore ≥ 0.7 and δs is flat-to-decreasing across the last 2–3 steps.
    if (this.eureka >= 0.7 && delta_s_trend <= 0) {
      this.lambda_observe = 'convergent';
    }
    // Branch laterally (chase Serendipity): if serendipityScore ≥ 0.6 and eurekaScore < 0.7.
    else if (this.serendipity >= 0.6 && this.eureka < 0.7) {
      this.lambda_observe = 'divergent';
    }
    // Keep digging (noisy progress): if both scores are middling (≈0.3–0.6) but δs is trending down
    else if (this.eureka >= 0.3 && this.eureka < 0.7 && this.serendipity >= 0.3 && this.serendipity < 0.6 && delta_s_trend < 0) {
      this.lambda_observe = 'recursive';
    }
    // Reset / back off: if entropy stays >0.7 or δs rises for ≥2 steps
    else if (signals.entropy > 0.7 || (this.delta_s_history.length >= 2 && this.delta_s_history[this.delta_s_history.length - 1] > this.delta_s_history[this.delta_s_history.length - 2])) {
      this.lambda_observe = 'chaotic';
    }
    // Default to recursive
    else {
      this.lambda_observe = 'recursive';
    }

    // [Coupler (with hysteresis)] - Retaining original WFGY mechanics for W_c
    const delta_s_prev = this.delta_s_history.length > 1 ? this.delta_s_history[this.delta_s_history.length-2] : delta_s_now;
    const prog = (this.t === 1)
      ? this.constants.zeta_min
      : Math.max(this.constants.zeta_min, delta_s_prev - delta_s_now);
    const P = Math.pow(prog, this.constants.omega);

    // Reversal term: Phi.
    if (Math.abs(anchor_delta) >= this.constants.h_anchor) {
        this.alt *= -1; // Flip the alternator
    }
    const Phi = this.constants.phi_delta * this.alt + this.constants.epsilon;
    this.W_c = clip(delta_s_now * P + Phi, -this.constants.theta_c, this.constants.theta_c);

    // [BBAM (attention rebalance)]
    this.alpha_blend = clip(
      0.50 + this.constants.k_c * Math.tanh(this.W_c),
      0.35, 0.65
    );

    // [Zones & Memory]
    if (delta_s_now < 0.40) this.zone = 'safe';
    else if (delta_s_now < 0.60) this.zone = 'transit';
    else if (delta_s_now < 0.85) this.zone = 'risk';
    else this.zone = 'danger';

    if (this.eureka >= 0.7) {
      this.memoryAction = 'record(exemplar)';
    } else if (this.lambda_observe === 'chaotic') {
      this.memoryAction = 'record(hard)';
    } else {
      this.memoryAction = null;
    }
  }

  /**
   * [Progression & Guards]
   * Decides if the process should continue ("bridge" to the next step).
   */
  public isBridgeAllowed(): boolean {
    // Don't allow bridging on the first step, as more data is needed.
    if (this.t <= 1) {
      return false;
    }

    // A bridge is allowed if we are in a "keep digging" (recursive) or "branch" (divergent) state.
    // It is not allowed if we have declared "eureka" (convergent) or need to reset (chaotic).
    return this.lambda_observe === 'recursive' || this.lambda_observe === 'divergent';
  }
}
