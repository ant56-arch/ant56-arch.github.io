/* Lab 2: content tweaks that need a look at the text. Runs again whenever the
   page's own scripts redraw something. */
(() => {
  const hide = e => e && e.classList.add("ds-hide");
  const tidy = () => {
    // "NFL Edge · our picks to win": the page already says NFL
    document.querySelectorAll(".rb-eyebrow").forEach(e => { const t = e.textContent.replace(/^[A-Za-z ]+ Edge\s*·\s*/, ""); if (t !== e.textContent) e.textContent = t.charAt(0).toUpperCase() + t.slice(1); });
    // "League" over a column of league names
    document.querySelectorAll("th").forEach(e => { if (e.textContent.trim() === "League") e.textContent = ""; });
    repeats();
    icons();
    loading();
  };

  // the same number shown twice in one place: keep the first, drop the echo
  function repeats() {
    // game cards: the pick's chance is on its team row, so the footer doesn't repeat it
    document.querySelectorAll("a.gc").forEach(c => {
      const rows = [...c.querySelectorAll(".gc-team .gc-num")].map(e => e.textContent.trim());
      c.querySelectorAll(".gc-pct").forEach(e => { if (rows.includes(e.textContent.trim())) e.classList.add("ds-hide"); });
      // "79% for PHI, we say 78%": our 78% is right above
      c.querySelectorAll("dd small").forEach(e => { e.textContent = e.textContent.replace(/,\s*we say \d+%/, ""); });
    });
    // results tables: "We give OKC 76%" sits next to the 76% win chance column
    document.querySelectorAll(".ml-sub").forEach(e => {
      const row = e.closest("tr"), prob = row && row.querySelector("td.prob");
      if (prob) e.textContent = e.textContent.replace(new RegExp("\\s*·?\\s*We give \\S+ " + prob.textContent.trim().replace("%", "\\%") + ",?\\s*"), " · ").replace(/ · $/, "").replace(/ ·  · /, " · ");
    });
    // day headers: "Sat, Nov 7, 2026: 6-1 · Moneyline 6-1"
    document.querySelectorAll(".section-label, h3, .day-head").forEach(e => {
      if (e.children.length) return;
      const t = e.textContent.replace(/(:\s*(\d+-\d+(?:-\d+)?))\s*·\s*Moneyline\s+\2\s*$/i, "$1");
      if (t !== e.textContent) e.textContent = t;
    });
    // accuracy: the moneyline record is the season record again, so show its units
    const stats = [...document.querySelectorAll(".statline .stat")];
    const season = stats.find(s => /^this season$/i.test(s.querySelector(".stat-label")?.textContent.trim() || ""));
    const ml = stats.find(s => /^moneyline$/i.test(s.querySelector(".stat-label")?.textContent.trim() || ""));
    if (season && ml) {
      const v = ml.querySelector(".stat-value"), sub = ml.querySelector(".stat-sub"), u = sub && sub.textContent.match(/^([+−-]?[\d.]+) units?,?\s*(.*)$/);
      if (v && u && v.textContent.trim() === season.querySelector(".stat-value").textContent.trim()) { v.textContent = u[1] + "u"; sub.textContent = u[2]; }
    }
  }

  // arrows drawn as text become the same stroked icon as the settings gear
  const ARROW = { "←": "M15 6l-6 6 6 6M9 12h12", "→": "M9 6l6 6-6 6M15 12H3", "↓": "M6 9l6 6 6-6M12 15V3" };
  function icons() {
    document.querySelectorAll("button, i, .arrows button").forEach(e => {
      const t = e.textContent.trim(); if (!ARROW[t] || e.children.length) return;
      e.innerHTML = `<svg class="ds-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ARROW[t]}"/></svg>`;
    });
  }

  // a shimmer where something is still loading: charts waiting on their script, "Loading..." text
  const started = Date.now();
  function loading() {
    document.querySelectorAll(".chart-card > canvas").forEach(c => {
      const box = c.parentElement;
      const drawn = window.Chart && window.Chart.getChart && window.Chart.getChart(c);
      box.classList.toggle("ds-loading", !drawn && Date.now() - started < 10000 && !box.textContent.match(/couldn.t load/i));
    });
    document.querySelectorAll("p, span, div, li").forEach(e => {
      if (e.children.length) return;
      e.classList.toggle("ds-loading-text", /^Loading\b/.test(e.textContent.trim()));
    });
    if (Date.now() - started < 10500 && document.querySelector(".ds-loading")) setTimeout(run, 500);
  }

  let t = 0;
  const run = () => { clearTimeout(t); t = setTimeout(() => { mo.disconnect(); tidy(); mo.observe(document.body, { childList: true, subtree: true }); }, 50); };
  const mo = new MutationObserver(run);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
