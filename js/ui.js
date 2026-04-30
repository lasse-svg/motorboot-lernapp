/* ui.js — DOM rendering, view switching, toasts, confetti. */

const UI = (() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Topic metadata for friendly names + emojis
  const TOPIC_META = {
    recht:               { emoji: "📜", name: "Recht & Vorschriften" },
    vorfahrt:            { emoji: "↔️", name: "Vorfahrt & Begegnen" },
    schifffahrtszeichen: { emoji: "🚦", name: "Schifffahrtszeichen" },
    lichter:             { emoji: "🔆", name: "Lichterführung" },
    schallzeichen:       { emoji: "🔔", name: "Schallzeichen" },
    schleuse:            { emoji: "🚪", name: "Schleusen" },
    brücke:              { emoji: "🌉", name: "Brücken & Durchfahrten" },
    notfall:             { emoji: "🆘", name: "Notfall & Hilfe" },
    umwelt:              { emoji: "🌱", name: "Umwelt" },
    technik:             { emoji: "⚙️", name: "Technik & Boot" },
    wetter:              { emoji: "🌬️", name: "Wetter & Sicht" },
    anker:               { emoji: "⚓", name: "Anker & Festmacher" },
    allgemein:           { emoji: "📘", name: "Allgemein" },
  };

  function topicMeta(t) { return TOPIC_META[t] || { emoji: "📘", name: t }; }

  // ---------- View switching ----------
  let currentView = "home";
  function goto(view) {
    $$(".view").forEach(v => v.classList.add("hidden"));
    const target = document.querySelector(`[data-view="${view}"].view`);
    if (target) target.classList.remove("hidden");
    currentView = view;
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderForView(view);
  }

  function renderForView(view) {
    if (view === "home") renderHome();
    else if (view === "learn") renderTopics();
    else if (view === "sheets") renderSheets();
    else if (view === "difficult") renderDifficult();
    else if (view === "crew") renderCrew();
    else if (view === "profile") renderProfile();
    else if (view === "badges") renderBadges();
  }

  // ---------- HUD ----------
  function renderHUD() {
    const s = State.get();
    $("#xp-count").textContent = s.xp;
    $("#streak-count").textContent = s.streak;
    const r = State.rankFor(s.xp);
    $("#rank-emoji").textContent = r.current.emoji;
    $("#rank-name").textContent = r.current.name;
    $("#rank-bar-fill").style.width = (r.progress * 100) + "%";
    $("#profile-avatar").textContent = s.profile.avatar || "🚤";
  }

  function bumpHUD(which) {
    const el = $(`#hud-${which}`);
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  // ---------- Home ----------
  function renderHome() {
    renderHUD();
    const s = State.get();
    const dm = State.ensureDailyMission();
    $("#dm-desc").textContent = `${dm.done} / ${dm.target} Fragen heute beantwortet`;
    $("#dm-bar-fill").style.width = Math.min(100, (dm.done / dm.target) * 100) + "%";
    const dmEl = $("#daily-mission");
    if (dm.done >= dm.target) dmEl.classList.add("complete"); else dmEl.classList.remove("complete");

    // Stats
    const agg = State.aggregateStats();
    $("#stat-answered").textContent = agg.answered;
    $("#stat-correct").textContent = agg.trefferquote + "%";
    $("#stat-mastered").textContent = `${agg.mastered}/253`;
    $("#stat-badges").textContent = s.badges.length;

    // Crew preview
    const crewPrev = $("#crew-preview-list");
    crewPrev.innerHTML = "";
    const lb = Crew.leaderboard("xp").slice(0, 4);
    if (lb.length === 1 && lb[0].isMe) {
      crewPrev.innerHTML = `<div class="empty-hint">Noch keine Crew. <strong>Lade Freunde ein →</strong></div>`;
    } else {
      lb.forEach((m, i) => {
        const row = document.createElement("div");
        row.className = "crew-mini-item";
        row.innerHTML = `<span class="avatar">${escape(m.a)}</span>
          <span class="name">${i+1}. ${escape(m.n)}${m.isMe ? " <small style='color:var(--text-dim)'>(Du)</small>" : ""}</span>
          <span class="xp">⭐ ${m.x}</span>`;
        crewPrev.appendChild(row);
      });
    }

    // Recent badges
    const badgeBox = $("#badges-preview-list");
    badgeBox.innerHTML = "";
    const recent = Badges.recent(4);
    if (recent.length === 0) {
      badgeBox.innerHTML = `<div class="empty-hint">Noch keine Errungenschaften. <strong>Beantworte deine erste Frage!</strong></div>`;
    } else {
      recent.forEach(b => {
        const row = document.createElement("div");
        row.className = "badge-mini";
        row.innerHTML = `<span class="b-emoji">${b.emoji}</span>
          <div><div class="b-name">${escape(b.name)}</div><div class="b-desc">${escape(b.desc)}</div></div>`;
        badgeBox.appendChild(row);
      });
    }
  }

  // ---------- Onboarding ----------
  function renderOnboarding() {
    const onboard = $("#onboarding");
    if (State.get().onboarded) {
      onboard.classList.add("hidden");
      return false;
    }
    onboard.classList.remove("hidden");
    let chosenAvatar = "🚤";
    const buttons = $$("#onboard-avatars button");
    buttons.forEach(b => b.classList.remove("selected"));
    buttons[0].classList.add("selected");
    buttons.forEach(b => {
      b.onclick = () => {
        buttons.forEach(x => x.classList.remove("selected"));
        b.classList.add("selected");
        chosenAvatar = b.dataset.avatar;
      };
    });
    $("#onboard-start").onclick = () => {
      const name = $("#onboard-name").value.trim() || "Käpt'n Anonymous";
      State.setProfile(name, chosenAvatar);
      onboard.classList.add("hidden");
      renderHUD(); renderHome();
      // Show pending invite if any
      const inv = Crew.pendingInvite();
      if (inv) {
        const r = Crew.add(inv);
        if (r.ok) {
          toast({ type: "success", icon: "👥", title: "Crewmitglied hinzugefügt", desc: `${r.member.n} ist jetzt in deiner Crew.` });
          Badges.check({ type: "crew_added" }).forEach(announceBadge);
        }
        Crew.clearPendingInvite();
      }
      toast({ type: "success", icon: "🚀", title: `Ahoi, ${name}!`, desc: "Drücke ein Quick-Quiz um zu starten." });
    };
    return true;
  }

  // ---------- Quiz rendering ----------
  function renderQuiz() {
    const s = Quiz.getSession();
    if (!s) return;
    goto("quiz");
    $("#quiz-title").textContent = s.title;
    $("#quiz-current").textContent = s.idx + 1;
    $("#quiz-total").textContent = s.questions.length;
    $("#quiz-bar-fill").style.width = ((s.idx) / s.questions.length * 100) + "%";

    // Timer
    const tim = $("#quiz-timer");
    if (s.timerSec) { tim.classList.remove("hidden"); renderTimer(); } else { tim.classList.add("hidden"); }

    const q = Quiz.current();
    if (!q) return;

    $("#q-section").textContent = q.section === "basis" ? "Basis" : "Binnen";
    $("#q-section").className = "q-section " + q.section;
    $("#q-id").textContent = "Frage " + q.id;
    $("#q-text").textContent = q.question;

    // Bookmark
    const st = State.get().questions[q.id];
    const bk = $("#bookmark-btn");
    if (st && st.bookmarked) { bk.textContent = "★"; bk.classList.add("bookmarked"); }
    else { bk.textContent = "☆"; bk.classList.remove("bookmarked"); }

    // Answers
    const box = $("#q-answers");
    box.innerHTML = "";
    q._order.forEach((sourceIdx, displayIdx) => {
      const btn = document.createElement("button");
      btn.className = "q-answer";
      btn.dataset.idx = displayIdx;
      btn.innerHTML = `<span class="letter">${"ABCD"[displayIdx]}</span><span class="text">${escape(q.answers[sourceIdx])}</span>`;
      btn.onclick = () => onAnswerClick(displayIdx, btn);
      box.appendChild(btn);
    });
    $("#q-feedback").classList.add("hidden");
  }

  function onAnswerClick(displayIdx, btn) {
    const s = Quiz.getSession();
    if (!s) return;
    const q = Quiz.current();
    if (!q || q._answered) return;

    if (s.examMode) {
      // In exam mode: mark as answered visually but no feedback yet; allow re-pick before next.
      $$(".q-answer").forEach(b => b.classList.remove("exam-answered"));
      btn.classList.add("exam-answered");
      // Don't reveal correctness — stash the pick on the question
      q._examPickedDisplay = displayIdx;
      // Show "Weiter" feedback
      const fb = $("#q-feedback");
      fb.classList.remove("hidden");
      fb.classList.remove("correct", "wrong");
      $("#q-feedback-text").innerHTML = `<strong>Antwort gespeichert.</strong> Du kannst noch wechseln, oder weitergehen.`;
      $("#q-next").textContent = (s.idx + 1 >= s.questions.length) ? "Prüfung abgeben →" : "Weiter →";
      $("#q-next").onclick = () => {
        // Submit pick to engine
        if (q._answered) return;
        Quiz.answer(q._examPickedDisplay);
      };
      return;
    }

    Quiz.answer(displayIdx);
  }

  // After Quiz.answer() in non-exam mode → reveal feedback then advance
  function markAnsweredAndAdvance() {
    const s = Quiz.getSession();
    if (!s) return;
    const q = Quiz.current();
    if (!q) return;

    if (s.examMode) {
      // In exam mode the Quiz.answer was called when user pressed Weiter — we just advance.
      Quiz.next();
      return;
    }

    // Reveal correctness on each answer button
    const buttons = $$(".q-answer");
    buttons.forEach(b => b.classList.add("disabled"));
    buttons.forEach(b => {
      const idx = parseInt(b.dataset.idx, 10);
      const sourceIdx = q._order[idx];
      if (sourceIdx === 0) b.classList.add("correct");
      if (idx === q._pickedDisplay && !q._wasCorrect) b.classList.add("wrong");
    });

    const fb = $("#q-feedback");
    fb.classList.remove("hidden");
    fb.classList.remove("correct", "wrong");
    fb.classList.add(q._wasCorrect ? "correct" : "wrong");
    if (q._wasCorrect) {
      $("#q-feedback-text").innerHTML = `<strong>✅ Richtig!</strong> Klasse Antwort.`;
    } else {
      const correctText = q.answers[0];
      $("#q-feedback-text").innerHTML = `<strong>❌ Leider falsch.</strong> Richtig wäre: <em>${escape(correctText)}</em>`;
    }
    $("#q-next").textContent = (s.idx + 1 >= s.questions.length) ? "Ergebnis ansehen →" : "Weiter →";
    $("#q-next").onclick = () => Quiz.next();

    // Update HUD live
    renderHUD();
    bumpHUD("xp");
  }

  function renderTimer() {
    const s = Quiz.getSession();
    if (!s || !s.timerSec) return;
    const m = Math.floor(s.timeLeft / 60);
    const sec = s.timeLeft % 60;
    $("#quiz-time").textContent = `${m}:${String(sec).padStart(2,"0")}`;
  }

  // ---------- Topics (Lernmodus) ----------
  function renderTopics() {
    const grid = $("#topic-grid");
    grid.innerHTML = "";
    const ts = State.topicStats();
    Object.keys(TOPIC_META).forEach(t => {
      const meta = topicMeta(t);
      const stat = ts[t] || { seen: 0, correct: 0, total: 0 };
      const total = window.QUESTIONS.filter(q => q.topics.includes(t)).length;
      const pct = stat.seen ? Math.round((stat.correct / stat.seen) * 100) : 0;
      const card = document.createElement("button");
      card.className = "topic-card";
      card.innerHTML = `
        <span class="topic-emoji">${meta.emoji}</span>
        <div class="topic-name">${meta.name}</div>
        <div class="topic-count">${total} Fragen · Quote ${pct}%</div>
        <div class="topic-progress"><div class="topic-progress-fill" style="width:${pct}%"></div></div>`;
      card.onclick = () => Quiz.startTopic(t);
      if (total === 0) card.style.display = "none";
      grid.appendChild(card);
    });
  }

  // ---------- Sheets ----------
  function renderSheets() {
    const grid = $("#sheets-grid");
    grid.innerHTML = "";
    const state = State.get();
    for (let i = 0; i < Sheets.COUNT; i++) {
      const r = state.sheets[i];
      const card = document.createElement("button");
      card.className = "sheet-card" + (r && r.passed ? " passed" : "");
      card.innerHTML = `
        <div class="sheet-num">${i + 1}</div>
        <div class="sheet-label">Bogen · 30 Fragen</div>
        ${r ? `<div class="sheet-best">Beste: ${r.bestPercent}% · ${r.attempts} Versuch${r.attempts === 1 ? "" : "e"}</div>` : `<div class="sheet-best" style="color:var(--text-dim)">Noch nicht versucht</div>`}`;
      card.onclick = () => Quiz.startSheet(i);
      grid.appendChild(card);
    }
  }

  // ---------- Difficult ----------
  function renderDifficult() {
    const wrap = $("#difficult-list");
    wrap.innerHTML = "";
    const state = State.get();
    const items = window.QUESTIONS
      .map(q => ({ q, st: state.questions[q.id] }))
      .filter(x => x.st && (x.st.bookmarked || (x.st.wrong > 0 && x.st.bucket < 4)))
      .sort((a, b) => (b.st.wrong - b.st.correct) - (a.st.wrong - a.st.correct))
      .slice(0, 30);

    if (items.length === 0) {
      wrap.innerHTML = `<div class="card empty-hint">Noch keine schwierigen Fragen. Markiere welche per ☆ oder beantworte ein paar erst falsch — kein Drama, das gehört dazu.</div>`;
      return;
    }
    items.forEach(({ q, st }) => {
      const row = document.createElement("div");
      row.className = "difficult-row";
      row.innerHTML = `
        <span class="diff-id">${q.id}</span>
        <span class="diff-text">${escape(q.question)}</span>
        <span class="diff-bad">${st.wrong}× ✗ / ${st.correct}× ✓${st.bookmarked ? " ★" : ""}</span>`;
      wrap.appendChild(row);
    });
  }

  // ---------- Crew view ----------
  let lbMetric = "xp";
  function renderCrew() {
    $("#my-share-code").value = Crew.exportCode();
    $("#add-code-input").value = "";
    const errEl = $("#add-crew-error");
    errEl.classList.add("hidden");
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const list = $("#leaderboard-list");
    list.innerHTML = "";
    const lb = Crew.leaderboard(lbMetric);
    lb.forEach((m, idx) => {
      const row = document.createElement("div");
      row.className = "lb-row" + (m.isMe ? " you" : "");
      const valueByMetric = {
        xp: `${m.x} ⭐`,
        streak: `${m.s} 🔥`,
        mastered: `${m.m} ⚓`,
        badges: `${(m.b||[]).length} 🏅`,
      };
      const rankCls = idx === 0 ? "gold" : idx === 1 ? "silver" : idx === 2 ? "bronze" : "";
      const rankEmoji = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : (idx + 1);
      row.innerHTML = `
        <div class="lb-rank ${rankCls}">${rankEmoji}</div>
        <div class="lb-avatar">${escape(m.a)}</div>
        <div class="lb-info">
          <div class="lb-name">${escape(m.n)}${m.isMe ? " (Du)" : ""}</div>
          <div class="lb-rank-name">Stand: ${m.t ? new Date(m.t).toLocaleDateString("de-DE") : "jetzt"}</div>
        </div>
        <div class="lb-value">${valueByMetric[lbMetric] || valueByMetric.xp}</div>
        ${m.isMe ? "" : `<div class="lb-actions"><button class="lb-mini-btn" data-action="remove-crew" data-id="${escapeAttr(m.id)}">×</button></div>`}`;
      list.appendChild(row);
    });
  }

  // ---------- Profile ----------
  function renderProfile() {
    const s = State.get();
    $("#profile-avatar-big").textContent = s.profile.avatar || "🚤";
    $("#profile-name").textContent = s.profile.name || "Anonym";
    const r = State.rankFor(s.xp);
    $("#profile-rank").textContent = `${r.current.emoji} ${r.current.name} · ${s.xp} XP` + (r.next ? ` · noch ${r.next.xp - s.xp} XP bis ${r.next.name}` : "");
    $("#edit-name").value = s.profile.name || "";
    const ap = $("#edit-avatars");
    ap.innerHTML = "";
    ["🚤","⛵","🛥️","🛶","🦦","🐬","🦈","🦞","🐙","🦭","🐢","🦅"].forEach(em => {
      const b = document.createElement("button");
      b.dataset.avatar = em;
      b.textContent = em;
      if (em === s.profile.avatar) b.classList.add("selected");
      b.onclick = () => {
        ap.querySelectorAll("button").forEach(x => x.classList.remove("selected"));
        b.classList.add("selected");
      };
      ap.appendChild(b);
    });

    // Topic stats
    const ts = State.topicStats();
    const tsBox = $("#topic-stats");
    tsBox.innerHTML = "";
    const entries = Object.keys(TOPIC_META).filter(t => (ts[t]||{}).seen > 0);
    if (entries.length === 0) {
      tsBox.innerHTML = `<div class="empty-hint">Noch keine Daten. Starte ein Quiz!</div>`;
    } else {
      entries.forEach(t => {
        const meta = topicMeta(t);
        const st = ts[t];
        const pct = st.seen ? Math.round((st.correct / st.seen) * 100) : 0;
        const row = document.createElement("div");
        row.className = "topic-stat-row";
        row.innerHTML = `<span class="tsr-emoji">${meta.emoji}</span>
          <span class="tsr-name">${meta.name}</span>
          <div class="tsr-bar"><div class="tsr-bar-fill" style="width:${pct}%"></div></div>
          <span class="tsr-pct">${pct}%</span>`;
        tsBox.appendChild(row);
      });
    }
  }

  // ---------- Badges ----------
  function renderBadges() {
    const grid = $("#badges-grid");
    grid.innerHTML = "";
    const unlocked = new Set(State.get().badges);
    Badges.ALL.forEach(b => {
      const card = document.createElement("div");
      card.className = "badge-card " + (unlocked.has(b.id) ? "unlocked" : "locked");
      card.innerHTML = `<span class="b-emoji">${b.emoji}</span>
        <div class="b-name">${escape(b.name)}</div>
        <div class="b-desc">${escape(b.desc)}</div>`;
      grid.appendChild(card);
    });
  }

  // ---------- Result ----------
  function renderResult({ session, percent, correct, wrong, total, xpEarned, badges }) {
    goto("result");
    let title, subtitle, emoji;
    if (session.examMode) {
      const passed = correct >= 27;
      title = passed ? "🎓 Bestanden!" : "Knapp daneben!";
      subtitle = passed
        ? `${correct} von ${total} richtig — du hast die Prüfung simuliert geschafft!`
        : `${correct} von ${total} richtig — 27 wären nötig. Bleib dran, du schaffst das!`;
      emoji = passed ? "🎓" : "🌊";
    } else if (session.sheetIdx !== null) {
      const passed = percent >= 90;
      title = passed ? `Bogen ${session.sheetIdx + 1} bestanden!` : `Bogen ${session.sheetIdx + 1}: ${percent}%`;
      subtitle = passed ? "Sehr stark!" : "Noch ein bisschen üben — der nächste Versuch klappt besser.";
      emoji = passed ? "📋" : "📖";
    } else {
      if (percent === 100) { title = "Perfekt!"; emoji = "💯"; subtitle = "Alles richtig — Käpt'n-Niveau."; }
      else if (percent >= 80) { title = "Klasse!"; emoji = "🎉"; subtitle = `${correct}/${total} richtig — sehr gut.`; }
      else if (percent >= 50) { title = "Solide!"; emoji = "💪"; subtitle = `${correct}/${total} richtig — bleib dran.`; }
      else { title = "Üben hilft!"; emoji = "📚"; subtitle = `${correct}/${total} richtig — schau dir die schwierigen Fragen an.`; }
    }
    $("#result-emoji").textContent = emoji;
    $("#result-title").textContent = title;
    $("#result-subtitle").textContent = subtitle;
    $("#result-correct").textContent = correct;
    $("#result-wrong").textContent = wrong;
    $("#result-percent").textContent = percent + "%";
    $("#result-xp").textContent = "+" + xpEarned;

    const rb = $("#result-badges");
    if (badges && badges.length) {
      rb.classList.remove("hidden");
      rb.innerHTML = "<strong>🎖️ Neue Errungenschaften:</strong> " + badges.map(b => `<span class="result-badge">${b.emoji} ${escape(b.name)}</span>`).join("");
    } else {
      rb.classList.add("hidden");
      rb.innerHTML = "";
    }
    renderHUD();
  }

  // ---------- Toasts ----------
  let toastSeq = 0;
  function toast({ type = "info", icon = "ℹ️", title = "", desc = "", duration = 3500 }) {
    const c = $("#toast-container");
    const id = "toast-" + (++toastSeq);
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.id = id;
    el.innerHTML = `<div class="toast-icon">${icon}</div>
      <div><div class="toast-title">${escape(title)}</div><div class="toast-desc">${escape(desc)}</div></div>`;
    c.appendChild(el);
    setTimeout(() => {
      el.classList.add("fade-out");
      setTimeout(() => el.remove(), 400);
    }, duration);
  }

  // ---------- Confetti ----------
  let confettiActive = false;
  function confettiBurst({ big = false } = {}) {
    const canvas = $("#confetti-canvas");
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = ["#ffd166", "#06d6a0", "#3aafa9", "#ef476f", "#f4a261", "#fff"];
    const N = big ? 180 : 80;
    const pieces = Array.from({ length: N }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 18 - 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 6 + Math.random() * 8,
      shape: Math.random() < 0.5 ? "rect" : "circle",
    }));
    let frame = 0;
    function step() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.vy += 0.4;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.5);
        else { ctx.beginPath(); ctx.arc(0,0,p.size/2,0,Math.PI*2); ctx.fill(); }
        ctx.restore();
      });
      frame++;
      if (frame < (big ? 130 : 90)) requestAnimationFrame(step);
      else ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    requestAnimationFrame(step);
  }

  // ---------- helpers ----------
  function escape(s) {
    if (s === undefined || s === null) return "";
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escape(s).replace(/`/g,"&#96;"); }

  function announceBadge(b) {
    toast({
      type: "badge",
      icon: b.emoji,
      title: "Errungenschaft freigeschaltet!",
      desc: `${b.name} — ${b.desc}`,
      duration: 5000,
    });
    confettiBurst();
  }

  function setLeaderboardMetric(m) { lbMetric = m; renderLeaderboard(); }

  return {
    goto, renderHUD, renderHome, renderQuiz, renderTimer,
    renderTopics, renderSheets, renderDifficult, renderCrew, renderProfile, renderBadges,
    renderLeaderboard, setLeaderboardMetric,
    renderResult,
    renderOnboarding,
    markAnsweredAndAdvance,
    toast, confettiBurst, bumpHUD, announceBadge,
    escape,
    get current() { return currentView; },
  };
})();
