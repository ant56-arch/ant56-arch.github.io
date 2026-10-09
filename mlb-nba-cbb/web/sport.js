// MLB Edge site behavior: sortable tables, the History day picker, and the
// Accuracy charts (Chart.js, loaded via CDN on that page). Same patterns as
// NFL Edge's web/site.js.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function makeSortable(table) {
  const tbody = table.tBodies[0];
  table.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.tabIndex = 0;
    th.setAttribute("aria-sort", "none");
    th.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); }
    });
    th.addEventListener("click", () => {
      const rows = Array.from(tbody.querySelectorAll("tr"));
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
          // Blank values (no stat yet) always sort last.
          const av = parseFloat(val(a)), bv = parseFloat(val(b));
          if (isNaN(av)) return 1;
          if (isNaN(bv)) return -1;
          return asc ? av - bv : bv - av;
        }
        return asc ? val(a).localeCompare(val(b)) : val(b).localeCompare(val(a));
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}
document.querySelectorAll("table.data[data-sortable]").forEach(makeSortable);

// --- History day picker ---
function resultPill(p) {
  if (p.void) return "<span class='pill pill-void'>NO DECISION</span>";
  if (p.got_hit === null) return "<span class='faint'>Pending</span>";
  const line = `${p.hits}-for-${p.at_bats}`;
  return p.got_hit
    ? `${line} <span class='pill pill-positive'>HIT</span>`
    : `${line} <span class='pill pill-danger'>MISS</span>`;
}

function initHistoryPicker() {
  if (typeof HISTORY_DATA === "undefined") return;
  const picker = document.getElementById("day-select");
  const container = document.getElementById("day-content");
  if (!picker || !container) return;

  function render(day) {
    const d = HISTORY_DATA.days[day];
    let rows = "";
    d.picks.forEach(p => {
      const prob = p.confidence === null ? "<span class='faint'>-</span>" : `${p.confidence.toFixed(0)}%`;
      rows += `<tr>
        <td><div class="player-name">${esc(p.player_name)}</div><div class="player-meta">${esc(p.matchup)}</div></td>
        <td class="num prob" data-label="Hit chance">${prob}</td>
        <td class="num" data-label="Result"><span>${resultPill(p)}</span></td>
      </tr>`;
    });
    const s = d.summary;
    const note = d.legacy
      ? "<div class='table-footnote'>Picked by the old weighted-score model, which didn't produce a real hit chance.</div>"
      : "";
    container.innerHTML = `<div class="section-label">${esc(d.label)}: ${s.hits} of ${s.graded} got a hit${s.voided ? `, ${s.voided} no decision` : ""}</div>
      <table class="data responsive-stack">
        <thead><tr><th>Player</th><th class="num">Hit chance</th><th class="num">Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>${note}`;
  }

  HISTORY_DATA.order.forEach(day => {
    const opt = document.createElement("option");
    opt.value = day;
    opt.textContent = HISTORY_DATA.days[day].label;
    picker.appendChild(opt);
  });
  picker.addEventListener("change", () => render(picker.value));
  picker.value = HISTORY_DATA.order[0];
  render(picker.value);
}
initHistoryPicker();

