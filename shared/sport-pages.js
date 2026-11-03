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
// buttons filter both. The choice is saved for every sport site.
const SP_VIEW_KEY = "edge-board-view";
function initSlatePickers() {
  document.querySelectorAll(".sp-mount").forEach(mount => {
    let games = [];
    try { games = JSON.parse(mount.querySelector(".sp-data").textContent); } catch (e) { return; }
    if (!games.length) return;
    const scope = mount.parentElement;
    let view = "slate";
    try { if (localStorage.getItem(SP_VIEW_KEY) === "cards") view = "cards"; } catch (e) { /* storage blocked */ }
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
  const team = (c, side) => `<div class="gl-team gl-${side}${String(c.team.id) === poss && live ? " has-ball" : ""}" style="--tc:${color(c)}">` +
    `<b>${edgeEsc(abbr(c))}</b><span class="gl-score">${edgeEsc(String(c.score ?? 0))}</span></div>`;
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
  const pick = pickHome ? abbr(home) : abbr(away), other = pickHome ? abbr(away) : abbr(home);
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
  const team = (c, side) => `<div class="gl-team gl-${side}" style="--tc:${color(c)}"><b>${edgeEsc(abbr(c))}</b>` +
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
  const pickName = pickDraw ? "Draw" : pickHome ? abbr(home) : abbr(away);
  const up = pickDraw ? "Draw" : `${pickName} wins`, down = pickDraw ? "No draw" : `${pickHome ? abbr(away) : abbr(home)} wins`;
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
    const res = `${edgeEsc(abbr(away))} ${end.as}, ${edgeEsc(abbr(home))} ${end.hs}` + (pts ? ` · ${pts} scoring play${pts === 1 ? "" : "s"}` : "");
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
  const tick = async () => {
    if (Date.now() < new Date(card.dataset.start).getTime() - 5 * 60000) return 60000;
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
    return (kind === "football" ? glRender(card, data, site.sport) : glRenderOther(card, data, site.sport)) ? 30000 : null;
  };
  const loop = async () => { const wait = await tick(); if (wait) setTimeout(loop, wait); };
  loop();
}
initLiveGame();
