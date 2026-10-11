// Seeded pseudo-random generator (mulberry32). The seed is stored with each run so the
// stochastic draws behind a run are documented; exact replay is not required by the brief.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: () => {
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    // entries: array of [value, weight]
    weighted: (entries) => {
      let total = 0;
      for (const [, w] of entries) total += w;
      let r = next() * total;
      for (const [v, w] of entries) {
        r -= w;
        if (r <= 0) return v;
      }
      return entries[entries.length - 1][0];
    },
  };
  return rng;
}
