import type { Budget } from './budget';
import type { Signals } from './signals';
import { computeSimEst } from './signals';
import { InsightDynamicsController } from './insightDynamicsController';

/**
 * A stateful controller that uses the WFGY framework to decide whether
 * another retrieval or analysis cycle should be executed.
 */
export class DepthController {
  private currentDepth = 0;
  private sim_est_prev = 0;
  private wfgyController: InsightDynamicsController;

  constructor(private budget: Budget) {
    this.wfgyController = new InsightDynamicsController();
  }

  /**
   * Updates the controller with the latest signals and decides if the process
   * should continue.
   *
   * @param signals - Heuristic signals derived from the current results.
   * @returns `true` if probing should continue, `false` to stop.
   */
  public shouldDeepen(signals: Signals): boolean {
    // Stop if we've exhausted the allowed depth.
    if (this.currentDepth >= this.budget.maxCycles) {
      return false;
    }
    this.currentDepth++;

    // Calculate the core similarity estimate for the current state.
    const sim_est = computeSimEst(signals);

    // Update the WFGY controller with the new signal.
    this.wfgyController.update(sim_est, signals, this.sim_est_prev);

    // Update the previous similarity estimate for the next iteration
    this.sim_est_prev = sim_est;

    // The decision to continue is now governed by the WFGY progression guards.
    return this.wfgyController.isBridgeAllowed();
  }

  /**
   * Returns the latest alpha_blend value from the WFGY controller.
   */
  public getAlphaBlend(): number {
    return this.wfgyController.alpha_blend;
  }

  /**
   * Returns the latest observation about the system's state.
   */
  public getLambdaObserve(): string {
    return this.wfgyController.lambda_observe;
  }
}
