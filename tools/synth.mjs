/* A 3-minute synthetic DJ set with a known answer, shared by the tests:
     0-90 s    house at 128 BPM over an A-minor chord (Camelot 8A)
     90-180 s  a different groove at 140 BPM over D minor (7A), other timbre
   Deterministic (seeded noise). */
export const SYNTH = { duration: 180, change: 90, parts: [{ bpm: 128, key: "8A" }, { bpm: 140, key: "7A" }] };

export function makeSet(sr = 16000) {
  const N = SYNTH.duration * sr, y = new Float32Array(N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const chord = (t, notes, w) => notes.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t) * w, 0);
  const part = (t0, t1, bpm, notes, square) => {
    const beat = 60 / bpm;
    for (let i = Math.floor(t0 * sr); i < t1 * sr; i++) {
      const t = i / sr, tb = (t - t0) % beat, phase = Math.floor((t - t0) / beat);
      let v = 0;
      if (tb < 0.12) v += Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-tb * 40)) * tb) * Math.exp(-tb * 18) * 0.9;   // kick
      const off = (t - t0 + beat / 2) % beat;
      if (off < 0.04) v += rnd() * Math.exp(-off * 90) * 0.25;                                                         // hat
      if (square && phase % 2 === 1 && tb < 0.15) v += rnd() * Math.exp(-tb * 25) * 0.35;                              // snare
      const pad = chord(t, notes, 0.07);
      v += square ? Math.sign(pad) * 0.05 + pad * 0.5 : pad;
      y[i] = Math.max(-1, Math.min(1, v));
    }
  };
  part(0, 90, 128, [220, 261.63, 329.63, 110], false);        // A minor (A C E + A2 bass)
  part(90, 180, 140, [293.66, 349.23, 440, 146.83], true);    // D minor (D F A + D3 bass)
  return y;
}

/** 16-bit mono WAV bytes */
export function wavBytes(y, sr = 16000) {
  const n = y.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * 32767))), 44 + i * 2);
  return buf;
}

/* CLI: node tools/synth.mjs out.wav [sampleRate]  (used by tools/selftest_py.py) */
if (process.argv[1] && process.argv[1].endsWith("synth.mjs") && process.argv[2]) {
  const fs = await import("node:fs");
  const sr = +(process.argv[3] || 44100);
  fs.writeFileSync(process.argv[2], wavBytes(makeSet(sr), sr));
}
