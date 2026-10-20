/* Camelot keys on a perceptual hue wheel.
   Camelot 1..12 walks the wheel in 30° steps, so harmonic neighbors (±1)
   get neighboring hues and a key clash reads as a jump in color.
   Minor (A) keys sit deeper, major (B) keys lighter. */
(function () {
  function oklchToRgb(L, C, hDeg) {
    const h = (hDeg * Math.PI) / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return lin.map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });
  }

  const HUE0 = 18; // 1A/1B: warm coral; 4: gold; 7: green; 10: blue; 12: violet

  function parse(code) {
    if (!code) return null;
    const m = /^(\d+)([AB])$/.exec(code);
    return m ? { n: +m[1], mode: m[2] } : null;
  }

  function keyRgb(code, tone) {
    const k = parse(code);
    tone = tone || "base";
    if (!k) {
      const g = tone === "deep" ? [74, 72, 86] : tone === "pale" ? [172, 168, 186] : [124, 120, 140];
      return g;
    }
    const h = HUE0 + (k.n - 1) * 30;
    const minor = k.mode === "A";
    const T = {
      base: minor ? [0.72, 0.14] : [0.8, 0.12],
      deep: minor ? [0.42, 0.09] : [0.48, 0.08],
      pale: minor ? [0.88, 0.06] : [0.92, 0.05],
      ink:  minor ? [0.78, 0.12] : [0.85, 0.1],
    }[tone];
    return oklchToRgb(T[0], T[1], h);
  }

  function keyColor(code, tone, alpha) {
    const [r, g, b] = keyRgb(code, tone);
    return alpha == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
  }

  window.KeyColor = { keyRgb, keyColor, parse, HUE0 };
})();
