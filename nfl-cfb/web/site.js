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
// (the full 2026 season, past + upcoming - defaults to the current week,
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

// --- Season week picker (teams.html) - 2026 only, past + upcoming ---
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

// --- Trend charts (accuracy.html) ---
function initCharts() {
  if (typeof ACCURACY_DATA === "undefined") return;
  // The chart boxes ship with a static skeleton (data-state="loading"); if
  // the CDN script never arrived, say so instead of leaving blank boxes.
  if (typeof Chart === "undefined") {
    document.querySelectorAll(".chart-card").forEach(c => c.dataset.state = "failed");
    return;
  }
  Chart.defaults.font.family = "'Barlow', 'Helvetica Neue', Arial, sans-serif";
  Chart.defaults.animation = false;
  const labels = ACCURACY_DATA.labels;

  function lineChart(canvasId, title, usSeries, vegasSeries, formatFn) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    el.closest(".chart-card")?.setAttribute("data-state", "ready");
    new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Our model", data: usSeries, borderColor: "#e5793b", backgroundColor: "#e5793b", pointRadius: 3, borderWidth: 2, tension: 0 },
          { label: "Vegas", data: vegasSeries, borderColor: "#8db4d8", backgroundColor: "#8db4d8", pointRadius: 3, borderWidth: 2, tension: 0 },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: title, align: "start", font: { size: 15, weight: "bold" }, color: "#ecebe7" },
          legend: { display: true, position: "top", align: "start", labels: { color: "#ecebe7", font: { size: 13 }, boxWidth: 12, boxHeight: 2 } },
          tooltip: {
            backgroundColor: "#1a1b1d", borderColor: "#45484e", borderWidth: 1, cornerRadius: 6,
            titleColor: "#ecebe7", bodyColor: "#a8a7a1",
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatFn(ctx.parsed.y)}` },
          },
        },
        scales: {
          y: { ticks: { color: "#a8a7a1" }, grid: { color: "#2b2d31" }, border: { display: false } },
          x: { ticks: { color: "#a8a7a1" }, grid: { display: false }, border: { color: "#45484e" } },
        },
      },
    });
  }

  lineChart("chart-accuracy", "Straight-Up Pick Accuracy by Week", ACCURACY_DATA.us_accuracy, ACCURACY_DATA.vegas_accuracy, (v) => (v * 100).toFixed(0) + "%");
  lineChart("chart-spread-mae", "Spread Error by Week (points off actual margin, lower = sharper)", ACCURACY_DATA.us_spread_mae, ACCURACY_DATA.vegas_spread_mae, (v) => "±" + v.toFixed(1));
  lineChart("chart-brier", "Win Probability Calibration by Week (Brier score, lower = sharper)", ACCURACY_DATA.us_brier, ACCURACY_DATA.vegas_brier, (v) => v.toFixed(3));
}
initCharts();

// --- Score ticker (shared by every Edge site) ---
// Two scrolling bars under the top bar, for MLB and the NFL only: a score
// ticker (live games first, then games still to play, then finals; each opens
// the Schedule tab) and a red bar of scoring plays seen in the last 3 hours.
// Each site's build publishes games.json (ESPN's current slate plus our picks)
// next to its summary.json; the ticker asks ESPN for fresh scores in the
// browser every 30 seconds while a game is live (every 2 minutes while a game
// starts within 6 hours). A gear in the top bar turns each bar, score pop-ups
// and each sport on or off (saved in localStorage). Keep this block identical
// in home.js (repo root), nfl-cfb/web/site.js and mlb-nba-cbb/web/site.js.
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
];
const EDGE_LIVE_POLL = 30000;   // while a game is live
const EDGE_IDLE_POLL = 120000;  // while a game starts within EDGE_SOON
const EDGE_SOON = 6 * 3600000;
const EDGE_TICKER_SPORTS = ["MLB", "NFL"];
const EDGE_SCORES_KEY = "edge-ticker-scores";
const EDGE_PLAYS_KEY = "edge-ticker-plays";
const edgeTicker = { published: {}, slates: {}, plays: [], flash: new Set(), crawlStart: {}, toasts: null, settings: null };

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

// --- Ticker settings: a gear in the top bar opens switches for each bar ---
const EDGE_SETTINGS_KEY = "edge-ticker-settings";
const EDGE_SETTINGS = [
  { k: "ticker", label: "Score ticker", sub: "A scrolling bar of MLB and NFL games", on: true },
  { k: "plays", label: "Scoring plays", sub: "A red bar with each run, touchdown and field goal", on: true },
  { k: "popups", label: "Score pop-ups", sub: "A card in the corner when a team scores", on: false },
  { k: "MLB", label: "MLB", sub: "Show baseball games", on: true, sport: true },
  { k: "NFL", label: "NFL", sub: "Show NFL games", on: true, sport: true },
];

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
    EDGE_SETTINGS.forEach(s => { edgeTicker.settings[s.k] = typeof saved[s.k] === "boolean" ? saved[s.k] : s.on; });
  }
  return edgeTicker.settings;
}

function initTickerSettings() {
  const bar = document.querySelector(".topbar-inner");
  if (!bar || bar.querySelector(".ticker-gear")) return;
  const wrap = edgeNode("div", "ticker-settings");
  const btn = edgeNode("button", "ticker-gear");
  btn.type = "button";
  btn.setAttribute("aria-label", "Ticker settings");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "ticker-panel");
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  const panel = edgeNode("div", "ticker-panel");
  panel.id = "ticker-panel";
  panel.hidden = true;
  panel.append(edgeNode("div", "ticker-panel-title", "Ticker settings"));
  const settings = edgeSettings();
  EDGE_SETTINGS.forEach((s, i) => {
    if (s.sport && !EDGE_SETTINGS[i - 1].sport) panel.append(edgeNode("div", "ticker-panel-sub", "Sports"));
    const row = edgeNode("label", "ticker-switch");
    const text = edgeNode("span", "ticker-switch-text");
    text.append(edgeNode("span", "ticker-switch-label", s.label), edgeNode("span", "ticker-switch-sub", s.sub));
    const input = edgeNode("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = settings[s.k];
    input.addEventListener("change", () => {
      settings[s.k] = input.checked;
      edgeStore(EDGE_SETTINGS_KEY, settings);
      edgeRenderTicker();
    });
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

// --- Score ticker and scoring plays (shared by every Edge site) ---
// What a score is called, by sport and points scored.
function edgeScoreWord(sport, pts) {
  if (sport === "NFL" || sport === "CFB") {
    return { 6: "Touchdown", 7: "Touchdown", 8: "Touchdown", 3: "Field goal", 2: "2 points", 1: "Extra point" }[pts] || `+${pts}`;
  }
  if (sport === "MLB") return pts === 1 ? "Run scores" : `${pts} runs score`;
  if (sport === "NHL") return pts === 1 ? "Goal" : `${pts} goals`;
  return `+${pts}`;
}

// A pop-up when a team scores (off unless turned on in the ticker settings):
// the scoring team in its color, the new score and the game clock.
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
// twice in a row and slide left forever; a rebuild keeps the bar where it was
// in its loop, so a score update doesn't jump it back to the start.
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
  // About 60px a second, measured once the items are on the page.
  const width = run.scrollWidth / 2;
  const secs = Math.max(20, width / 60);
  const t0 = edgeTicker.crawlStart[cls] || (edgeTicker.crawlStart[cls] = Date.now());
  run.style.animationDuration = secs + "s";
  run.style.animationDelay = -(((Date.now() - t0) / 1000) % secs) + "s";
}

function edgeTickerItem(site, g) {
  return () => {
    const a = edgeNode("a", "crawl-item" + (g.state === "in" ? " is-live" : ""));
    a.href = site.schedule;
    a.append(edgeNode("span", "crawl-sport", site.sport));
    [g.away, g.home].forEach(t => {
      const team = edgeNode("span", "crawl-team" + (g.state === "post" && t.winner ? " is-winner" : "") +
                            (edgeTicker.flash.has(`${site.sport}:${g.id}:${t === g.away ? "away" : "home"}`) ? " just-scored" : ""));
      if (t.logo) {
        const img = edgeNode("img", "crawl-logo");
        img.src = t.logo;
        img.alt = "";
        team.append(img);
      }
      team.append(edgeNode("span", null, t.abbr || t.short));
      if (g.state !== "pre" && t.score != null) team.append(edgeNode("b", null, String(t.score)));
      a.append(team);
    });
    a.append(edgeNode("span", "crawl-status", edgeGameStatus(g)));
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

function edgeRenderTicker() {
  const settings = edgeSettings();
  const t = g => new Date(g.start).getTime() || 0;
  const items = [];
  // Live games first, then games still to play, then finals.
  ["in", "pre", "post"].forEach(state => {
    EDGE_TICKER_SPORTS.forEach(sport => {
      const slate = edgeTicker.slates[sport];
      if (!settings[sport] || !slate) return;
      const site = EDGE_SITES.find(s => s.sport === sport);
      slate.games.filter(g => g.state === state)
        .sort((a, b) => (state === "post" ? t(b) - t(a) : t(a) - t(b)))
        .forEach(g => items.push(edgeTickerItem(site, g)));
    });
  });
  edgeCrawl("crawl-ticker", "Scores", settings.ticker ? items : []);
  const plays = edgeTicker.plays.filter(p => settings[p.sport]).map(edgePlayItem);
  edgeCrawl("crawl-plays", "Scoring", settings.plays ? plays : []);
}

async function initScoreboard() {
  // The old strip is replaced by the two bars.
  document.querySelectorAll(".scoreboard").forEach(n => n.remove());
  initTickerSettings();
  const sites = EDGE_TICKER_SPORTS.map(sport => EDGE_SITES.find(s => s.sport === sport));
  const slates = await Promise.all(sites.map(edgeLoadGames));
  // Scores from the last read, kept across pages for 15 minutes so moving
  // between pages doesn't miss a score or count one twice.
  const saved = edgeStore(EDGE_SCORES_KEY);
  const last = saved && Date.now() - saved.t < 15 * 60000 ? saved.scores : null;
  const scores = Object.assign({}, last || {});
  const fresh = [];
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
                     what: edgeScoreWord(site.sport, now - before), team: team.short || team.abbr,
                     logo: team.logo, color: team.color, text: g.lastPlay || "",
                     score: `${team.abbr} ${now}, ${other.abbr} ${other.score}`,
                     clock: g.state === "post" ? "Final" : g.detail });
      });
    });
  });
  edgeStore(EDGE_SCORES_KEY, { t: Date.now(), scores });
  // Scoring plays from the last 3 hours, newest first, kept across pages.
  const kept = (edgeStore(EDGE_PLAYS_KEY) || []).filter(p => Date.now() - p.t < 3 * 3600000);
  const plays = fresh.reverse().concat(kept.filter(p => !fresh.some(f => f.id === p.id))).slice(0, 12);
  edgeStore(EDGE_PLAYS_KEY, plays);
  edgeTicker.plays = plays;
  edgeRenderTicker();
  if (edgeSettings().popups) fresh.slice(0, 3).forEach(edgeScoreToast);
  const now = Date.now();
  const all = slates.flatMap(s => (s ? s.games : []));
  if (all.some(g => g.state === "in")) setTimeout(initScoreboard, EDGE_LIVE_POLL);
  else if (all.some(g => g.state === "pre" && t(g) - now < EDGE_SOON && now - t(g) < EDGE_SOON)) setTimeout(initScoreboard, EDGE_IDLE_POLL);
  function t(g) { return new Date(g.start).getTime() || 0; }
}
initScoreboard();

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
