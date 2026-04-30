/* quiz.js — Active quiz session: question selection, answer scoring,
   spaced repetition, exam mode with timer. */

const Quiz = (() => {
  // ----- Session state -----
  let session = null;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Pick N questions weighted by spaced repetition: lower bucket → higher weight.
  function pickWeighted(pool, n) {
    const state = State.get();
    const weighted = pool.map(q => {
      const st = state.questions[q.id];
      const bucket = st ? st.bucket : 0;
      // Bucket 0..5 → weight 6..1 (mastered is rare, never seen most common after 0)
      const weight = Math.max(1, 6 - bucket) + (st && st.bookmarked ? 2 : 0);
      return { q, weight };
    });
    const out = [];
    const used = new Set();
    while (out.length < n && out.length < pool.length) {
      const total = weighted.reduce((s, x) => used.has(x.q.id) ? s : s + x.weight, 0);
      let r = Math.random() * total;
      for (const x of weighted) {
        if (used.has(x.q.id)) continue;
        r -= x.weight;
        if (r <= 0) {
          out.push(x.q);
          used.add(x.q.id);
          break;
        }
      }
    }
    return out;
  }

  // Build a session of a given mode
  function start({ mode, title, questions, examMode = false, timerSec = null, sheetIdx = null, topic = null }) {
    session = {
      mode, title, examMode, sheetIdx, topic,
      questions: questions.map(q => ({
        ...q,
        // Pre-shuffle answer order for this session; remember the correct one (always index 0 in source).
        _order: shuffle([0, 1, 2, 3]),
      })),
      idx: 0,
      correctCount: 0,
      wrongCount: 0,
      correctStreak: 0,
      maxCorrectStreak: 0,
      answers: [],   // [{qid, picked, correct, comeback, ts}]
      sessionXP: 0,
      startedAt: Date.now(),
      timerSec, timeLeft: timerSec, timerHandle: null,
    };
    if (timerSec) {
      session.timerHandle = setInterval(tickTimer, 1000);
    }
    UI.renderQuiz();
  }

  function tickTimer() {
    if (!session) return;
    session.timeLeft -= 1;
    UI.renderTimer();
    if (session.timeLeft <= 0) {
      clearInterval(session.timerHandle);
      session.timerHandle = null;
      finish();
    }
  }

  function current() {
    if (!session) return null;
    return session.questions[session.idx];
  }

  // User picks an answer (in displayed-order index 0..3)
  function answer(displayIdx) {
    if (!session) return;
    const q = current();
    if (!q || q._answered) return;
    const sourceIdx = q._order[displayIdx];   // map back to original answer index
    const isCorrect = sourceIdx === 0;        // catalog convention: a (idx 0) is correct
    q._answered = true;
    q._pickedDisplay = displayIdx;
    q._wasCorrect = isCorrect;

    // Detect comeback: question was previously wrong and is now correct
    const prev = State.get().questions[q.id];
    const comeback = isCorrect && prev && prev.wrong > 0;

    if (isCorrect) {
      session.correctCount += 1;
      session.correctStreak += 1;
      session.maxCorrectStreak = Math.max(session.maxCorrectStreak, session.correctStreak);
    } else {
      session.wrongCount += 1;
      session.correctStreak = 0;
    }
    session.answers.push({ qid: q.id, displayIdx, correct: isCorrect, comeback, ts: Date.now() });

    // In exam mode, do not record progress per-question or grant XP per-question
    if (!session.examMode) {
      State.tickActivity();
      State.recordQuestion(q.id, isCorrect);

      // XP per answer
      const xp = isCorrect ? 10 : 2;
      session.sessionXP += xp;
      const r = State.awardXP(xp);
      if (r.rankUp) {
        UI.toast({ type: "badge", icon: "🎖️", title: `Rang erreicht: ${r.newRank}!`, desc: "Aufgestiegen — weiter so!" });
        UI.confettiBurst();
      }

      // Spaced-repetition rewards: streak XP every 5 in a row
      if (isCorrect && session.correctStreak > 0 && session.correctStreak % 5 === 0) {
        session.sessionXP += 15;
        State.awardXP(15);
        UI.toast({ type: "success", icon: "🔥", title: `${session.correctStreak} in Folge!`, desc: "+15 Bonus-XP" });
      }

      // Badge checks
      const newBadges = Badges.check({ type: "answer", correctStreak: session.maxCorrectStreak, comeback });
      newBadges.forEach(announceBadge);

      // Daily mission completion
      const dm = State.get().dailyMission;
      if (dm && dm.done >= dm.target && !dm.claimed) {
        dm.claimed = true;
        State.save();
        session.sessionXP += 50;
        State.awardXP(50);
        UI.toast({ type: "badge", icon: "🎯", title: "Mission abgeschlossen!", desc: "+50 XP für die heutige Mission." });
        UI.confettiBurst();
        Badges.check({ type: "daily_complete", consecutive: 1 }).forEach(announceBadge);
      }
    }

    UI.markAnsweredAndAdvance();
  }

  function announceBadge(b) {
    UI.toast({
      type: "badge",
      icon: b.emoji,
      title: `Errungenschaft freigeschaltet!`,
      desc: `${b.name} — ${b.desc}`,
      duration: 5000,
    });
    UI.confettiBurst();
  }

  function next() {
    if (!session) return;
    if (session.idx + 1 >= session.questions.length) {
      finish();
      return;
    }
    session.idx += 1;
    UI.renderQuiz();
  }

  function quit() {
    if (session && session.timerHandle) {
      clearInterval(session.timerHandle);
    }
    session = null;
    UI.goto("home");
  }

  function finish() {
    if (!session) return;
    if (session.timerHandle) { clearInterval(session.timerHandle); session.timerHandle = null; }
    const total = session.questions.length;
    const correct = session.correctCount;
    // For exam mode, count an unanswered question as wrong
    const wrong = total - correct;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    let xpEarned = 0;
    let summaryBadges = [];

    if (session.examMode) {
      // Now record per-question stats and award XP all at once
      session.answers.forEach(a => {
        State.tickActivity();
        State.recordQuestion(a.qid, a.correct);
      });
      const passed = correct >= 27; // 27/30 to pass
      xpEarned = correct * 5 + (passed ? 200 : 0) + (percent === 100 ? 200 : 0);
      State.awardXP(xpEarned);
      State.recordExamResult(percent, correct, total, passed);
      summaryBadges = Badges.check({ type: "exam_finished", passed, percent });
    } else if (session.sheetIdx !== null) {
      State.recordSheetResult(session.sheetIdx, percent, correct, total);
      const passed = percent >= 90;
      xpEarned = correct * 4 + (passed ? 80 : 0);
      State.awardXP(xpEarned);
      summaryBadges = Badges.check({ type: "sheet_finished", passed, sheetIdx: session.sheetIdx });
    } else {
      // Quick-quiz / topic-learn / difficult: XP already awarded per question
      xpEarned = session.sessionXP;
      summaryBadges = Badges.check({ type: "session_finished" });
    }

    UI.renderResult({
      session, percent, correct, wrong, total,
      xpEarned, badges: summaryBadges,
    });
    if (percent >= 80) UI.confettiBurst({ big: true });
    summaryBadges.forEach(announceBadge);
    session = null;
  }

  function getSession() { return session; }

  // ----- Mode entry points -----

  function startQuickQuiz(n = 10) {
    const all = window.QUESTIONS;
    const picked = pickWeighted(all, n);
    start({ mode: "quick", title: "Quick-Quiz", questions: picked });
  }

  function startTopic(topic) {
    let pool = window.QUESTIONS.filter(q => q.topics.includes(topic));
    if (pool.length === 0) pool = window.QUESTIONS;
    const picked = pickWeighted(pool, Math.min(10, pool.length));
    start({ mode: "topic", topic, title: `Lernen: ${topic}`, questions: picked });
  }

  function startDifficult() {
    const state = State.get();
    // Difficult = bucket < 3 with at least one wrong, OR bookmarked
    const candidates = window.QUESTIONS.filter(q => {
      const st = state.questions[q.id];
      if (!st) return false;
      if (st.bookmarked) return true;
      return st.wrong > 0 && st.bucket < 4;
    });
    if (candidates.length === 0) {
      UI.toast({ type: "warn", icon: "🤷", title: "Keine schwierigen Fragen", desc: "Du hast noch keine Fragen oft falsch beantwortet." });
      UI.goto("home");
      return;
    }
    const picked = candidates.slice(0, Math.min(15, candidates.length));
    start({ mode: "difficult", title: "Schwierige Fragen", questions: shuffle(picked) });
  }

  function startExam() {
    const basis  = window.QUESTIONS.filter(q => q.section === "basis");
    const binnen = window.QUESTIONS.filter(q => q.section === "binnen");
    const picked = shuffle([...shuffle(basis).slice(0, 7), ...shuffle(binnen).slice(0, 23)]);
    start({
      mode: "exam", title: "Prüfungssimulation",
      questions: picked, examMode: true, timerSec: 60 * 60,
    });
  }

  function startSheet(idx) {
    const sheet = Sheets.get(idx);
    start({
      mode: "sheet", title: `Bogen ${idx + 1} / ${Sheets.COUNT}`,
      questions: sheet, sheetIdx: idx,
    });
  }

  function bookmarkCurrent() {
    const q = current();
    if (!q) return false;
    return State.toggleBookmark(q.id);
  }

  return {
    start, answer, next, quit, finish,
    getSession, current, bookmarkCurrent,
    startQuickQuiz, startTopic, startDifficult, startExam, startSheet,
  };
})();
