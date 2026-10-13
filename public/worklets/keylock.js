// Key-lock: an AudioWorklet that shifts pitch by `pitch` without changing
// tempo. Each deck plays at playbackRate r (which also raises the pitch by r);
// the deck sets pitch = 1/r here so the track keeps its original key.
//
// Method: streaming phase vocoder (STFT, N = 2048, hop N/8, Hann windows).
// Each bin's true frequency is estimated from its phase advance, the bins are
// moved to k × pitch, and phases are re-accumulated at the shifted frequencies.
// At pitch 1 the synthesis phases are re-synced to the analysis phases, which
// makes the output an exact (delayed) copy of the input. On transients (a jump
// in spectral flux, e.g. a kick) the phases are reset too, so attacks stay
// sharp and on time instead of being smeared across the window.
//
// Latency is constant: DELAY (= N) samples on every deck at any pitch, so beat
// alignment between decks is preserved (lib/audio/keylock.ts mirrors it).
// Plain JS in /public because worklet modules are loaded by URL.

const N = 2048;
const OSAMP = 8;
const HOP = N / OSAMP;
// FIFO offset (samples kept from the previous frame) …
const LATENCY = N - HOP;
// … and the resulting input → output delay, measured in lib/audio/keylock.test.ts.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by the test harness
const DELAY = N;
const HALF = N / 2;
const EXPECT = (2 * Math.PI * HOP) / N;
/** Spectral flux (rise in magnitude) relative to the previous frame that counts as an attack. */
const TRANSIENT_FLUX = 0.35;

const WINDOW = new Float64Array(N);
for (let i = 0; i < N; i++) WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
// Hann analysis × Hann synthesis overlap-adds to 3/8 × OSAMP.
const OLA_GAIN = 1 / ((3 / 8) * OSAMP);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

class Channel {
  constructor() {
    this.inFifo = new Float64Array(N);
    this.outFifo = new Float64Array(N);
    this.accum = new Float64Array(2 * N);
    this.lastPhase = new Float64Array(HALF + 1);
    this.sumPhase = new Float64Array(HALF + 1);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.mag = new Float64Array(HALF + 1);
    this.freq = new Float64Array(HALF + 1);
    this.synMag = new Float64Array(HALF + 1);
    this.synFreq = new Float64Array(HALF + 1);
    this.prevMag = new Float64Array(HALF + 1);
    this.rover = LATENCY;
    this.silentFrames = 0;
    // After silence the stored phases are stale: restart phase tracking from the next frame.
    this.resync = true;
  }

  /** Process one sample; returns the output sample (LATENCY samples later). */
  step(x, pitch) {
    this.inFifo[this.rover] = x;
    const y = this.outFifo[this.rover - LATENCY];
    this.rover++;
    if (this.rover >= N) {
      this.rover = LATENCY;
      this.frame(pitch);
    }
    return y;
  }

  frame(pitch) {
    const { re, im, inFifo } = this;
    let energy = 0;
    for (let k = 0; k < N; k++) {
      re[k] = inFifo[k] * WINDOW[k];
      im[k] = 0;
      energy += re[k] * re[k];
    }
    // Skip the work for silence once the output tail has drained.
    if (energy < 1e-12) this.silentFrames++;
    else this.silentFrames = 0;
    if (this.silentFrames > OSAMP) {
      this.resync = true;
      this.shiftOut();
      return;
    }

    fft(re, im);
    const identity = Math.abs(pitch - 1) < 1e-4;
    const resync = this.resync;
    this.resync = false;
    let rise = 0;
    let prevTotal = 0;
    for (let k = 0; k <= HALF; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);
      let d = resync ? 0 : phase - this.lastPhase[k] - k * EXPECT;
      this.lastPhase[k] = phase;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      if (mag > this.prevMag[k]) rise += mag - this.prevMag[k];
      prevTotal += this.prevMag[k];
      this.prevMag[k] = mag;
      this.mag[k] = mag;
      this.freq[k] = k + (d * OSAMP) / (2 * Math.PI);
      if (identity || resync) this.sumPhase[k] = phase;
    }
    const transient = !identity && !resync && rise > TRANSIENT_FLUX * (prevTotal + 1e-9);

    if (identity) {
      // Spectrum untouched (only the phase resync above): exact reconstruction.
      for (let k = 0; k <= HALF; k++) {
        re[k] = this.mag[k] * Math.cos(this.sumPhase[k]);
        im[k] = this.mag[k] * Math.sin(this.sumPhase[k]);
      }
    } else {
      this.synMag.fill(0);
      this.synFreq.fill(0);
      for (let k = 0; k <= HALF; k++) {
        const idx = Math.round(k * pitch);
        if (idx > HALF) break;
        if (this.mag[k] > this.synMag[idx]) {
          this.synFreq[idx] = this.freq[k] * pitch;
          // On an attack, take the source bin's phase so the transient stays coherent.
          if (transient) this.sumPhase[idx] = Math.atan2(im[k], re[k]);
        }
        this.synMag[idx] += this.mag[k];
      }
      for (let k = 0; k <= HALF; k++) {
        const f = this.synMag[k] > 0 ? this.synFreq[k] : k;
        if (!transient) this.sumPhase[k] += ((f - k) * 2 * Math.PI) / OSAMP + k * EXPECT;
        const m = this.synMag[k];
        const ph = this.sumPhase[k];
        this.synMag[k] = m * Math.cos(ph);
        this.synFreq[k] = m * Math.sin(ph);
      }
      for (let k = 0; k <= HALF; k++) {
        re[k] = this.synMag[k];
        im[k] = this.synFreq[k];
      }
    }
    // Conjugate-symmetric negative frequencies, then inverse FFT via conj trick.
    for (let k = 1; k < HALF; k++) {
      re[N - k] = re[k];
      im[N - k] = -im[k];
    }
    for (let k = 0; k < N; k++) im[k] = -im[k];
    fft(re, im);
    for (let k = 0; k < N; k++) this.accum[k] += (WINDOW[k] * re[k] * OLA_GAIN) / N;
    this.shiftOut();
  }

  shiftOut() {
    for (let k = 0; k < HOP; k++) this.outFifo[k] = this.accum[k];
    this.accum.copyWithin(0, HOP, HOP + N);
    this.accum.fill(0, N);
    this.inFifo.copyWithin(0, HOP, N);
  }
}

class KeyLockProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "pitch", defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.channels = [new Channel(), new Channel()];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const pitch = parameters.pitch[0];
    for (let c = 0; c < output.length; c++) {
      const ch = this.channels[Math.min(c, 1)];
      const src = input[c] ?? input[0];
      const out = output[c];
      for (let i = 0; i < out.length; i++) out[i] = ch.step(src ? src[i] : 0, pitch);
    }
    return true;
  }
}

registerProcessor("keylock", KeyLockProcessor);
