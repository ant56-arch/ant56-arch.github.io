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

