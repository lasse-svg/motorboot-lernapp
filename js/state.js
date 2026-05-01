/* state.js — Profile, progress, XP/level/streak persistence in localStorage. */

const State = (() => {
  const KEY = "ahoi.state.v1";
  const KEY_CREW = "ahoi.crew.v1";
  const KEY_BADGES = "ahoi.badges.v1";

  // Rank ladder — XP thresholds + emoji + name. Names are progressively more nautical.
  const RANKS = [
    { name: "Landratte",      emoji: "🦦", xp: 0    },
    { name: "Decksjunge",     emoji: "🐢", xp: 200  },
    { name: "Matrose",        emoji: "🐬", xp: 600  },
    { name: "Steuermann",     emoji: "⛵", xp: 1500 },
    { name: "Skipper",        emoji: "🚤", xp: 3000 },
    { name: "Bootsmann",      emoji: "🛥️", xp: 5500 },
    { name: "1. Offizier",    emoji: "🦈", xp: 9000 },
    { name: "Käpt'n",         emoji: "⚓", xp: 14000 },
    { name: "Admiral",        emoji: "🦅", xp: 22000 },
  ];

  function defaultState() {
    return {
      profile: { name: "", avatar: "🚤", createdAt: Date.now() },
      xp: 0,
      streak: 0,
      lastActivityDate: null,        // YYYY-MM-DD
      onboarded: false,
      // per-question stats for spaced repetition (Leitner-style buckets)
      questions: {},                 // id → {seen, correct, wrong, lastSeen, bucket, bookmarked}
      // sheet results
      sheets: {},                    // sheetIndex → {bestPercent, attempts, passed}
      // exam attempts
      exams: [],                     // [{date, percent, correct, total, passed}]
      // daily mission
      dailyMission: { date: null, target: 10, done: 0, claimed: false },
      // unlocked badges
      badges: [],                    // ids
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const obj = JSON.parse(raw);
      const def = defaultState();
      // shallow-merge to be forward-compatible
      return { ...def, ...obj, profile: { ...def.profile, ...(obj.profile||{}) }, dailyMission: { ...def.dailyMission, ...(obj.dailyMission||{}) } };
    } catch (e) {
      console.error("state load error", e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { console.error("state save error", e); }
    // Mirror to cloud if signed in (debounced inside Cloud)
    try {
      if (typeof Cloud !== "undefined" && Cloud.enabled && Cloud.enabled() && Cloud.isSignedIn()) {
        Cloud.pushState();
      }
    } catch (e) { /* swallow */ }
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }

  function diffDays(aStr, bStr) {
    const a = new Date(aStr), b = new Date(bStr);
    return Math.round((b - a) / 86400000);
  }

  function get() { return state; }

  function setProfile(name, avatar) {
    state.profile.name = name.trim() || "Käpt'n Anonymous";
    state.profile.avatar = avatar || "🚤";
    state.onboarded = true;
    save();
  }

  function rankFor(xp) {
    let cur = RANKS[0];
    let next = null;
    for (let i = 0; i < RANKS.length; i++) {
      if (xp >= RANKS[i].xp) { cur = RANKS[i]; next = RANKS[i+1] || null; }
    }
    let progress = 1;
    if (next) progress = Math.max(0, Math.min(1, (xp - cur.xp) / (next.xp - cur.xp)));
    return { current: cur, next, progress };
  }

  function tickActivity() {
    // Update streak: if last activity was yesterday → +1, today → unchanged, else → reset to 1.
    const today = todayStr();
    if (state.lastActivityDate === today) return false;
    let streakChanged = false;
    if (state.lastActivityDate) {
      const days = diffDays(state.lastActivityDate, today);
      if (days === 1) { state.streak += 1; streakChanged = true; }
      else if (days > 1) { state.streak = 1; streakChanged = true; }
    } else {
      state.streak = 1; streakChanged = true;
    }
    state.lastActivityDate = today;
    // Reset daily mission for new day
    if (state.dailyMission.date !== today) {
      state.dailyMission = { date: today, target: 10, done: 0, claimed: false };
    }
    save();
    return streakChanged;
  }

  function ensureDailyMission() {
    const today = todayStr();
    if (state.dailyMission.date !== today) {
      state.dailyMission = { date: today, target: 10, done: 0, claimed: false };
      save();
    }
    return state.dailyMission;
  }

  function recordQuestion(qid, wasCorrect) {
    const q = state.questions[qid] || { seen: 0, correct: 0, wrong: 0, lastSeen: 0, bucket: 0, bookmarked: false };
    q.seen += 1;
    q.lastSeen = Date.now();
    if (wasCorrect) {
      q.correct += 1;
      q.bucket = Math.min(5, q.bucket + 1);     // mastery bucket up
    } else {
      q.wrong += 1;
      q.bucket = Math.max(0, q.bucket - 2);     // big drop on miss
    }
    state.questions[qid] = q;
    // Daily mission
    ensureDailyMission();
    if (state.dailyMission.done < state.dailyMission.target) {
      state.dailyMission.done += 1;
    }
    save();
  }

  function toggleBookmark(qid) {
    const q = state.questions[qid] || { seen: 0, correct: 0, wrong: 0, lastSeen: 0, bucket: 0, bookmarked: false };
    q.bookmarked = !q.bookmarked;
    state.questions[qid] = q;
    save();
    return q.bookmarked;
  }

  function awardXP(amount) {
    if (!amount) return { rankUp: false };
    const before = rankFor(state.xp).current.name;
    state.xp += amount;
    const after = rankFor(state.xp).current.name;
    save();
    return { rankUp: before !== after, oldRank: before, newRank: after };
  }

  function unlockBadge(badgeId) {
    if (state.badges.includes(badgeId)) return false;
    state.badges.push(badgeId);
    save();
    return true;
  }

  function resetProgress() {
    const profile = state.profile; // keep profile + onboarded
    state = defaultState();
    state.profile = profile;
    state.onboarded = true;
    save();
  }

  function recordSheetResult(sheetIdx, percent, correct, total) {
    const cur = state.sheets[sheetIdx] || { bestPercent: 0, attempts: 0, passed: false };
    cur.attempts += 1;
    cur.bestPercent = Math.max(cur.bestPercent, percent);
    if (percent >= 90) cur.passed = true;
    state.sheets[sheetIdx] = cur;
    save();
  }

  function recordExamResult(percent, correct, total, passed) {
    state.exams.push({ date: todayStr(), percent, correct, total, passed });
    save();
  }

  // Aggregate stats
  function aggregateStats() {
    let answered = 0, correct = 0, mastered = 0, encountered = 0;
    for (const id in state.questions) {
      const q = state.questions[id];
      answered += q.seen;
      correct  += q.correct;
      encountered += 1;
      if (q.bucket >= 4) mastered += 1;
    }
    const trefferquote = answered ? Math.round((correct / answered) * 100) : 0;
    return { answered, correct, mastered, encountered, trefferquote };
  }

  function topicStats() {
    // For each topic compute encountered/correct ratio
    const buckets = {};
    for (const q of window.QUESTIONS) {
      const st = state.questions[q.id];
      if (!st) continue;
      for (const t of q.topics) {
        if (!buckets[t]) buckets[t] = { seen: 0, correct: 0, total: 0 };
        buckets[t].seen += st.seen;
        buckets[t].correct += st.correct;
      }
    }
    for (const q of window.QUESTIONS) {
      for (const t of q.topics) {
        if (!buckets[t]) buckets[t] = { seen: 0, correct: 0, total: 0 };
        buckets[t].total += 1;
      }
    }
    return buckets;
  }

  return {
    get, save, load,
    setProfile, rankFor, RANKS,
    tickActivity, ensureDailyMission,
    recordQuestion, toggleBookmark,
    awardXP, unlockBadge,
    resetProgress,
    recordSheetResult, recordExamResult,
    aggregateStats, topicStats,
    todayStr,
  };
})();
