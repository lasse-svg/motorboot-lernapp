/* crew.js — Profile codes & crew leaderboard.

   Code format: "ahoi:" + base64url(JSON({ v, n, a, x, s, m, b, t }))
   - v: version
   - n: name (truncated)
   - a: avatar
   - x: xp
   - s: streak
   - m: mastered count
   - b: badge ids array
   - t: timestamp

   Stored in localStorage["ahoi.crew.v1"] as { code: snapshot } map.
*/

const Crew = (() => {
  const KEY = "ahoi.crew.v1";

  function exportCode() {
    const s = State.get();
    const agg = State.aggregateStats();
    const payload = {
      v: 1,
      n: (s.profile.name || "Anonym").slice(0, 30),
      a: s.profile.avatar || "🚤",
      x: s.xp,
      s: s.streak,
      m: agg.mastered,
      ans: agg.answered,
      b: s.badges.slice(),
      t: Date.now(),
    };
    return "ahoi:" + b64urlEncode(JSON.stringify(payload));
  }

  function decode(code) {
    if (!code || typeof code !== "string") return null;
    code = code.trim();
    if (code.startsWith("ahoi:")) code = code.slice(5);
    try {
      const json = b64urlDecode(code);
      const obj = JSON.parse(json);
      if (!obj || obj.v !== 1) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function b64urlEncode(str) {
    // UTF-8 safe
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlDecode(b64) {
    b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function _read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch { return {}; }
  }
  function _write(obj) { localStorage.setItem(KEY, JSON.stringify(obj)); }

  // Import a crew member's code. Returns {ok, member} or {ok: false, reason}.
  function add(code) {
    const obj = decode(code);
    if (!obj) return { ok: false, reason: "Ungültiger Code." };
    const myCode = exportCode();
    if (code.trim() === myCode) return { ok: false, reason: "Das ist dein eigener Code." };
    const all = _read();
    // Identify by name+avatar (no real ID without server). Latest snapshot wins.
    const memberId = obj.n + "|" + obj.a;
    all[memberId] = obj;
    _write(all);
    return { ok: true, member: obj, isUpdate: !!all[memberId] };
  }

  function remove(memberId) {
    const all = _read();
    delete all[memberId];
    _write(all);
  }

  function list() {
    const all = _read();
    return Object.entries(all).map(([id, m]) => ({ id, ...m }));
  }

  function leaderboard(metric) {
    const myAgg = State.aggregateStats();
    const me = {
      id: "__me__",
      n: State.get().profile.name || "Du",
      a: State.get().profile.avatar || "🚤",
      x: State.get().xp,
      s: State.get().streak,
      m: myAgg.mastered,
      ans: myAgg.answered,
      b: State.get().badges,
      isMe: true,
    };
    const all = [me, ...list()];
    const sorters = {
      xp:       (a, b) => b.x - a.x,
      streak:   (a, b) => b.s - a.s,
      mastered: (a, b) => b.m - a.m,
      badges:   (a, b) => (b.b||[]).length - (a.b||[]).length,
    };
    return all.sort(sorters[metric] || sorters.xp);
  }

  function shareLink() {
    const code = exportCode();
    const base = location.origin + location.pathname;
    return base + "#crew=" + encodeURIComponent(code);
  }

  // If the URL contains ?crew=... or #crew=... auto-import on load.
  function consumeUrlInvite() {
    let invite = null;
    if (location.hash.startsWith("#crew=")) invite = decodeURIComponent(location.hash.slice(6));
    const url = new URL(location.href);
    if (!invite && url.searchParams.has("crew")) invite = url.searchParams.get("crew");
    if (invite) {
      // Don't auto-add until profile exists
      sessionStorage.setItem("ahoi.pendingInvite", invite);
      // Clear from URL
      history.replaceState({}, "", location.pathname);
    }
  }

  function pendingInvite() {
    return sessionStorage.getItem("ahoi.pendingInvite");
  }
  function clearPendingInvite() {
    sessionStorage.removeItem("ahoi.pendingInvite");
  }

  return {
    exportCode, decode, add, remove, list, leaderboard,
    shareLink, consumeUrlInvite, pendingInvite, clearPendingInvite,
  };
})();
