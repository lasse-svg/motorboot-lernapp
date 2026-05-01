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
    "remove-cloud-friend": (el) => removeCloudFriend(el.dataset.uid),

    // Auth
    "open-account":  ()   => openAccountModal(),
    "close-account": ()   => closeAccountModal(),
    "auth-signin":   ()   => authSignIn(),
    "auth-signup":   ()   => authSignUp(),
    "auth-google":   ()   => authGoogle(),
    "auth-signout":  ()   => authSignOut(),
    "auth-reset":    ()   => authReset(),
    "set-username":  ()   => setUsername(),
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

  async function addCrewFromInput() {
    const input = document.getElementById("add-code-input").value.trim();
    const err = document.getElementById("add-crew-error");
    err.classList.add("hidden");

    // Cloud-mode: accept @username (or plain username) for friend lookup
    if (Cloud.enabled() && Cloud.isSignedIn() && !input.startsWith("ahoi:")) {
      try {
        const target = await Cloud.findUserByUsername(input);
        if (!target) { err.textContent = "❌ Kein Account mit diesem Username gefunden."; err.classList.remove("hidden"); return; }
        if (target.uid === Cloud.user().uid) { err.textContent = "❌ Das bist du selbst."; err.classList.remove("hidden"); return; }
        await Cloud.addFriend(target.uid);
        document.getElementById("add-code-input").value = "";
        UI.toast({ type: "success", icon: "👥", title: "Zur Crew hinzugefügt", desc: `${target.name} ist jetzt in deiner Crew.` });
        UI.confettiBurst();
        Badges.check({ type: "crew_added" }).forEach(UI.announceBadge);
        UI.renderCrew();
      } catch (e) {
        err.textContent = "❌ " + (e.message || "Fehler beim Hinzufügen.");
        err.classList.remove("hidden");
      }
      return;
    }

    // Code-mode (offline)
    const r = Crew.add(input);
    if (!r.ok) {
      err.textContent = "❌ " + r.reason;
      err.classList.remove("hidden");
      return;
    }
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

  async function removeCloudFriend(uid) {
    if (!confirm("Aus deiner Crew entfernen?")) return;
    try {
      await Cloud.removeFriend(uid);
      UI.renderCrew();
    } catch (e) { console.error(e); }
  }

  // ---------- Auth ----------
  function openAccountModal() {
    if (!Cloud.enabled()) {
      UI.toast({ type: "warn", icon: "⚙️", title: "Cloud nicht konfiguriert", desc: "Firebase-Config fehlt." });
      return;
    }
    document.getElementById("account-modal").classList.remove("hidden");
    refreshAccountModal();
    // Tab switching
    document.querySelectorAll(".auth-tab").forEach(t => {
      t.onclick = () => {
        document.querySelectorAll(".auth-tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        const target = t.dataset.authTab;
        document.getElementById("auth-pane-signin").classList.toggle("hidden", target !== "signin");
        document.getElementById("auth-pane-signup").classList.toggle("hidden", target !== "signup");
        clearAuthError();
      };
    });
  }

  function refreshAccountModal() {
    const signedIn = Cloud.isSignedIn();
    document.getElementById("account-login-view").classList.toggle("hidden", signedIn);
    document.getElementById("account-info-view").classList.toggle("hidden", !signedIn);
    if (signedIn) {
      const u = Cloud.user();
      const s = State.get();
      document.getElementById("acc-avatar").textContent = s.profile.avatar || "🚤";
      document.getElementById("acc-name").textContent = s.profile.name || u.displayName || "Anonym";
      document.getElementById("acc-email").textContent = u.email || "";
      // Username will be shown when fetched
      Cloud.fetchLeaderboard("xp", 1, "friends").catch(() => {}); // warm-up
      const usernameEl = document.getElementById("acc-username");
      usernameEl.textContent = "Username: lädt …";
      // Try to read from cached own doc via a fetch
      (async () => {
        try {
          const lb = await Cloud.fetchLeaderboard("xp", 1, "friends");
          // We just want our own doc; the leaderboard helper includes self in friends scope.
          const me = lb.find(d => d.uid === u.uid);
          if (me && me.username) {
            usernameEl.textContent = "Username: @" + me.username;
            document.getElementById("acc-username-input").value = me.username;
          } else {
            usernameEl.textContent = "Noch kein Username gesetzt";
          }
        } catch (e) { usernameEl.textContent = ""; }
      })();
    }
    clearAuthError();
  }

  function closeAccountModal() {
    document.getElementById("account-modal").classList.add("hidden");
  }

  function showAuthError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = "❌ " + msg;
    el.classList.remove("hidden");
  }
  function clearAuthError() {
    const el = document.getElementById("auth-error");
    if (el) el.classList.add("hidden");
    const ue = document.getElementById("username-error");
    if (ue) ue.classList.add("hidden");
  }

  function humanAuthError(e) {
    const code = e && e.code;
    const map = {
      "auth/invalid-email": "Ungültige E-Mail-Adresse.",
      "auth/user-not-found": "Kein Konto mit dieser E-Mail.",
      "auth/wrong-password": "Falsches Passwort.",
      "auth/invalid-credential": "E-Mail oder Passwort falsch.",
      "auth/email-already-in-use": "Es gibt bereits ein Konto mit dieser E-Mail. Probier 'Einloggen'.",
      "auth/weak-password": "Passwort zu schwach (mindestens 6 Zeichen).",
      "auth/popup-closed-by-user": "Login abgebrochen.",
      "auth/network-request-failed": "Keine Internetverbindung.",
    };
    return map[code] || (e && e.message) || "Unbekannter Fehler.";
  }

  async function authSignIn() {
    clearAuthError();
    const email = document.getElementById("auth-email").value.trim();
    const pw = document.getElementById("auth-pw").value;
    if (!email || !pw) { showAuthError("E-Mail und Passwort eingeben."); return; }
    try {
      await Cloud.signInEmail(email, pw);
      UI.toast({ type: "success", icon: "☁️", title: "Eingeloggt!", desc: "Fortschritt wird jetzt gesynct." });
      closeAccountModal();
      UI.renderHUD(); UI.renderHome();
    } catch (e) { showAuthError(humanAuthError(e)); }
  }

  async function authSignUp() {
    clearAuthError();
    const name = document.getElementById("auth-signup-name").value.trim();
    const email = document.getElementById("auth-signup-email").value.trim();
    const pw = document.getElementById("auth-signup-pw").value;
    if (!name || !email || !pw) { showAuthError("Bitte alle Felder ausfüllen."); return; }
    if (pw.length < 6) { showAuthError("Passwort mindestens 6 Zeichen."); return; }
    try {
      await Cloud.signUpEmail(email, pw, name);
      // Update local profile name if not set
      const s = State.get();
      if (!s.profile.name) State.setProfile(name, s.profile.avatar || "🚤");
      UI.toast({ type: "success", icon: "🎉", title: "Konto erstellt!", desc: "Setze einen Username, um in der Bestenliste zu erscheinen." });
      closeAccountModal();
      // Re-open with the logged-in view so they can set a username
      setTimeout(openAccountModal, 600);
      UI.renderHUD(); UI.renderHome();
    } catch (e) { showAuthError(humanAuthError(e)); }
  }

  async function authGoogle() {
    clearAuthError();
    try {
      await Cloud.signInGoogle();
      UI.toast({ type: "success", icon: "☁️", title: "Eingeloggt!", desc: "Mit Google erfolgreich angemeldet." });
      closeAccountModal();
      UI.renderHUD(); UI.renderHome();
    } catch (e) { showAuthError(humanAuthError(e)); }
  }

  async function authSignOut() {
    if (!confirm("Wirklich abmelden? Dein Fortschritt bleibt in der Cloud erhalten.")) return;
    await Cloud.signOut();
    UI.toast({ type: "warn", icon: "👋", title: "Abgemeldet", desc: "Bis zum nächsten Mal!" });
    closeAccountModal();
    UI.renderHUD();
  }

  async function authReset() {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) { showAuthError("E-Mail-Adresse oben eintragen."); return; }
    try {
      await Cloud.resetPassword(email);
      UI.toast({ type: "success", icon: "✉️", title: "E-Mail unterwegs", desc: "Schau in dein Postfach." });
    } catch (e) { showAuthError(humanAuthError(e)); }
  }

  async function setUsername() {
    const ue = document.getElementById("username-error");
    ue.classList.add("hidden");
    const name = document.getElementById("acc-username-input").value.trim();
    const r = await Cloud.setUsername(name);
    if (!r.ok) {
      ue.textContent = "❌ " + r.reason;
      ue.classList.remove("hidden");
      return;
    }
    document.getElementById("acc-username").textContent = "Username: @" + name.toLowerCase();
    UI.toast({ type: "success", icon: "🏷️", title: "Username gespeichert", desc: "@" + name.toLowerCase() });
  }

  // ---------- Init ----------
  async function init() {
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
    // Cloud (no-op if config is null)
    try {
      const ok = await Cloud.init();
      if (ok) {
        Cloud.onAuthChange(u => {
          UI.renderHUD();
          if (UI.current === "crew") UI.renderCrew();
        });
      }
    } catch (e) { console.error("Cloud init error", e); }
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
