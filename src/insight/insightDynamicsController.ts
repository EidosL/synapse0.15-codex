import { clip, rollingMean } from '../util/math';

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
  private delta_s_prev = 0;
  private delta_s_history: number[] = [];
  private alt = 1; // Reversal term alternator, starts at +1

  // Publicly readable outputs
  public W_c = 0;
  public alpha_blend = DEFAULTS.alpha_blend;
  public lambda_observe: LambdaObserve = 'recursive';
  public zone: Zone = 'safe';
  public memoryAction: MemoryAction = null;

  // Constants for this instance
  private readonly constants = DEFAULTS;

  constructor(params?: Partial<typeof DEFAULTS>) {
    this.constants = { ...DEFAULTS, ...params };
  }

  /**
   * Updates the controller with the new tension signal.
   * @param delta_s_now The new delta_s value for the current step.
   * @param anchor_delta The change in anchor truth value. Not used yet.
   */
  public update(delta_s_now: number, anchor_delta = 0) {
    this.t++;

    // [Lambda update]
    const delta = delta_s_now - this.delta_s_prev;
    this.delta_s_history.push(delta_s_now);
    if (this.delta_s_history.length > 5) {
      this.delta_s_history.shift();
    }
    const E_resonance = rollingMean(this.delta_s_history);
    const E_resonance_prev = this.delta_s_history.length > 1 ? rollingMean(this.delta_s_history.slice(0, -1)) : E_resonance;

    if (delta <= -0.02 && E_resonance <= E_resonance_prev) {
      this.lambda_observe = 'convergent';
    } else if (Math.abs(delta) < 0.02 && Math.abs(E_resonance - E_resonance_prev) < 0.01) { // flat
      this.lambda_observe = 'recursive';
    } else if (delta > 0.04) { // Ignoring anchor conflicts for chaotic state for now
      this.lambda_observe = 'chaotic';
    } else { // delta in (-0.02, 0.04] or oscillating E_resonance
      this.lambda_observe = 'divergent';
    }

    // [Coupler (with hysteresis)]
    const prog = (this.t === 1)
      ? this.constants.zeta_min
      : Math.max(this.constants.zeta_min, this.delta_s_prev - delta_s_now);
    const P = Math.pow(prog, this.constants.omega);

    // Reversal term: Phi.
    // alt flips only when |Δanchor| ≥ h.
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

    if (delta_s_now > 0.60) this.memoryAction = 'record(hard)';
    else if (delta_s_now < 0.35) this.memoryAction = 'record(exemplar)';
    else this.memoryAction = null;

    // Update state for next iteration
    this.delta_s_prev = delta_s_now;
  }

  /**
   * [Progression & Guards]
   * Checks if a BBPF bridge is allowed.
   */
  public isBridgeAllowed(): boolean {
    const delta_s_decreases = this.delta_s_history.length > 1
      ? this.delta_s_history[this.delta_s_history.length - 1] < this.delta_s_history[this.delta_s_history.length - 2]
      : false;

    return delta_s_decreases && (this.W_c < 0.5 * this.constants.theta_c);
  }
}
