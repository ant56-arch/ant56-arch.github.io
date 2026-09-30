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

// Home page: the Board, one row per site with its all-time record and top
// pick, filled from the summary.json each site's build publishes next to its
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
    const s = bySummary.get(row.dataset.summary);
    if (s) renderRow(row, s);
    else row.querySelector(".board-what").textContent = "Couldn't load here. Open the site to see its picks.";
  });
}
initHome();

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
