/* sheets.js — Generate 15 deterministic Fragebögen with 30 questions each.
   Real exam composition: 7 Basisfragen + 23 spezifische Binnenfragen.
   We seed a deterministic shuffle so the same sheet always contains the same questions. */

const Sheets = (() => {
  const SHEET_COUNT = 15;
  const SHEET_BASIS_COUNT = 7;
  const SHEET_BINNEN_COUNT = 23;

  // Mulberry32 PRNG for deterministic seeded shuffles
  function prng(seed) {
    let a = seed >>> 0;
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Build sheets: deal questions round-robin from a shuffled deck so each question
  // appears in roughly the same number of sheets and every sheet has the right mix.
  function buildAll() {
    const all = window.QUESTIONS;
    const basis  = all.filter(q => q.section === "basis");   // 72
    const binnen = all.filter(q => q.section === "binnen");  // 181

    const rng = prng(424242); // fixed seed → deterministic across users
    const basisShuffled  = shuffled(basis, rng);
    const binnenShuffled = shuffled(binnen, rng);

    const sheets = Array.from({ length: SHEET_COUNT }, () => []);

    // Deal basis questions round-robin (each sheet gets 7 → total 105, basis has only 72,
    // so some questions are reused across sheets — that's fine for practice).
    for (let i = 0; i < SHEET_COUNT * SHEET_BASIS_COUNT; i++) {
      const q = basisShuffled[i % basisShuffled.length];
      sheets[i % SHEET_COUNT].push(q);
    }
    // Deal binnen questions round-robin (15 * 23 = 345 deals over 181 questions).
    for (let i = 0; i < SHEET_COUNT * SHEET_BINNEN_COUNT; i++) {
      const q = binnenShuffled[i % binnenShuffled.length];
      sheets[i % SHEET_COUNT].push(q);
    }

    // Within each sheet: deduplicate (in case the round-robin produced the same id twice
    // — unlikely but possible) and pad if needed by drawing more from the same pool.
    return sheets.map((sheet, idx) => {
      const seen = new Set();
      const unique = [];
      for (const q of sheet) {
        if (!seen.has(q.id)) { seen.add(q.id); unique.push(q); }
      }
      // Pad if we lost a couple to dedup
      const sheetRng = prng(idx * 9973 + 17);
      const fillers = shuffled(all, sheetRng);
      let fi = 0;
      while (unique.length < 30 && fi < fillers.length) {
        if (!seen.has(fillers[fi].id)) { seen.add(fillers[fi].id); unique.push(fillers[fi]); }
        fi += 1;
      }
      // Final shuffle for question order within the sheet
      return shuffled(unique, sheetRng);
    });
  }

  let _cache = null;
  function all() {
    if (!_cache) _cache = buildAll();
    return _cache;
  }
  function get(idx) { return all()[idx]; }

  return { all, get, COUNT: SHEET_COUNT };
})();
