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
