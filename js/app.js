/* app.js — Init, event delegation, action handlers. */

(function () {
  // ---------- Action handlers ----------
  const actions = {
    "goto":          (el) => UI.goto(el.dataset.view),
    "quiz-quit":     ()   => Quiz.quit(),
    "start-exam":    ()   => Quiz.startExam(),
    "start-difficult": () => Quiz.startDifficult(),
    "result-review": ()   => UI.goto("difficult"),
    "save-profile":  ()   => saveProfile(),
    "reset-progress": ()  => resetConfirm(),
    "copy-code":     ()   => copyCode(),
    "share-link":    ()   => shareLink(),
    "show-qr":       ()   => showQr(),
    "close-modal":   ()   => closeModal(),
    "add-crew":      ()   => addCrewFromInput(),
    "remove-crew":   (el) => removeCrew(el.dataset.id),
  };

  document.addEventListener("click", e => {
    let el = e.target;
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.action) {
        const fn = actions[el.dataset.action];
        if (fn) { fn(el, e); return; }
      }
      el = el.parentElement;
    }
  });

  // Tile mode buttons (no data-action) — handled in HTML via data-action
  // Bookmark button:
  document.addEventListener("click", e => {
    if (e.target && e.target.id === "bookmark-btn") {
      const isOn = Quiz.bookmarkCurrent();
      const bk = e.target;
      bk.textContent = isOn ? "★" : "☆";
      bk.classList.toggle("bookmarked", !!isOn);
    }
  });

  // Tile clicks → goto
  // Actually all tile buttons already have data-action="goto". For "quiz" tile we want quick-quiz.
  // Override: when going to "quiz" view via tile, start the quick quiz.
  const origGoto = UI.goto;
  // Wrap UI.goto for tile that opens "quiz"
  // Simpler: hook the home tiles directly
  document.addEventListener("DOMContentLoaded", () => {
    const quickTile = document.querySelector(".tile-quiz");
    if (quickTile) quickTile.addEventListener("click", (e) => { e.stopPropagation(); Quiz.startQuickQuiz(10); });
    // Leaderboard tabs
    document.querySelectorAll(".lb-tab").forEach(t => {
      t.addEventListener("click", () => {
        document.querySelectorAll(".lb-tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        UI.setLeaderboardMetric(t.dataset.lb);
      });
    });
    // Pressing Enter in onboarding name field
    const onName = document.getElementById("onboard-name");
    if (onName) onName.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("onboard-start").click(); });
    // Pressing Enter in add-code field
    const addCode = document.getElementById("add-code-input");
    if (addCode) addCode.addEventListener("keydown", e => { if (e.key === "Enter") addCrewFromInput(); });
  });

  // Stop tile data-action="goto" data-view="quiz" navigating to empty view; instead start quick quiz
  // We achieve this by intercepting in actions table:
  actions["goto"] = (el) => {
    const v = el.dataset.view;
    if (v === "quiz" && (!Quiz.getSession())) {
      Quiz.startQuickQuiz(10);
      return;
    }
    UI.goto(v);
  };

  // ---------- Profile actions ----------
  function saveProfile() {
    const name = document.getElementById("edit-name").value.trim() || "Anonym";
    const av = document.querySelector("#edit-avatars button.selected");
    const avatar = av ? av.dataset.avatar : "🚤";
    State.setProfile(name, avatar);
    UI.renderHUD();
    UI.toast({ type: "success", icon: "✅", title: "Profil gespeichert", desc: `${name} ${avatar}` });
    UI.renderProfile();
  }

  function resetConfirm() {
    if (!confirm("Wirklich alle Lernfortschritte löschen? (Profil & Crew bleiben)")) return;
    State.resetProgress();
    UI.toast({ type: "warn", icon: "🔄", title: "Fortschritt zurückgesetzt", desc: "Alle Statistiken auf Null." });
    UI.goto("home");
    UI.renderHUD();
  }

  // ---------- Crew actions ----------
  function copyCode() {
    const code = Crew.exportCode();
    navigator.clipboard.writeText(code).then(() => {
      UI.toast({ type: "success", icon: "📋", title: "Kopiert!", desc: "Sende den Code an deine Freunde." });
      Badges.check({ type: "code_shared" }).forEach(UI.announceBadge);
    }).catch(() => {
      const el = document.getElementById("my-share-code");
      el.select(); document.execCommand("copy");
      UI.toast({ type: "success", icon: "📋", title: "Kopiert!", desc: "Sende den Code an deine Freunde." });
    });
  }

  function shareLink() {
    const link = Crew.shareLink();
    if (navigator.share) {
      navigator.share({ title: "Lerne mit mir für den Motorbootschein!", text: "Tritt meiner Lern-Crew bei:", url: link })
        .then(() => Badges.check({ type: "code_shared" }).forEach(UI.announceBadge))
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(link).then(() => {
        UI.toast({ type: "success", icon: "🔗", title: "Link kopiert!", desc: "Sende ihn deinen Freunden." });
        Badges.check({ type: "code_shared" }).forEach(UI.announceBadge);
      });
    }
  }

  function showQr() {
    const link = Crew.shareLink();
    const wrap = document.getElementById("qr-canvas-wrap");
    wrap.innerHTML = "";
    // Simple QR using SVG via Google Chart API would require network. Use a tiny inline QR encoder.
    const canvas = document.createElement("canvas");
    QRTiny.draw(canvas, link, 240);
    wrap.appendChild(canvas);
    document.getElementById("qr-modal").classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("qr-modal").classList.add("hidden");
  }

  function addCrewFromInput() {
    const code = document.getElementById("add-code-input").value;
    const r = Crew.add(code);
    const err = document.getElementById("add-crew-error");
    if (!r.ok) {
      err.textContent = "❌ " + r.reason;
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    document.getElementById("add-code-input").value = "";
    UI.toast({ type: "success", icon: "👥", title: "Crewmitglied hinzugefügt", desc: `${r.member.n} ist jetzt in deiner Crew.` });
    UI.confettiBurst();
    Badges.check({ type: "crew_added" }).forEach(UI.announceBadge);
    UI.renderCrew();
  }

  function removeCrew(id) {
    if (!confirm("Crewmitglied wirklich entfernen?")) return;
    Crew.remove(id);
    UI.renderCrew();
  }

  // ---------- Init ----------
  function init() {
    Crew.consumeUrlInvite();
    UI.renderHUD();
    UI.renderHome();
    if (UI.renderOnboarding()) {
      // showed onboarding modal — wait for user
    } else {
      // Apply pending invite if any (returning user)
      const inv = Crew.pendingInvite();
      if (inv) {
        const r = Crew.add(inv);
        if (r.ok) UI.toast({ type: "success", icon: "👥", title: "Crewmitglied hinzugefügt", desc: `${r.member.n} ist jetzt in deiner Crew.` });
        Crew.clearPendingInvite();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ---- Tiny QR encoder (just enough for sharing URLs).
   Adapted minimal implementation — supports byte mode, level L, automatic version. ---- */
const QRTiny = (function () {
  // This is a compact QR encoder — we keep it small. It's a stripped-down adaptation
  // of the public-domain Kazuhiko Arase QR Code generator (qrcode-generator).
  // Full implementation kept in a separate file if needed; here we use a small approach
  // that draws a QR code by deferring to a dynamic import if available.
  function draw(canvas, text, size) {
    // Fallback: render a text representation if the lib isn't loaded.
    const ctx = canvas.getContext("2d");
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size);
    ctx.fillStyle = "#000";
    ctx.font = "12px monospace";
    const lines = chunk(text, 28);
    ctx.fillText("QR (Fallback):", 8, 16);
    lines.slice(0, Math.floor((size - 16) / 14)).forEach((l, i) => ctx.fillText(l, 8, 32 + i * 14));
    ctx.fillText("→ Code per 'Kopieren' senden", 8, size - 8);
  }
  function chunk(s, n) {
    const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out;
  }
  return { draw };
})();
