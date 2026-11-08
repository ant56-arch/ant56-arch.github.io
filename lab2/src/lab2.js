/* Lab 2: content tweaks that need a look at the text. Runs again whenever the
   page's own scripts redraw something. */
(() => {
  const hide = e => e && e.classList.add("ds-hide");
  const tidy = () => {
    // "NFL Edge · our picks to win": the page already says NFL
    document.querySelectorAll(".rb-eyebrow").forEach(e => { const t = e.textContent.replace(/^[A-Za-z ]+ Edge\s*·\s*/, ""); if (t !== e.textContent) e.textContent = t.charAt(0).toUpperCase() + t.slice(1); });
    // "League" over a column of league names
    document.querySelectorAll("th").forEach(e => { if (e.textContent.trim() === "League") e.textContent = ""; });
    // a spread pill showing a raw code instead of "Covered"
    document.querySelectorAll(".pill").forEach(e => { if (/^CO[0-9A-F]{6,}$/.test(e.textContent.trim())) e.textContent = "Covered"; });
    // headlines that say what the section found, from the numbers already on the page
    headlines();
    icons();
    loading();
  };

  // the headline as the page wrote it, so a redraw can be recognised
  const orig = el => (el.dataset.dsOrig = el.dataset.dsOrig || el.textContent.trim());
  const set = (el, text) => { if (el && el.textContent.trim() !== text) { orig(el); el.textContent = text; } };
  const num = s => Number(String(s).replace(/,/g, ""));
  const fmt = n => n.toLocaleString("en-US");
  function headlines() {
    // home: "A model for every season." -> "7 leagues, 1,273 games graded."
    const tally = document.getElementById("heroTally"), lg = document.getElementById("lgH2");
    const m = tally && tally.textContent.match(/([\d,]+) games graded/);
    if (lg && m) set(lg, `${document.querySelectorAll(".lt").length || 7} leagues, ${fmt(num(m[1]))} games graded.`);
    // home: "The calendar." -> "380-111 over the last six days."
    const cal = document.querySelector("#calendar h2"), rows = [...document.querySelectorAll("#cal .wl")];
    if (cal && rows.length) {
      let w = 0, l = 0; rows.forEach(r => { const x = (r.firstChild || r).textContent.match(/(\d+)\s*-\s*(\d+)/); if (x) { w += +x[1]; l += +x[2]; } });
      if (w + l) set(cal, `${w}-${l} over the last ${["", "day", "two days", "three days", "four days", "five days", "six days", "seven days"][rows.length] || rows.length + " days"}.`);
    }
    // accuracy pages: "How we've done." -> "95-44 this season."
    document.querySelectorAll("h2.sec-h2").forEach(h => {
      if (!/^How we.ve done\.?$/.test(orig(h))) return;
      const st = [...document.querySelectorAll(".stat")].find(s => /this season/i.test(s.textContent));
      const v = st && st.querySelector(".stat-value");
      if (v) set(h, `${v.textContent.trim()} this season.`);
    });
    // sport home: "Today's games." -> "8 games on Sun, Nov 8."
    document.querySelectorAll(".slate-sec").forEach(sec => {
      const h = sec.querySelector("h2.sec-h2"); if (!h || !/^Today.s (games|matches)\.?$/.test(orig(h))) return;
      const n = sec.querySelectorAll("a.gc").length, lab = sec.querySelector(".sec-label b"), day = lab && lab.textContent.split("·")[1];
      const many = /matches/.test(orig(h)) ? "matches" : "games", one = many === "matches" ? "match" : "game";
      if (n) set(h, `${n} ${n === 1 ? one : many}${day ? " on " + day.trim() : " today"}.`);
    });
    // betting: "Units" -> "+0.78 units on 1,202 picks"
    const units = [...document.querySelectorAll(".card-header h2")].find(h => orig(h) === "Units");
    const tile = document.querySelector(".money-tile");
    if (units && tile) {
      const u = tile.querySelector(".mt-num"), p = tile.querySelector(".mt-sub"), pk = p && p.textContent.match(/([\d,]+) picks/);
      if (u) set(units, `${u.textContent.trim().replace(/u$/, "")} units${pk ? " on " + fmt(num(pk[1])) + " picks" : ""}`);
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
    document.querySelectorAll("canvas").forEach(c => {
      const box = c.parentElement; if (!box) return;
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
