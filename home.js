// --- Scoreboard strip (shared by every Edge site) ---
// Fills <div class="scoreboard"> under the top bar with the latest games in
// every sport, ESPN style: live games first, then what's next, then recent
// finals, each with our pick. Each site's build publishes games.json (ESPN's
// current slate plus our picks) next to its summary.json; the strip then asks
// ESPN for fresh scores in the browser, refreshes every minute while a game is
// live, and keeps the published file if ESPN can't be reached. If no sport has
// games, it falls back to each site's top picks from summary.json. Keep this
// block identical in home.js (ant56-arch.github.io), web/site.js (nfl-edge)
// and web/site.js (mlb-hit-predictor).
const EDGE_SITES = [
  { sport: "NFL", summary: "/nfl-edge/nfl/summary.json", games: "/nfl-edge/nfl/games.json",
    href: "/nfl-edge/nfl/index.html", schedule: "/nfl-edge/nfl/schedule.html" },
  { sport: "CFB", summary: "/nfl-edge/cfb/summary.json", games: "/nfl-edge/cfb/games.json",
    href: "/nfl-edge/cfb/index.html", schedule: "/nfl-edge/cfb/schedule.html" },
  { sport: "MLB", summary: "/mlb-hit-predictor/summary.json", games: "/mlb-hit-predictor/games.json",
    href: "/mlb-hit-predictor/", schedule: "/mlb-hit-predictor/schedule.html" },
  { sport: "NBA", summary: "/mlb-hit-predictor/nba/summary.json", games: "/mlb-hit-predictor/nba/games.json",
    href: "/mlb-hit-predictor/nba/index.html", schedule: "/mlb-hit-predictor/nba/schedule.html" },
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
    return { abbr: t.abbreviation || "", short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  return { id: String(ev.id), start: ev.date, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           tv: tv.slice(0, 2).join(", "), away: team(sides.away), home: team(sides.home) };
}

async function edgeLoadGames(site) {
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

// Home page: the scoreboard strip, the record row in the hero and one card per
// site, all filled from the summary.json each site's build publishes next to
// its pages (nfl-edge: <sport>/summary.json, mlb-hit-predictor: summary.json
// and nba/summary.json). If one fails, its card keeps its link.

function formatUpdated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Updated " + d.toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

function formatRetrained(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Model retrained " + d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

function renderCard(box, s, summaryUrl) {
  box.replaceChildren();

  const meta = edgeNode("div", "picks-meta");
  if (s.heading) meta.append(edgeNode("span", "picks-heading", s.heading));
  const updated = formatUpdated(s.updated);
  if (updated) meta.append(edgeNode("span", "picks-updated", updated));
  box.append(meta);

  if (s.picks && s.picks.length) {
    const list = edgeNode("ol", "pick-list");
    for (const p of s.picks) {
      const row = edgeNode("li", "pick-row");
      const who = edgeNode("div", "pick-who");
      who.append(edgeNode("div", "pick-label", p.label));
      if (p.sub) who.append(edgeNode("div", "pick-sub", p.sub));
      const val = edgeNode("div", "pick-value");
      val.append(edgeNode("span", "pick-number", p.value));
      // A summary can name its own result labels (NBA Edge: ["WIN", "LOSS"]).
      const pill = edgeResultPill(p.result, s.result_labels);
      if (pill) val.append(pill);
      row.append(who, val);
      list.append(row);
    }
    box.append(list);
  } else {
    box.append(edgeNode("div", "picks-status", s.empty || "No picks yet."));
  }

  if (s.record) {
    const rec = edgeNode("div", "site-record");
    rec.append(edgeNode("span", "record-value", s.record.value), edgeNode("span", "record-label", s.record.label));
    if (s.record.sub) rec.append(edgeNode("span", "record-sub", s.record.sub));
    box.append(rec);
  } else if (s.picks && s.picks.length) {
    // Picks are out but none graded yet this season. Summaries only carry
    // this season's live record, never a backtest, so say that plainly.
    box.append(edgeNode("div", "picks-status record-pending", "No results yet this season. The record starts once these games are played."));
  }

  // When the model last retrained itself, linking to that site's Model tab.
  const retrained = s.retrained ? formatRetrained(s.retrained) : "";
  if (retrained) {
    const link = edgeNode("a", "model-link", retrained);
    link.href = new URL(s.model_url || "model.html", new URL(summaryUrl, location.href)).pathname;
    link.append(edgeNode("span", "model-link-more", "See how it learns"));
    box.append(link);
  }
}

async function initHome() {
  const summaries = await edgeFetchSummaries();
  const bySummary = new Map(EDGE_SITES.map((site, i) => [site.summary, summaries[i]]));

  document.querySelectorAll(".site-card[data-summary]").forEach(card => {
    const box = card.querySelector(".site-picks");
    const s = bySummary.get(card.dataset.summary);
    if (s) renderCard(box, s, card.dataset.summary);
    else box.replaceChildren(edgeNode("div", "picks-status", "Picks couldn't load here. Open the site to see them."));
  });

  const stats = document.querySelector(".hero-stats");
  if (!stats) return;
  EDGE_SITES.forEach((site, i) => {
    const r = summaries[i] && summaries[i].record;
    if (!r) return;
    const stat = edgeNode("div", "hero-stat");
    const value = edgeNode("dd");
    value.append(edgeNode("span", "hero-stat-value", r.value));
    stat.append(edgeNode("dt", null, `${site.sport} · ${r.label}`), value);
    stats.append(stat);
  });
}
initHome();
