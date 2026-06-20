/**
 * A lightly underdamped scalar spring. Eases a value toward a moving target
 * with a small overshoot and settle, which makes demeanor/expression changes
 * feel bouncy and alive instead of linearly interpolated.
 *
 * Damping ratio is set by `damping / (2 * sqrt(stiffness))`; the defaults
 * give roughly 0.65 — a quick approach with a cute ~6% overshoot.
 */
export class Spring {
  private velocity = 0;

  constructor(
    public value = 0,
    private readonly stiffness = 80,
    private readonly damping = 12,
  ) {}

  /** Advances the spring toward `target` by `delta` seconds and returns the new value. */
  update(target: number, delta: number): number {
    // Substep the integration so a big frame gap (e.g. a backgrounded tab)
    // can't make the semi-implicit Euler step explode.
    let remaining = Math.min(delta, 0.25);
    while (remaining > 1e-6) {
      const dt = Math.min(remaining, 1 / 30);
      this.velocity += ((target - this.value) * this.stiffness - this.velocity * this.damping) * dt;
      this.value += this.velocity * dt;
      remaining -= dt;
    }
    return this.value;
  }

  /** Jumps straight to `value` with no residual motion, e.g. on reset. */
  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
