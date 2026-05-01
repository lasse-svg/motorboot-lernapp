/* cloud.js — Firebase Auth + Firestore state sync + leaderboard.

   Activation: window.FIREBASE_CONFIG must be set in firebase-config.js.
   If null/undefined, the app runs in local-only mode (no login UI shown).

   Public API:
     await Cloud.init()                    -> true if cloud is enabled, false otherwise
     Cloud.enabled()                       -> boolean
     Cloud.isSignedIn()                    -> boolean
     Cloud.user()                          -> {uid, email, ...} | null
     Cloud.onAuthChange(cb)                -> off()
     await Cloud.signInEmail(email, pw)
     await Cloud.signUpEmail(email, pw, displayName)
     await Cloud.signInGoogle()
     await Cloud.signOut()
     await Cloud.resetPassword(email)
     await Cloud.setUsername(username)         -> {ok, reason?}
     await Cloud.usernameTaken(username)       -> boolean
     await Cloud.pushState(stateSnapshot)      -> debounced write
     Cloud.subscribeToOwnState(cb)             -> off(); fires on remote changes
     await Cloud.fetchLeaderboard(metric, n)   -> [{uid, name, avatar, xp, ...}]
     await Cloud.findUserByUsername(name)      -> userDoc | null
     await Cloud.addFriend(uid)
     await Cloud.removeFriend(uid)
     await Cloud.fetchFriends()                -> array of public profiles
*/

const Cloud = (function () {
  let app = null, auth = null, db = null;
  let modules = null;          // dynamically-imported Firebase functions
  let _enabled = false;
  let _user = null;
  let _userDoc = null;         // last seen own user doc
  let _authListeners = [];
  let _ownStateUnsub = null;
  let _pushTimer = null;
  let _pendingPush = null;

  function enabled() { return _enabled; }
  function user() { return _user; }
  function isSignedIn() { return !!_user; }

  async function init() {
    if (!window.FIREBASE_CONFIG) {
      _enabled = false;
      return false;
    }
    try {
      const fbApp  = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js");
      const fbAuth = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js");
      const fbDb   = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
      modules = { ...fbApp, ...fbAuth, ...fbDb };

      app = modules.initializeApp(window.FIREBASE_CONFIG);
      auth = modules.getAuth(app);
      db = modules.getFirestore(app);
      _enabled = true;

      modules.onAuthStateChanged(auth, async u => {
        _user = u;
        if (u) {
          await _onSignedIn(u);
        } else {
          if (_ownStateUnsub) { _ownStateUnsub(); _ownStateUnsub = null; }
          _userDoc = null;
        }
        _authListeners.forEach(fn => { try { fn(u); } catch (e) { console.error(e); } });
      });
      return true;
    } catch (e) {
      console.error("Firebase init failed", e);
      _enabled = false;
      return false;
    }
  }

  function onAuthChange(cb) {
    _authListeners.push(cb);
    return () => { _authListeners = _authListeners.filter(x => x !== cb); };
  }

  // ---------- Auth ----------
  async function signUpEmail(email, password, displayName) {
    const r = await modules.createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await modules.updateProfile(r.user, { displayName });
    }
    return r.user;
  }
  async function signInEmail(email, password) {
    const r = await modules.signInWithEmailAndPassword(auth, email, password);
    return r.user;
  }
  async function signInGoogle() {
    const provider = new modules.GoogleAuthProvider();
    const r = await modules.signInWithPopup(auth, provider);
    return r.user;
  }
  async function signOut() {
    if (_ownStateUnsub) { _ownStateUnsub(); _ownStateUnsub = null; }
    return modules.signOut(auth);
  }
  async function resetPassword(email) {
    return modules.sendPasswordResetEmail(auth, email);
  }

  // ---------- User docs ----------
  function _userRef(uid)       { return modules.doc(db, "users", uid); }
  function _usernameRef(name)  { return modules.doc(db, "usernames", name.toLowerCase()); }

  async function _onSignedIn(u) {
    // Ensure a user doc exists; if not, create one from the local state.
    const ref = _userRef(u.uid);
    const snap = await modules.getDoc(ref);
    if (!snap.exists()) {
      const localState = State.get();
      const localAgg = State.aggregateStats();
      const initial = {
        uid: u.uid,
        email: u.email || null,
        name: localState.profile.name || u.displayName || (u.email ? u.email.split("@")[0] : "Anonym"),
        avatar: localState.profile.avatar || "🚤",
        username: null,
        xp: localState.xp || 0,
        streak: localState.streak || 0,
        lastActivityDate: localState.lastActivityDate || null,
        mastered: localAgg.mastered,
        answered: localAgg.answered,
        badges: localState.badges.slice(),
        questions: localState.questions || {},
        sheets: localState.sheets || {},
        exams: localState.exams || [],
        dailyMission: localState.dailyMission || null,
        friends: [],
        createdAt: modules.serverTimestamp(),
        updatedAt: modules.serverTimestamp(),
      };
      await modules.setDoc(ref, initial);
      _userDoc = initial;
    } else {
      // Merge remote into local (remote wins for high-water-mark fields)
      _userDoc = snap.data();
      _mergeRemoteIntoLocal(_userDoc);
      // Push local back if anything was higher locally
      _schedulePush(0);
    }
    // Subscribe to remote changes (other devices)
    _subscribeOwn();
  }

  function _mergeRemoteIntoLocal(remote) {
    const s = State.get();
    s.xp        = Math.max(s.xp || 0,        remote.xp || 0);
    s.streak    = Math.max(s.streak || 0,    remote.streak || 0);
    if (remote.lastActivityDate && (!s.lastActivityDate || remote.lastActivityDate > s.lastActivityDate)) {
      s.lastActivityDate = remote.lastActivityDate;
    }
    s.profile.name   = remote.name   || s.profile.name;
    s.profile.avatar = remote.avatar || s.profile.avatar;
    s.badges = Array.from(new Set([...(s.badges||[]), ...(remote.badges||[])]));
    s.onboarded = true;
    // Merge questions: per qid, keep max counts
    s.questions = s.questions || {};
    for (const qid in (remote.questions || {})) {
      const r = remote.questions[qid];
      const l = s.questions[qid] || { seen:0, correct:0, wrong:0, lastSeen:0, bucket:0, bookmarked:false };
      s.questions[qid] = {
        seen: Math.max(l.seen, r.seen||0),
        correct: Math.max(l.correct, r.correct||0),
        wrong: Math.max(l.wrong, r.wrong||0),
        lastSeen: Math.max(l.lastSeen||0, r.lastSeen||0),
        bucket: Math.max(l.bucket||0, r.bucket||0),
        bookmarked: !!(l.bookmarked || r.bookmarked),
      };
    }
    // Merge sheets: per index, keep best
    s.sheets = s.sheets || {};
    for (const idx in (remote.sheets || {})) {
      const r = remote.sheets[idx];
      const l = s.sheets[idx] || { bestPercent:0, attempts:0, passed:false };
      s.sheets[idx] = {
        bestPercent: Math.max(l.bestPercent, r.bestPercent||0),
        attempts: l.attempts + (r.attempts||0),
        passed: !!(l.passed || r.passed),
      };
    }
    // Exams: prefer the union (dedup by date+percent+correct)
    const exams = [...(s.exams||[]), ...(remote.exams||[])];
    const seen = new Set();
    s.exams = exams.filter(e => {
      const k = e.date + "|" + e.percent + "|" + e.correct;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    State.save();
  }

  // ---------- Push state (debounced) ----------
  function _schedulePush(delay = 1500) {
    if (!_enabled || !_user) return;
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(_doPush, delay);
  }

  async function _doPush() {
    if (!_enabled || !_user) return;
    try {
      const s = State.get();
      const agg = State.aggregateStats();
      const update = {
        name: s.profile.name || "Anonym",
        avatar: s.profile.avatar || "🚤",
        xp: s.xp || 0,
        streak: s.streak || 0,
        lastActivityDate: s.lastActivityDate || null,
        mastered: agg.mastered,
        answered: agg.answered,
        badges: s.badges || [],
        questions: s.questions || {},
        sheets: s.sheets || {},
        exams: s.exams || [],
        dailyMission: s.dailyMission || null,
        updatedAt: modules.serverTimestamp(),
      };
      await modules.setDoc(_userRef(_user.uid), update, { merge: true });
    } catch (e) {
      console.error("Cloud push failed", e);
    }
  }

  function pushStateNow() {
    _schedulePush(0);
  }
  function pushState() {
    _schedulePush(1500);
  }

  // ---------- Live subscription on own doc ----------
  function _subscribeOwn() {
    if (!_user) return;
    if (_ownStateUnsub) _ownStateUnsub();
    _ownStateUnsub = modules.onSnapshot(_userRef(_user.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      _userDoc = data;
      // If remote updatedAt is newer than what we have locally, merge in.
      // Avoid overwriting values we just changed locally — we only merge if remote is strictly higher.
      _mergeRemoteIntoLocal(data);
      if (typeof UI !== "undefined" && UI.renderHUD) {
        UI.renderHUD();
        if (UI.current === "home") UI.renderHome();
        if (UI.current === "crew") UI.renderCrew && UI.renderCrew();
      }
    });
  }

  // ---------- Username & friends ----------
  async function usernameTaken(name) {
    const ref = _usernameRef(name);
    const snap = await modules.getDoc(ref);
    return snap.exists();
  }

  async function setUsername(name) {
    if (!_user) return { ok:false, reason:"Nicht eingeloggt." };
    name = (name || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) {
      return { ok:false, reason:"3–20 Zeichen, nur a–z, 0–9 und Unterstrich." };
    }
    // Reserve username
    const taken = await usernameTaken(name);
    if (taken) {
      // If it's already mine, fine
      const snap = await modules.getDoc(_usernameRef(name));
      if (snap.data().uid !== _user.uid) return { ok:false, reason:"Username schon vergeben." };
    }
    // Free up old username
    const myDoc = await modules.getDoc(_userRef(_user.uid));
    const oldUsername = myDoc.exists() ? myDoc.data().username : null;
    if (oldUsername && oldUsername !== name) {
      try { await modules.deleteDoc(_usernameRef(oldUsername)); } catch (e) {}
    }
    await modules.setDoc(_usernameRef(name), { uid: _user.uid });
    await modules.updateDoc(_userRef(_user.uid), { username: name });
    return { ok:true };
  }

  async function findUserByUsername(name) {
    name = (name || "").trim().toLowerCase().replace(/^@/, "");
    if (!name) return null;
    const u = await modules.getDoc(_usernameRef(name));
    if (!u.exists()) return null;
    const uid = u.data().uid;
    const profile = await modules.getDoc(_userRef(uid));
    return profile.exists() ? profile.data() : null;
  }

  async function addFriend(uid) {
    if (!_user) throw new Error("Nicht eingeloggt.");
    if (uid === _user.uid) throw new Error("Das bist du selbst.");
    const myRef = _userRef(_user.uid);
    const snap = await modules.getDoc(myRef);
    const friends = (snap.data().friends || []).slice();
    if (!friends.includes(uid)) friends.push(uid);
    await modules.updateDoc(myRef, { friends });
    return friends;
  }

  async function removeFriend(uid) {
    if (!_user) return;
    const myRef = _userRef(_user.uid);
    const snap = await modules.getDoc(myRef);
    const friends = (snap.data().friends || []).filter(x => x !== uid);
    await modules.updateDoc(myRef, { friends });
    return friends;
  }

  async function fetchFriends() {
    if (!_user) return [];
    const myRef = _userRef(_user.uid);
    const snap = await modules.getDoc(myRef);
    const friends = snap.data().friends || [];
    if (!friends.length) return [];
    const out = [];
    for (const fuid of friends) {
      const fs = await modules.getDoc(_userRef(fuid));
      if (fs.exists()) out.push(fs.data());
    }
    return out;
  }

  async function fetchLeaderboard(metric = "xp", n = 50, scope = "global") {
    if (!_enabled) return [];
    let docs = [];
    if (scope === "friends") {
      docs = await fetchFriends();
      // Always include self
      if (_user) {
        const me = await modules.getDoc(_userRef(_user.uid));
        if (me.exists()) docs = [me.data(), ...docs];
      }
    } else {
      const q = modules.query(modules.collection(db, "users"), modules.orderBy(metric, "desc"), modules.limit(n));
      const snap = await modules.getDocs(q);
      snap.forEach(d => docs.push(d.data()));
    }
    return docs;
  }

  return {
    init, enabled, isSignedIn, user, onAuthChange,
    signInEmail, signUpEmail, signInGoogle, signOut, resetPassword,
    setUsername, usernameTaken,
    pushState, pushStateNow,
    findUserByUsername, addFriend, removeFriend, fetchFriends, fetchLeaderboard,
  };
})();
