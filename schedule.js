// The Schedule tab: each sport's current slate laid out like a TV listings
// grid, one panel per day with a row per start time and a column per network.
// Uses the same data as the scoreboard strip (edgeLoadGames in home.js: each
// site's games.json, refreshed from ESPN in the browser when it can be
// reached), so this loads after home.js. Sports with more networks than fit
// across (MLB and NBA local TV) list each time slot's games as cards instead.
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
const SCHED_TZ = { timeZone: "America/New_York" };

function schedStartEt(g) {
  const d = new Date(g.start);
  if (isNaN(d)) return null;
  const parts = {};
  new Intl.DateTimeFormat("en-US", { ...SCHED_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(d).forEach(p => { parts[p.type] = Number(p.value); });
  return {
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
  let first = true;
  days.forEach((dayGames, day) => {
    const n = `${dayGames.length} game${dayGames.length === 1 ? "" : "s"}`;
    main.append(schedDay(day, dayGames, cfg, first && slate.label && !/^\w{3}, /.test(slate.label) ? `${slate.label} · ${n}` : n));
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
  show();
}
initSchedule();
