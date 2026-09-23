// The Schedule tab: each sport's current slate laid out like a TV listings
// grid, one panel per day with a row per start time and a column per network.
// Uses the same data as the scoreboard strip (edgeLoadGames in home.js: each
// site's games.json, refreshed from ESPN in the browser when it can be
// reached), so this loads after home.js. Sports with more networks than fit
// across (MLB and NBA local TV) list each time slot's games as cards instead.
// The TV Guide view lays the same games out like a cable guide: a row per
// network, times across the top, each game a block as long as a typical game.
const SCHED_SPORTS = [
  { key: "nfl", sport: "NFL", pickLabel: "Our pick", empty: "No NFL games on this week's schedule yet." },
  { key: "cfb", sport: "CFB", pickLabel: "Our pick", empty: "No Top 25 games on this week's schedule yet.",
    note: "Games with a Top 25 team (AP poll). Our pick shows for games between teams we cover." },
  { key: "mlb", sport: "MLB", pickLabel: "Top hitter",
    empty: "No MLB games on today's schedule. The next slate shows up here the morning of." },
  { key: "nba", sport: "NBA", pickLabel: "Our pick",
    empty: "No NBA games on the schedule yet. The 2026-27 season tips off in late October." },
];
const SCHED_MAX_NETWORKS = 6;
// Typical game length in minutes, for the width of a guide block.
const GUIDE_MINUTES = { nfl: 180, cfb: 210, mlb: 180, nba: 150 };
const GUIDE_SLOT = 30;
const GUIDE_VIEW_KEY = "edge-schedule-view-2";  // new key so everyone starts on TV Guide

function schedView() {
  // TV Guide unless this device picked Cards.
  try { return localStorage.getItem(GUIDE_VIEW_KEY) === "cards" ? "cards" : "guide"; } catch (e) { return "guide"; }
}

function schedSetView(view) {
  try { localStorage.setItem(GUIDE_VIEW_KEY, view); } catch (e) { /* the choice just won't be remembered */ }
}
const SCHED_TZ = { timeZone: "America/New_York" };

function schedStartEt(g) {
  const d = new Date(g.start);
  if (isNaN(d)) return null;
  const parts = {};
  new Intl.DateTimeFormat("en-US", { ...SCHED_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(d).forEach(p => { parts[p.type] = Number(p.value); });
  return {
    minutes: (parts.hour || 0) * 60 + (parts.minute || 0),
    day: d.toLocaleDateString("en-US", { ...SCHED_TZ, weekday: "long", month: "long", day: "numeric" }),
    // ESPN lists games without a set time at midnight Eastern.
    slot: parts.hour || parts.minute
      ? d.toLocaleTimeString("en-US", { ...SCHED_TZ, hour: "numeric", minute: "2-digit" }) + " ET"
      : "Time TBA",
  };
}

function schedNetwork(g) {
  return (g.tv || "").split(",")[0].trim() || "TV TBA";
}

function schedSide(t, showScore) {
  const side = edgeNode("div", "sched-team");
  if (t.logo) {
    const img = edgeNode("img", "sched-logo");
    img.src = t.logo;
    img.alt = "";
    img.loading = "lazy";
    side.append(img);
  } else {
    side.append(edgeNode("span", "sched-logo"));
  }
  const name = edgeNode("div", "sched-name");
  if (t.rank) name.append(edgeNode("span", "sched-rank", String(t.rank)));
  name.append(edgeNode("span", null, t.short || t.abbr));
  const sub = t.probable || t.record;
  if (sub) name.append(edgeNode("small", null, sub));
  side.append(name);
  if (showScore && t.score != null) side.append(edgeNode("span", "sched-score" + (t.winner ? " win" : ""), String(t.score)));
  return side;
}

function schedGame(g, pickLabel) {
  const card = edgeNode("article", "sched-game" + (g.state === "in" ? " is-live" : ""));
  const top = edgeNode("div", "sched-top");
  top.append(edgeNode("span", "sched-status", g.state === "pre" ? (g.neutral ? "Neutral site" : "") : g.detail || "Final"));
  if (g.tv) top.append(edgeNode("span", "sched-tv", g.tv));
  card.append(top, schedSide(g.away, g.state !== "pre"), edgeNode("div", "sched-sep", g.neutral ? "vs" : "@"),
              schedSide(g.home, g.state !== "pre"));
  if (g.pick) {
    const pick = edgeNode("div", "sched-pick");
    pick.append(edgeNode("span", "sched-pick-label", pickLabel), edgeNode("span", "sched-pick-text", g.pick.text));
    const pill = edgeResultPill(g.pick.result);
    if (pill) pick.append(pill);
    card.append(pick);
  }
  return card;
}

// One day's games: a row per start time, a column per network.
function schedDay(day, games, cfg, subtitle) {
  const card = edgeNode("section", "card");
  const header = edgeNode("div", "card-header");
  header.append(edgeNode("h2", null, day), edgeNode("div", "subtitle", subtitle));
  card.append(header);

  const counts = new Map();
  games.forEach(g => counts.set(schedNetwork(g), (counts.get(schedNetwork(g)) || 0) + 1));
  const networks = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  const byNetwork = networks.length <= SCHED_MAX_NETWORKS;
  const grid = edgeNode("div", "tv-grid" + (byNetwork ? "" : " is-list"));
  grid.style.setProperty("--tv-cols", byNetwork ? networks.length : 1);

  if (byNetwork) {
    const head = edgeNode("div", "tv-row tv-head");
    head.append(edgeNode("div", "tv-time", "Time"));
    networks.forEach(n => head.append(edgeNode("div", "tv-net", n)));
    grid.append(head);
  }
  const slots = new Map();
  games.forEach(g => {
    const slot = g._et.slot;
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(g);
  });
  slots.forEach((slotGames, slot) => {
    const row = edgeNode("div", "tv-row");
    row.append(edgeNode("div", "tv-time", slot));
    (byNetwork ? networks : [null]).forEach(n => {
      const inCell = slotGames.filter(g => n === null || schedNetwork(g) === n);
      const cell = edgeNode("div", "tv-cell" + (inCell.length ? "" : " tv-empty"));
      inCell.forEach(g => cell.append(schedGame(g, cfg.pickLabel)));
      row.append(cell);
    });
    grid.append(row);
  });
  card.append(grid);
  return card;
}

// ── TV Guide view ────────────────────────────────────────────────────────────
function guideClock(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function guideTeam(t, showScore) {
  const row = edgeNode("span", "guide-team" + (showScore && t.winner ? " is-winner" : ""));
  const name = edgeNode("span", "guide-team-name");
  if (t.logo) {
    const img = edgeNode("img", "guide-logo");
    img.src = t.logo;
    img.alt = "";
    img.loading = "lazy";
    name.append(img);
  }
  if (t.rank) name.append(edgeNode("span", "guide-rank", String(t.rank)));
  name.append(edgeNode("span", null, t.abbr || t.short));
  row.append(name);
  if (showScore && t.score != null) row.append(edgeNode("span", "guide-score", String(t.score)));
  return row;
}

function guideBlock(g, cfg) {
  const block = edgeNode("article", "guide-show" + (g.state === "in" ? " is-live" : g.state === "post" ? " is-final" : ""));
  const status = g.state === "pre" ? g._et.slot : g.detail || "Final";
  block.append(edgeNode("span", "guide-status", status));
  const matchup = edgeNode("span", "guide-matchup");
  matchup.append(guideTeam(g.away, g.state !== "pre"), edgeNode("span", "guide-at", g.neutral ? "vs" : "@"),
                 guideTeam(g.home, g.state !== "pre"));
  block.append(matchup);
  if (g.pick) {
    const pick = edgeNode("span", "guide-pick");
    pick.append(edgeNode("span", null, g.pick.text));
    const pill = edgeResultPill(g.pick.result);
    if (pill) pick.append(pill);
    block.append(pick);
  }
  block.title = `${g.away.short || g.away.abbr} ${g.neutral ? "vs" : "at"} ${g.home.short || g.home.abbr}, ${status}` +
                (g.tv ? `, ${g.tv}` : "") + (g.pick ? `. ${cfg.pickLabel}: ${g.pick.text}` : "");
  return block;
}

// One day as a cable-style guide: a row per network, half-hour columns.
function schedGuideDay(day, games, cfg, subtitle, isToday) {
  const card = edgeNode("section", "card guide-card");
  const header = edgeNode("div", "card-header");
  header.append(edgeNode("h2", null, day), edgeNode("div", "subtitle", subtitle));
  card.append(header);

  const timed = games.filter(g => g._et.slot !== "Time TBA");
  const tba = games.filter(g => g._et.slot === "Time TBA");
  const length = GUIDE_MINUTES[cfg.key] || 180;
  if (timed.length) {
    const first = Math.floor(Math.min(...timed.map(g => g._et.minutes)) / GUIDE_SLOT) * GUIDE_SLOT;
    const last = Math.max(...timed.map(g => g._et.minutes + length));
    const slots = Math.ceil((last - first) / GUIDE_SLOT);

    // Networks with the most games first, like the big channels at the top of a guide.
    const byNet = new Map();
    timed.forEach(g => {
      const n = schedNetwork(g);
      if (!byNet.has(n)) byNet.set(n, []);
      byNet.get(n).push(g);
    });
    const networks = [...byNet.keys()].sort((a, b) =>
      byNet.get(b).length - byNet.get(a).length || byNet.get(a)[0]._et.minutes - byNet.get(b)[0]._et.minutes);

    const scroll = edgeNode("div", "guide-scroll");
    const grid = edgeNode("div", "guide-grid");
    grid.style.setProperty("--guide-slots", slots);
    const head = edgeNode("div", "guide-row guide-head");
    head.append(edgeNode("div", "guide-net guide-corner", "ET"));
    for (let i = 0; i < slots; i++) {
      const at = first + i * GUIDE_SLOT;
      const tick = edgeNode("div", "guide-tick" + (at % 60 ? " is-half" : ""), at % 60 ? "" : guideClock(at));
      tick.style.gridColumn = `${i + 2} / span 1`;
      head.append(tick);
    }
    grid.append(head);

    networks.forEach(n => {
      // Overlapping games on one network (regional TV) get their own lane.
      const lanes = [];
      const placed = byNet.get(n).map(g => {
        const start = g._et.minutes;
        let lane = lanes.findIndex(end => end <= start);
        if (lane === -1) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = start + length;
        return { g, lane };
      });
      const row = edgeNode("div", "guide-row");
      const label = edgeNode("div", "guide-net", n);
      label.style.gridRow = `1 / span ${lanes.length}`;
      row.append(label);
      placed.forEach(({ g, lane }) => {
        const block = guideBlock(g, cfg);
        const col = Math.round((g._et.minutes - first) / GUIDE_SLOT * 2) / 2;  // half-slot precision
        const startCol = Math.floor(col) + 2;
        const span = Math.max(1, Math.round(length / GUIDE_SLOT));
        block.style.gridColumn = `${startCol} / span ${span}`;
        block.style.gridRow = `${lane + 1}`;
        // Starts on the quarter hour: nudge it half a column (margins resolve against its grid area).
        if (col % 1) block.style.marginLeft = `calc(50% / ${span})`;
        row.append(block);
      });
      grid.append(row);
    });

    // A red line at the current time when this day is today.
    if (isToday) {
      const p = {};
      new Intl.DateTimeFormat("en-US", { ...SCHED_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(x => { p[x.type] = Number(x.value); });
      const now = (p.hour || 0) * 60 + (p.minute || 0);
      if (now >= first && now <= first + slots * GUIDE_SLOT) {
        const line = edgeNode("div", "guide-now");
        line.style.setProperty("--guide-now", (now - first) / (slots * GUIDE_SLOT));
        grid.append(line);
      }
    }
    scroll.append(grid);
    card.append(scroll);
  }
  if (tba.length) {
    card.append(edgeNode("div", "section-label", "Time TBA"));
    const list = edgeNode("div", "sched-grid");
    tba.forEach(g => list.append(schedGame(g, cfg.pickLabel)));
    card.append(list);
  }
  return card;
}

function schedRender(main, cfg, slate) {
  const games = (slate ? slate.games : [])
    .map(g => ({ ...g, _et: schedStartEt(g) }))
    .filter(g => g._et)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  main.replaceChildren();
  if (!games.length) {
    const card = edgeNode("section", "card");
    card.append(edgeNode("div", "empty-state", slate ? cfg.empty : "The schedule couldn't load right now. Try again in a minute."));
    main.append(card);
    return;
  }
  const days = new Map();
  games.forEach(g => {
    if (!days.has(g._et.day)) days.set(g._et.day, []);
    days.get(g._et.day).push(g);
  });
  const guide = schedView() === "guide";
  const today = new Date().toLocaleDateString("en-US", { ...SCHED_TZ, weekday: "long", month: "long", day: "numeric" });
  let first = true;
  days.forEach((dayGames, day) => {
    const n = `${dayGames.length} game${dayGames.length === 1 ? "" : "s"}`;
    const subtitle = first && slate.label && !/^\w{3}, /.test(slate.label) ? `${slate.label} · ${n}` : n;
    main.append(guide ? schedGuideDay(day, dayGames, cfg, subtitle, day === today) : schedDay(day, dayGames, cfg, subtitle));
    first = false;
  });
  const note = [cfg.note, "Times and TV from ESPN" + (slate.live ? ", with live scores." : ".")].filter(Boolean).join(" ");
  main.append(edgeNode("div", "table-footnote", note));
}

// With no sport in the link, open the one with a game on now or starting next.
function schedDefault(slates) {
  let best = null;
  let bestTime = Infinity;
  SCHED_SPORTS.forEach((cfg, i) => {
    (slates[i] ? slates[i].games : []).forEach(g => {
      const t = g.state === "in" ? -1 : g.state === "pre" ? new Date(g.start).getTime() : Infinity;
      if (t < bestTime) { bestTime = t; best = cfg.key; }
    });
  });
  if (best) return best;
  const any = SCHED_SPORTS.find((cfg, i) => slates[i] && slates[i].games.length);
  return any ? any.key : SCHED_SPORTS[0].key;
}

async function initSchedule() {
  const main = document.querySelector(".schedule-main");
  if (!main) return;
  const sites = SCHED_SPORTS.map(cfg => EDGE_SITES.find(s => s.sport === cfg.sport));
  const slates = await Promise.all(sites.map(site => (site ? edgeLoadGames(site) : null)));
  const tabs = document.querySelectorAll(".sched-tabs a");

  const show = () => {
    const key = location.hash.slice(1).toLowerCase();
    const i = Math.max(0, SCHED_SPORTS.findIndex(cfg => cfg.key === (SCHED_SPORTS.some(c => c.key === key) ? key : schedDefault(slates))));
    tabs.forEach(a => {
      const on = a.dataset.sport === SCHED_SPORTS[i].key;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    schedRender(main, SCHED_SPORTS[i], slates[i]);
  };
  window.addEventListener("hashchange", show);

  // Cards / TV Guide toggle, remembered on this device.
  const buttons = document.querySelectorAll(".view-toggle button");
  const markView = () => buttons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === schedView())));
  buttons.forEach(b => b.addEventListener("click", () => {
    schedSetView(b.dataset.view);
    markView();
    show();
  }));
  markView();
  show();
}
initSchedule();
