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
    const picker = edgeSlatePicker({ filters: true, withDay: new Set(games.map(g => g.date)).size > 1 });
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
  let hit = null;
  if (p === "Draw") hit = away.score === home.score;
  else if (away.score !== home.score) hit = (p === card.dataset.away) === (away.score > home.score);
  if (hit === null) return;
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
