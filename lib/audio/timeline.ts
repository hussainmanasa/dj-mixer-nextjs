// Maps between AudioContext time and track position for one deck, given its
// playback-rate schedule (constant rate, optionally one linear ramp) and at
// most one jump (a dialogue that cuts straight to the drop).
// Pure math so beat alignment can be unit-tested without Web Audio.

export interface RateRamp {
  /** Context time the ramp starts / ends. */
  t0: number;
  t1: number;
  r0: number;
  r1: number;
}

/** At context time `at`, playback continues from track position `to`. */
export interface Jump {
  at: number;
  to: number;
}

export class PlaybackTimeline {
  constructor(
    /** Context time the source starts. */
    public readonly startTime: number,
    /** Track position (s) the source starts from. */
    public readonly startOffset: number,
    /** Initial playback rate. */
    public readonly rate: number,
    public ramp: RateRamp | null = null,
    public readonly jump: Jump | null = null,
  ) {}

  rateAt(t: number): number {
    const r = this.ramp;
    if (!r || t <= r.t0) return this.rate;
    if (t >= r.t1) return r.r1;
    return r.r0 + ((r.r1 - r.r0) * (t - r.t0)) / (r.t1 - r.t0);
  }

  /** Track position (s) at context time `t`. */
  positionAt(t: number): number {
    const j = this.jump;
    // After a jump the track continues from `to`, having played the same distance since.
    if (j && t >= j.at) return j.to + this.continuous(t) - this.continuous(j.at);
    return this.continuous(t);
  }

  /** Context time at which the deck reaches track position `pos` (after the jump if it plays twice). */
  timeAt(pos: number): number {
    const j = this.jump;
    if (!j) return this.continuousTimeAt(pos);
    const before = this.continuous(j.at);
    if (pos >= j.to) return this.continuousTimeAt(before + pos - j.to);
    // Skipped over by the jump: reached (in effect) when the jump happens.
    return pos <= before ? this.continuousTimeAt(pos) : j.at;
  }

  /** Position as if there were no jump. */
  private continuous(t: number): number {
    if (t <= this.startTime) return this.startOffset;
    const r = this.ramp;
    if (!r || t <= r.t0) return this.startOffset + (t - this.startTime) * this.rate;
    const p0 = this.startOffset + (r.t0 - this.startTime) * this.rate;
    const T = r.t1 - r.t0;
    if (t <= r.t1) {
      const dt = t - r.t0;
      return p0 + r.r0 * dt + ((r.r1 - r.r0) * dt * dt) / (2 * T);
    }
    const p1 = p0 + ((r.r0 + r.r1) / 2) * T;
    return p1 + (t - r.t1) * r.r1;
  }

  private continuousTimeAt(pos: number): number {
    if (pos <= this.startOffset) return this.startTime;
    const r = this.ramp;
    if (!r) return this.startTime + (pos - this.startOffset) / this.rate;
    const p0 = this.continuous(r.t0);
    if (pos <= p0) return this.startTime + (pos - this.startOffset) / this.rate;
    const T = r.t1 - r.t0;
    const p1 = p0 + ((r.r0 + r.r1) / 2) * T;
    if (pos <= p1) {
      const a = (r.r1 - r.r0) / (2 * T);
      const b = r.r0;
      const c = -(pos - p0);
      const dt = Math.abs(a) < 1e-12 ? -c / b : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      return r.t0 + dt;
    }
    return r.t1 + (pos - p1) / r.r1;
  }
}
