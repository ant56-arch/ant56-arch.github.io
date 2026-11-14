// NFL Edge's own behavior: the Teams week picker, the Accuracy week filter and
// the Players tabs. Sortable tables and the charts are shared
// (shared/sport-pages.js).

// --- Week picker: populates a <select> from {week_order, weeks} and
// re-renders a content div on change. Weeks that carry a "group" (the
// season) are listed under it. Teams uses it for this season, past +
// upcoming (defaulting to the current week via pickDefault, since "most
// recent" would land on the season finale), plus earlier seasons' graded
// weeks. ---
function buildWeekPicker(data, selectId, contentId, renderWeek, pickDefault) {
  const picker = document.getElementById(selectId);
  const container = document.getElementById(contentId);
  if (!picker || !container || !data) return;

  function render(weekKey) {
    const week = data.weeks[weekKey];
    container.innerHTML = week ? renderWeek(week) : "<p class='muted'>No data for this week.</p>";
  }

  const groups = {};
  data.week_order.forEach(wk => {
    const opt = document.createElement("option");
    opt.value = wk;
    opt.textContent = data.weeks[wk].label;
    const group = data.weeks[wk].group;
    if (!group) { picker.appendChild(opt); return; }
    if (!groups[group]) {
      groups[group] = document.createElement("optgroup");
      groups[group].label = group;
      picker.appendChild(groups[group]);
    }
    groups[group].appendChild(opt);
  });
  picker.addEventListener("change", () => render(picker.value));
  if (data.week_order.length) {
    picker.value = pickDefault ? pickDefault(data) : data.week_order[data.week_order.length - 1];
    render(picker.value);
  }
}

// An earlier season's week (backfilled picks): our pick and Vegas's, with
// the final score and whether our pick hit.
function pastWeekTable(week) {
  let rows = "";
  week.games.forEach(g => {
    const pill = g.model_correct == null ? "" : g.model_correct ? " <span class='pill pill-positive'>HIT</span>" : " <span class='pill pill-danger'>MISS</span>";
    rows += `<tr>
      <td>${g.away_team} @ ${g.home_team}</td>
      <td class="num mono accent" data-label="Model Pick">${g.model_pick}</td>
      <td class="num mono market-color" data-label="Vegas">${g.vegas_pick}</td>
      <td class="num mono" data-label="Result"><span>${g.away_score}-${g.home_score}${pill}</span></td>
    </tr>`;
  });
  return `<table class="data responsive-stack">
      <thead><tr><th>Matchup</th><th class="num">Model Pick</th><th class="num">Vegas</th><th class="num">Result</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="table-footnote muted">Picks from before this site went live, made the same way and graded against the final score.</div>`;
}

// --- Accuracy tab week filter: one week of moneyline and TD picks at a
// time (newest by default), or every week, with that week's record. ---
function initAccuracyWeeks() {
  const picker = document.getElementById("acc-week-select");
  if (!picker) return;
  const rows = Array.from(document.querySelectorAll("tr[data-week]"));
  const weeks = [...new Set(rows.map(r => r.dataset.week))];
  [...weeks, "all"].forEach(wk => {
    const opt = document.createElement("option");
    opt.value = wk;
    opt.textContent = wk === "all" ? "All weeks" : wk;
    picker.appendChild(opt);
  });
  const summary = document.getElementById("acc-week-summary");
  function record(kind, shown) {
    const r = shown.filter(x => x.dataset.kind === kind);
    if (!r.length) return "";
    const w = r.filter(x => x.dataset.res === "W").length;
    const l = r.filter(x => x.dataset.res === "L").length;
    const p = r.length - w - l;
    return `${w}-${l}${p ? "-" + p : ""}`;
  }
  function show(wk) {
    const shown = rows.filter(r => wk === "all" || r.dataset.week === wk);
    rows.forEach(r => { r.hidden = !shown.includes(r); });
    // A table with nothing from that week (no TD picks before they started) hides too.
    new Set(rows.map(r => r.closest("table"))).forEach(t => {
      t.hidden = !t.querySelector("tr[data-week]:not([hidden])");
    });
    const ml = record("ml", shown), td = record("td", shown);
    const parts = [ml && `Moneyline ${ml}`, td && `TD Value picks ${td}`].filter(Boolean);
    summary.textContent = parts.length ? `${wk === "all" ? "All weeks" : wk}: ${parts.join(", ")}` : "No graded picks that week.";
  }
  picker.addEventListener("change", () => show(picker.value));
  if (weeks.length) { picker.value = weeks[0]; show(weeks[0]); }
}
initAccuracyWeeks();

// --- Season week picker (teams.html) - the current season, past + upcoming ---
function initTeamsPicker() {
  if (typeof TEAMS_DATA === "undefined") return;
  buildWeekPicker(TEAMS_DATA, "teams-week-select", "teams-week-content", (week) => {
    if (week.past) return pastWeekTable(week);
    let rows = "";
    week.games.forEach(g => {
      const pick = `${g.favored_team} -${g.favored_by.toFixed(1)}`;
      const vegas = g.vegas_favored_team ? `${g.vegas_favored_team} -${g.vegas_favored_by.toFixed(1)}` : "-";
      let resultCell;
      if (g.graded) {
        const resultPill = g.correct ? "<span class='pill pill-positive'>HIT</span>" : "<span class='pill pill-danger'>MISS</span>";
        resultCell = `${g.away_score}-${g.home_score} ${resultPill}`;
      } else {
        resultCell = "<span class='faint'>-</span>";
      }
      const live = g.graded ? "" : ` data-live data-day="${g.gameday || ""}" data-away="${g.away_label}" data-home="${g.home_label}" data-pick="${g.favored_team}"`;
      rows += `<tr${live}>
        <td>${g.matchup_html}</td>
        <td class="num mono accent" data-label="Model Pick">${pick}</td>
        <td class="num mono market-color" data-label="Vegas">${vegas}</td>
        <td class="num mono" data-label="Total">${g.total.toFixed(1)}</td>
        <td class="num mono" data-label="Win%">${(g.win_pct * 100).toFixed(0)}%</td>
        <td class="num ml-cell" data-label="Moneyline">${g.ml_html || "<span class='faint'>-</span>"}</td>
        <td class="num mono" data-label="Result"><span>${resultCell}</span></td>
      </tr>`;
    });
    return `<table class="data responsive-stack">
        <thead><tr><th>Matchup</th><th class="num">Model Pick</th><th class="num">Vegas</th><th class="num">Total</th><th class="num">Win%</th><th class="num">Moneyline</th><th class="num">Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="table-footnote muted">Result shows the final score once graded. Moneyline is our pick at Vegas's price, with our win chance next to Vegas's; VALUE means ours is at least 6% higher.</div>`;
  }, (data) => data.default_week || data.week_order[data.week_order.length - 1]);
}
initTeamsPicker();

// Teams table rows for games not graded yet: ESPN's live score or final, with
// HIT / MISS on the model pick (a tie misses), until the next run grades them.
// Uses the game-card helpers in sport-pages.js, which loads after this file.
let teamsLiveTimer = null;
async function teamsLive() {
  clearTimeout(teamsLiveTimer);
  const rows = [...document.querySelectorAll("#teams-week-content tr[data-live]")];
  const site = gcLiveSite();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const days = [...new Set(rows.map(r => r.dataset.day).filter(d => d && d <= today))];
  if (!rows.length || !site || !days.length) return;
  const events = await gcLiveEvents(site, days);
  let live = false;
  rows.forEach(row => {
    const e = gcLiveMatch(row, events, site.sport);
    if (!e || e.state === "pre") return;
    const k = a => edgeFavKey(site.sport, a);
    const flip = k(row.dataset.away) === k(e.home.abbr) || k(row.dataset.home) === k(e.away.abbr);
    const away = flip ? e.home : e.away, home = flip ? e.away : e.home;
    if (away.score == null || home.score == null) return;
    const cell = row.querySelector('[data-label="Result"] span');
    if (!cell) return;
    if (e.state === "in") {
      live = true;
      cell.innerHTML = `${away.score}-${home.score} <span class="gc-when is-live">${e.detail || "Live"}</span>`;
      return;
    }
    const hit = away.score !== home.score && (row.dataset.pick === row.dataset.away) === (away.score > home.score);
    cell.innerHTML = `${away.score}-${home.score} <span class='pill ${hit ? "pill-positive" : "pill-danger"}'>${hit ? "HIT" : "MISS"}</span>`;
  });
  if (live) teamsLiveTimer = setTimeout(teamsLive, 60000);
}
if (typeof TEAMS_DATA !== "undefined") {
  setTimeout(teamsLive, 0);  // after sport-pages.js has loaded
  const pick = document.getElementById("teams-week-select");
  if (pick) pick.addEventListener("change", () => setTimeout(teamsLive, 0));
}

// --- In-page category tabs (players.html) ---
function initSubtabs() {
  document.querySelectorAll(".subtabs").forEach(bar => {
    bar.querySelectorAll(".subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        bar.querySelectorAll(".subtab").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const targetId = btn.dataset.target;
        document.querySelectorAll(".cat-panel").forEach(panel => {
          panel.hidden = panel.id !== targetId;
        });
      });
    });
  });
}
initSubtabs();

// --- Score ticker and site settings (shared by every Edge site) ---
// Two scrolling bars under the top bar: a score ticker (live games first,
// then games still to play, then finals; each opens the Schedule tab) and a
// red bar of scoring plays seen in the last 3 hours (for basketball, only
// standout finals). Each site's build publishes games.json (ESPN's current
// slate plus our picks) next to its summary.json; the ticker asks ESPN for
// fresh scores in the browser every 30 seconds while a game is live (every 2
// minutes while a game starts within 6 hours). A gear in the top bar opens
// the site settings: what the ticker shows, which sports, time zone, odds
// format, theme and home page defaults, saved in localStorage. Every Edge
// site's script starts from this file (see shared/assets.py).
const EDGE_SITES = [
  { sport: "NFL", summary: "/nfl/summary.json", games: "/nfl/games.json",
    href: "/nfl/index.html", schedule: "/schedule.html#nfl" },
  { sport: "NBA", summary: "/nba/summary.json", games: "/nba/games.json",
    href: "/nba/index.html", schedule: "/schedule.html#nba" },
  { sport: "MLB", summary: "/mlb/summary.json", games: "/mlb/games.json",
    href: "/mlb/", schedule: "/schedule.html#mlb" },
  { sport: "NHL", summary: "/nhl/summary.json", games: "/nhl/games.json",
    href: "/nhl/index.html", schedule: "/schedule.html#nhl" },
  { sport: "CFB", summary: "/cfb/summary.json", games: "/cfb/games.json",
    href: "/cfb/index.html", schedule: "/schedule.html#cfb" },
  // CBB isn't on the Schedule tab or in the ticker yet; its games.json feeds
  // the live scores on its own game cards.
  { sport: "CBB", summary: "/cbb/summary.json", games: "/cbb/games.json",
    href: "/cbb/index.html", schedule: "/cbb/index.html" },
  // Soccer Edge: Premier League, La Liga and Champions League in one games.json
  // with no single ESPN address, so it isn't in the score ticker.
  { sport: "Soccer", summary: "/soccer/summary.json", games: "/soccer/games.json",
    href: "/soccer/index.html", schedule: "/schedule.html#soccer" },
];
const EDGE_LIVE_POLL = 30000;   // while a game is live
const EDGE_IDLE_POLL = 120000;  // while a game starts within EDGE_SOON
const EDGE_SOON = 6 * 3600000;
const EDGE_TICKER_SPORTS = ["MLB", "NFL", "NBA", "NHL", "CFB"];
const EDGE_SCORES_KEY = "edge-ticker-scores";
const EDGE_PLAYS_KEY = "edge-ticker-plays";
const EDGE_CRAWL_KEY = "edge-ticker-pos";
const edgeTicker = { published: {}, slates: {}, plays: [], flash: new Set(), toasts: null, settings: null };

// Text made safe to put inside HTML.
function edgeEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function edgeFetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  return fetch(url, { cache: "no-cache", signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
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

// Soccer abbreviations ESPN gets wrong or makes confusing (it calls Bayern
// Munich "MUN"), by ESPN team id. Same table as shared/soccer_abbr.py.
const EDGE_SOCCER_ABBR = {
  360: "MUN", 382: "MCI", 132: "FCB", 124: "BVB", 134: "STU", 99: "MAL", 166: "LIL", 175: "LEN",
  104: "ROM", 2572: "COM", 2980: "BOD", 437: "POR", 494: "SLA", 521: "SLO", 510: "VIK",
};
function edgeTeamAbbr(t) {
  const logo = t.logo || ((t.logos || [])[0] || {}).href || "";
  return (logo.includes("/soccer/") && EDGE_SOCCER_ABBR[t.id]) || t.abbreviation || "";
}

// How a team is shown: NFL, NBA, NHL and MLB by abbreviation ("KC"); college
// and soccer by the school or club ("Ohio State", "Bayern Munich"). The
// abbreviation stays the key everything matches on (picks, favorites, ESPN).
// t: {abbr, short, name}; short is ESPN's shortDisplayName, name is the
// display name (games.json) or the short name (the slate picker's games).
const EDGE_NAME_SPORTS = ["CFB", "CBB", "SOCCER"];
function edgeNamesTeams(sport) {
  return EDGE_NAME_SPORTS.includes(String(sport || "").toUpperCase());
}
function edgeTeamLabel(sport, t) {
  if (!t) return "";
  if (!edgeNamesTeams(sport)) return t.abbr || t.short || t.name || "";
  // Soccer clubs: the full club name ("Coventry City", not "Coventry").
  const name = /^soccer$/i.test(sport) ? (t.name || t.short) : (t.short || t.name);
  return String(name || t.abbr || "").replace(/^#\d+\s+/, "");
}
// Text that names teams by abbreviation ("ARIZ to win, 72%", "MIZ +2.5"),
// with each of this game's abbreviations swapped for the team's name.
function edgeNameText(sport, g, text) {
  if (!text || !g || !edgeNamesTeams(sport)) return text;
  const map = {};
  [g.away, g.home].forEach(t => { if (t && t.abbr) { const n = edgeTeamLabel(sport, t); if (n && n !== t.abbr) map[t.abbr] = n; } });
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const alts = keys.map(k => k.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join("|");
  const re = new RegExp("(^|[^A-Za-z0-9&])(" + alts + ")(?![A-Za-z0-9&])", "g");
  return String(text).replace(re, (m, pre, k) => pre + map[k]);
}
// One team's name, given its abbreviation in this game (anything else, like
// "Draw", as is).
function edgeTeamOf(sport, g, abbr) {
  const t = g && (abbr === g.away.abbr ? g.away : abbr === g.home.abbr ? g.home : null);
  return t ? edgeTeamLabel(sport, t) : abbr;
}
// SVG text for a team name inside a small circle (the logo's stand-in): up
// to two lines, shrunk so the longest fits the circle's width.
function edgeSvgName(name, x, cy, width, size, cls) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  let lines = [words.join(" ")];
  if (words.length > 1 && lines[0].length > 7) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) best = [a, b];
    }
    lines = best;
  }
  const longest = Math.max(...lines.map(l => l.length), 1);
  const fs = Math.max(6, Math.min(size, width / (longest * 0.62)));
  const top = cy - (lines.length - 1) * fs * 0.55 + fs * 0.35;
  return `<text class="${cls}" x="${x}" y="${top.toFixed(1)}" text-anchor="middle" style="font-size:${fs.toFixed(1)}px;letter-spacing:0">` +
    lines.map((l, i) => `<tspan x="${x}" dy="${i ? (fs * 1.1).toFixed(1) : 0}">${edgeEsc(l)}</tspan>`).join("") + "</text>";
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
    // The team's top scorer (basketball), for standout games in the red bar.
    const pts = ((c.leaders || []).find(l => l.name === "points") || {}).leaders;
    const top = pts && pts[0];
    const leader = top && top.athlete ? { name: top.athlete.shortName || top.athlete.displayName || "", pts: Number(top.value || top.displayValue) || 0 } : null;
    return { leader, abbr: edgeTeamAbbr(t), short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner, record: record ? record.summary : null,
             probable: probable ? probable.shortName : null, color: t.color ? "#" + t.color : "" };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  const sit = comp.situation || {};
  const lastPlay = (sit.lastPlay || {}).text || "";
  const st = comp.status || ev.status || {};
  // Football: where the ball is, for the live win chance (edgeLiveChance).
  // ESPN's yardLine counts from the home team's goal line.
  const ball = sit.possession && sit.yardLine != null && sit.down > 0
    ? { home: String(sit.possession) === String((sides.home.team || {}).id), yardLine: Number(sit.yardLine) } : null;
  return { id: String(ev.id), start: ev.date, lastPlay, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           period: st.period || 0, clock: st.displayClock || "", ball,
           tv: tv.slice(0, 2).join(", "), neutral: !!comp.neutralSite, series: edgeSeriesLabel(ev, comp),
           away: team(sides.away), home: team(sides.home) };
}

// A playoff game's round and series score, like "NLCS · Game 2 · MIL leads series 1-0"
// ("" outside the postseason). Same rule as series_label in shared/games.py.
function edgeSeriesLabel(ev, comp) {
  const series = comp.series || {};
  if ((ev.season || {}).type !== 3 && series.type !== "playoff") return "";
  const note = ((comp.notes || []).find(n => n.headline) || {}).headline || "";
  const parts = note ? [note.replace(/ - /g, " · ")] : [];
  if (series.summary && (series.competitors || []).some(c => c.wins)) parts.push(series.summary);
  return parts.join(" · ");
}

// A finished game's pick is graded when the site rebuilds overnight; until then
// grade it here from the final score so it shows Hit or Miss right away.
// Picks name a team by its abbreviation first ("MTL 65%", "SEA to win, 51%",
// "DEN +2.5") or say "Draw"; anything else (MLB's top hitter) stays ungraded.
function edgeGradePick(g, pick) {
  const a = Number(g.away.score), h = Number(g.home.score);
  if (g.state !== "post" || g.away.score == null || g.home.score == null || isNaN(a) || isNaN(h)) return pick;
  const margin = (text, line) => {
    const tok = (text || "").split(/[\s,]/)[0];
    if (tok === "Draw") return a === h ? 0.5 : -1;
    const m = tok === g.away.abbr ? a - h : tok === g.home.abbr ? h - a : null;
    return m == null ? null : m + (line || 0);
  };
  const out = { ...pick };
  if (out.result == null) {
    const m = margin(out.text);
    if (m != null) out.result = m > 0;
  }
  if (out.spread && out.spread.result == null) {
    const line = parseFloat(((out.spread.short || out.spread.text || "").split(" ")[1]) || "");
    const m = isNaN(line) ? null : margin(out.spread.short || out.spread.text, line);
    if (m != null && m !== 0) out.spread = { ...out.spread, result: m > 0 };  // a push stays ungraded
  }
  return out;
}

async function edgeLoadGames(site) {
  if (!site.games) return null;
  // The published file only changes when the site rebuilds, so fetch it once.
  const published = edgeTicker.published[site.games] || await edgeFetchJson(site.games);
  if (!published) return null;
  edgeTicker.published[site.games] = published;
  const live = published.espn ? await edgeFetchJson(published.espn, 6000) : null;
  if (live && Array.isArray(live.events)) {
    const picks = {};
    const urls = {};
    (published.games || []).forEach(g => { if (g.pick) picks[g.id] = g.pick; if (g.url) urls[g.id] = g.url; });
    let games = live.events.map(edgeParseEspn).filter(Boolean);
    if (published.top25_only) games = games.filter(g => g.away.rank || g.home.rank);
    games.forEach(g => { if (picks[g.id]) g.pick = edgeGradePick(g, picks[g.id]); if (urls[g.id]) g.url = urls[g.id]; });
    const week = live.week && live.week.number;
    return { label: week && !["MLB", "NBA", "NHL"].includes(site.sport) ? `Week ${week}` : published.label,
             games, live: true };
  }
  return { label: published.label, games: published.games || [], live: false };
}

// --- Site settings: a gear in the top bar (ticker, sports, display, home) ---
// Saved per device in localStorage. Time zone and odds format also rewrite the
// "7:05 PM ET" times and "+135" prices the sites' builds print into pages.
const EDGE_SETTINGS_KEY = "edge-ticker-settings";
const EDGE_SETTINGS = [
  { group: "Ticker" },
  { k: "ticker", label: "Score ticker", sub: "A scrolling bar of games", on: true },
  { k: "plays", label: "Scoring plays", sub: "A red bar with each score (NBA: big finals only)", on: true },
  { k: "popups", label: "Score pop-ups", sub: "A card in the corner when a team scores", on: false },
  { k: "sound", label: "Sound", sub: "A short chime when a team scores", on: false },
  { k: "liveOnly", label: "Live games only", sub: "Hide games still to play and finals", on: false },
  { k: "picks", label: "Our picks", sub: "Show the model's pick next to each game", on: true },
  { k: "myTeamsFirst", label: "My teams first", sub: "Games with teams you pick lead the ticker", on: true },
  { button: "pickTeams", label: "Pick my teams" },
  { k: "speed", label: "Ticker speed", on: "normal", choices: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] },
  { group: "Sports in the ticker" },
  { k: "MLB", label: "MLB", on: true, sport: true },
  { k: "NFL", label: "NFL", on: true, sport: true },
  { k: "NBA", label: "NBA", on: true, sport: true },
  { k: "NHL", label: "NHL", on: true, sport: true },
  { k: "CFB", label: "College football", sub: "Games with a Top 25 team", on: true, sport: true },
  { group: "Display" },
  { k: "tz", label: "Time zone", on: "ET", choices: [["ET", "Eastern"], ["CT", "Central"], ["MT", "Mountain"], ["PT", "Pacific"], ["device", "My device"]] },
  { k: "odds", label: "Odds", on: "american", choices: [["american", "American (−150)"], ["decimal", "Decimal (1.67)"], ["percent", "Win chance (60%)"]] },
  { k: "theme", label: "Theme", on: "device", choices: [["light", "Paper (light)"], ["dark", "Night (dark)"], ["device", "Match my device"]] },
  { group: "Home page" },
  { k: "homeLayout", label: "Games view", on: "auto", choices: [["auto", "Slate"], ["cards", "Cards"], ["list", "List"]] },
  { k: "homeDay", label: "Opens on", on: "auto", choices: [["auto", "First day with games"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["weekend", "Weekend"]] },
  { group: "Owner" },
  // Password-locked page built by model_room/ (the Model Room workflow).
  { link: "/model-room/", label: "Model Room" },
];
const EDGE_TZ = { ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles" };
const EDGE_SPEED = { slow: 35, normal: 60, fast: 100 };  // pixels a second

function edgeStore(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* private mode or blocked storage: settings last for this page only */ }
  return null;
}

function edgeSettings() {
  if (!edgeTicker.settings) {
    const saved = edgeStore(EDGE_SETTINGS_KEY) || {};
    edgeTicker.settings = {};
    EDGE_SETTINGS.forEach(s => {
      if (!s.k) return;
      const ok = s.choices ? s.choices.some(c => c[0] === saved[s.k]) : typeof saved[s.k] === "boolean";
      edgeTicker.settings[s.k] = ok ? saved[s.k] : s.on;
    });
    // The home page's Cards/List buttons save their own choice; show it here.
    try {
      const layout = localStorage.getItem("edge-home-layout");
      if (layout === "cards" || layout === "list") edgeTicker.settings.homeLayout = layout;
      else if (layout === "slate") edgeTicker.settings.homeLayout = "auto";
    } catch (e) { /* storage blocked */ }
  }
  return edgeTicker.settings;
}

// The time zone picked in settings: { timeZone, label } for Intl formatting.
function edgeTz() {
  const tz = edgeSettings().tz;
  if (EDGE_TZ[tz]) return { timeZone: EDGE_TZ[tz], label: tz };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date()).find(p => p.type === "timeZoneName");
  return { timeZone: zone, label: name ? name.value : "local" };
}

// Minutes a time zone is ahead of UTC right now.
function edgeTzOffset(timeZone) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date()).forEach(x => { p[x.type] = Number(x.value); });
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  return Math.round((asUtc - Date.now()) / 60000);
}

// A moneyline price in the odds format picked in settings.
function edgeOdds(p) {
  const fmt = edgeSettings().odds;
  if (fmt === "decimal") return (p > 0 ? 1 + p / 100 : 1 + 100 / Math.abs(p)).toFixed(2);
  if (fmt === "percent") return Math.round(100 * (p > 0 ? 100 / (p + 100) : -p / (-p + 100))) + "%";
  return p > 0 ? "+" + p : "−" + Math.abs(p);
}

// Rewrites build-printed times ("Sun 1:00 PM ET") and prices ("+135",
// "−150") inside a part of the page to the picked time zone and odds format.
const EDGE_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EDGE_TIME_RE = /\b(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat)([a-z]*)(,?) )?(\d{1,2}):(\d{2}) ?(AM|PM) ET\b/g;
const EDGE_ODDS_RE = /(^|[\s(·])([+−-])(\d{3,5})(?![\d.,%$])/g;
function edgeLocalize(root) {
  const s = edgeSettings();
  const tz = edgeTz();
  const shift = s.tz === "ET" ? 0 : edgeTzOffset(tz.timeZone) - edgeTzOffset(EDGE_TZ.ET);
  const doTime = s.tz !== "ET";
  const doOdds = s.odds !== "american";
  if (!root || (!doTime && !doOdds)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(n.parentNode.nodeName)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    let text = n.nodeValue;
    if (doTime && text.includes("ET")) {
      text = text.replace(EDGE_TIME_RE, (m, day, rest, comma, h, min, ap) => {
        let mins = (Number(h) % 12 + (ap === "PM" ? 12 : 0)) * 60 + Number(min) + shift;
        let dayShift = 0;
        if (mins < 0) { mins += 1440; dayShift = -1; }
        if (mins >= 1440) { mins -= 1440; dayShift = 1; }
        const hh = Math.floor(mins / 60), mm = String(mins % 60).padStart(2, "0");
        let out = `${hh % 12 || 12}:${mm} ${hh < 12 ? "AM" : "PM"} ${tz.label}`;
        if (day) {
          const i = (EDGE_DAYS.findIndex(d => d.startsWith(day)) + dayShift + 7) % 7;
          const name = rest ? EDGE_DAYS[i] : EDGE_DAYS[i].slice(0, 3);
          out = `${name}${comma} ${out}`;
        }
        return out;
      });
    }
    if (doOdds) {
      text = text.replace(EDGE_ODDS_RE, (m, pre, sign, num) => pre + edgeOdds((sign === "+" ? 1 : -1) * Number(num)));
    }
    if (text !== n.nodeValue) n.nodeValue = text;
  });
}

function edgeApplyTheme() {
  const t = edgeSettings().theme;
  const light = t === "light" || (t === "device" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

// ---------- Stadium hero ----------
// Every page's masthead is a stadium under lights, drawn on a canvas: a
// ballpark on the home page and MLB, an open-air stadium for football and
// soccer, an indoor arena with ice or hardwood for hockey and basketball.
// Seeded random, so the crowd and grain are the same on every visit.

function edgeStadiumKind(sport) {
  const s = String(sport || "").toUpperCase();
  if (s === "NHL") return "ice";
  if (s === "NBA" || s === "CBB") return "court";
  if (s === "NFL" || s === "CFB") return "gridiron";
  if (s === "SOCCER") return "pitch";
  return "park";
}

function edgeStadium(c, kind) {
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const x = c.getContext("2d"); x.scale(dpr, dpr);
  const W = r.width, H = r.height, hz = H * (kind === "park" || kind === "pitch" || kind === "gridiron" ? 0.5 : 0.46);
  const indoor = kind === "ice" || kind === "court";
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let g = x.createLinearGradient(0, 0, 0, hz);
  if (indoor) { g.addColorStop(0, "#07090A"); g.addColorStop(0.7, "#141A1C"); g.addColorStop(1, "#2A2620"); }
  else { g.addColorStop(0, "#0B1418"); g.addColorStop(0.55, "#1D2A33"); g.addColorStop(0.85, "#6B4A3A"); g.addColorStop(1, "#C98A55"); }
  x.fillStyle = g; x.fillRect(0, 0, W, hz + 2);
  if (indoor) {
    // roof trusses
    x.strokeStyle = "rgba(242,238,230,.06)"; x.lineWidth = 1;
    for (let i = 0; i <= 14; i++) { x.beginPath(); x.moveTo(W * i / 14, 0); x.lineTo(W * 0.5 + (i - 7) * W * 0.03, hz - 90); x.stroke(); }
    // scoreboard
    const sw = Math.min(160, W * 0.18);
    x.fillStyle = "#0C100E"; x.fillRect(W / 2 - sw / 2, H * 0.06, sw, sw * 0.42);
    x.fillStyle = "rgba(229,157,114,.55)"; x.fillRect(W / 2 - sw / 2 + 6, H * 0.06 + 6, sw - 12, 3);
  } else {
    x.fillStyle = "#2A2F33";
    x.beginPath(); x.moveTo(0, hz);
    for (let i = 0; i <= 12; i++) x.lineTo(W * i / 12, hz - 20 - Math.sin(i * 1.7) * 14 - Math.cos(i * 0.9) * 10);
    x.lineTo(W, hz); x.fill();
  }
  // the stands, a long low bowl, and the crowd in them
  g = x.createLinearGradient(0, hz - 70, 0, hz + 30); g.addColorStop(0, "#1B2420"); g.addColorStop(1, "#0F1613");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(-20, hz + 30); x.lineTo(-20, hz - 30);
  x.quadraticCurveTo(W * 0.5, hz - (indoor ? 150 : 110), W + 20, hz - 30); x.lineTo(W + 20, hz + 30); x.fill();
  const crowd = Math.min(2600, W * 1.2);
  for (let i = 0; i < crowd; i++) {
    const px = rnd() * W, t = px / W, top = hz - 30 - Math.sin(t * Math.PI) * (indoor ? 105 : 70);
    const py = top + rnd() * (hz + 26 - top);
    x.fillStyle = `rgba(${200 + rnd() * 55},${170 + rnd() * 60},${140 + rnd() * 60},${0.08 + rnd() * 0.22})`;
    x.fillRect(px, py, 1.2, 1.2);
  }
  // the playing surface
  const top = hz + 20;
  if (kind === "ice") {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#9FB3BC"); g.addColorStop(1, "#56666C");
  } else if (kind === "court") {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#8A6440"); g.addColorStop(1, "#3E2A19");
  } else {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#2E5A33"); g.addColorStop(1, "#14301B");
  }
  x.fillStyle = g; x.fillRect(0, top, W, H);
  const stripe = (w0, w1, a, b) => {
    for (let i = -14; i < 26; i++) {
      x.fillStyle = i % 2 ? a : b;
      x.beginPath();
      x.moveTo(W * 0.5 + i * w0, top); x.lineTo(W * 0.5 + (i + 1) * w0, top);
      x.lineTo(W * 0.5 + (i + 1) * w1, H); x.lineTo(W * 0.5 + i * w1, H); x.fill();
    }
  };
  if (kind === "court") stripe(14, 90, "rgba(255,255,255,.025)", "rgba(0,0,0,.05)");
  else if (kind !== "ice") stripe(40, 260, "rgba(255,255,255,.035)", "rgba(0,0,0,.05)");
  // a horizon-to-viewer line at fraction f across the field, in perspective
  const across = (f, color, w) => {
    const y = top + (H - top) * f;
    x.strokeStyle = color; x.lineWidth = w || 1.2;
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
  };
  const line = "rgba(242,238,230,.24)";
  if (kind === "park") {
    x.strokeStyle = line; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(W * 0.5, H * 0.98); x.lineTo(W * 0.05, hz + 40); x.moveTo(W * 0.5, H * 0.98); x.lineTo(W * 0.95, hz + 40); x.stroke();
    x.fillStyle = "rgba(160,104,64,.55)";
    x.beginPath(); x.ellipse(W * 0.5, H * 0.9, W * 0.2, H * 0.12, 0, Math.PI, 2 * Math.PI); x.fill();
  } else if (kind === "pitch") {
    [0.08, 0.2, 0.36, 0.58, 0.86].forEach(f => across(f, line, 1 + f));
    x.strokeStyle = line; x.lineWidth = 1.4;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.36, W * 0.09, (H - top) * 0.07, 0, 0, 2 * Math.PI); x.stroke();
  } else if (kind === "gridiron") {
    // the field seen from behind the near end zone: sidelines narrowing toward the far one,
    // yard lines every five yards between them, hash marks and the yard numbers
    const half = f => W * (0.14 + 0.76 * f), yAt = f => top + (H - top) * f;
    const fy = i => 0.07 + 0.93 * Math.pow(i / 20, 1.5);
    x.fillStyle = "rgba(6,18,10,.35)";
    x.beginPath(); x.moveTo(0, top); x.lineTo(W / 2 - half(0), top); x.lineTo(W / 2 - half(1), yAt(1)); x.lineTo(0, yAt(1)); x.fill();
    x.beginPath(); x.moveTo(W, top); x.lineTo(W / 2 + half(0), top); x.lineTo(W / 2 + half(1), yAt(1)); x.lineTo(W, yAt(1)); x.fill();
    x.strokeStyle = line; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(W / 2 - half(0), top); x.lineTo(W / 2 - half(1), yAt(1)); x.moveTo(W / 2 + half(0), top); x.lineTo(W / 2 + half(1), yAt(1)); x.stroke();
    for (let i = 0; i <= 20; i++) {
      const f = fy(i), y = yAt(f), h = half(f);
      x.strokeStyle = line; x.lineWidth = (i % 2 ? 0.7 : 1.3) * (0.6 + f);
      x.beginPath(); x.moveTo(W / 2 - h, y); x.lineTo(W / 2 + h, y); x.stroke();
      if (i % 2 === 0 && i > 0 && i < 20) {
        const yd = Math.min(i * 5, 100 - i * 5);
        x.fillStyle = "rgba(242,238,230,.28)"; x.font = `600 ${Math.round(6 + 26 * f)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "bottom";
        x.fillText(String(yd), W / 2 - h * 0.8, y - 2); x.fillText(String(yd), W / 2 + h * 0.8, y - 2);
      }
      if (i < 20) {
        const f2 = fy(i + 0.5), y2 = yAt(f2), hx = half(f2) * 0.22, len = 2 + 6 * f2;
        x.lineWidth = 1;
        x.beginPath(); x.moveTo(W / 2 - hx, y2 - len / 2); x.lineTo(W / 2 - hx, y2 + len / 2);
        x.moveTo(W / 2 + hx, y2 - len / 2); x.lineTo(W / 2 + hx, y2 + len / 2); x.stroke();
      }
    }
  } else if (kind === "ice") {
    across(0.42, "rgba(176,40,40,.65)", 4);
    across(0.18, "rgba(40,80,170,.55)", 3);
    across(0.78, "rgba(40,80,170,.55)", 4);
    x.strokeStyle = "rgba(176,40,40,.6)"; x.lineWidth = 2;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.42, W * 0.08, (H - top) * 0.09, 0, 0, 2 * Math.PI); x.stroke();
  } else if (kind === "court") {
    across(0.4, line, 2);
    x.strokeStyle = line; x.lineWidth = 2;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.4, W * 0.07, (H - top) * 0.1, 0, 0, 2 * Math.PI); x.stroke();
    x.beginPath(); x.ellipse(W * 0.5, H * 1.02, W * 0.28, (H - top) * 0.32, 0, Math.PI, 2 * Math.PI); x.stroke();
  }
  // light towers outdoors, a ring of lamps indoors, each with its glow
  const lamps = indoor ? [[0.2, 0.2], [0.4, 0.14], [0.6, 0.14], [0.8, 0.2]] : [[0.12, 0.16], [0.3, 0.1], [0.7, 0.1], [0.88, 0.16]];
  lamps.forEach(([fx, fy]) => {
    const lx = W * fx, ly = H * fy;
    const glow = x.createRadialGradient(lx, ly, 0, lx, ly, W * (indoor ? 0.16 : 0.22));
    glow.addColorStop(0, "rgba(255,240,205,.55)"); glow.addColorStop(0.12, "rgba(255,226,170,.18)"); glow.addColorStop(1, "rgba(255,220,160,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    x.fillStyle = "#FFF6E2";
    if (indoor) { x.fillRect(lx - 9, ly - 2, 18, 4); return; }
    x.fillStyle = "#0C110F"; x.fillRect(lx - 1.5, ly, 3, hz - ly);
    x.fillStyle = "#FFF6E2";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(lx - 14 + i * 7.5, ly - 8 + j * 6, 5, 4);
  });
  // haze and film grain
  g = x.createLinearGradient(0, hz - 60, 0, hz + 80); g.addColorStop(0, "rgba(255,230,190,0)"); g.addColorStop(0.5, "rgba(255,230,190,.10)"); g.addColorStop(1, "rgba(255,230,190,0)");
  x.fillStyle = g; x.fillRect(0, hz - 60, W, 140);
  const grain = Math.min(30000, W * H / 90);
  for (let i = 0; i < grain; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; x.fillRect(rnd() * W, rnd() * H, 1, 1); }
}

function initStadium() {
  const head = document.querySelector("header.masthead");
  if (!head || head.querySelector("canvas.stadium")) return;
  const c = document.createElement("canvas");
  c.className = "stadium";
  c.setAttribute("aria-hidden", "true");
  head.prepend(c);
  const kind = edgeStadiumKind(head.dataset.sport);
  const draw = () => edgeStadium(c, kind);
  draw();
  let w = c.clientWidth, timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (c.clientWidth !== w) { w = c.clientWidth; draw(); } }, 150);
  });
}

function initSiteSettings() {
  edgeApplyTheme();
  initStadium();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", edgeApplyTheme);
  if (document.body) {
    edgeLocalize(document.body);
    // Pages that draw parts with script (the home page, Schedule) get the same.
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 || n.nodeType === 3) edgeLocalize(n.nodeType === 1 ? n : n.parentNode);
    }))).observe(document.body, { childList: true, subtree: true });
  }
  // Sport pages keep it in the top bar; the home page in its own nav.
  const bar = document.querySelector(".topbar-inner") || document.querySelector("nav.nav");
  if (!bar || bar.querySelector(".ticker-gear")) return;
  const wrap = edgeNode("div", "ticker-settings");
  const btn = edgeNode("button", "ticker-gear");
  btn.type = "button";
  btn.setAttribute("aria-label", "Settings");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "ticker-panel");
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  const panel = edgeNode("div", "ticker-panel");
  panel.id = "ticker-panel";
  panel.hidden = true;
  panel.append(edgeNode("div", "ticker-panel-title", "Settings"));
  const settings = edgeSettings();
  const save = (k, v) => {
    settings[k] = v;
    edgeStore(EDGE_SETTINGS_KEY, settings);
    if (k === "homeLayout") {
      try {
        if (v === "auto") localStorage.removeItem("edge-home-layout");
        else localStorage.setItem("edge-home-layout", v);
      } catch (e) { /* storage blocked */ }
    }
    if (k === "theme") edgeApplyTheme();
    // Times and prices are already rewritten in the page, so redraw it.
    if (k === "tz" || k === "odds" || ((k === "homeLayout" || k === "homeDay") && document.getElementById("hg-out"))) {
      location.reload();
      return;
    }
    edgeRenderTicker();
  };
  window.addEventListener("edge-favs-change", () => edgeRenderTicker());
  EDGE_SETTINGS.forEach(s => {
    if (s.group) { panel.append(edgeNode("div", "ticker-panel-sub", s.group)); return; }
    if (s.button === "pickTeams") {
      const b = edgeNode("button", "ticker-teams-btn");
      b.type = "button";
      const count = () => { const n = edgeFavs().size; b.textContent = n ? `★ ${s.label} (${n})` : `☆ ${s.label}`; };
      count();
      window.addEventListener("edge-favs-change", count);
      b.addEventListener("click", () => { setOpen(false); edgeOpenTeamPicker(); });
      panel.append(b);
      return;
    }
    if (s.link) {
      // Pages on this site open in the same tab; other sites open in a new one.
      const local = s.link.startsWith("/");
      const a = edgeNode("a", "ticker-teams-btn", local ? s.label : s.label + " \u2197");
      a.href = s.link;
      if (!local) {
        a.target = "_blank";
        a.rel = "noopener";
      }
      panel.append(a);
      return;
    }
    if (s.choices) {
      const row = edgeNode("label", "ticker-choice");
      row.append(edgeNode("span", "ticker-switch-label", s.label));
      const sel = edgeNode("select");
      s.choices.forEach(([v, text]) => {
        const o = edgeNode("option", null, text);
        o.value = v;
        sel.append(o);
      });
      sel.value = settings[s.k];
      sel.addEventListener("change", () => save(s.k, sel.value));
      row.append(sel);
      panel.append(row);
      return;
    }
    const row = edgeNode("label", "ticker-switch");
    const text = edgeNode("span", "ticker-switch-text");
    text.append(edgeNode("span", "ticker-switch-label", s.label));
    if (s.sub) text.append(edgeNode("span", "ticker-switch-sub", s.sub));
    const input = edgeNode("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = settings[s.k];
    input.addEventListener("change", () => save(s.k, input.checked));
    row.append(text, input, edgeNode("span", "ticker-switch-knob"));
    panel.append(row);
  });
  const setOpen = open => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", e => { if (!wrap.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });
  wrap.append(btn, panel);
  bar.append(wrap);
}

function edgeGameStatus(g) {
  if (g.state !== "pre") return g.detail || (g.state === "post" ? "Final" : "Live");
  const d = new Date(g.start);
  if (isNaN(d)) return "";
  const tz = edgeTz();
  const opts = { timeZone: tz.timeZone };
  const day = d.toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const today = new Date().toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
  return (day === today ? "" : day + " ") + time + " " + tz.label;
}

// --- Score ticker and scoring plays ---
// What a score is called, by sport and points scored.
function edgeScoreWord(sport, pts) {
  if (sport === "NFL" || sport === "CFB") {
    return { 6: "Touchdown", 7: "Touchdown", 8: "Touchdown", 3: "Field goal", 2: "2 points", 1: "Extra point" }[pts] || `+${pts}`;
  }
  if (sport === "MLB") return pts === 1 ? "Run scores" : `${pts} runs score`;
  if (sport === "NHL") return pts === 1 ? "Goal" : `${pts} goals`;
  return `+${pts}`;
}

// A short two-note chime (when turned on in settings). Browsers allow sound
// only after the visitor has tapped the page, so it can stay quiet until then.
function edgeChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    edgeTicker.audio = edgeTicker.audio || new Ctx();
    const ctx = edgeTicker.audio;
    if (ctx.state === "suspended") ctx.resume();
    [[880, 0], [1320, 0.14]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
  } catch (e) { /* no sound available */ }
}

// A pop-up when a team scores (off unless turned on in settings): the
// scoring team in its color, the new score and the game clock.
function edgeScoreToast(play) {
  if (document.hidden) return;
  if (!edgeTicker.toasts || !edgeTicker.toasts.isConnected) {
    edgeTicker.toasts = edgeNode("div", "score-toasts");
    edgeTicker.toasts.setAttribute("aria-live", "polite");
    document.body.append(edgeTicker.toasts);
  }
  const toast = edgeNode("a", "score-toast");
  toast.href = play.href;
  if (play.color) toast.style.setProperty("--team", play.color);
  const head = edgeNode("span", "score-toast-head");
  head.append(edgeNode("span", "score-toast-sport", play.sport), edgeNode("span", "score-toast-what", play.what));
  const main = edgeNode("span", "score-toast-main");
  if (play.logo) {
    const img = edgeNode("img", "score-toast-logo");
    img.src = play.logo;
    img.alt = "";
    main.append(img);
  }
  main.append(edgeNode("span", "score-toast-team", `${play.team} score!`));
  const line = edgeNode("span", "score-toast-line");
  line.append(edgeNode("b", null, play.score));
  if (play.clock) line.append(edgeNode("span", "score-toast-clock", play.clock));
  toast.append(head, main, line);
  const close = edgeNode("button", "score-toast-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.addEventListener("click", e => { e.preventDefault(); toast.remove(); });
  toast.append(close);
  edgeTicker.toasts.prepend(toast);
  while (edgeTicker.toasts.children.length > 3) edgeTicker.toasts.lastChild.remove();
  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 400);
  }, 6000);
}

// One scrolling bar (the ticker or the red scoring-plays bar). Its items run
// twice in a row and slide left forever. Where the bar is (how far it has
// scrolled, and when) is saved as the page runs and as it closes, and every
// rebuild or new page carries on from there, so a score update or moving to
// another tab doesn't start it over.
function edgeCrawl(cls, label, items) {
  let bar = document.querySelector("." + cls);
  if (!items.length) {
    if (bar) bar.hidden = true;
    return;
  }
  if (!bar) {
    bar = edgeNode("aside", "crawl " + cls);
    const anchor = (cls === "crawl-plays" && document.querySelector(".crawl-ticker")) || document.querySelector(".topbar");
    if (!anchor) return;
    anchor.after(bar);
  }
  edgeCrawlSave(cls);
  bar.setAttribute("aria-label", label);
  bar.hidden = false;
  const tag = edgeNode("span", "crawl-tag", label);
  const view = edgeNode("div", "crawl-view");
  const run = edgeNode("div", "crawl-run");
  [0, 1].forEach(copy => items.forEach(make => {
    const item = make();
    if (copy) item.setAttribute("aria-hidden", "true");
    run.append(item);
  }));
  view.append(run);
  bar.replaceChildren(tag, view);
  const width = run.scrollWidth / 2;
  const secs = Math.max(15, width / (EDGE_SPEED[edgeSettings().speed] || EDGE_SPEED.normal));
  const saved = (edgeStore(EDGE_CRAWL_KEY) || {})[cls];
  // Pixels scrolled so far: the saved spot plus the time since it was saved.
  const px = saved ? saved.px + Math.max(0, Date.now() - saved.t) / 1000 * (width / secs) : 0;
  run.style.animationDuration = secs + "s";
  run.style.animationDelay = -((px % width) / width * secs) + "s";
  if (!edgeTicker.crawlSaving) {
    edgeTicker.crawlSaving = true;
    const saveAll = () => ["crawl-ticker", "crawl-plays"].forEach(edgeCrawlSave);
    setInterval(saveAll, 1000);
    addEventListener("pagehide", saveAll);
    document.addEventListener("visibilitychange", saveAll);
  }
}

// Saves how far a bar has scrolled right now (shared by every page on this
// device).
function edgeCrawlSave(cls) {
  const run = document.querySelector(`.${cls}:not([hidden]) .crawl-run`);
  if (!run || !run.style.animationDuration) return;
  const width = run.scrollWidth / 2;
  const x = -new DOMMatrixReadOnly(getComputedStyle(run).transform).m41;
  if (!width || !Number.isFinite(x)) return;
  const all = edgeStore(EDGE_CRAWL_KEY) || {};
  all[cls] = { px: x, t: Date.now() };
  edgeStore(EDGE_CRAWL_KEY, all);
}

// --- Live win chance for football (the score ticker and the game page's Live card) ---
const GL_LEN = 3600;  // regulation seconds

// Seconds left in regulation after a play ("mm:ss" in period p), 0 in overtime.
function glLeft(period, clock) {
  const [m, s] = String(clock || "0:00").split(":").map(Number);
  const secs = (m || 0) * 60 + (s || 0);
  return period > 4 ? 0 : Math.max(0, (4 - period) * 900 + secs);
}

// Home team's win chance: the rest of the game as our line scaled to the time
// left (the same bell curve as How it could end), plus about what the drive
// in progress is worth from where the ball is.
function glHomeWin(margin, left, homeBall, toGo, mu, sd, ot) {
  let mean = margin;
  if (homeBall != null && toGo != null) {
    const ep = Math.max(-1, Math.min(6, 6 - 0.07 * toGo));
    mean += homeBall ? ep : -ep;
  }
  const f = ot ? 0.08 : left / GL_LEN;
  mean += mu * f;
  const spread = sd * Math.sqrt(f);
  if (spread < 0.3) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const z = mean / spread;
  // Normal CDF (Abramowitz-Stegun).
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// A live NFL or CFB game's win chance for our pick, from the score, clock and
// ball in ESPN's scoreboard and our pregame line (pick.live, written by the
// football build): {team, pct}, or null when the game isn't live or has no line.
function edgeLiveChance(g) {
  const line = g && g.pick && g.pick.live;
  if (!line || g.state !== "in" || g.away.score == null || g.home.score == null || !line.sd) return null;
  const toGo = g.ball ? (g.ball.home ? 100 - g.ball.yardLine : g.ball.yardLine) : null;
  const h = glHomeWin(g.home.score - g.away.score, glLeft(g.period || 1, g.clock), g.ball ? g.ball.home : null,
                      toGo, line.margin, line.sd, (g.period || 0) > 4);
  const p = line.pick_home ? h : 1 - h;
  return { team: line.team, pct: Math.round(Math.min(0.99, Math.max(0.01, p)) * 100) };
}

// A game's own page on our site when it has one, else the sport's schedule.
function edgeGameHref(site, g) {
  return g && g.url ? site.href.replace(/index\.html$/, "") + g.url : site.schedule;
}

function edgeTickerItem(site, g, mine) {
  return () => {
    const a = edgeNode("a", "crawl-item" + (g.state === "in" ? " is-live" : ""));
    a.href = edgeGameHref(site, g);
    a.append(edgeNode("span", "crawl-sport", (mine ? "\u2605 " : "") + site.sport));
    [g.away, g.home].forEach(t => {
      const team = edgeNode("span", "crawl-team" + (g.state === "post" && t.winner ? " is-winner" : "") +
                            (edgeTicker.flash.has(`${site.sport}:${g.id}:${t === g.away ? "away" : "home"}`) ? " just-scored" : ""));
      if (t.logo) {
        const img = edgeNode("img", "crawl-logo");
        img.src = t.logo;
        img.alt = "";
        team.append(img);
      }
      if (t.rank) team.append(edgeNode("span", "crawl-rank", String(t.rank)));
      team.append(edgeNode("span", null, edgeTeamLabel(site.sport, t)));
      if (g.state !== "pre" && t.score != null) team.append(edgeNode("b", null, String(t.score)));
      a.append(team);
    });
    a.append(edgeNode("span", "crawl-status", edgeGameStatus(g)));
    const liveNow = edgeLiveChance(g);
    if (edgeSettings().picks && liveNow) {
      const pick = edgeNode("span", "crawl-pick is-live");
      pick.append(edgeNode("span", null, `Our win chance: ${edgeTeamOf(site.sport, g, liveNow.team)} ${liveNow.pct}%`), edgeNode("span", "crawl-live", "LIVE"));
      a.append(pick);
    } else if (edgeSettings().picks && g.pick && g.pick.text) {
      const pick = edgeNode("span", "crawl-pick");
      pick.append(edgeNode("span", null, "Pick: " + edgeNameText(site.sport, g, g.pick.text)));
      const pill = edgeResultPill(g.pick.result, g.pick.labels);
      if (pill) pick.append(pill);
      a.append(pick);
    }
    return a;
  };
}

function edgePlayItem(play) {
  return () => {
    const a = edgeNode("a", "crawl-item play-item");
    a.href = play.href;
    a.append(edgeNode("span", "crawl-sport", play.sport), edgeNode("b", "play-what", play.what),
             edgeNode("span", "play-score", play.score));
    if (play.clock) a.append(edgeNode("span", "crawl-status", play.clock));
    if (play.text) a.append(edgeNode("span", "play-text", play.text));
    return a;
  };
}

// --- My teams: favorite teams in any league ("NFL:KC"), saved per device ---
// Picked from the gear menu or the home page's "My teams" button, or starred on
// a home game card. Keys use ESPN's abbreviations; a few of our data sources
// spell some teams differently, so those are mapped onto ESPN's.
const EDGE_FAV_KEY = "edge-favs";
const EDGE_FAV_ALIAS = { "MLB:AZ": "MLB:ARI", "MLB:CWS": "MLB:CHW", "NFL:LA": "NFL:LAR", "NFL:WAS": "NFL:WSH" };
// ESPN team lists per sport: [path, query] for each list.
const EDGE_TEAM_LISTS = {
  NFL: [["football/nfl", ""]],
  CFB: [["football/college-football", "limit=1000"]],
  MLB: [["baseball/mlb", ""]],
  NBA: [["basketball/nba", ""]],
  NHL: [["hockey/nhl", ""]],
  CBB: [["basketball/mens-college-basketball", "groups=50&limit=500"]],
  Soccer: [["soccer/eng.1", ""], ["soccer/esp.1", ""], ["soccer/uefa.champions", ""]],
};
const EDGE_TEAM_SPORT_NAMES = { CFB: "College football", CBB: "College basketball" };

function edgeFavKey(sport, abbr) {
  const k = `${sport}:${abbr}`;
  return EDGE_FAV_ALIAS[k] || k;
}

// Soccer favorites saved under ESPN's old abbreviations, moved once to ours
// (old "MUN" was Bayern, so this can't be a plain alias).
const EDGE_SOCCER_FAV_MOVES = { MAN: "MUN", MNC: "MCI", MUN: "FCB", DOR: "BVB", VFB: "STU", MCF: "MAL", LILL: "LIL",
  RCL: "LEN", ROMA: "ROM", COMO: "COM", BODO: "BOD", FCP: "POR", SLP: "SLA", SLB: "SLO", VFK: "VIK" };
function edgeMoveSoccerFavs(favs) {
  if (edgeStore("edge-favs-soccer-v2")) return favs;
  const moved = favs.map(k => k.startsWith("Soccer:") && EDGE_SOCCER_FAV_MOVES[k.slice(7)] ? "Soccer:" + EDGE_SOCCER_FAV_MOVES[k.slice(7)] : k);
  if (favs.length) edgeStore(EDGE_FAV_KEY, moved);
  edgeStore("edge-favs-soccer-v2", 1);
  return moved;
}

function edgeFavs() {
  const favs = edgeStore(EDGE_FAV_KEY);
  return new Set(edgeMoveSoccerFavs(Array.isArray(favs) ? favs : []).map(k => EDGE_FAV_ALIAS[k] || k));
}

function edgeIsFav(sport, ...abbrs) {
  const favs = edgeFavs();
  return abbrs.some(a => a && favs.has(edgeFavKey(sport, a)));
}

function edgeSetFav(sport, abbr, on) {
  const favs = edgeFavs();
  const k = edgeFavKey(sport, abbr);
  if (on) favs.add(k); else favs.delete(k);
  edgeStore(EDGE_FAV_KEY, [...favs]);
  window.dispatchEvent(new CustomEvent("edge-favs-change"));
}

// Teams starred, for "My teams first" in the ticker. The ticker still shows
// every game; starred teams' games just come first.
function edgeMyTeams() {
  const settings = edgeSettings();
  if (!settings.myTeamsFirst) return null;
  const favs = edgeFavs();
  return favs.size ? favs : null;
}

// teams.json is built weekly from ESPN (shared/teams.py), since ESPN's team
// lists can't be read from the browser; ESPN is only a fallback.
const edgeTeamCache = {};
let edgeTeamFile = null;
async function edgeLoadTeams(sport) {
  if (!edgeTeamFile) edgeTeamFile = edgeFetchJson("/teams.json");
  const file = await edgeTeamFile;
  if (!file) edgeTeamFile = null;
  if (file && Array.isArray(file[sport]) && file[sport].length) return file[sport];
  if (!edgeTeamCache[sport]) {
    edgeTeamCache[sport] = Promise.all((EDGE_TEAM_LISTS[sport] || []).map(([path, q]) =>
      edgeFetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams${q ? "?" + q : ""}`, 8000)))
      .then(lists => {
        const seen = new Map();
        lists.forEach(data => {
          const teams = (((((data || {}).sports || [])[0] || {}).leagues || [])[0] || {}).teams || [];
          teams.forEach(({ team: t }) => {
            const abbr = t && edgeTeamAbbr(t);
            if (!abbr || seen.has(abbr)) return;
            seen.set(abbr, { abbr, name: t.displayName || t.shortDisplayName || abbr,
                                       logo: ((t.logos || [])[0] || {}).href || "" });
          });
        });
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
  }
  const teams = await edgeTeamCache[sport];
  if (!teams.length) delete edgeTeamCache[sport];  // try again next time
  return teams;
}

// A sheet to pick favorite teams: a tab per sport, a search box and every team.
function edgeOpenTeamPicker(startSport) {
  if (document.querySelector(".team-picker")) return;
  const sports = Object.keys(EDGE_TEAM_LISTS);
  let sport = sports.includes(startSport) ? startSport : sports[0];
  const opener = document.activeElement;
  const back = edgeNode("div", "team-picker");
  const box = edgeNode("div", "team-picker-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "My teams");
  const head = edgeNode("div", "team-picker-head");
  const close = edgeNode("button", "team-picker-close", "Done");
  close.type = "button";
  head.append(edgeNode("div", "team-picker-title", "My teams"), close);
  const note = edgeNode("p", "team-picker-note", "Star teams in any league. Their games go to the top of the home page, and the ticker can show only them.");
  const mine = edgeNode("div", "team-picker-mine");
  const tabs = edgeNode("div", "team-picker-tabs");
  tabs.setAttribute("role", "tablist");
  const search = edgeNode("input", "team-picker-search");
  search.type = "search";
  search.placeholder = "Search teams";
  search.setAttribute("aria-label", "Search teams");
  const list = edgeNode("div", "team-picker-list");
  box.append(head, note, mine, tabs, search, list);
  back.append(box);

  const drawMine = () => {
    const favs = [...edgeFavs()];
    mine.replaceChildren();
    if (!favs.length) { mine.append(edgeNode("span", "team-picker-none", "No teams yet.")); return; }
    favs.sort().forEach(k => {
      const [sp, abbr] = k.split(":");
      const chip = edgeNode("button", "team-picker-chip", `${sp === "Soccer" ? "" : sp + " "}${abbr} ×`);
      chip.type = "button";
      chip.setAttribute("aria-label", `Remove ${sp} ${abbr}`);
      chip.addEventListener("click", () => { edgeSetFav(sp, abbr, false); drawMine(); drawList(); });
      mine.append(chip);
    });
  };
  let token = 0;
  const drawList = async () => {
    const mineToken = ++token;
    if (!list.childElementCount) { const p = edgeNode("p", "team-picker-none", "Loading teams."); p.dataset.loading = ""; list.append(p); }
    const teams = await edgeLoadTeams(sport);
    if (mineToken !== token) return;
    const q = search.value.trim().toLowerCase();
    const shown = teams.filter(t => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase() === q);
    list.replaceChildren();
    if (!teams.length) { list.append(edgeNode("p", "team-picker-none", "Couldn't load teams. Check your connection and try again.")); return; }
    if (!shown.length) { list.append(edgeNode("p", "team-picker-none", "No team matches that.")); return; }
    shown.forEach(t => {
      const on = edgeIsFav(sport, t.abbr);
      const b = edgeNode("button", "team-picker-team");
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      if (t.logo) {
        const img = edgeNode("img");
        img.src = t.logo; img.alt = ""; img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        b.append(img);
      }
      b.append(edgeNode("span", "team-picker-name", t.name), edgeNode("span", "team-picker-star", on ? "★" : "☆"));
      b.addEventListener("click", () => {
        const now = !edgeIsFav(sport, t.abbr);
        edgeSetFav(sport, t.abbr, now);
        b.setAttribute("aria-pressed", String(now));
        b.lastChild.textContent = now ? "★" : "☆";
        drawMine();
      });
      list.append(b);
    });
  };
  sports.forEach(sp => {
    const t = edgeNode("button", null, sp);
    t.type = "button";
    t.setAttribute("role", "tab");
    if (EDGE_TEAM_SPORT_NAMES[sp]) t.title = EDGE_TEAM_SPORT_NAMES[sp];
    t.setAttribute("aria-selected", String(sp === sport));
    t.addEventListener("click", () => {
      sport = sp;
      tabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", String(x === t)));
      search.value = "";
      list.replaceChildren();
      drawList();
    });
    tabs.append(t);
  });
  search.addEventListener("input", drawList);
  const done = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("team-picker-open");
    if (opener && opener.focus) opener.focus();
  };
  const onKey = e => { if (e.key === "Escape") done(); };
  close.addEventListener("click", done);
  back.addEventListener("click", e => { if (e.target === back) done(); });
  document.addEventListener("keydown", onKey);
  document.documentElement.classList.add("team-picker-open");
  document.body.append(back);
  drawMine();
  drawList();
  close.focus();
}

function edgeRenderTicker() {
  const settings = edgeSettings();
  const mine = edgeMyTeams();
  const t = g => new Date(g.start).getTime() || 0;
  const items = [];
  const later = [];
  const isMine = (sport, g) => mine && (mine.has(edgeFavKey(sport, g.away.abbr)) || mine.has(edgeFavKey(sport, g.home.abbr)));
  // My teams' games first, then live games, games still to play, finals.
  (settings.liveOnly ? ["in"] : ["in", "pre", "post"]).forEach(state => {
    EDGE_TICKER_SPORTS.forEach(sport => {
      const slate = edgeTicker.slates[sport];
      if (!settings[sport] || !slate) return;
      const site = EDGE_SITES.find(s => s.sport === sport);
      slate.games.filter(g => g.state === state)
        .sort((a, b) => (state === "post" ? t(b) - t(a) : t(a) - t(b)))
        .forEach(g => (isMine(sport, g) ? items : later).push(edgeTickerItem(site, g, isMine(sport, g))));
    });
  });
  edgeCrawl("crawl-ticker", "Scores", settings.ticker ? items.concat(later) : []);
  const plays = edgeTicker.plays.filter(p => settings[p.sport]).map(edgePlayItem);
  edgeCrawl("crawl-plays", "Scoring", settings.plays ? plays : []);
}

// Sports whose red-bar entries are standout finals instead of every score.
const EDGE_FINALS_ONLY = ["NBA"];
// The red bar stays short: one line per game, the newest few games only.
const EDGE_PLAYS_MAX = 6;
// ESPN's "last play" is often a later, non-scoring play ("X pitches to Y");
// it is shown only when it reads like the score itself.
const EDGE_SCORING_TEXT = /\b(homer(s|ed)?|home run|grand slam|scores?|scored|runs? in|walk-off|sacrifice fly|touchdown|field goal|safety|extra point|two-point|goal)\b/i;
const edgePlayGame = p => p.id.split(":").slice(0, 2).join(":");

// A basketball final worth a line in the red bar: a blowout (20+ points), a
// big scoring night for a team (130+) or a player (40+), or overtime. Only
// games that started in the last 4 hours, so an old final doesn't come back
// after its line has expired.
function edgeStandout(site, g) {
  if (g.state !== "post" || g.away.score == null || g.home.score == null) return null;
  if (Date.now() - new Date(g.start).getTime() > 4 * 3600000) return null;
  const [win, lose] = g.away.score > g.home.score ? [g.away, g.home] : [g.home, g.away];
  const notes = [];
  if (/OT/.test(g.detail || "")) notes.push(g.detail.replace(/^Final\/?/i, "").trim() || "OT");
  if (win.score - lose.score >= 20) notes.push(`Won by ${win.score - lose.score}`);
  const nm = t => edgeTeamLabel(site.sport, t);
  [win, lose].filter(t => t.score >= 130).forEach(t => notes.push(`${nm(t)} scored ${t.score}`));
  const stars = [g.away, g.home].map(t => t.leader).filter(l => l && l.pts >= 40);
  stars.forEach(l => notes.push(`${l.name} ${l.pts} pts`));
  if (!notes.length) return null;
  const what = stars.length ? `${stars[0].pts}-point night` : /OT/.test(g.detail || "") ? "Overtime final" : win.score - lose.score >= 20 ? "Blowout" : "Big final";
  return { id: `${site.sport}:${g.id}:final`, sport: site.sport, href: edgeGameHref(site, g), t: Date.now(),
           teams: [g.away.abbr, g.home.abbr], what, team: win.short || win.abbr, logo: win.logo, color: win.color,
           text: notes.join(" \u00b7 "), score: `${nm(win)} ${win.score}, ${nm(lose)} ${lose.score}`, clock: "Final" };
}

async function initScoreboard() {
  // The old strip is replaced by the two bars.
  document.querySelectorAll(".scoreboard").forEach(n => n.remove());
  const sites = EDGE_TICKER_SPORTS.map(sport => EDGE_SITES.find(s => s.sport === sport));
  const slates = await Promise.all(sites.map(edgeLoadGames));
  // Scores from the last read, kept across pages for 15 minutes so moving
  // between pages doesn't miss a score or count one twice.
  const saved = edgeStore(EDGE_SCORES_KEY);
  const last = saved && Date.now() - saved.t < 15 * 60000 ? saved.scores : null;
  const scores = Object.assign({}, last || {});
  const fresh = [];
  const finals = [];
  edgeTicker.flash = new Set();
  sites.forEach((site, i) => {
    const slate = slates[i];
    if (!slate) return;
    edgeTicker.slates[site.sport] = slate;
    // Compare only fresh reads from ESPN; a game that went final since the
    // last read (a walk-off) still counts.
    if (!slate.live) return;
    slate.games.forEach(g => {
      if (g.state === "pre") return;
      // Basketball scores too often for a play per basket: the red bar only
      // gets its big finals (see edgeStandout).
      if (EDGE_FINALS_ONLY.includes(site.sport)) {
        const standout = edgeStandout(site, g);
        if (standout) finals.push(standout);
        return;
      }
      ["away", "home"].forEach(side => {
        const key = `${site.sport}:${g.id}:${side}`;
        const now = g[side].score;
        const before = last ? last[key] : null;
        if (now != null) scores[key] = now;
        if (before == null || now == null || now <= before) return;
        edgeTicker.flash.add(key);
        const team = g[side];
        const other = g[side === "away" ? "home" : "away"];
        fresh.push({ id: `${key}:${now}`, sport: site.sport, href: edgeGameHref(site, g), t: Date.now(),
                     teams: [g.away.abbr, g.home.abbr],
                     what: edgeScoreWord(site.sport, now - before), team: team.short || team.abbr,
                     logo: team.logo, color: team.color, text: EDGE_SCORING_TEXT.test(g.lastPlay || "") ? g.lastPlay : "",
                     score: `${edgeTeamLabel(site.sport, team)} ${now}, ${edgeTeamLabel(site.sport, other)} ${other.score}`,
                     clock: g.state === "post" ? "Final" : g.detail });
      });
    });
  });
  edgeStore(EDGE_SCORES_KEY, { t: Date.now(), scores });
  // Scoring plays from the last 3 hours, newest first, kept across pages.
  // Lines saved by older versions (every basket, any last play) are dropped.
  const kept = (edgeStore(EDGE_PLAYS_KEY) || [])
    .filter(p => p && p.id && Date.now() - p.t < 3 * 3600000)
    .filter(p => !EDGE_FINALS_ONLY.includes(p.sport) || /:final$/.test(p.id))
    .map(p => Object.assign({}, p, { text: /:final$/.test(p.id) || EDGE_SCORING_TEXT.test(p.text || "") ? p.text : "" }));
  const newFinals = finals.filter(f => !kept.some(p => p.id === f.id));
  const seen = new Set();
  const plays = fresh.reverse().concat(newFinals, kept)
    .filter(p => !seen.has(edgePlayGame(p)) && seen.add(edgePlayGame(p)))
    .slice(0, EDGE_PLAYS_MAX);
  edgeStore(EDGE_PLAYS_KEY, plays);
  edgeTicker.plays = plays;
  edgeRenderTicker();
  const settings = edgeSettings();
  const shown = fresh.filter(p => settings[p.sport]);
  if (settings.popups) shown.slice(0, 3).forEach(edgeScoreToast);
  if (settings.sound && shown.length && !document.hidden) edgeChime();
  const now = Date.now();
  const all = slates.flatMap(s => (s ? s.games : []));
  if (all.some(g => g.state === "in")) setTimeout(initScoreboard, EDGE_LIVE_POLL);
  else if (all.some(g => g.state === "pre" && start(g) - now < EDGE_SOON && now - start(g) < EDGE_SOON)) setTimeout(initScoreboard, EDGE_IDLE_POLL);
  function start(g) { return new Date(g.start).getTime() || 0; }
}
initSiteSettings();
initScoreboard();

// --- Sport menu on phones (shared by every Edge site) ---
// Adds a menu button (the current sport and three lines) to the top bar; on
// phones the CSS hides the sport tabs behind it and drops them down as a list
// when it's tapped.
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

// --- Sport pages in the home page's layout (shared/chrome.py) ---
// The nav turns to paper once the stadium scrolls away, sits under the score
// bars however tall they are (--tick-h, --nav-h).
function initEdgeNav() {
  const nav = document.querySelector("nav.edge-nav");
  if (!nav) return;
  const hero = document.querySelector(".edge-hero");
  const solid = () => nav.classList.toggle("solid", !hero || scrollY > hero.offsetHeight - nav.offsetHeight - 30);
  addEventListener("scroll", solid, { passive: true });
  addEventListener("resize", solid);
  solid();
  const root = document.documentElement.style;
  const tick = document.querySelector(".edge-tick");
  const set = () => {
    if (tick) root.setProperty("--tick-h", tick.offsetHeight + "px");
    root.setProperty("--nav-h", nav.offsetHeight + "px");
  };
  const watch = new ResizeObserver(set);
  [tick, nav].forEach(el => el && watch.observe(el));
  set();
}
initEdgeNav();

// --- Motion and record helpers (home page and sport pages) ---
// Sliding tab highlight, rolling score digits, records that count up, and
// the per-day results (summary.json "daily": [[date, wins, losses], ...])
// behind trend lines, the record chart and the Model tab's results
// calendar. Streak badges read "ml_streak": winning or losing days (weeks for
// NFL/CFB) in a row. Every animation is skipped for prefers-reduced-motion.
const EDGE_REDUCE = matchMedia("(prefers-reduced-motion: reduce)");

// Puts a highlight behind (kind "pill") or under (kind "line") a button
// group's pressed button and slides it to the next one. Safe to call after
// the group's buttons are re-rendered: it starts from where it last was.
function edgeSlide(group, kind) {
  if (!group) return;
  group.classList.add("has-slide", kind === "line" ? "slide-line" : "slide-pill");
  let mark = group.querySelector(":scope > .slide-mark");
  if (!mark) {
    mark = edgeNode("span", "slide-mark");
    mark.setAttribute("aria-hidden", "true");
    if (group._slideAt) { mark.style.left = group._slideAt[0] + "px"; mark.style.width = group._slideAt[1] + "px"; }
    group.prepend(mark);
  }
  const place = () => {
    const b = group.querySelector('button[aria-pressed="true"]');
    if (!b || !b.offsetWidth) { mark.hidden = true; return; }
    mark.hidden = false;
    group._slideAt = [b.offsetLeft, b.offsetWidth];
    mark.style.left = b.offsetLeft + "px";
    mark.style.width = b.offsetWidth + "px";
  };
  void mark.offsetWidth;  // start the slide from the previous spot
  place();
  if (!group._slideBound) {
    group._slideBound = true;
    group.addEventListener("click", () => requestAnimationFrame(() => edgeSlide(group, kind)));
    window.addEventListener("resize", () => edgeSlide(group, kind));
    if (document.fonts) document.fonts.ready.then(() => edgeSlide(group, kind));
  }
}

// Sets el to a number, rolling each changed digit like a slot reel when it
// already showed a different number.
function edgeRoll(el, value) {
  const str = String(value);
  const was = el.dataset.roll;
  el.dataset.roll = str;
  el.setAttribute("aria-label", str);
  if (was === undefined || was === str || EDGE_REDUCE.matches || !/^\d+$/.test(str)) { el.textContent = str; return; }
  el.textContent = "";
  [...str].forEach((c, k) => {
    const slot = edgeNode("span", "roll");
    slot.setAttribute("aria-hidden", "true");
    const reel = edgeNode("span", "roll-reel");
    for (let d = 0; d <= 9; d++) reel.append(edgeNode("span", null, String(d)));
    const from = was.padStart(str.length, "0")[k];
    reel.style.transform = `translateY(${-Number(/\d/.test(from) ? from : 0)}em)`;
    slot.append(reel);
    el.append(slot);
    void reel.offsetWidth;
    reel.style.transitionDelay = k * 60 + "ms";
    reel.style.transform = `translateY(${-Number(c)}em)`;
  });
  el.classList.remove("roll-flash");
  void el.offsetWidth;
  el.classList.add("roll-flash");
}

// A "W-L" record that counts up from 0-0 the first time it's shown.
function edgeCountUp(el, wins, losses) {
  const end = `${wins}-${losses}`;
  if (EDGE_REDUCE.matches || el.dataset.counted) { el.textContent = end; return; }
  el.dataset.counted = "1";
  const t0 = performance.now(), dur = 1000;
  const step = t => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = p < 1 ? `${Math.round(wins * e)}-${Math.round(losses * e)}` : end;
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = "0-0";
  requestAnimationFrame(step);
}

// Running winning % after each day: [{date, pct, w, l}], oldest first. The
// first days, before EDGE_MIN_PICKS graded picks, are left out: a 1-0 or 0-1
// start (100% or 0%) would swamp the scale.
const EDGE_MIN_PICKS = 20;
function edgeRunning(daily) {
  let w = 0, l = 0;
  return (daily || []).map(([date, dw, dl]) => { w += dw; l += dl; return { date, w, l, pct: w / Math.max(1, w + l) }; })
    .filter(r => r.w + r.l >= EDGE_MIN_PICKS);
}

// A badge for summary.json "ml_streak" ({kind: "W"|"L", n, unit}): winning
// or losing days (weeks for NFL/CFB) in a row. null without one.
function edgeStreakBadge(s) {
  if (!s || !s.n) return null;
  const won = s.kind === "W";
  const b = edgeNode("span", "streak " + (won ? "is-w" : "is-l"), s.kind + s.n);
  const u = s.unit || "pick";
  b.title = `${s.n} ${won ? "winning" : "losing"} ${u}${s.n === 1 ? "" : "s"} in a row`;
  b.setAttribute("aria-label", b.title);
  return b;
}

// A small trend line of the running winning % over the last `days` days with
// a graded pick, its high and low on the left and a caption under it.
function edgeSpark(daily, days) {
  const run = edgeRunning(daily).slice(-(days || 30));
  if (run.length < 2) return null;
  const vals = run.map(r => r.pct);
  const lo = Math.max(0, Math.floor(Math.min(...vals) * 100) - 1) / 100, hi = Math.min(100, Math.ceil(Math.max(...vals) * 100) + 1) / 100;
  const x = i => 2 + i * (156 / (run.length - 1)), y = v => 32 - (v - lo) / (hi - lo) * 28;
  const line = run.map((r, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(r.pct).toFixed(1)).join("");
  const wrap = edgeNode("div", "spk");
  const axis = edgeNode("div", "spk-y");
  axis.append(edgeNode("span", null, Math.round(hi * 100) + "%"), edgeNode("span", null, Math.round(lo * 100) + "%"));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 160 34");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path class="spark-area" d="${line}L158 34L2 34Z"/><path class="spark-line" d="${line}" vector-effect="non-scaling-stroke"/>` +
                  `<circle class="spark-dot" cx="${x(run.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.6"/>`;
  wrap.append(axis, svg);
  const box = edgeNode("div", "spk-box");
  box.append(wrap, edgeNode("span", "spk-cap", `Winning %, last ${run.length} days with picks`));
  return box;
}

// --- Slate picker (home page and each sport's game board) ---
// One game at a time: a big number, the matchup, our pick, win chance and
// price, a line of text written from the numbers, and a drawing of the
// sport's field with both teams on it. Up to EDGE_SP_NUMBERED games are
// numbered squares; past that, a list grouped by start time. Games use the
// home page's shape: {key, sport, start, date, at, away/home: {abbr, name,
// logo, score}, pick, pickName, prob, price, book, value, state ("pre", "in"
// or "post"), hit, detail, url, why: [label, team it helps] or null}.
const EDGE_SP_NUMBERED = 12;

function edgeSpTime(g) {
  if (!g.start) return "";
  const tz = edgeTz();
  return new Date(g.start).toLocaleTimeString("en-US", { timeZone: tz.timeZone, hour: "numeric", minute: "2-digit" }) + " " + tz.label;
}

function edgeSpDay(g) {
  if (!g.start) return "";
  return new Date(g.start).toLocaleDateString("en-US", { timeZone: edgeTz().timeZone, weekday: "short" });
}

// What the text under the numbers says, from the numbers alone.
function edgePickNote(g) {
  const name = abbr => abbr === g.away.abbr ? g.away.name : abbr === g.home.abbr ? g.home.name : abbr;
  const lab = t => edgeTeamLabel(g.sport, t);
  const scored = g.away.score != null && g.home.score != null;
  const line = scored ? `${lab(g.away)} ${g.away.score}, ${lab(g.home)} ${g.home.score}` : "";
  if (!g.pick) return g.state === "pre" ? "No pick yet. Our pick posts once the model has this game's lineups and prices." : "We didn't post a pick for this game.";
  const pk = g.pick === "Draw" ? "a draw" : name(g.pick);
  if (g.hit === true) return `Final${line ? ": " + line : ""}. Our pick, ${pk}, hit.`;
  if (g.hit === false) return `Final${line ? ": " + line : ""}. Our pick, ${pk}, missed.`;
  if (g.state === "in" && scored) {
    if (g.pick === "Draw") return `Live: ${line}. We picked a draw.`;
    const ours = g.pick === g.away.abbr ? g.away.score : g.home.score;
    const theirs = g.pick === g.away.abbr ? g.home.score : g.away.score;
    return `Live${g.detail ? ", " + g.detail : ""}: ${line}. Our pick, ${pk}, is ${ours > theirs ? "ahead" : ours < theirs ? "behind" : "tied"}.`;
  }
  if (g.state === "post") return `Final${line ? ": " + line : ""}. Grading this one shortly.`;
  const p = g.prob.toFixed(0), them = g.pick === "Draw" ? "it" : "them";
  let s;
  if (g.book == null) s = `We have ${pk} at ${p}% to win. No price is posted yet, so there's nothing to compare it with.`;
  else {
    const gap = g.prob - g.book, b = g.book.toFixed(0);
    if (gap >= 2) s = `We like ${pk} more than Vegas does, ${p}% to ${b}%.`;
    else if (gap <= -2) s = `We pick ${pk} too, but Vegas likes ${them} more, ${b}% to our ${p}%.`;
    else s = `Vegas agrees with us on ${pk}, ${b}% to our ${p}%.`;
  }
  if (g.why && g.why[0]) s += ` The biggest factor is ${g.why[0].toLowerCase()}, which helps ${name(g.why[1])}.`;
  return s;
}

// The field, court, rink or pitch, drawn in an 800 x 500 box.
function edgeSpField(sport) {
  if (sport === "NHL") return `
    <rect class="sp-turf" x="120" y="110" width="560" height="290" rx="110"/>
    <line class="sp-red" x1="400" y1="110" x2="400" y2="400" stroke-width="3"/>
    <line class="sp-blue" x1="315" y1="110" x2="315" y2="400" stroke-width="5"/><line class="sp-blue" x1="485" y1="110" x2="485" y2="400" stroke-width="5"/>
    <line class="sp-red" x1="162" y1="122" x2="162" y2="388"/><line class="sp-red" x1="638" y1="122" x2="638" y2="388"/>
    <circle class="sp-line" cx="400" cy="255" r="42"/>
    <circle class="sp-line" cx="232" cy="185" r="30"/><circle class="sp-line" cx="232" cy="325" r="30"/>
    <circle class="sp-line" cx="568" cy="185" r="30"/><circle class="sp-line" cx="568" cy="325" r="30"/>
    <path class="sp-line" d="M162 235 a20 20 0 0 1 0 40"/><path class="sp-line" d="M638 235 a20 20 0 0 0 0 40"/>`;
  if (sport === "MLB") return `<g transform="translate(0 -34)">
    <path class="sp-turf" d="M400 450 L140 190 A370 370 0 0 1 660 190 Z"/>
    <path class="sp-dirt" d="M400 450 L292 342 L400 234 L508 342 Z"/>
    <circle class="sp-line" cx="400" cy="352" r="12"/>
    <path class="sp-line sp-dash" d="M252 302 A210 210 0 0 1 548 302"/>
    <rect class="sp-base" x="394" y="228" width="12" height="12"/><rect class="sp-base" x="502" y="336" width="12" height="12"/>
    <rect class="sp-base" x="286" y="336" width="12" height="12"/><path class="sp-base" d="M392 444 h16 v8 l-8 8 l-8 -8 z"/></g>`;
  if (sport === "Soccer") return `
    <rect class="sp-turf" x="110" y="100" width="580" height="310"/>
    <line class="sp-line" x1="400" y1="100" x2="400" y2="410"/><circle class="sp-line" cx="400" cy="255" r="48"/>
    <rect class="sp-line" x="110" y="172" width="84" height="166"/><rect class="sp-line" x="606" y="172" width="84" height="166"/>
    <rect class="sp-line" x="110" y="218" width="30" height="74"/><rect class="sp-line" x="660" y="218" width="30" height="74"/>
    <path class="sp-line" d="M194 226 a32 32 0 0 1 0 58"/><path class="sp-line" d="M606 226 a32 32 0 0 0 0 58"/>`;
  if (sport === "NBA" || sport === "CBB") return `
    <rect class="sp-wood" x="110" y="110" width="580" height="290"/>
    <line class="sp-line" x1="400" y1="110" x2="400" y2="400"/><circle class="sp-line" cx="400" cy="255" r="40"/>
    <rect class="sp-paint" x="110" y="205" width="120" height="100"/><rect class="sp-paint" x="570" y="205" width="120" height="100"/>
    <circle class="sp-line" cx="230" cy="255" r="40"/><circle class="sp-line" cx="570" cy="255" r="40"/>
    <path class="sp-line" d="M110 130 H223 A150 150 0 0 1 223 380 H110"/><path class="sp-line" d="M690 130 H577 A150 150 0 0 0 577 380 H690"/>
    <circle class="sp-red" cx="140" cy="255" r="7"/><circle class="sp-red" cx="660" cy="255" r="7"/>`;
  // NFL and CFB
  let yards = "";
  for (let i = 0; i <= 10; i++) {
    const x = 170 + i * 46;
    yards += `<line class="sp-line" x1="${x}" y1="120" x2="${x}" y2="390" stroke-width="${i === 5 ? 2.5 : 1.2}"/>`;
    if (i > 0 && i < 10) yards += `<text class="sp-yd" x="${x}" y="146" text-anchor="middle">${(i <= 5 ? i : 10 - i) * 10}</text>`;
  }
  return `<rect class="sp-turf" x="110" y="120" width="580" height="270"/>
    <rect class="sp-end" x="110" y="120" width="60" height="270"/><rect class="sp-end" x="630" y="120" width="60" height="270"/>${yards}`;
}

function edgeSpMarker(g, t, x, side) {
  const isPick = g.pick === t.abbr;
  const id = "spc" + Math.random().toString(36).slice(2, 8);
  // The abbreviation (college and soccer: the name, fitted to the circle)
  // sits under the logo, so it shows if the logo can't load.
  const short = t.abbr.length > 4 ? t.abbr.slice(0, 4).toUpperCase() : t.abbr;
  const art = (edgeNamesTeams(g.sport) ? edgeSvgName(edgeTeamLabel(g.sport, t), x, 255, 56, 15, "sp-abbr")
    : `<text class="sp-abbr" x="${x}" y="261" text-anchor="middle">${edgeEsc(short)}</text>`) + (t.logo
    ? `<clipPath id="${id}"><circle cx="${x}" cy="255" r="25"/></clipPath><image href="${edgeEsc(t.logo)}" x="${x - 25}" y="230" width="50" height="50" clip-path="url(#${id})" preserveAspectRatio="xMidYMid meet" onerror="this.remove()"/>`
    : "");
  const score = t.score != null ? `<text class="sp-score" x="${x}" y="345" text-anchor="middle">${edgeEsc(t.score)}</text>` : "";
  const flag = isPick ? `<path class="sp-pole" d="M${x + 24} 196 v26"/><path class="sp-flag" d="M${x + 24} 196 l16 6 l-16 6 z"/>` : "";
  return `<g class="sp-team${isPick ? " is-pick" : ""}"><circle class="sp-disc" cx="${x}" cy="255" r="32"/>${art}${flag}
    <text class="sp-side" x="${x}" y="${t.score != null ? 307 : 312}" text-anchor="middle">${side}${isPick ? " · PICK" : ""}</text>${score}</g>`;
}

function edgeSpDrawing(g) {
  const away = g.at === "vs" ? "" : "AWAY", home = g.at === "vs" ? "" : "HOME";
  let bar = "";
  if (g.pick && g.prob != null) {
    const w = 560 * g.prob / 100;
    bar = `<text class="sp-cap" x="120" y="452">OUR CHANCE</text><text class="sp-cap" x="680" y="452" text-anchor="end">${g.prob.toFixed(1)}%</text>
      <rect class="sp-track" x="120" y="460" width="560" height="5"/><rect class="sp-fill" x="120" y="460" width="${w.toFixed(1)}" height="5"/>`;
    if (g.book != null) {
      const bx = 120 + 560 * g.book / 100;
      bar += `<line class="sp-book" x1="${bx.toFixed(1)}" y1="454" x2="${bx.toFixed(1)}" y2="471"/>` +
             `<text class="sp-cap sp-book-t" x="${Math.min(640, Math.max(160, bx)).toFixed(1)}" y="488" text-anchor="middle">VEGAS ${g.book.toFixed(1)}%</text>`;
    }
  }
  return edgeSpField(g.sport) + edgeSpMarker(g, g.away, 262, away) + edgeSpMarker(g, g.home, 538, home) + bar;
}

// "TB @ DAL" with each team's logo in front of its name (a logo that fails to
// load just goes away). big: the larger logos for the picker's title.
function edgeMatchup(g, cls, big) {
  const box = edgeNode("span", cls);
  const side = t => {
    if (t.logo) {
      const img = edgeNode("img", big ? "mt-logo is-big" : "mt-logo");
      img.src = t.logo; img.alt = ""; img.loading = "lazy";
      img.onerror = () => img.remove();
      box.append(img);
    }
    box.append(document.createTextNode(edgeTeamLabel(g.sport, t)));
  };
  side(g.away);
  box.append(edgeNode("span", "mt-at", g.at === "vs" ? " vs " : " @ "));
  side(g.home);
  return box;
}

// opts: {multiSport, withDay, onSelect(key)}. Returns {el, set(games, key)}.
function edgeSlatePicker(opts) {
  opts = opts || {};
  const st = { games: [], list: [], cur: 0, key: null };
  const el = edgeNode("div", "sp");
  el.innerHTML = `
    <div class="sp-left">
      <div class="sp-head"><span class="sp-num">01</span><div class="sp-hd"><small class="sp-of"></small><h3 class="sp-title"></h3></div></div>
      <dl class="sp-facts"><div><dt>Our pick</dt><dd class="sp-pick"></dd></div><div><dt>Win chance</dt><dd class="sp-prob"></dd></div><div><dt>Price</dt><dd class="sp-price"></dd></div></dl>
      <p class="sp-note" aria-live="polite"></p>
      <div class="sp-choose">
        <div class="sp-choose-top"><span>Choose a game</span><span class="sp-arrows">
          <button type="button" class="sp-prev" aria-label="Previous game">&larr;</button><button type="button" class="sp-next" aria-label="Next game">&rarr;</button></span></div>
        <div class="sp-chips"></div>
        <div class="sp-list" hidden></div>
      </div>
    </div>
    <div class="sp-frame">
      <div class="sp-bar"><span class="sp-tag"></span><span class="sp-pill"></span><a class="sp-open" href="#">Game page &rarr;</a></div>
      <svg class="sp-svg" viewBox="0 0 800 500" role="img"><title></title><g></g></svg>
    </div>`;
  const $ = s => el.querySelector(s);
  const chips = $(".sp-chips"), list = $(".sp-list");

  function stateTag(g) {
    if (g.hit === true) return "HIT";
    if (g.hit === false) return "MISS";
    if (g.state === "in") return "LIVE";
    if (g.state === "post") return "FINAL";
    return null;
  }
  function renderChooser() {
    st.list = st.games;
    const many = st.games.length > EDGE_SP_NUMBERED;
    chips.hidden = many;
    list.hidden = !many;
    if (!many) {
      chips.replaceChildren(...st.list.map((g, i) => {
        const b = edgeNode("button", null, String(i + 1).padStart(2, "0"));
        b.type = "button";
        b.dataset.i = i;
        const tag = stateTag(g);
        const sm = edgeNode("small", tag ? "is-" + tag.toLowerCase() : null, tag || (opts.multiSport ? g.sport : edgeSpTime(g).replace(/ \S+$/, "")));
        b.append(sm);
        b.setAttribute("aria-label", `${edgeTeamLabel(g.sport, g.away)} at ${edgeTeamLabel(g.sport, g.home)}${tag ? ", " + tag.toLowerCase() : ""}`);
        return b;
      }));
      return;
    }
    const keep = list.scrollTop;
    const nodes = [];
    let last = null;
    st.list.forEach((g, i) => {
      const head = g.state === "in" ? "Live now" : (opts.withDay ? edgeSpDay(g) + " " : "") + edgeSpTime(g);
      if (head !== last) {
        const n = st.list.filter(x => (x.state === "in" ? "Live now" : (opts.withDay ? edgeSpDay(x) + " " : "") + edgeSpTime(x)) === head).length;
        const h = edgeNode("h4", null);
        h.append(edgeNode("span", null, head), edgeNode("span", null, `${n} ${n === 1 ? "game" : "games"}`));
        nodes.push(h);
        last = head;
      }
      const b = edgeNode("button", null);
      b.type = "button";
      b.dataset.i = i;
      const tag = stateTag(g);
      b.append(edgeNode("span", "sp-lg", opts.multiSport ? g.sport : (tag || "")), edgeMatchup(g, "sp-mt"));
      const pk = edgeNode("span", "sp-pk", g.pick ? `${edgeTeamOf(g.sport, g, g.pick)} ${Math.round(g.prob)}%` : "No pick yet");
      if (opts.multiSport && tag) pk.prepend(edgeNode("b", "is-" + tag.toLowerCase(), tag + " "));
      b.append(pk);
      nodes.push(b);
    });
    if (!nodes.length) nodes.push(edgeNode("div", "sp-empty", "No games match this filter."));
    list.replaceChildren(...nodes);
    list.scrollTop = keep;
  }
  function show(i, animate) {
    const L = st.list;
    if (!L.length) return;
    st.cur = (i + L.length) % L.length;
    const g = L[st.cur];
    st.key = g.key;
    const n = String(st.cur + 1).padStart(2, "0");
    $(".sp-num").textContent = n;
    const tag = stateTag(g);
    $(".sp-of").textContent = [`Game ${st.cur + 1} of ${L.length}`, g.sport, tag ? tag[0] + tag.slice(1).toLowerCase() : ""].filter(Boolean).join(" · ");
    const title = `${edgeTeamLabel(g.sport, g.away)} ${g.at === "vs" ? "vs" : "@"} ${edgeTeamLabel(g.sport, g.home)}`;
    $(".sp-title").replaceChildren(...edgeMatchup(g, "x", 1).childNodes);
    $(".sp-title").classList.toggle("is-long", title.length > 13);
    $(".sp-title").classList.toggle("is-longer", title.length > 24);
    $(".sp-pick").textContent = !g.pick ? "None yet" : g.pick === "Draw" ? "Draw" : edgeTeamOf(g.sport, g, g.pick);
    $(".sp-pick").classList.toggle("is-name", edgeNamesTeams(g.sport) && $(".sp-pick").textContent.length > 8);
    $(".sp-prob").textContent = g.pick && g.prob != null ? Math.round(g.prob) + "%" : "–";
    $(".sp-price").textContent = g.price != null ? (typeof edgePrice === "function" ? edgePrice(g.price) : (g.price > 0 ? "+" : "") + g.price) : "–";
    $(".sp-note").textContent = edgePickNote(g);
    $(".sp-tag").textContent = `${g.sport} · ${g.away.name} ${g.at === "vs" ? "vs" : "at"} ${g.home.name}`;
    const open = $(".sp-open");
    open.hidden = !g.url;
    if (g.url) open.href = g.url;
    const pill = $(".sp-pill");
    pill.className = "sp-pill" + (g.state === "in" ? " is-live" : g.hit === true ? " is-hit" : g.hit === false ? " is-miss" : "");
    pill.textContent = g.state === "in" ? (g.detail || "Live") : g.hit != null ? (g.hit ? "Final · Hit" : "Final · Miss")
      : g.state === "post" ? "Final" : `Game ${n} · ${opts.withDay ? edgeSpDay(g) + " " : ""}${edgeSpTime(g)}`;
    const box = list.hidden ? chips : list;
    box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === st.cur)));
    const on = box.querySelector('button[aria-pressed="true"]');
    if (on && !list.hidden && animate) {
      const top = on.offsetTop, h = on.offsetHeight;
      if (top < list.scrollTop + 36 || top + h > list.scrollTop + list.clientHeight) list.scrollTop = top - 44;
    }
    const svg = $(".sp-svg");
    const draw = () => {
      svg.querySelector("title").textContent = `${g.sport}: ${g.away.name} ${g.at === "vs" ? "vs" : "at"} ${g.home.name}${g.pick ? ", our pick " + edgeTeamOf(g.sport, g, g.pick) : ""}`;
      svg.querySelector("g").innerHTML = edgeSpDrawing(g);
    };
    if (animate && !EDGE_REDUCE.matches) {
      svg.classList.add("is-swap");
      clearTimeout(st.swap);
      st.swap = setTimeout(() => { draw(); svg.classList.remove("is-swap"); }, 180);
    } else draw();
    if (opts.onSelect) opts.onSelect(g.key);
  }
  const pickFrom = e => { const b = e.target.closest("button[data-i]"); if (b) show(+b.dataset.i, true); };
  chips.addEventListener("click", pickFrom);
  list.addEventListener("click", pickFrom);
  $(".sp-prev").addEventListener("click", () => show(st.cur - 1, true));
  $(".sp-next").addEventListener("click", () => show(st.cur + 1, true));
  el.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); show(st.cur + 1, true); el.querySelector('.sp-chips:not([hidden]) button[aria-pressed="true"], .sp-list:not([hidden]) button[aria-pressed="true"]')?.focus(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); show(st.cur - 1, true); el.querySelector('.sp-chips:not([hidden]) button[aria-pressed="true"], .sp-list:not([hidden]) button[aria-pressed="true"]')?.focus(); }
  });

  // New games (a refresh, a filter outside the picker): keeps the game that
  // was showing when it's still there, else starts with the next to play.
  function set(games, key) {
    const want = key || st.key;
    st.games = games;
    renderChooser();
    el.hidden = !st.list.length;
    if (!st.list.length) return;
    let i = st.list.findIndex(g => g.key === want);
    if (i < 0) i = st.list.findIndex(g => g.state === "in");
    if (i < 0) i = st.list.findIndex(g => g.state === "pre");
    show(Math.max(0, i), false);
  }
  return { el, set, state: st };
}

// Page tabs (the pill row under the hero) stay pinned just under the bars
// fixed across the top (scores, scoring plays, the EDGE nav) while you scroll.
// Only full-width bars count, so sticky headers inside the page and score
// pop-ups never push the tabs down. --edge-tabs is where the tabs end, for
// anything else that sticks below them.
function initStickyTabs() {
  const bar = document.querySelector(".edge-jump, .jump");
  if (!bar) return;
  const cur = bar.querySelector('[aria-current="page"], .go');
  if (cur && cur.offsetLeft + cur.offsetWidth > bar.clientWidth - 32) bar.scrollLeft = cur.offsetLeft + cur.offsetWidth - bar.clientWidth + 48;
  let pinned = [];
  const set = () => {
    const top = Math.max(0, ...pinned.map(e => e.getBoundingClientRect())
      .filter(r => r.top < 160 && r.bottom > 0 && r.height < 200 && r.width > innerWidth * 0.6).map(r => r.bottom));
    bar.style.top = top + "px";
    document.documentElement.style.setProperty("--edge-tabs", top + bar.offsetHeight + "px");
    bar.classList.toggle("is-stuck", Math.abs(bar.getBoundingClientRect().top - top) < 1 && scrollY > 0);
  };
  const find = () => { pinned = [...document.querySelectorAll("body *")].filter(e => !bar.contains(e) && getComputedStyle(e).position === "fixed"); set(); };
  let raf = 0;
  addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(set); }, { passive: true });
  addEventListener("resize", find);
  addEventListener("load", find);
  find();
  setInterval(find, 5000);
}

// "Loading..." text marked data-loading shimmers until the real text replaces it.
function initLoadingText() {
  document.querySelectorAll("[data-loading]").forEach(el => {
    const done = () => { if (!/^Loading\b/.test(el.textContent.trim())) { el.removeAttribute("data-loading"); mo.disconnect(); } };
    const mo = new MutationObserver(done);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { initStickyTabs(); initLoadingText(); });
else { initStickyTabs(); initLoadingText(); }

// Sortable tables: click (or Enter/Space on) a column header with
// data-sort-key to sort by it; blank numbers always sort last.
function makeSortable(table) {
  const tbody = table.tBodies[0];
  table.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.tabIndex = 0;
    th.setAttribute("aria-sort", "none");
    th.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); }
    });
    th.addEventListener("click", () => {
      const rows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.classList.contains("day-header"));
      const asc = !th.classList.contains("sorted-asc");
      table.querySelectorAll("th").forEach(h => {
        h.classList.remove("sorted-asc", "sorted-desc");
        if (h.hasAttribute("aria-sort")) h.setAttribute("aria-sort", "none");
      });
      th.classList.add(asc ? "sorted-asc" : "sorted-desc");
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");

      const key = th.dataset.sortKey;
      const isNumeric = th.classList.contains("num");
      const val = r => r.querySelector(`[data-key="${key}"]`)?.dataset.value ?? "";
      rows.sort((a, b) => {
        if (isNumeric) {
          const av = parseFloat(val(a)), bv = parseFloat(val(b));
          if (isNaN(av)) return 1;
          if (isNaN(bv)) return -1;
          return asc ? av - bv : bv - av;
        }
        return asc ? val(a).localeCompare(val(b)) : val(b).localeCompare(val(a));
      });
      // Day-group headers only make sense in date order, so sorting drops them.
      tbody.querySelectorAll(".day-header").forEach(r => r.remove());
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

document.querySelectorAll("table.data[data-sortable]").forEach(makeSortable);

// --- Section tabs on narrow screens ---
// When the tabs don't fit (phones), scroll the current one into view and fade
// whichever edge has more tabs hidden past it, so it's clear the row swipes.
function initSectionTabs() {
  const row = document.querySelector(".tabs-inner");
  if (!row) return;
  const active = row.querySelector("a.active");
  if (active && row.scrollWidth > row.clientWidth) {
    row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  }
  const edges = () => {
    row.classList.toggle("fade-left", row.scrollLeft > 4);
    row.classList.toggle("fade-right", row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
  };
  edges();
  row.addEventListener("scroll", edges, { passive: true });
  window.addEventListener("resize", edges);
}
initSectionTabs();

// --- Day buttons over the game cards (extras.game_board) ---
// "All games" shows every day; a day's button shows only that day's cards.
// Keep this block identical in nfl-cfb/web/site.js and mlb-nba-cbb/web/site.js.
function initDayChips() {
  document.querySelectorAll(".day-chips").forEach(group => {
    const days = group.parentElement.querySelectorAll(".gc-day");
    group.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      group.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      days.forEach(d => { d.hidden = btn.dataset.day !== "all" && d.dataset.day !== btn.dataset.day; });
    }));
  });
}
initDayChips();

// --- Competition buttons over the game cards (Soccer Edge) ---
// "All" shows every match; a competition's button shows only its cards (the
// data-group extras.game_card puts on each), and hides a day with none left.
function initCompChips() {
  document.querySelectorAll(".comp-chips").forEach(group => {
    const scope = group.parentElement;
    group.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      group.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      const comp = btn.dataset.group;
      scope.querySelectorAll(".gc[data-group]").forEach(c => { c.hidden = comp !== "all" && c.dataset.group !== comp; });
      scope.querySelectorAll(".gc-day").forEach(d => {
        d.classList.toggle("is-empty", !d.querySelector(".gc:not([hidden])"));
      });
    }));
  });
}
initCompChips();

// --- Sliding highlight under the day and competition buttons ---
document.querySelectorAll(".day-chips, .comp-chips").forEach(g => edgeSlide(g, "line"));

// --- Slate picker over the game cards (extras.game_board) ---
// The board's games come as JSON in .sp-mount; Slate shows them one at a
// time with edgeSlatePicker, Cards shows the cards. The day and competition
// buttons filter both. The choice is saved for every sport site. Cards is the
// default (2026-11-05); the key changed from "edge-board-view" so
// every visitor starts on Cards once, with Slate one tap away.
const SP_VIEW_KEY = "edge-board-view-2";
function initSlatePickers() {
  document.querySelectorAll(".sp-mount").forEach(mount => {
    let games = [];
    try { games = JSON.parse(mount.querySelector(".sp-data").textContent); } catch (e) { return; }
    if (!games.length) return;
    const scope = mount.parentElement;
    let view = "cards";
    try { if (localStorage.getItem(SP_VIEW_KEY) === "slate") view = "slate"; } catch (e) { /* storage blocked */ }
    const picker = edgeSlatePicker({ withDay: new Set(games.map(g => g.date)).size > 1 });
    const bar = edgeNode("div", "sp-view");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Games view");
    ["slate", "cards"].forEach(v => {
      const b = edgeNode("button", null, v === "slate" ? "Slate" : "Cards");
      b.type = "button";
      b.dataset.v = v;
      bar.append(b);
    });
    mount.append(bar, picker.el);
    const filter = { day: "all", comp: "all" };
    const apply = () => {
      bar.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
      const gs = games.filter(g => (filter.day === "all" || g.date === filter.day) && (filter.comp === "all" || g.group === filter.comp));
      picker.set(gs);
      picker.el.hidden = view !== "slate" || !gs.length;
      scope.querySelectorAll(".gc-day").forEach(d => d.classList.toggle("sp-off", view === "slate"));
      edgeSlide(bar, "pill");
    };
    bar.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      view = b.dataset.v;
      try { localStorage.setItem(SP_VIEW_KEY, view); } catch (err) { /* storage blocked */ }
      apply();
    });
    scope.querySelectorAll(".day-chips button").forEach(b => b.addEventListener("click", () => { filter.day = b.dataset.day; apply(); }));
    scope.querySelectorAll(".comp-chips button").forEach(b => b.addEventListener("click", () => { filter.comp = b.dataset.group; apply(); }));
    mount._slate = { games, apply };
    apply();
  });
}
initSlatePickers();

// --- Results calendar (Model tab, model_page.render) ---
// One square per day from this site's summary.json "daily", colored by that
// day's record; MLB adds a Hits / Games switch for its two records.
async function initResultsCalendar() {
  const box = document.getElementById("results-cal");
  if (!box) return;
  const s = await edgeFetchJson(box.dataset.summary || "summary.json");
  const parts = [["Hits", s && s.daily], ["Games", s && s.games && s.games.daily]].filter(([, d]) => d && d.length);
  if (!parts.length) return;
  if (!(s.games && s.games.daily && s.games.daily.length)) parts[0][0] = "";
  const state = { part: 0, month: null };
  const months = d => [...new Set(d.map(([day]) => day.slice(0, 7)))];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const title = edgeNode("h3");
  const seg = (cls, label) => { const g = edgeNode("div", "rc-seg " + cls); g.setAttribute("role", "group"); g.setAttribute("aria-label", label); return g; };
  const partSeg = seg("rc-part", "Record");
  const monthSeg = seg("rc-month", "Month");
  const prev = edgeNode("button", null, "‹"), next = edgeNode("button", null, "›");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Previous month");
  next.setAttribute("aria-label", "Next month");
  monthSeg.append(prev, next);
  const ctl = edgeNode("div", "rc-ctl");
  if (parts.length > 1) {
    parts.forEach(([name], i) => {
      const b = edgeNode("button", null, name);
      b.type = "button";
      b.addEventListener("click", () => { state.part = i; state.month = null; draw(); });
      partSeg.append(b);
    });
    ctl.append(partSeg);
  }
  ctl.append(monthSeg);
  const top = edgeNode("div", "rc-top");
  top.append(title, ctl);
  const grid = edgeNode("div", "rc-grid");
  const sum = edgeNode("p", "rc-sum");
  const key = edgeNode("div", "rc-key");
  [["is-great", "70% or better"], ["is-win", "Winning day"], ["is-even", "Even"], ["is-loss", "Losing day"]].forEach(([c, t]) => {
    const k = edgeNode("span"), i = edgeNode("i", "rc-d " + c);
    k.append(i, t);
    key.append(k);
  });
  const body = box.querySelector(".card-body");
  body.replaceChildren(top, grid, key, sum);
  box.hidden = false;
  function draw() {
    const daily = parts[state.part][1];
    const ms = months(daily);
    if (!state.month || !ms.includes(state.month)) state.month = ms[ms.length - 1];
    partSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === state.part)));
    const mi = ms.indexOf(state.month);
    prev.disabled = mi <= 0;
    next.disabled = mi >= ms.length - 1;
    prev.onclick = () => { state.month = ms[mi - 1]; draw(); };
    next.onclick = () => { state.month = ms[mi + 1]; draw(); };
    const [y, m] = state.month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    title.textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const byDay = Object.fromEntries(daily.map(([d, w, l]) => [d, [w, l]]));
    const cells = ["S", "M", "T", "W", "T", "F", "S"].map(d => edgeNode("span", "rc-dow", d));
    for (let i = 0; i < first.getUTCDay(); i++) cells.push(edgeNode("span"));
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let W = 0, L = 0, up = 0, down = 0;
    for (let d = 1; d <= nDays; d++) {
      const iso = `${state.month}-${String(d).padStart(2, "0")}`;
      const r = byDay[iso];
      const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const c = edgeNode("span", "rc-d" + (iso === today ? " is-today" : ""), String(d));
      if (r) {
        const [w, l] = r, p = w / (w + l);
        W += w; L += l;
        if (w > l) up++; else if (l > w) down++;
        c.classList.add(p >= 0.7 ? "is-great" : w > l ? "is-win" : w === l ? "is-even" : "is-loss");
        c.dataset.r = `${label}: ${w}-${l}`;
        c.tabIndex = 0;
        c.setAttribute("aria-label", c.dataset.r);
      }
      cells.push(c);
    }
    grid.replaceChildren(...cells);
    sum.replaceChildren(edgeNode("b", null, `${W}-${L}`),
      ` in ${title.textContent.split(" ")[0]} · ${up} winning ${up === 1 ? "day" : "days"}, ${down} losing ${down === 1 ? "day" : "days"}`);
  }
  draw();
}
initResultsCalendar();

// --- Accuracy charts (accuracy_page.charts_html) ---
// Every chart on the Accuracy tab, every sport, drawn the same way from the
// window.EDGE_CHARTS list: {id, title, labels, fmt, series: [{label, data,
// color, dash}]}. The box keeps its skeleton, or says the script never
// arrived, until Chart.js draws into it.
function initEdgeCharts() {
  const charts = window.EDGE_CHARTS || [];
  if (!charts.length) return;
  if (typeof Chart === "undefined") {
    document.querySelectorAll(".chart-card").forEach(c => c.dataset.state = "failed");
    return;
  }
  Chart.defaults.font.family = "'Archivo', 'Helvetica Neue', Arial, sans-serif";
  Chart.defaults.animation = false;
  const formats = {
    pct: v => (v * 100).toFixed(0) + "%",
    num1: v => v.toFixed(1),
    num3: v => v.toFixed(3),
    pm1: v => "±" + v.toFixed(1),
  };
  const tipFormats = { ...formats, pct: v => (v * 100).toFixed(1) + "%" };
  charts.forEach(c => {
    const el = document.getElementById(c.id);
    if (!el) return;
    el.closest(".chart-card")?.setAttribute("data-state", "ready");
    const fmt = formats[c.fmt] || formats.pct, tip = tipFormats[c.fmt] || tipFormats.pct;
    new Chart(el, {
      type: "line",
      data: {
        labels: c.labels,
        datasets: c.series.map(s => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
          borderDash: s.dash || [], pointRadius: 3, borderWidth: 2, tension: 0, spanGaps: true,
        })),
      },
      options: {
        // Fill the .chart-card box (base.css) rather than the canvas's
        // default shape, which left a sliver of plot on phones.
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: c.title, align: "start", font: { size: 15, weight: "bold" }, color: "#ecebe7" },
          legend: { display: true, position: "top", align: "start", labels: { color: "#ecebe7", font: { size: 13 }, boxWidth: 12, boxHeight: 2 } },
          tooltip: {
            backgroundColor: "#1a1b1d", borderColor: "#45484e", borderWidth: 1, cornerRadius: 6,
            titleColor: "#ecebe7", bodyColor: "#a8a7a1",
            callbacks: { label: ctx => `${ctx.dataset.label}: ${tip(ctx.parsed.y)}` },
          },
        },
        scales: {
          y: {
            grace: "5%", ticks: { color: "#a8a7a1", callback: fmt }, grid: { color: "#2b2d31" }, border: { display: false },
            // A share can't go below 0% or above 100%, whatever the padding.
            afterDataLimits: c.fmt === "pct" || !c.fmt ? s => { s.min = Math.max(0, s.min); s.max = Math.min(1, s.max); } : undefined,
          },
          x: { ticks: { color: "#a8a7a1" }, grid: { display: false }, border: { color: "#45484e" } },
        },
      },
    });
  });
}
// the chart script loads with defer, so draw once the page (and it) has loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEdgeCharts); else initEdgeCharts();

// --- Model switch (accuracy_page.switcher) ---
// Where a sport has two models (MLB hitters and games), buttons show one
// model's panel at a time, the same way on its Accuracy and Model tabs.
function initSwitchers() {
  document.querySelectorAll(".model-switch").forEach(bar => {
    const btns = bar.querySelectorAll("button[data-panel]");
    btns.forEach(btn => btn.addEventListener("click", () => {
      btns.forEach(b => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
        const panel = document.getElementById(b.dataset.panel);
        if (panel) panel.hidden = !on;
      });
    }));
  });
}
initSwitchers();

// --- Live scores on the game cards (extras.game_card) ---
// The cards are built by the site's scheduled runs, so a game that ends between
// runs would keep showing our projection. Cards for games not yet final carry
// data-start/-away/-home/-pick; this fills in ESPN's live score or final, and
// HIT / MISS on our pick to win, refreshing every minute while a game is live.
// The next run's grading (and the spread result) replaces it for good.
function gcLiveSite() {
  const dir = location.pathname.split("/")[1];
  return EDGE_SITES.find(s => s.games && s.games.split("/")[1] === dir) || null;
}

async function gcLiveEvents(site, days) {
  const published = await edgeFetchJson(site.games);
  if (!published || !published.espn) return [];
  const parse = data => data && Array.isArray(data.events) ? data.events.map(edgeParseEspn).filter(Boolean) : [];
  const events = parse(await edgeFetchJson(published.espn, 6000));
  const ids = new Set(events.map(e => e.id));
  const covered = new Set(events.map(e => new Date(e.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" })));
  const sep = published.espn.includes("?") ? "&" : "?";
  const extra = await Promise.all(days.filter(d => !covered.has(d)).slice(0, 6)
    .map(d => edgeFetchJson(published.espn + sep + "dates=" + d.replace(/-/g, ""), 6000)));
  extra.forEach(data => parse(data).forEach(e => { if (!ids.has(e.id)) { ids.add(e.id); events.push(e); } }));
  return events;
}

function gcLiveMatch(card, events, sport) {
  const key = a => edgeFavKey(sport, a);
  const teams = [card.dataset.away, card.dataset.home].map(key);
  const t = new Date(card.dataset.start).getTime();
  return events.find(e => {
    if (!teams.includes(key(e.away.abbr)) && !teams.includes(key(e.home.abbr))) return false;
    if (Number.isFinite(t)) return Math.abs(new Date(e.start).getTime() - t) < 15 * 60000;
    return new Date(e.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === card.dataset.day;
  }) || null;
}

function gcLivePaint(card, e, sport) {
  const flip = edgeFavKey(sport, card.dataset.away) === edgeFavKey(sport, e.home.abbr) ||
               edgeFavKey(sport, card.dataset.home) === edgeFavKey(sport, e.away.abbr);
  const away = flip ? e.home : e.away, home = flip ? e.away : e.home;
  if (away.score == null || home.score == null) return;
  const when = card.querySelector(".gc-when");
  if (when) {
    when.textContent = e.state === "post" ? "Final" : (e.detail || "Live");
    when.classList.toggle("is-live", e.state === "in");
  }
  const rows = card.querySelectorAll(".gc-team");
  [away, home].forEach((t, i) => {
    const row = rows[i];
    if (!row) return;
    const num = row.querySelector(".gc-num");
    if (num) num.textContent = String(t.score);
    row.classList.toggle("is-lead", t.score > (i ? away : home).score);
  });
  const pick = card.querySelector(".gc-pick");
  if (!pick || e.state !== "post" || pick.querySelector(".gc-live-res")) return;
  const p = card.dataset.pick;
  let hit;
  if (p === "Draw") hit = away.score === home.score;
  else hit = away.score !== home.score && (p === card.dataset.away) === (away.score > home.score);
  const res = edgeNode("span", `pill ${hit ? "pill-positive" : "pill-danger"} gc-live-res`, hit ? "HIT" : "MISS");
  pick.insertBefore(res, pick.querySelector(".gc-pct"));
}

async function initLiveCards() {
  const cards = [...document.querySelectorAll(".gc[data-start]")];
  const site = gcLiveSite();
  if (!cards.length || !site) return;
  const days = [...new Set(cards.map(c => c.dataset.day).filter(Boolean))];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const refresh = async () => {
    const started = cards.filter(c => { const t = new Date(c.dataset.start).getTime();
      return Number.isFinite(t) ? t <= Date.now() : c.dataset.day <= today; });
    if (!started.length) return false;
    const events = await gcLiveEvents(site, days.filter(d => d <= today));
    let live = false;
    // The slate pickers' games take the same live scores.
    document.querySelectorAll(".sp-mount").forEach(m => {
      if (!m._slate) return;
      let changed = false;
      m._slate.games.forEach(g => {
        if (g.state === "post" && g.hit != null) return;
        const e = gcLiveMatch({ dataset: { away: g.away.abbr, home: g.home.abbr, start: g.start || "", day: g.date } }, events, site.sport);
        if (!e || e.state === "pre") return;
        const flip = edgeFavKey(site.sport, g.away.abbr) === edgeFavKey(site.sport, e.home.abbr) ||
                     edgeFavKey(site.sport, g.home.abbr) === edgeFavKey(site.sport, e.away.abbr);
        const away = flip ? e.home : e.away, home = flip ? e.away : e.home;
        if (away.score == null || home.score == null) return;
        g.away.score = away.score;
        g.home.score = home.score;
        g.state = e.state;
        g.detail = e.detail || "";
        if (e.state === "post") {
          if (g.pick === "Draw") g.hit = away.score === home.score;
          else if (away.score !== home.score) g.hit = (g.pick === g.away.abbr) === (away.score > home.score);
          else if (site.sport === "Soccer") g.hit = false;
        }
        changed = true;
      });
      if (changed) m._slate.apply();
    });
    started.forEach(c => {
      const e = gcLiveMatch(c, events, site.sport);
      if (!e || e.state === "pre") return;
      // The series score moves once a playoff game ends.
      const series = c.querySelector(".gc-series");
      if (series && e.series) series.textContent = e.series;
      gcLivePaint(c, e, site.sport);
      if (e.state === "in") live = true;
    });
    return live;
  };
  const loop = async () => { if (await refresh()) setTimeout(loop, 60000); };
  loop();
}
initLiveCards();


// --- Ratings: the top 25 until "Show all" opens the rest ---
document.querySelectorAll("[data-show-all]").forEach(btn => {
  btn.addEventListener("click", () => {
    const table = btn.previousElementSibling;
    if (table) table.classList.remove("is-short");
    btn.remove();
  });
});


// --- Live game view on football game pages (extras.live_html) ---
// Once the game starts, the Live card fills in from ESPN's play-by-play: the
// score and down, the ball on a field, our win chance re-run after every play
// from our pregame line, and every drive. The Players to watch bars get a dot
// for each player's yards so far. Refreshes every 30 seconds while live.
// glLeft and glHomeWin (the live win chance) live in edge.js, shared with the score ticker.

function glShort(name) {
  return String(name || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/, "").replace(/[^a-z]/g, "");
}

// Our "J.Brissett" / "Mi.Wilson" against ESPN's first and last name.
function glSamePlayer(ours, a) {
  const [first, ...rest] = String(ours).split(".");
  const last = rest.join(".") || first;
  if (glShort(last) !== glShort(a.lastName || (a.displayName || "").split(" ").slice(-1)[0])) return false;
  return !rest.length || String(a.firstName || a.displayName || "").toLowerCase().startsWith(first.toLowerCase());
}

// A team on the Live card, from ESPN's competitor: its abbreviation, or for
// college and soccer its name (edgeTeamLabel).
function glLabel(sport, c) {
  const t = c.team || {};
  return edgeTeamLabel(sport, { abbr: edgeTeamAbbr(t), short: t.shortDisplayName, name: t.displayName });
}

function glRender(card, data, sport) {
  const ds = card.dataset;
  const comp = ((data.header || {}).competitions || [])[0] || {};
  const status = (comp.status || {}).type || {};
  if (!status.state || status.state === "pre") return false;
  const sides = {};
  (comp.competitors || []).forEach(c => { sides[c.homeAway] = c; });
  if (!sides.home || !sides.away) return false;
  const flip = edgeFavKey(sport, ds.away) === edgeFavKey(sport, edgeTeamAbbr(sides.home.team || {}));
  const away = flip ? sides.home : sides.away, home = flip ? sides.away : sides.home;
  const homeId = String(home.team.id), mu = Number(ds.margin), sd = Number(ds.sd);
  const abbr = c => edgeTeamAbbr(c.team || {});
  const lab = c => glLabel(sport, c), named = edgeNamesTeams(sport) ? " is-named" : "";
  const pickHome = edgeFavKey(sport, ds.pick) === edgeFavKey(sport, ds.home);
  const live = status.state === "in";

  // Every play in order, with the drive it belongs to.
  const drives = [...(((data.drives || {}).previous) || [])];
  const cur = (data.drives || {}).current;
  if (cur && cur.plays && cur.plays.length && !drives.some(d => d.id === cur.id)) drives.push(cur);
  const plays = [];
  drives.forEach(d => (d.plays || []).forEach(p => plays.push(p)));
  const last = plays[plays.length - 1];

  // Win chance after each play, ours for the pick.
  const chance = p => {
    const per = (p.period || {}).number || 1;
    const end = p.end || {};
    const ball = end.team && end.team.id ? String(end.team.id) === homeId : null;
    const h = glHomeWin((p.homeScore || 0) - (p.awayScore || 0), glLeft(per, (p.clock || {}).displayValue), ball,
                        end.yardsToEndzone != null && end.down ? end.yardsToEndzone : null, mu, sd, per > 4);
    return flip ? 1 - h : h;
  };
  const kick = glHomeWin(0, GL_LEN, null, null, mu, sd, false);
  const toPick = h => pickHome ? h : 1 - h;
  const series = [toPick(kick)].concat(plays.map(p => toPick(chance(p))));
  const sa = Number(away.score) || 0, sh = Number(home.score) || 0;
  let now;
  if (status.state === "post") now = toPick(sh > sa ? 1 : sh < sa ? 0 : 0.5);
  else now = series[series.length - 1];

  // Team colors from ESPN, for the score bars, end zones and drive swatches.
  const color = c => /^[0-9a-f]{6}$/i.test((c.team || {}).color || "") ? "#" + c.team.color : "var(--text-faint)";
  const colorOf = {};
  [away, home].forEach(c => { colorOf[String(c.team.id)] = color(c); colorOf[abbr(c)] = color(c); });

  // Board: score, clock, down and distance.
  const poss = last && last.end && last.end.team ? String(last.end.team.id) : String((comp.situation || {}).possession || "");
  const team = (c, side) => `<div class="gl-team gl-${side}${named}${String(c.team.id) === poss && live ? " has-ball" : ""}" style="--tc:${color(c)}">` +
    `<b>${edgeEsc(lab(c))}</b><span class="gl-score">${edgeEsc(String(c.score ?? 0))}</span></div>`;
  const clock = status.state === "post" ? "Final" : (status.shortDetail || status.detail || "Live");
  const down = live && last && last.end && last.end.downDistanceText ? last.end.downDistanceText : "";
  const lastText = live && last ? String(last.text || "").trim() : "";

  // The ball on a drawn field: the away team's end zone on the left.
  let field = "";
  if (live && last && last.end && last.end.team && last.end.yardsToEndzone != null) {
    const offHome = String(last.end.team.id) === homeId;
    const X = y => 100 + y * 10;  // yard 0-100 from the away goal line to x in a 1200 x 400 field
    const los = offHome ? last.end.yardsToEndzone : 100 - last.end.yardsToEndzone;
    const gain = last.end.distance || 0;
    const fd = Math.max(0, Math.min(100, offHome ? los - gain : los + gain));
    let turf = "";
    for (let y = 0; y < 100; y += 10) turf += `<rect x="${X(y)}" y="0" width="100" height="400" class="${(y / 10) % 2 ? "s2" : "s1"}"/>`;
    for (let y = 5; y < 100; y += 5) turf += `<line x1="${X(y)}" x2="${X(y)}" y1="0" y2="400" class="${y % 10 ? "yl5" : "yl"}"/>`;
    for (let y = 1; y < 100; y++) if (y % 5) turf += `<line x1="${X(y)}" x2="${X(y)}" y1="132" y2="144" class="hash"/><line x1="${X(y)}" x2="${X(y)}" y1="256" y2="268" class="hash"/>`;
    for (let y = 10; y < 100; y += 10) {
      const n = 50 - Math.abs(50 - y);
      turf += `<text x="${X(y)}" y="62" class="num">${n}</text><text x="${X(y)}" y="362" class="num">${n}</text>`;
    }
    const ez = (c, x, rot) => `<rect x="${x}" y="0" width="100" height="400" fill="${color(c)}"/>` +
      `<text x="${x + 50}" y="200" class="ezt" transform="rotate(${rot} ${x + 50} 200)">${edgeEsc(((c.team || {}).name || abbr(c)).toUpperCase())}</text>`;
    const bx = X(los), dir = offHome ? -1 : 1;
    field = `<div class="gl-field" role="img" aria-label="${edgeEsc(down || "Ball position")}">` +
      `<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid meet">${turf}${ez(away, 0, -90)}${ez(home, 1100, 90)}` +
      (last.end.down ? `<line x1="${X(fd)}" x2="${X(fd)}" y1="0" y2="400" class="fd"/>` : "") +
      `<line x1="${bx}" x2="${bx}" y1="0" y2="400" class="los"/>` +
      `<path d="M${bx - dir * 50} 96 L${bx} 96" class="dir"/><path d="M${bx} 96 L${bx - dir * 16} 86 L${bx - dir * 16} 106 Z" class="dirh"/>` +
      `<ellipse cx="${bx}" cy="200" rx="22" ry="14" class="ball"/><line x1="${bx - 8}" x2="${bx + 8}" y1="200" y2="200" class="lace"/>` +
      `<rect x="1" y="1" width="1198" height="398" class="edge"/></svg></div>`;
  }

  // Win chance over game time, with the quarters marked.
  const W = 600, H = 160;
  const t = p => { const per = (p.period || {}).number || 1; return per > 4 ? GL_LEN + 1 : GL_LEN - glLeft(per, (p.clock || {}).displayValue); };
  const times = [0].concat(plays.map(t));
  const span = Math.max(GL_LEN, times[times.length - 1]);
  const xy = (v, i) => [(times[i] / span * W).toFixed(1), (H - v * H).toFixed(1)];
  const pts = series.map((v, i) => xy(v, i).join(",")).join(" ");
  const [ex, ey] = xy(series[series.length - 1], series.length - 1);
  const pick = pickHome ? lab(home) : lab(away), other = pickHome ? lab(away) : lab(home);
  const quarters = [1, 2, 3, 4].map(q => `<line x1="${q * 900 / span * W}" x2="${q * 900 / span * W}" y1="0" y2="${H}" class="q"/>`).join("");
  const chart = `<div class="gl-plot"><span class="gl-up">${edgeEsc(pick)} wins &uarr;</span><span class="gl-down">${edgeEsc(other)} wins &darr;</span>` +
    `<div class="gl-svg"><svg class="gl-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${quarters}` +
    `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"></line><polyline points="${pts}"></polyline></svg>` +
    `<i class="gl-dot" style="left:${ex / W * 100}%;top:${ey / H * 100}%"></i></div>` +
    `<div class="gl-qs">${[1, 2, 3, 4].map(q => `<span style="left:${(q - 0.5) * 900 / span * 100}%">Q${q}</span>`).join("")}</div></div>`;
  const word = status.state === "post" ? "at the final whistle" : "from right here";
  const chanceHtml = `<div class="gl-chance"><span class="gl-eyebrow">Our win chance</span>` +
    `<div class="gl-now"><b>${Math.round(now * 100)}<small>%</small></b><span>${edgeEsc(pick)}</span></div>` +
    `<p class="gl-sub">${word}. ${Math.round(series[0] * 100)}% at kickoff.</p>${chart}</div>`;

  // Drives, latest first; the one in progress open with its latest play in bold.
  const driveHtml = drives.slice().reverse().map((d, i) => {
    const dt = d.team || {};
    const going = live && cur && d.id === cur.id;
    const result = going ? "Drive in progress" : [d.description, d.displayResult].filter(Boolean).join(" · ");
    const rows = (d.plays || []).slice().reverse().map((p, j) => {
      const st = p.start || {};
      const dd = st.down ? (st.shortDownDistanceText || `${st.down} & ${st.distance}`) + (st.possessionText ? ` at ${st.possessionText}` : "") : "";
      const when = `Q${(p.period || {}).number || ""} ${(p.clock || {}).displayValue || ""}` + (dd ? ` · ${dd}` : "");
      const cls = [i === 0 && j === 0 && live ? "is-cur" : "", p.scoringPlay ? "is-score" : ""].filter(Boolean).join(" ");
      return `<li${cls ? ` class="${cls}"` : ""}><span class="gl-when">${edgeEsc(when)}</span><span class="gl-text">${edgeEsc(String(p.text || "").trim())}</span></li>`;
    }).join("");
    const open = card.glOpen && d.id in card.glOpen ? card.glOpen[d.id] : i === 0 && live;
    return `<details class="gl-drive${d.isScore ? " is-score" : ""}" data-drive="${edgeEsc(String(d.id))}"${open ? " open" : ""}><summary>` +
      `<span class="gl-sw" style="background:${colorOf[String(dt.id)] || colorOf[dt.abbreviation] || "var(--text-faint)"}"></span>` +
      `<b>${edgeEsc(dt.abbreviation || "")}</b><span class="gl-res">${edgeEsc(result)}</span><i class="gl-chev" aria-hidden="true"></i></summary><ol>${rows}</ol></details>`;
  }).join("");

  const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  card.querySelector(".gl-body").innerHTML =
    `<div class="gl-panel"><div class="gl-board${live ? " is-live" : ""}">${team(away, "away")}${team(home, "home")}</div>` +
    `<div class="gl-sit"><span class="gl-clock">${edgeEsc(clock)}</span>${down ? `<b>${edgeEsc(down)}</b>` : ""}</div>` +
    field + (lastText ? `<p class="gl-last">${edgeEsc(lastText)}</p>` : "") +
    (live ? `<p class="gl-upd">Updated ${at}. ESPN's feed runs about 10 to 30 seconds behind TV.</p>` : "") + `</div>` +
    `<div class="gl-panel">${chanceHtml}</div>` +
    (driveHtml ? `<details class="gl-panel gl-plays" data-drive="all"${card.glOpen && card.glOpen.all ? " open" : ""}>` +
      `<summary><span class="gl-eyebrow">Drive by drive</span><span class="gl-count">${drives.length} drive${drives.length === 1 ? "" : "s"}</span>` +
      `<i class="gl-chev" aria-hidden="true"></i></summary><div class="gl-drives">${driveHtml}</div></details>` : "") +
    `<p class="table-footnote">Our win chance plays the rest of the game out from the real score, clock and ball ` +
    `using our line. Plays and scores from ESPN.</p>`;
  const h2 = card.querySelector(".card-header h2"), sub = card.querySelector(".card-header .subtitle");
  if (h2) h2.textContent = live ? "Live" : "How it played out";
  if (sub && !live) sub.textContent = "Every play from ESPN, with our win chance after each one";
  card.hidden = false;
  glPlayers(data, sport);
  return live;
}

// A dot on each Players to watch bar for the yards so far.
function glPlayers(data, sport) {
  const rows = document.querySelectorAll(".pr-list li[data-name]");
  if (!rows.length) return;
  const cats = { "Passing yards": ["passing", "passingYards"], "Rushing yards": ["rushing", "rushingYards"],
                 "Receiving yards": ["receiving", "receivingYards"] };
  ((data.boxscore || {}).players || []).forEach(tp => {
    const tm = edgeTeamAbbr(tp.team || {});
    (tp.statistics || []).forEach(cat => {
      const stat = Object.keys(cats).find(k => cats[k][0] === cat.name);
      const at = stat ? (cat.keys || []).indexOf(cats[stat][1]) : -1;
      if (at < 0) return;
      (cat.athletes || []).forEach(a => {
        const yds = Number((a.stats || [])[at]);
        if (!Number.isFinite(yds)) return;
        rows.forEach(li => {
          if (li.dataset.stat !== stat || edgeFavKey(sport, li.dataset.team) !== edgeFavKey(sport, tm)) return;
          if (!glSamePlayer(li.dataset.name, a.athlete || {})) return;
          const track = li.querySelector(".pr-track");
          let dot = track && track.querySelector(".pr-live");
          if (track && !dot) { dot = edgeNode("span", "pr-live"); track.append(dot); }
          if (dot) dot.style.left = Math.min(100, Math.max(0, yds / (Number(li.dataset.top) || 1) * 100)) + "%";
          const small = li.querySelector(".pr-nums small");
          let so = li.querySelector(".pr-sofar");
          if (!so) { so = edgeNode("span", "pr-sofar"); li.querySelector(".pr-nums").insertBefore(so, small); }
          so.textContent = `${yds} so far`;
          const box = li.closest(".pr-list").parentElement, note = box && box.querySelector(".table-footnote");
          if (note && !note.querySelector(".pr-live-note"))
            note.append(edgeNode("span", "pr-live-note", " The blue dot is yards so far in this game, from ESPN."));
        });
      });
    });
  });
}

// --- Live view for basketball, hockey, baseball and soccer (extras.live_html
// with data-kind) ---
// The same card as football without the field: the score and clock, our win
// chance re-run along the game from the real score and the time left, and
// every play grouped by period. Basketball plays the rest of the game out as
// a bell curve around our margin (data-margin, data-sd); hockey, baseball and
// soccer as each team's goals or runs still to come (data-hr, data-ar), with
// a tie going to overtime or extra innings (data-ties="extra") or a draw.
const GL_KINDS = {
  "basketball/nba": { len: 2880, per: 720, n: 4, lab: q => `Q${q}`, name: q => q > 4 ? `OT${q > 5 ? q - 4 : ""}` : `Quarter ${q}` },
  "basketball/mens-college-basketball": { len: 2400, per: 1200, n: 2, lab: q => `H${q}`, name: q => q > 2 ? `OT${q > 3 ? q - 2 : ""}` : `${q === 1 ? "1st" : "2nd"} half` },
  "hockey/nhl": { len: 3600, per: 1200, n: 3, lab: q => `P${q}`, name: q => q > 4 ? "Shootout" : q > 3 ? "Overtime" : `Period ${q}` },
  "baseball/mlb": { len: 54, per: 6, n: 9, lab: q => String(q), name: q => `Inning ${q}` },
  soccer: { len: 5400, per: 2700, n: 2, lab: q => `H${q}`, name: q => q > 2 ? "Extra time" : `${q === 1 ? "1st" : "2nd"} half` },
};

function glNormal(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function glPois(lam, n) {
  const out = [];
  let p = Math.exp(-lam);
  for (let k = 0; k < n; k++) { out.push(p); p *= lam / (k + 1); }
  return out;
}

// [home win, draw, away win] from here: our home lead now and the share f of
// the game still to play.
function glOutcome(ds, lead, f) {
  if (ds.sd) {
    const mean = lead + Number(ds.margin) * f, spread = Number(ds.sd) * Math.sqrt(f);
    const h = spread < 0.3 ? (lead > 0 ? 1 : lead < 0 ? 0 : 0.5) : glNormal(mean / spread);
    return [h, 0, 1 - h];
  }
  const ph = glPois(Number(ds.hr) * f, 16), pa = glPois(Number(ds.ar) * f, 16);
  let h = 0, d = 0, a = 0;
  ph.forEach((x, i) => pa.forEach((y, j) => { const m = lead + i - j; if (m > 0) h += x * y; else if (m < 0) a += x * y; else d += x * y; }));
  if (ds.ties !== "draw") { h += d / 2; a += d / 2; d = 0; }
  const tot = h + d + a || 1;
  return [h / tot, d / tot, a / tot];
}

function glSecs(clock) {
  const s = String(clock || "0");
  if (!s.includes(":")) return Number.parseFloat(s) || 0;
  const [m, x] = s.split(":").map(Number);
  return (m || 0) * 60 + (x || 0);
}

// Every scoring moment and play as {t (game time used), hs, as (our home and
// away score after it), per, when, text, score, team}.
function glEvents(data, ds, cfg, flip) {
  const ours = (h, a) => flip ? [a, h] : [h, a];
  const out = [];
  if (ds.kind === "soccer") {
    let h = 0, a = 0;
    const homeId = String(((((data.header || {}).competitions || [])[0] || {}).competitors || []).find(c => c.homeAway === "home")?.team?.id || "");
    (data.keyEvents || []).forEach(e => {
      const type = (e.type || {}).type || "";
      if (["start-delay", "end-delay"].includes(type)) return;
      const per = (e.period || {}).number || 1;
      const t = Math.min(Number((e.clock || {}).value) || 0, per > 2 ? cfg.len : per * cfg.per);
      if (e.scoringPlay) { if (String((e.team || {}).id) === homeId) h++; else a++; }
      const [hs, as] = ours(h, a);
      out.push({ t, hs, as, per, when: (e.clock || {}).displayValue || "", text: e.text || (e.type || {}).text || "",
                 score: !!e.scoringPlay, team: (e.team || {}).id });
    });
    return out;
  }
  (data.plays || []).forEach(p => {
    const per = (p.period || {}).number || 1;
    let t, when;
    if (ds.kind === "baseball") {
      if (p.summaryType !== "N" && !p.scoringPlay) return;
      const half = (per - 1) * 2 + ((p.period || {}).type === "Bottom" ? 1 : 0);
      t = Math.min(half * 3 + (p.outs || 0), cfg.len + 3);
      when = `${(p.period || {}).type === "Bottom" ? "Bot" : "Top"} ${per}`;
    } else {
      if (ds.kind === "hockey" && !p.scoringPlay && !/Goal|Penalty|Period|Shootout/i.test((p.type || {}).text || "")) return;
      const left = glSecs((p.clock || {}).displayValue);
      t = per > cfg.n ? cfg.len + 1 : (per - 1) * cfg.per + (cfg.per - left);
      when = `${cfg.lab(per)} ${(p.clock || {}).displayValue || ""}`;
    }
    const [hs, as] = ours(p.homeScore || 0, p.awayScore || 0);
    out.push({ t, hs, as, per, when, text: String(p.text || "").trim(), score: !!p.scoringPlay, team: (p.team || {}).id });
  });
  return out.filter(e => e.text);
}

function glRenderOther(card, data, sport) {
  const ds = card.dataset, cfg = GL_KINDS[ds.kind === "soccer" ? "soccer" : ds.path];
  const comp = ((data.header || {}).competitions || [])[0] || {};
  const status = (comp.status || {}).type || {};
  if (!cfg || !status.state || status.state === "pre") return false;
  const sides = {};
  (comp.competitors || []).forEach(c => { sides[c.homeAway] = c; });
  if (!sides.home || !sides.away) return false;
  const abbr = c => edgeTeamAbbr(c.team || {});
  const lab = c => glLabel(sport, c), named = edgeNamesTeams(sport) ? " is-named" : "";
  const flip = edgeFavKey(sport, ds.away) === edgeFavKey(sport, abbr(sides.home));
  const away = flip ? sides.home : sides.away, home = flip ? sides.away : sides.home;
  const live = status.state === "in", post = status.state === "post";
  const events = glEvents(data, ds, cfg, flip);
  const sa = Number(away.score) || 0, sh = Number(home.score) || 0;

  // Game time now: the latest event's, or the clock in the header.
  const st = comp.status || {};
  let now = events.length ? events[events.length - 1].t : 0;
  if (ds.kind !== "baseball" && ds.kind !== "soccer" && st.period) {
    now = st.period > cfg.n ? cfg.len + 1 : (st.period - 1) * cfg.per + (cfg.per - glSecs(st.displayClock));
  } else if (ds.kind === "soccer" && st.clock != null) {
    now = Math.max(now, Math.min(Number(st.clock) || 0, cfg.len));
  }
  if (post) now = Math.max(now, cfg.len);

  // Our pick's chance along the game: on a grid of game time, from the score
  // at that moment.
  const pickDraw = ds.pick === "Draw";
  const pickHome = !pickDraw && edgeFavKey(sport, ds.pick) === edgeFavKey(sport, ds.home);
  const toPick = o => pickDraw ? o[1] : pickHome ? o[0] : o[2];
  // Share of the game left; past regulation, about an overtime period or an extra inning.
  const frac = t => t < cfg.len ? (cfg.len - t) / cfg.len : ({ soccer: 0, baseball: 3 / 54 }[ds.kind] ?? 300 / cfg.len);
  const scoreAt = t => { let h = 0, a = 0; events.forEach(e => { if (e.t <= t) { h = e.hs; a = e.as; } }); return [h, a]; };
  const steps = 160, span = Math.max(cfg.len, now);
  const times = [];
  for (let i = 0; i <= steps; i++) { const t = now * i / steps; times.push(t); }
  events.forEach(e => { if (e.score && e.t <= now) times.push(e.t, e.t + 1e-6); });
  times.sort((x, y) => x - y);
  const series = times.map(t => {
    const [h, a] = t >= now - 1e-9 && t > 0 ? [sh, sa] : scoreAt(t);
    if (post && t >= now - 1e-9) return toPick(sh > sa ? [1, 0, 0] : sh < sa ? [0, 0, 1] : ds.ties === "draw" ? [0, 1, 0] : [0.5, 0, 0.5]);
    return toPick(glOutcome(ds, h - a, frac(t)));
  });
  const chanceNow = series[series.length - 1];

  const color = c => /^[0-9a-f]{6}$/i.test((c.team || {}).color || "") ? "#" + c.team.color : "var(--text-faint)";
  const team = (c, side) => `<div class="gl-team gl-${side}${named}" style="--tc:${color(c)}"><b>${edgeEsc(lab(c))}</b>` +
    `<span class="gl-score">${edgeEsc(String(c.score ?? 0))}</span></div>`;
  const clock = post ? "Final" : (status.shortDetail || status.detail || "Live");
  const last = live && events.length ? events[events.length - 1].text : "";

  // Chart over game time with the periods marked.
  const W = 600, H = 160;
  const xy = (v, t) => [(t / span * W).toFixed(1), (H - v * H).toFixed(1)];
  const pts = series.map((v, i) => xy(v, times[i]).join(",")).join(" ");
  const [ex, ey] = xy(chanceNow, times[times.length - 1]);
  const marks = [], labs = [];
  for (let q = 1; q <= cfg.n; q++) {
    if (q < cfg.n || span > cfg.len) marks.push(`<line x1="${q * cfg.per / span * W}" x2="${q * cfg.per / span * W}" y1="0" y2="${H}" class="q"/>`);
    labs.push(`<span style="left:${(q - 0.5) * cfg.per / span * 100}%">${edgeEsc(cfg.lab(q))}</span>`);
  }
  const pickName = pickDraw ? "Draw" : pickHome ? lab(home) : lab(away);
  const up = pickDraw ? "Draw" : `${pickName} wins`, down = pickDraw ? "No draw" : `${pickHome ? lab(away) : lab(home)} wins`;
  const chart = `<div class="gl-plot"><span class="gl-up">${edgeEsc(up)} &uarr;</span><span class="gl-down">${edgeEsc(down)} &darr;</span>` +
    `<div class="gl-svg"><svg class="gl-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${marks.join("")}` +
    `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"></line><polyline points="${pts}"></polyline></svg>` +
    `<i class="gl-dot" style="left:${ex / W * 100}%;top:${ey / H * 100}%"></i></div>` +
    `<div class="gl-qs">${labs.join("")}</div></div>`;
  const start = { basketball: "tip-off", hockey: "puck drop", baseball: "first pitch", soccer: "kickoff" }[ds.kind] || "the start";
  const word = post ? { basketball: "at the final buzzer", hockey: "at the final horn", baseball: "after the last out" }[ds.kind] ||
    "at the final whistle" : "from right here";
  const chanceHtml = `<div class="gl-chance"><span class="gl-eyebrow">Our ${pickDraw ? "draw" : "win"} chance</span>` +
    `<div class="gl-now"><b>${Math.round(chanceNow * 100)}<small>%</small></b><span>${edgeEsc(pickName)}</span></div>` +
    `<p class="gl-sub">${word}. ${Math.round(series[0] * 100)}% at ${start}.</p>${chart}</div>`;

  // Plays by period, latest first; the period in progress open.
  const colorOf = {};
  [away, home].forEach(c => { colorOf[String(c.team.id)] = color(c); });
  const pers = [...new Set(events.map(e => String(e.per)))];
  const lastPer = pers[pers.length - 1];
  const perHtml = pers.slice().reverse().map((per, i) => {
    const list = events.filter(e => String(e.per) === per);
    const pts = list.filter(e => e.score).length;
    const rows = list.slice().reverse().map((e, j) => {
      const cls = [i === 0 && j === 0 && live ? "is-cur" : "", e.score ? "is-score" : ""].filter(Boolean).join(" ");
      return `<li${cls ? ` class="${cls}"` : ""}><span class="gl-when">${edgeEsc(e.when)}</span>` +
        `<span class="gl-text">${e.team && colorOf[String(e.team)] ? `<i class="gl-dot-team" style="background:${colorOf[String(e.team)]}"></i>` : ""}${edgeEsc(e.text)}</span></li>`;
    }).join("");
    const end = list[list.length - 1];
    const res = `${edgeEsc(lab(away))} ${end.as}, ${edgeEsc(lab(home))} ${end.hs}` + (pts ? ` · ${pts} scoring play${pts === 1 ? "" : "s"}` : "");
    const key = "p" + per;
    const open = card.glOpen && key in card.glOpen ? card.glOpen[key] : per === lastPer && live;
    return `<details class="gl-drive${pts ? " is-score" : ""}" data-drive="${key}"${open ? " open" : ""}><summary>` +
      `<b>${edgeEsc(cfg.name(Number(per)))}</b><span class="gl-res">${res}</span><i class="gl-chev" aria-hidden="true"></i></summary><ol>${rows}</ol></details>`;
  }).join("");
  const feedName = ds.kind === "soccer" ? "Match events" : ds.kind === "baseball" ? "Inning by inning" : ds.kind === "hockey" ? "Goals and penalties" : "Play by play";

  const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  card.querySelector(".gl-body").innerHTML =
    `<div class="gl-panel"><div class="gl-board${live ? " is-live" : ""}">${team(away, "away")}${team(home, "home")}</div>` +
    `<div class="gl-sit"><span class="gl-clock">${edgeEsc(clock)}</span></div>` +
    (last ? `<p class="gl-last">${edgeEsc(last)}</p>` : "") +
    (live ? `<p class="gl-upd">Updated ${at}. ESPN's feed runs about 10 to 30 seconds behind TV.</p>` : "") + `</div>` +
    `<div class="gl-panel">${chanceHtml}</div>` +
    (perHtml ? `<details class="gl-panel gl-plays" data-drive="all"${card.glOpen && card.glOpen.all ? " open" : ""}>` +
      `<summary><span class="gl-eyebrow">${feedName}</span><span class="gl-count">${events.length} event${events.length === 1 ? "" : "s"}</span>` +
      `<i class="gl-chev" aria-hidden="true"></i></summary><div class="gl-drives">${perHtml}</div></details>` : "") +
    `<p class="table-footnote">Our ${pickDraw ? "draw" : "win"} chance plays the rest of the game out from the real score and time left ` +
    `using our pregame numbers. Plays and scores from ESPN.</p>`;
  const h2 = card.querySelector(".card-header h2"), sub = card.querySelector(".card-header .subtitle");
  if (h2) h2.textContent = live ? "Live" : "How it played out";
  if (sub && !live) sub.textContent = "Every play from ESPN, with our win chance along the way";
  card.hidden = false;
  return live;
}

async function initLiveGame() {
  const card = document.querySelector(".gl[data-path]");
  if (!card) return;
  // Keep the drives a reader opened or closed open or closed when the card refreshes.
  card.glOpen = {};
  card.addEventListener("click", e => {
    const sum = e.target.closest(".gl-drive > summary, .gl-plays > summary");
    if (sum) card.glOpen[sum.parentElement.dataset.drive] = !sum.parentElement.open;
  });
  const site = gcLiveSite();
  if (!site) return;
  let id = null;
  // Gray outlines hold the card's place while ESPN answers, so the page
  // doesn't jump when the card fills in; they go away if there's nothing to show.
  const body = card.querySelector(".gl-body");
  const hold = () => {
    if (!card.hidden || card.glShown) return;
    const sk = (w, h, more) => `<span class="gl-sk" style="width:${w};height:${h}${more ? ";" + more : ""}"></span>`;
    body.innerHTML = `<div class="gl-panel gl-wait" aria-hidden="true"><div class="gl-sk-row">${sk("110px", "34px")}${sk("110px", "34px")}</div>` +
      `<div class="gl-sk-row">${sk("90px", "14px")}${sk("140px", "14px")}</div>${sk("100%", "auto", "aspect-ratio:3/1")}${sk("80%", "14px")}</div>` +
      `<div class="gl-panel gl-wait" aria-hidden="true">${sk("120px", "12px")}${sk("150px", "46px")}${sk("100%", "150px")}</div>`;
    card.classList.add("is-waiting");
    card.hidden = false;
  };
  const unhold = () => { if (card.classList.contains("is-waiting") && !card.glShown) { card.hidden = true; card.classList.remove("is-waiting"); } };
  const tick = async () => {
    if (Date.now() < new Date(card.dataset.start).getTime() - 5 * 60000) return 60000;
    hold();
    const wait = await fetchAndRender();
    if (card.glShown) card.classList.remove("is-waiting"); else unhold();
    return wait;
  };
  const fetchAndRender = async () => {
    if (!id) id = card.dataset.event || null;
    if (!id) {
      const e = gcLiveMatch(card, await gcLiveEvents(site, [card.dataset.day].filter(Boolean)), site.sport);
      if (!e) return 120000;
      id = e.id;
    }
    const data = await edgeFetchJson(`https://site.api.espn.com/apis/site/v2/sports/${card.dataset.path}/summary?event=${id}`, 8000);
    if (!data) return 60000;
    const state = ((((data.header || {}).competitions || [])[0] || {}).status || {}).type || {};
    if (!state.state || state.state === "pre") return 60000;
    const kind = card.dataset.kind || "football";
    const live = kind === "football" ? glRender(card, data, site.sport) : glRenderOther(card, data, site.sport);
    if (!body.querySelector(".gl-wait")) card.glShown = true;
    return live ? 30000 : null;
  };
  const loop = async () => { const wait = await tick(); if (wait) setTimeout(loop, wait); };
  loop();
}
initLiveGame();
