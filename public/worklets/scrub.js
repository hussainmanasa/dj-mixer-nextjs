// Scratch: plays a track at a position that follows the jog wheel — forwards
// or backwards, faster or slower — and goes silent when the wheel stops, like
// a record under a hand. Used on the preview / cue output only (never the mix).
//
// Messages (positions in sample frames of the track):
//   { type: "window", channels, start }  samples around where it's scratched (±20 s)
//   { type: "target", frame }            where the wheel is now; playback chases it
//   { type: "play", frame, seconds }     play forwards at normal speed from frame (a key / scroll step)
//   { type: "end" }                      let go: it slows to a stop and goes silent
// Plain JS in /public because worklet modules are loaded by URL.

/** Seconds to catch up with the wheel. */
const FOLLOW = 0.03;
/** Time constant (s) of the platter's inertia. */
const INERTIA = 0.008;
/** Fastest scratch, × normal speed. */
const MAX_SPEED = 6;

class ScrubProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;
    this.start = 0;
    this.pos = 0;
    this.target = 0;
    this.vel = 0;
    this.level = 0;
    this.active = false;
    this.playLeft = 0;
    this.follow = 1 / (FOLLOW * sampleRate);
    this.smooth = 1 - Math.exp(-1 / (INERTIA * sampleRate));
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    if (m.type === "window") {
      this.channels = m.channels;
      this.start = m.start;
    } else if (m.type === "target") {
      // Picking the wheel up: start where it is, without a jump.
      if (!this.active || this.playLeft > 0) {
        this.pos = m.frame;
        this.vel = 0;
      }
      this.target = m.frame;
      this.active = true;
      this.playLeft = 0;
    } else if (m.type === "play") {
      this.pos = m.frame;
      this.target = m.frame;
      this.playLeft = Math.round(m.seconds * sampleRate);
      this.active = true;
    } else if (m.type === "end") {
      this.active = false;
      this.playLeft = 0;
    }
  }

  read(ch, frame) {
    const i = frame - this.start;
    const k = Math.floor(i);
    if (k < 0 || k + 1 >= ch.length) return 0;
    const t = i - k;
    return ch[k] * (1 - t) + ch[k + 1] * t;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    for (let i = 0; i < n; i++) {
      let desired = 0;
      if (this.playLeft > 0) {
        desired = 1;
        this.playLeft--;
        this.target = this.pos;
      } else if (this.active) {
        desired = (this.target - this.pos) * this.follow;
        if (desired > MAX_SPEED) desired = MAX_SPEED;
        else if (desired < -MAX_SPEED) desired = -MAX_SPEED;
      }
      this.vel += (desired - this.vel) * this.smooth;
      this.pos += this.vel;
      // Loudness follows speed: a still record is silent, and stopping never clicks.
      const want = Math.min(1, Math.abs(this.vel) * 4);
      this.level += (want - this.level) * this.smooth;
      for (let c = 0; c < out.length; c++) {
        const ch = this.channels ? this.channels[Math.min(c, this.channels.length - 1)] : null;
        out[c][i] = ch ? this.read(ch, this.pos) * this.level : 0;
      }
    }
    return true;
  }
}

registerProcessor("scrub", ScrubProcessor);
