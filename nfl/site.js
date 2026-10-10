// NFL Edge site behavior: sortable tables, the week-archive picker, and
// trend charts (Chart.js, loaded via CDN in each page's <head>).

function makeSortable(table) {
  const tbody = table.tBodies[0];
  table.querySelectorAll("th[data-sort-key]").forEach((th, colIndex) => {
    // Keyboard-operable like a real button: focusable, activates on
    // Enter/Space, and announces its current sort direction.
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
      rows.sort((a, b) => {
        const av = a.querySelector(`[data-key="${key}"]`)?.dataset.value ?? "";
        const bv = b.querySelector(`[data-key="${key}"]`)?.dataset.value ?? "";
        if (isNumeric) return asc ? parseFloat(av) - parseFloat(bv) : parseFloat(bv) - parseFloat(av);
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      // Sorting collapses any day-group headers - they only make sense in
      // chronological order, not after re-sorting by an arbitrary column.
      tbody.querySelectorAll(".day-header").forEach(r => r.remove());
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

document.querySelectorAll("table.data[data-sortable]").forEach(makeSortable);

// --- Shared week-picker: populates a <select> from {week_order, weeks} and
// re-renders a content div on change. Used by both history.html (every
// graded week, all seasons - defaults to the most recent) and teams.html
// (the current season, past + upcoming - defaults to the current week,
// picked via pickDefault since "most recent" there would land on the
// season finale). ---
function buildWeekPicker(data, selectId, contentId, renderWeek, pickDefault) {
  const picker = document.getElementById(selectId);
  const container = document.getElementById(contentId);
  if (!picker || !container || !data) return;

  function render(weekKey) {
    const week = data.weeks[weekKey];
    container.innerHTML = week ? renderWeek(week) : "<p class='muted'>No data for this week.</p>";
  }

  data.week_order.forEach(wk => {
    const opt = document.createElement("option");
    opt.value = wk;
    opt.textContent = data.weeks[wk].label;
    picker.appendChild(opt);
  });
  picker.addEventListener("change", () => render(picker.value));
  if (data.week_order.length) {
    picker.value = pickDefault ? pickDefault(data) : data.week_order[data.week_order.length - 1];
    render(picker.value);
  }
}

// --- Week archive picker (history.html) - all seasons, graded only ---
function initHistoryPicker() {
  if (typeof HISTORY_DATA === "undefined") return;
  buildWeekPicker(HISTORY_DATA, "week-select", "week-content", (week) => {
    let rows = "";
    week.games.forEach(g => {
      rows += `<tr>
        <td>${g.away_team} @ ${g.home_team}<div class="faint" style="font-size:13px;">Final: ${g.away_score}-${g.home_score}</div></td>
        <td class="num mono" data-label="Model Pick">${g.model_pick}</td>
        <td class="num mono" data-label="Result">${g.model_correct ? "<span class='pill pill-positive'>HIT</span>" : "<span class='pill pill-danger'>MISS</span>"}</td>
        <td class="num mono" data-label="Vegas Pick">${g.vegas_pick}</td>
        <td class="num mono" data-label="Result">${g.vegas_correct ? "<span class='pill pill-positive'>HIT</span>" : "<span class='pill pill-danger'>MISS</span>"}</td>
      </tr>`;
    });
    return `<table class="data responsive-stack">
        <thead><tr><th>Matchup</th><th class="num">Model Pick</th><th class="num">Result</th><th class="num">Vegas Pick</th><th class="num">Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  });
}
initHistoryPicker();

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
      rows += `<tr>
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
      <div class="table-footnote muted">Result shows the final score once graded. Moneyline is our pick at the book's price, with our win chance vs the book's (vig removed); VALUE means an edge of 6 points or more.</div>`;
  }, (data) => data.default_week || data.week_order[data.week_order.length - 1]);
}
initTeamsPicker();

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
  // CBB Edge has no games.json yet, so it shows on the home page only.
  { sport: "CBB", summary: "/cbb/summary.json", games: null,
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
    return { leader, abbr: t.abbreviation || "", short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner, record: record ? record.summary : null,
             probable: probable ? probable.shortName : null, color: t.color ? "#" + t.color : "" };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  const lastPlay = ((comp.situation || {}).lastPlay || {}).text || "";
  return { id: String(ev.id), start: ev.date, lastPlay, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           tv: tv.slice(0, 2).join(", "), neutral: !!comp.neutralSite, away: team(sides.away), home: team(sides.home) };
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
    (published.games || []).forEach(g => { if (g.pick) picks[g.id] = g.pick; });
    let games = live.events.map(edgeParseEspn).filter(Boolean);
    if (published.top25_only) games = games.filter(g => g.away.rank || g.home.rank);
    games.forEach(g => { if (picks[g.id]) g.pick = picks[g.id]; });
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
  { k: "theme", label: "Theme", on: "dark", choices: [["dark", "Dark"], ["light", "Light"], ["device", "Match my device"]] },
  { group: "Home page" },
  { k: "homeLayout", label: "Games view", on: "auto", choices: [["auto", "Cards (list on phones)"], ["cards", "Cards"], ["list", "List"]] },
  { k: "homeDay", label: "Opens on", on: "auto", choices: [["auto", "First day with games"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["weekend", "Weekend"]] },
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

function initSiteSettings() {
  edgeApplyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", edgeApplyTheme);
  if (document.body) {
    edgeLocalize(document.body);
    // Pages that draw parts with script (the home page, Schedule) get the same.
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 || n.nodeType === 3) edgeLocalize(n.nodeType === 1 ? n : n.parentNode);
    }))).observe(document.body, { childList: true, subtree: true });
  }
  const bar = document.querySelector(".topbar-inner");
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

function edgeTickerItem(site, g, mine) {
  return () => {
    const a = edgeNode("a", "crawl-item" + (g.state === "in" ? " is-live" : ""));
    a.href = site.schedule;
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
      team.append(edgeNode("span", null, t.abbr || t.short));
      if (g.state !== "pre" && t.score != null) team.append(edgeNode("b", null, String(t.score)));
      a.append(team);
    });
    a.append(edgeNode("span", "crawl-status", edgeGameStatus(g)));
    if (edgeSettings().picks && g.pick && g.pick.text) {
      const pick = edgeNode("span", "crawl-pick");
      pick.append(edgeNode("span", null, "Pick: " + g.pick.text));
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

function edgeFavs() {
  const favs = edgeStore(EDGE_FAV_KEY);
  return new Set(Array.isArray(favs) ? favs.map(k => EDGE_FAV_ALIAS[k] || k) : []);
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
            if (!t || !t.abbreviation || seen.has(t.abbreviation)) return;
            seen.set(t.abbreviation, { abbr: t.abbreviation, name: t.displayName || t.shortDisplayName || t.abbreviation,
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
    if (!list.childElementCount) list.append(edgeNode("p", "team-picker-none", "Loading teams."));
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
  [win, lose].filter(t => t.score >= 130).forEach(t => notes.push(`${t.abbr} scored ${t.score}`));
  const stars = [g.away, g.home].map(t => t.leader).filter(l => l && l.pts >= 40);
  stars.forEach(l => notes.push(`${l.name} ${l.pts} pts`));
  if (!notes.length) return null;
  const what = stars.length ? `${stars[0].pts}-point night` : /OT/.test(g.detail || "") ? "Overtime final" : win.score - lose.score >= 20 ? "Blowout" : "Big final";
  return { id: `${site.sport}:${g.id}:final`, sport: site.sport, href: site.schedule, t: Date.now(),
           teams: [g.away.abbr, g.home.abbr], what, team: win.short || win.abbr, logo: win.logo, color: win.color,
           text: notes.join(" \u00b7 "), score: `${win.abbr} ${win.score}, ${lose.abbr} ${lose.score}`, clock: "Final" };
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
        fresh.push({ id: `${key}:${now}`, sport: site.sport, href: site.schedule, t: Date.now(),
                     teams: [g.away.abbr, g.home.abbr],
                     what: edgeScoreWord(site.sport, now - before), team: team.short || team.abbr,
                     logo: team.logo, color: team.color, text: EDGE_SCORING_TEXT.test(g.lastPlay || "") ? g.lastPlay : "",
                     score: `${team.abbr} ${now}, ${other.abbr} ${other.score}`,
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

// --- Motion and record helpers (home page and sport pages) ---
// Sliding tab highlight, rolling score digits, records that count up, and
// the per-day results (summary.json "daily": [[date, wins, losses], ...])
// behind trend lines, the record chart and the Model tab's results
// calendar. Streak badges read "ml_streak": moneyline picks won or lost in
// a row. Every animation is skipped for prefers-reduced-motion.
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

// A badge for summary.json "ml_streak" ({kind: "W"|"L", n}): moneyline
// picks won or lost in a row, one game at a time. null without one.
function edgeStreakBadge(s) {
  if (!s || !s.n) return null;
  const won = s.kind === "W";
  const b = edgeNode("span", "streak " + (won ? "is-w" : "is-l"), s.kind + s.n);
  b.title = `${won ? "Won" : "Lost"} the last ${s.n === 1 ? "" : s.n + " "}moneyline ${s.n === 1 ? "pick" : "picks"}`;
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
  Chart.defaults.font.family = "'Barlow', 'Helvetica Neue', Arial, sans-serif";
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
initEdgeCharts();

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
