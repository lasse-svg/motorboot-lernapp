/* badges.js — Achievement definitions + check after every action. */

const Badges = (() => {
  // id, emoji, name, description, predicate(ctx) → boolean
  // ctx exposes: state, lastEvent ({type, ...}), aggregate
  const ALL = [
    { id: "first_wave",     emoji: "🌊", name: "Erste Welle",
      desc: "Erste Frage richtig beantwortet.",
      check: ctx => ctx.aggregate.correct >= 1 },

    { id: "ten_streak",     emoji: "🔟", name: "Wellenreiter",
      desc: "10 richtige Antworten in Folge.",
      check: ctx => ctx.lastEvent.type === "answer" && ctx.lastEvent.correctStreak >= 10 },

    { id: "twentyfive_qs",  emoji: "🐚", name: "Sammler",
      desc: "25 Fragen beantwortet.",
      check: ctx => ctx.aggregate.answered >= 25 },

    { id: "hundred_qs",     emoji: "🪼", name: "Hundertschaft",
      desc: "100 Fragen beantwortet.",
      check: ctx => ctx.aggregate.answered >= 100 },

    { id: "all_seen",       emoji: "👁️", name: "Alleskenner",
      desc: "Jede der 253 Fragen mindestens 1× gesehen.",
      check: ctx => ctx.aggregate.encountered >= 253 },

    { id: "fifty_mastered", emoji: "⚓", name: "Verlässlicher Anker",
      desc: "50 Fragen sicher beherrscht.",
      check: ctx => ctx.aggregate.mastered >= 50 },

    { id: "all_mastered",   emoji: "🏆", name: "Vollblut-Skipper",
      desc: "Alle 253 Fragen sicher beherrscht.",
      check: ctx => ctx.aggregate.mastered >= 253 },

    { id: "streak_3",       emoji: "🔥", name: "Drei Tage am Steuer",
      desc: "3 Tage Streak gehalten.",
      check: ctx => ctx.state.streak >= 3 },

    { id: "streak_7",       emoji: "🌅", name: "Wochenend-Käpt'n",
      desc: "7 Tage Streak gehalten.",
      check: ctx => ctx.state.streak >= 7 },

    { id: "streak_30",      emoji: "💎", name: "Monats-Skipper",
      desc: "30 Tage Streak gehalten.",
      check: ctx => ctx.state.streak >= 30 },

    { id: "first_exam",     emoji: "🎓", name: "Prüfungs-Premiere",
      desc: "Erste Prüfungssimulation bestanden.",
      check: ctx => (ctx.state.exams||[]).some(e => e.passed) },

    { id: "perfect_exam",   emoji: "💯", name: "Perfekte Welle",
      desc: "30 von 30 in der Prüfungssimulation.",
      check: ctx => (ctx.state.exams||[]).some(e => e.percent === 100) },

    { id: "five_exams",     emoji: "🏅", name: "Trainingsfleiß",
      desc: "5 Prüfungssimulationen abgelegt.",
      check: ctx => (ctx.state.exams||[]).length >= 5 },

    { id: "all_sheets",     emoji: "📋", name: "Alle 15 Bögen",
      desc: "Alle 15 Übungsbögen mindestens 1× bestanden.",
      check: ctx => Object.values(ctx.state.sheets||{}).filter(s => s.passed).length >= 15 },

    { id: "early_bird",     emoji: "🌞", name: "Frühaufsteher",
      desc: "Vor 8 Uhr morgens gelernt.",
      check: ctx => ctx.lastEvent.type === "answer" && new Date().getHours() < 8 },

    { id: "night_owl",      emoji: "🌙", name: "Nachteule",
      desc: "Nach 23 Uhr gelernt.",
      check: ctx => ctx.lastEvent.type === "answer" && new Date().getHours() >= 23 },

    { id: "crew_first",     emoji: "👥", name: "Crewmitglied",
      desc: "Ersten Freund zur Crew hinzugefügt.",
      check: ctx => ctx.lastEvent.type === "crew_added" },

    { id: "crew_three",     emoji: "🤝", name: "Crew-Stamm",
      desc: "3 Freunde in der Crew.",
      check: ctx => ctx.lastEvent.type === "crew_added" && ctx.crewSize >= 3 },

    { id: "shared",         emoji: "📤", name: "Mitteilsam",
      desc: "Eigenen Code geteilt.",
      check: ctx => ctx.lastEvent.type === "code_shared" },

    { id: "comeback",       emoji: "🔄", name: "Comeback",
      desc: "Eine zuvor falsche Frage später richtig beantwortet.",
      check: ctx => ctx.lastEvent.type === "answer" && ctx.lastEvent.comeback },

    { id: "daily_done",     emoji: "🎯", name: "Mission erfüllt",
      desc: "Tägliche Mission abgeschlossen.",
      check: ctx => {
        const dm = ctx.state.dailyMission;
        return dm && dm.done >= dm.target;
      } },

    { id: "daily_3",        emoji: "🏹", name: "Drei-Tages-Schütze",
      desc: "3 Tage in Folge die tägliche Mission geschafft.",
      check: ctx => ctx.lastEvent.type === "daily_complete" && ctx.lastEvent.consecutive >= 3 },

    { id: "rank_skipper",   emoji: "🚤", name: "Aufstieg: Skipper",
      desc: "Rang Skipper erreicht.",
      check: ctx => ctx.state.xp >= 3000 },

    { id: "rank_kapitan",   emoji: "⚓", name: "Aufstieg: Käpt'n",
      desc: "Rang Käpt'n erreicht.",
      check: ctx => ctx.state.xp >= 14000 },
  ];

  function byId(id) { return ALL.find(b => b.id === id); }

  function check(lastEvent = {}) {
    const state = State.get();
    const aggregate = State.aggregateStats();
    const crewSize = (Crew.list() || []).length;
    const ctx = { state, aggregate, crewSize, lastEvent };
    const newly = [];
    for (const b of ALL) {
      if (state.badges.includes(b.id)) continue;
      try {
        if (b.check(ctx)) {
          State.unlockBadge(b.id);
          newly.push(b);
        }
      } catch (e) { /* ignore */ }
    }
    return newly;
  }

  function recent(n = 4) {
    const ids = [...State.get().badges].reverse().slice(0, n);
    return ids.map(byId).filter(Boolean);
  }

  return { ALL, byId, check, recent };
})();
