// --- Scoreboard strip (shared by every Edge site) ---
// Fills <div class="scoreboard"> under the top bar with the latest games in
// every sport, ESPN style: live games first, then what's next, then recent
// finals, each with our pick; a game opens the Schedule tab (schedule.html
// and schedule.js on the home site). Each site's build publishes games.json (ESPN's
// current slate plus our picks) next to its summary.json; the strip then asks
// ESPN for fresh scores in the browser, refreshes every minute while a game is
// live, and keeps the published file if ESPN can't be reached. If no sport has
// games, it falls back to each site's top picks from summary.json. Keep this
// block identical in home.js (repo root), nfl-cfb/web/site.js and
// mlb-nba-cbb/web/site.js.
const EDGE_SITES = [
  { sport: "NFL", summary: "/nfl/summary.json", games: "/nfl/games.json",
    href: "/nfl/index.html", schedule: "/schedule.html#nfl" },
  { sport: "NBA", summary: "/nba/summary.json", games: "/nba/games.json",
    href: "/nba/index.html", schedule: "/schedule.html#nba" },
  { sport: "MLB", summary: "/mlb/summary.json", games: "/mlb/games.json",
    href: "/mlb/", schedule: "/schedule.html#mlb" },
  { sport: "CFB", summary: "/cfb/summary.json", games: "/cfb/games.json",
    href: "/cfb/index.html", schedule: "/schedule.html#cfb" },
  // CBB Edge has no games.json yet, so it shows on the home page only.
  { sport: "CBB", summary: "/cbb/summary.json", games: null,
    href: "/cbb/index.html", schedule: "/cbb/index.html" },
];
const EDGE_GAMES_PER_SPORT = 16;

function edgeFetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  return fetch(url, { cache: "no-cache", signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site => edgeFetchJson(site.summary)));
  }
  return window.edgeSummaries;
}

function edgeNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function edgeResultPill(result, labels) {
  const [yes, no] = labels || ["HIT", "MISS"];
  if (result === true) return edgeNode("span", "pill pill-positive", yes);
  if (result === false) return edgeNode("span", "pill pill-danger", no);
  return null;
}

// ESPN scoreboard event -> the same shape games.py publishes.
function edgeParseEspn(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const sides = {};
  (comp.competitors || []).forEach(c => { sides[c.homeAway] = c; });
  if (!sides.home || !sides.away) return null;
  const type = ((comp.status || ev.status || {}).type) || {};
  const team = c => {
    const t = c.team || {};
    const rank = (c.curatedRank || {}).current;
    const score = c.score === undefined || c.score === "" ? null : Number(c.score);
    const record = (c.records || []).find(r => !r.type || r.type === "total");
    const probable = ((c.probables || [])[0] || {}).athlete;
    return { abbr: t.abbreviation || "", short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner, record: record ? record.summary : null,
             probable: probable ? probable.shortName : null };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  return { id: String(ev.id), start: ev.date, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           tv: tv.slice(0, 2).join(", "), neutral: !!comp.neutralSite, away: team(sides.away), home: team(sides.home) };
}

async function edgeLoadGames(site) {
  if (!site.games) return null;
  const published = await edgeFetchJson(site.games);
  if (!published) return null;
  const live = published.espn ? await edgeFetchJson(published.espn, 6000) : null;
  if (live && Array.isArray(live.events)) {
    const picks = {};
    (published.games || []).forEach(g => { if (g.pick) picks[g.id] = g.pick; });
    let games = live.events.map(edgeParseEspn).filter(Boolean);
    if (published.top25_only) games = games.filter(g => g.away.rank || g.home.rank);
    games.forEach(g => { if (picks[g.id]) g.pick = picks[g.id]; });
    const week = live.week && live.week.number;
    return { label: week && site.sport !== "MLB" && site.sport !== "NBA" ? `Week ${week}` : published.label,
             games, live: true };
  }
  return { label: published.label, games: published.games || [], live: false };
}

function edgeOrderGames(games) {
  const t = g => new Date(g.start).getTime() || 0;
  const live = games.filter(g => g.state === "in").sort((a, b) => t(a) - t(b));
  const next = games.filter(g => g.state === "pre").sort((a, b) => t(a) - t(b));
  const done = games.filter(g => g.state === "post").sort((a, b) => t(b) - t(a));
  return live.concat(next, done).slice(0, EDGE_GAMES_PER_SPORT);
}

function edgeGameStatus(g) {
  if (g.state !== "pre") return g.detail || (g.state === "post" ? "Final" : "Live");
  const d = new Date(g.start);
  if (isNaN(d)) return "";
  const opts = { timeZone: "America/New_York" };
  const day = d.toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const today = new Date().toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
  return (day === today ? "" : day + " ") + time + " ET";
}

function edgeGameCell(site, g) {
  const cell = edgeNode("a", "score-cell game-cell" + (g.state === "in" ? " is-live" : ""));
  cell.href = site.schedule;
  const top = edgeNode("span", "score-top");
  top.append(edgeNode("span", "game-status", edgeGameStatus(g)));
  if (g.tv) top.append(edgeNode("span", "game-tv", g.tv));
  cell.append(top);
  [g.away, g.home].forEach(t => {
    const row = edgeNode("span", "game-row" + (g.state === "post" && t.winner ? " is-winner" : ""));
    const name = edgeNode("span", "game-team");
    if (t.logo) {
      const img = edgeNode("img", "game-logo");
      img.src = t.logo;
      img.alt = "";
      img.loading = "lazy";
      name.append(img);
    }
    if (t.rank) name.append(edgeNode("span", "game-rank", String(t.rank)));
    name.append(edgeNode("span", null, t.abbr || t.short));
    row.append(name, edgeNode("span", "game-score", g.state !== "pre" && t.score != null ? String(t.score) : ""));
    cell.append(row);
  });
  if (g.pick) {
    const sub = edgeNode("span", "score-sub game-pick");
    sub.append(edgeNode("span", null, g.pick.text));
    const pill = edgeResultPill(g.pick.result);
    if (pill) sub.append(pill);
    cell.append(sub);
  }
  return cell;
}

// Fallback when no sport has games: each site's top picks.
function edgePickCells(track, summaries) {
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    const picks = s ? (s.picks || []).slice(0, 3) : [];
    if (!picks.length) return;
    const head = edgeNode("a", "score-cell score-sport");
    head.href = site.href;
    head.append(edgeNode("span", "score-sport-name", site.sport), edgeNode("span", "score-top", s.heading || ""));
    track.append(head);
    picks.forEach((p, rank) => {
      const cell = edgeNode("a", "score-cell");
      cell.href = site.href;
      cell.append(edgeNode("span", "score-top", rank === 0 ? "Top pick" : `Pick ${rank + 1}`));
      const main = edgeNode("span", "score-main");
      main.append(edgeNode("span", "score-label", p.label), edgeNode("span", "score-value", p.value));
      const sub = edgeNode("span", "score-sub");
      sub.append(edgeNode("span", null, p.sub || ""));
      const pill = edgeResultPill(p.result, s.result_labels);
      if (pill) sub.append(pill);
      cell.append(main, sub);
      track.append(cell);
    });
  });
}

async function initScoreboard() {
  const board = document.querySelector(".scoreboard");
  if (!board) return;
  const slates = await Promise.all(EDGE_SITES.map(edgeLoadGames));
  const track = edgeNode("div", "scoreboard-track");
  EDGE_SITES.forEach((site, i) => {
    const slate = slates[i];
    const games = slate ? edgeOrderGames(slate.games) : [];
    if (!games.length) return;
    const head = edgeNode("a", "score-cell score-sport");
    head.href = site.schedule;
    head.append(edgeNode("span", "score-sport-name", site.sport), edgeNode("span", "score-top", slate.label || ""));
    track.append(head);
    games.forEach(g => track.append(edgeGameCell(site, g)));
  });
  if (!track.children.length) edgePickCells(track, await edgeFetchSummaries());
  if (!track.children.length) return;
  const scroll = board.firstChild ? board.firstChild.scrollLeft : 0;
  board.replaceChildren(track);
  track.scrollLeft = scroll;
  board.hidden = false;
  // Keep live scores moving, like ESPN's bar, while any game is in progress.
  if (slates.some(s => s && s.live && s.games.some(g => g.state === "in"))) setTimeout(initScoreboard, 60000);
}
initScoreboard();

// Home page: the Board, one row per site (two for MLB: hits and games) with
// its all-time record and top pick, filled from the summary.json each site's build publishes next to its
// pages (/nfl/, /cfb/, /mlb/, /nba/ and /cbb/summary.json). If one fails, its
// row keeps its link.

function formatRetrained(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Model retrained " + d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

function renderRow(row, s) {
  const rec = row.querySelector(".board-rec");
  const what = row.querySelector(".board-what");
  const top = row.querySelector(".board-top");
  if (s.record) {
    rec.classList.remove("is-wait");
    rec.replaceChildren(s.record.value);
    if (s.record.sub) rec.append(edgeNode("small", null, s.record.sub));
    const label = s.record.label.charAt(0).toUpperCase() + s.record.label.slice(1);
    what.textContent = label + (s.record.since ? `, since ${s.record.since}` : "");
  } else {
    rec.textContent = "Soon";
    what.textContent = "The record starts with the first graded pick.";
  }
  const p = s.picks && s.picks[0];
  if (p) {
    // "Today: Wed, Sep 30" reads "Today's top pick"; "Week 5" reads "Week 5 top pick".
    const heading = s.heading || "Latest:";
    const when = heading.includes(":") ? heading.split(":")[0] + "'s" : heading;
    top.replaceChildren(`${when} top pick: ${p.label} `, edgeNode("b", null, p.value));
    const pill = edgeResultPill(p.result, s.result_labels);
    if (pill) top.append(" ", pill);
  } else {
    top.textContent = s.empty || "No picks yet.";
  }
  const retrained = s.retrained ? formatRetrained(s.retrained) : "";
  if (retrained) top.append(edgeNode("small", null, retrained));
}

async function initHome() {
  const summaries = await edgeFetchSummaries();
  const bySummary = new Map(EDGE_SITES.map((site, i) => [site.summary, summaries[i]]));
  document.querySelectorAll(".board-row[data-summary]").forEach(row => {
    // A row can show one part of a site's summary: MLB's game picks are its own row.
    const full = bySummary.get(row.dataset.summary);
    const s = full && row.dataset.part ? full[row.dataset.part] && { ...full, ...full[row.dataset.part] } : full;
    if (s) renderRow(row, s);
    else row.querySelector(".board-what").textContent = "Couldn't load here. Open the site to see its picks.";
  });
}
initHome();

// --- Best Bets, "$10 a pick" and Last night (home site only) ---
// Each site's summary.json carries "slate" (games still to play, with our
// pick, its moneyline price and a link to the game's page), "units" (the
// running total of 1 unit on every graded moneyline pick) and "last" (the
// latest day's results). Money is $10 a pick: units times 10.
const EDGE_STAKE = 10;
const EDGE_LINE_COLORS = { MLB: "var(--ours)", NFL: "var(--vegas)", CFB: "#d8c49a", NBA: "#b39ddb", CBB: "#8fd3c4" };
const EDGE_ET = { timeZone: "America/New_York" };

function edgeMoney(units) {
  const d = Math.round(units * EDGE_STAKE * 100) / 100;
  return (d < 0 ? "−" : "+") + "$" + Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function edgePrice(p) {
  return p > 0 ? "+" + p : "−" + Math.abs(p);
}

function edgeDayKey(d) {
  return d.toLocaleDateString("en-CA", EDGE_ET);  // YYYY-MM-DD in Eastern time
}

function edgeShortDay(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// "Today 8:00 PM", "Sat 12:00 PM" in Eastern time.
function edgeWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = edgeDayKey(d) === edgeDayKey(new Date()) ? "Today"
    : d.toLocaleDateString("en-US", { ...EDGE_ET, weekday: "short" });
  return day + " " + d.toLocaleTimeString("en-US", { ...EDGE_ET, hour: "numeric", minute: "2-digit" });
}

function edgeUpcoming(summaries) {
  const now = Date.now();
  const out = [];
  summaries.forEach((s, i) => (s && s.slate || []).forEach(g => {
    const t = new Date(g.start).getTime();
    if (!g.start || t > now) out.push({ ...g, site: EDGE_SITES[i], t: t || Infinity });
  }));
  return out.sort((a, b) => a.t - b.t);
}

function edgeValueRow(g) {
  const row = edgeNode("a", "vb-row");
  row.href = g.url;
  row.append(edgeNode("span", "vb-sport", g.sport));
  const who = edgeNode("span", "vb-pick");
  who.append(edgeNode("b", null, `${g.pick} ${edgePrice(g.price)}`), edgeNode("small", null, `over ${g.other}`));
  const bar = edgeNode("span", "vb-bar");
  const track = edgeNode("span", "vb-track");
  track.setAttribute("aria-hidden", "true");
  const fill = edgeNode("span", "vb-fill");
  fill.style.width = g.prob + "%";
  const tick = edgeNode("span", "vb-tick");
  tick.style.left = g.book + "%";
  track.append(fill, tick);
  const say = edgeNode("small");
  say.append("We say ", edgeNode("b", "vb-ours", Math.round(g.prob) + "%"), ", the price says ",
             edgeNode("b", "vb-book", Math.round(g.book) + "%"));
  bar.append(track, say);
  const when = edgeNode("span", "vb-when");
  const pays = g.price >= 100 ? `$100 wins $${g.price}` : `Bet $${-g.price} to win $100`;
  when.append(edgeNode("span", null, edgeWhen(g.start) || "Time TBA"), edgeNode("small", null, pays));
  row.append(who, bar, when);
  return row;
}

function edgeSureCard(eyebrow, name, pct, sub, href) {
  const card = edgeNode("a", "bet-card");
  card.href = href;
  const pick = edgeNode("div", "bet-pick");
  pick.append(edgeNode("b", null, name));
  const big = edgeNode("div", "bet-pct", String(Math.round(pct)));
  big.append(edgeNode("small", null, "%"));
  card.append(edgeNode("div", "bet-when", eyebrow), pick, big, edgeNode("div", "bet-sub", sub));
  return card;
}

async function initBestBets() {
  const list = document.getElementById("value-picks");
  const sure = document.getElementById("surest-picks");
  if (!list || !sure) return;
  const summaries = await edgeFetchSummaries();
  const games = edgeUpcoming(summaries);
  const value = games.filter(g => g.value && g.price != null && g.book != null);
  if (value.length) list.replaceChildren(...value.map(edgeValueRow));
  else list.replaceChildren(edgeNode("div", "empty-state",
    "No value picks right now. They show up here when our chance beats a betting price by 6 points or more."));

  const cards = [];
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    if (!s) return;
    if (site.sport === "MLB") {
      const p = (s.picks || [])[0];
      if (p && p.result == null && (s.heading || "").startsWith("Today")) {
        cards.push(edgeSureCard("MLB hitter · today", p.label, parseFloat(p.value), `to get a hit, ${p.sub}`, site.href));
      }
    }
    const top = games.filter(g => g.site === site).sort((a, b) => b.prob - a.prob)[0];
    if (top) {
      const label = site.sport === "MLB" ? "MLB game" : site.sport;
      const when = edgeWhen(top.start);
      cards.push(edgeSureCard(`${label} · ${when.split(" ")[0] || "soon"}`, top.pick, top.prob,
                              `${top.at === "vs" ? "vs" : (top.pick === top.home ? "vs" : "at")} ${top.other}${when ? ", " + when.split(" ").slice(1).join(" ") : ""}`,
                              top.url));
    }
  });
  if (cards.length) sure.replaceChildren(...cards);
  else sure.replaceChildren(edgeNode("div", "empty-state", "No games coming up right now."));
  const stamp = document.getElementById("bets-updated");
  if (stamp) stamp.textContent = `${games.length} games still to play across every sport`;
}
initBestBets();

// The running total of $10 on every moneyline pick, one step line per sport.
function edgeMoneyChart(lines) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 760, H = 300, L = 60, R = 176, T = 16, B = 34;
  const day = s => new Date(s + "T12:00:00Z").getTime();
  const DAY = 86400000;
  const d0 = Math.min(...lines.map(l => day(l.units.series[0][0]) - DAY));
  let d1 = Math.max(...lines.map(l => day(l.units.series[l.units.series.length - 1][0])));
  if (d1 <= d0) d1 = d0 + DAY;
  const vals = [0].concat(...lines.map(l => l.units.series.map(p => p[1] * EDGE_STAKE)));
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find(s => span / s <= 6) || 10000;
  const lo = Math.min(0, Math.floor(Math.min(...vals) / step) * step);
  const hi = Math.max(Math.ceil(Math.max(...vals) / step) * step, lo + step);
  const x = t => L + (W - L - R) * (t - d0) / (d1 - d0);
  const y = v => T + (H - T - B) * (hi - v) / (hi - lo);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Running total from $10 on every moneyline pick: " +
    lines.map(l => `${l.name} ${edgeMoney(l.units.units)} over ${l.units.picks} picks`).join("; "));
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let v = lo; v <= hi + 1e-9; v += step) {
    el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "z" : "g" });
    el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "t" },
       v === 0 ? "$0" : (v > 0 ? "+" : "−") + "$" + Math.abs(v).toLocaleString("en-US"));
  }
  const fmt = t => new Date(t).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const days = Math.round((d1 - d0) / DAY);
  const ticks = days >= 2 ? [d0, d0 + Math.floor(days / 2) * DAY, d1] : [d0, d1];
  ticks.forEach(t => el("text", { x: x(t), y: H - 10, "text-anchor": "middle", class: "t" }, fmt(t)));
  const ends = lines.map((l, i) => [y(l.units.series[l.units.series.length - 1][1] * EDGE_STAKE), i]).sort((a, b) => a[0] - b[0]);
  const placed = {};
  let last = -99;
  ends.forEach(([yy, i]) => { last = Math.max(yy, last + 16); placed[i] = last; });
  lines.forEach((l, i) => {
    const pts = [[day(l.units.series[0][0]) - DAY, 0]].concat(l.units.series.map(p => [day(p[0]), p[1] * EDGE_STAKE]));
    let d = "";
    pts.forEach(([t, v], k) => { d += k ? ` H${x(t).toFixed(1)} V${y(v).toFixed(1)}` : `M${x(t).toFixed(1)},${y(v).toFixed(1)}`; });
    d += ` H${x(d1).toFixed(1)}`;
    const endV = pts[pts.length - 1][1];
    el("path", { d, fill: "none", style: `stroke:${l.color}`, "stroke-width": 2.5, "stroke-linejoin": "round" });
    el("circle", { cx: x(d1), cy: y(endV), r: 4, style: `fill:${l.color}` });
    el("text", { x: x(d1) + 10, y: placed[i] + 4, class: "lab", style: `fill:${l.color}` },
       `${l.name} ${edgeMoney(l.units.units)}`);
  });
  const wrap = edgeNode("div", "money-chart");
  wrap.append(svg);
  return wrap;
}

async function initDollars() {
  const box = document.getElementById("dollars");
  if (!box) return;
  const summaries = await edgeFetchSummaries();
  const lines = [];
  EDGE_SITES.forEach((site, i) => {
    const u = summaries[i] && summaries[i].units;
    if (u && u.series && u.series.length) {
      lines.push({ name: site.sport === "MLB" ? "MLB games" : site.sport, color: EDGE_LINE_COLORS[site.sport], units: u, href: site.href });
    }
  });
  if (!lines.length) return;
  const total = lines.reduce((a, l) => a + l.units.units, 0);
  const picks = lines.reduce((a, l) => a + l.units.picks, 0);
  const tiles = edgeNode("div", "money-tiles");
  const tile = (label, units, sub, href) => {
    const t = edgeNode(href ? "a" : "div", "money-tile");
    if (href) t.href = href;
    t.append(edgeNode("span", "mt-label", label), edgeNode("span", "mt-num " + (units >= 0 ? "is-up" : "is-down"), edgeMoney(units)),
             edgeNode("span", "mt-sub", sub));
    return t;
  };
  tiles.append(tile("All sports", total, `${picks} picks, $${(picks * EDGE_STAKE).toLocaleString("en-US")} risked`));
  lines.forEach(l => tiles.append(tile(l.name, l.units.units,
    `${l.units.wins}-${l.units.losses} since ${edgeShortDay(l.units.since).replace(/^\w+, /, "")}`, l.href)));
  const missing = EDGE_SITES.filter(site => site.sport !== "MLB" && !lines.some(l => l.name === site.sport)).map(s => s.sport);
  const note = edgeNode("div", "table-footnote",
    "MLB hitter picks have no betting price, so they aren't in this." +
    (missing.length ? ` ${missing.join(" and ")} join with their first graded pick.` : ""));
  box.querySelector(".card-body").replaceChildren(tiles, edgeMoneyChart(lines), note);
  box.hidden = false;
}
initDollars();

// Last night: every sport's latest results in one strip at the top of the home page.
async function initLastNight() {
  const box = document.getElementById("last-night");
  if (!box) return;
  const summaries = await edgeFetchSummaries();
  const lasts = [];
  EDGE_SITES.forEach((site, i) => { const l = summaries[i] && summaries[i].last; if (l) lasts.push({ site, last: l }); });
  if (!lasts.length) return;
  const latest = lasts.map(l => l.last.date).sort().pop();
  const today = edgeDayKey(new Date());
  const ago = d => Math.round((new Date(today + "T12:00:00Z") - new Date(d + "T12:00:00Z")) / 86400000);
  if (ago(latest) > 3) return;  // nothing recent: offseason or a quiet stretch
  const recent = lasts.filter(l => ago(l.last.date) - ago(latest) <= 2);
  const yesterday = ago(latest) === 1;
  let wins = 0, losses = 0, units = 0, bets = 0;
  const rows = edgeNode("div", "ln-rows");
  const addRow = (label, items, date, href) => {
    const w = items.filter(it => it.hit).length;
    wins += w; losses += items.length - w;
    const row = edgeNode("div", "ln-row");
    const name = edgeNode("a", "ln-sport");
    name.href = href;
    name.append(edgeNode("b", null, label), edgeNode("span", null, `${w}-${items.length - w}`));
    if (date !== latest) name.append(edgeNode("small", null, edgeShortDay(date).split(",")[0]));
    const list = edgeNode("span", "ln-items");
    items.forEach(it => {
      const item = edgeNode(it.url ? "a" : "span", "ln-item " + (it.hit ? "is-hit" : "is-miss"));
      if (it.url) item.href = it.url;
      item.append(edgeNode("span", "ln-mark", it.hit ? "✓" : "✗"));
      item.setAttribute("aria-label", (it.hit ? "Hit: " : "Miss: ") + it.text);
      item.append(it.text);
      list.append(item);
    });
    row.append(name, list);
    rows.append(row);
  };
  recent.forEach(({ site, last }) => {
    if (last.games && last.games.length) {
      last.games.forEach(g => { if (g.units != null) { units += g.units; bets += 1; } });
      addRow(site.sport === "MLB" ? "MLB games" : site.sport, last.games, last.date,
             site.sport === "MLB" ? "/mlb/games.html" : site.href);
    }
    if (last.hits && last.hits.length) {
      addRow("MLB hits", last.hits.map(h => ({ hit: h.hit, text: `${h.name.split(" ").slice(1).join(" ") || h.name} ${h.line}` })),
             last.date, site.href);
    }
  });
  if (!rows.children.length) return;

  // Next up: each sport's next game day still to come.
  const next = [];
  const seen = new Set();
  edgeUpcoming(summaries).forEach(g => {
    if (seen.has(g.site.sport) || !g.start) return;
    seen.add(g.site.sport);
    const key = edgeDayKey(new Date(g.start));
    const n = (summaries[EDGE_SITES.indexOf(g.site)].slate || []).filter(x => x.start && edgeDayKey(new Date(x.start)) === key).length;
    const when = key === today ? "today" : "on " + new Date(g.start).toLocaleDateString("en-US", { ...EDGE_ET, weekday: "long" });
    next.push(`${n} ${g.site.sport} ${n === 1 ? "game" : "games"} ${when}`);
  });
  if (next.length) {
    const row = edgeNode("div", "ln-row ln-next");
    const name = edgeNode("span", "ln-sport");
    name.append(edgeNode("b", null, "Next up"));
    row.append(name, edgeNode("span", "ln-items", next.join(", ") + "."));
    rows.append(row);
  }

  const head = edgeNode("div", "ln-head");
  head.append(edgeNode("span", "rb-eyebrow", `${yesterday ? "Last night" : "Latest results"} · ${edgeShortDay(latest)}`),
              edgeNode("span", "ln-num", `${wins}-${losses}`));
  if (bets) head.append(edgeNode("span", "ln-sub", `${edgeMoney(units)} at $${EDGE_STAKE} a game pick`));
  box.querySelector(".card-body").replaceChildren(head, rows);
  box.hidden = false;
}
initLastNight();

// --- Sport menu on phones (shared by every Edge site) ---
// Adds a menu button (the current sport and three lines) to the top bar; on
// phones the CSS hides the sport tabs behind it and drops them down as a list
// when it's tapped. Keep this block identical in home.js (repo root),
// nfl-cfb/web/site.js and mlb-nba-cbb/web/site.js.
function initSportMenu() {
  const bar = document.querySelector(".topbar-inner");
  const nav = bar && bar.querySelector(".sport-switcher");
  if (!nav || bar.querySelector(".menu-toggle")) return;
  nav.id = nav.id || "sport-menu";
  const active = nav.querySelector(".sport-tab.active");
  const btn = edgeNode("button", "menu-toggle");
  btn.type = "button";
  btn.setAttribute("aria-controls", nav.id);
  btn.setAttribute("aria-expanded", "false");
  const icon = edgeNode("span", "menu-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.append(edgeNode("span"), edgeNode("span"), edgeNode("span"));
  btn.append(edgeNode("span", "menu-current", active ? active.textContent : "Sports"),
             edgeNode("span", "sr-only", " menu"), icon);
  const setOpen = open => {
    bar.classList.toggle("menu-open", open);
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => setOpen(!bar.classList.contains("menu-open")));
  document.addEventListener("click", e => { if (!bar.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && bar.classList.contains("menu-open")) { setOpen(false); btn.focus(); }
  });
  bar.insertBefore(btn, nav);
  bar.classList.add("has-menu");
}
initSportMenu();
