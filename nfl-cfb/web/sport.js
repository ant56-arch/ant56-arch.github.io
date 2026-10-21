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


// --- Ratings: the top 25 until "Show all" opens the rest ---
document.querySelectorAll("[data-show-all]").forEach(btn => {
  btn.addEventListener("click", () => {
    const table = btn.previousElementSibling;
    if (table) table.classList.remove("is-short");
    btn.remove();
  });
});
