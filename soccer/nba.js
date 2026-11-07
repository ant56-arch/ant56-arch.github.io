// Day picker for game picks: NBA Edge's History tab (NBA_HISTORY) and MLB
// Edge's Games tab (GAME_HISTORY). site.js handles sorting and the Accuracy
// charts; this renders one day of game picks.

function nbaResult(g) {
  if (g.void) return "<span class='pill pill-void'>NO DECISION</span>";
  if (g.correct === null) return "<span class='faint'>Pending</span>";
  const pillHtml = g.correct
    ? "<span class='pill pill-positive'>WIN</span>"
    : "<span class='pill pill-danger'>LOSS</span>";
  return `${edgeEsc(g.score)} ${pillHtml}`;
}

// The moneyline bet: "BUF to win +135", the model's pick, and VALUE at a 6+ point edge. The bet is
// always on our pick, so whether it won is the Result column's (units live on the Betting tab).
function nbaMoneyline(m) {
  if (!m) return "<span class='faint'>No odds</span>";
  const value = m.value ? " <span class='pill pill-primary'>VALUE</span>" : "";
  return `<div class="ml"><div class="ml-pick">${edgeEsc(m.text)}${value}</div>
    <div class="ml-sub">${edgeEsc(m.detail)}</div>${m.locked ? `<div class="lock-note locked">Locked ${edgeEsc(m.locked)}</div>` : ""}</div>`;
}

function initNbaHistory() {
  const H = typeof NBA_HISTORY !== "undefined" ? NBA_HISTORY
    : typeof GAME_HISTORY !== "undefined" ? GAME_HISTORY : null;
  if (!H) return;
  const picker = document.getElementById("day-select");
  const container = document.getElementById("day-content");
  if (!picker || !container) return;

  function render(day) {
    const d = H.days[day];
    const hasMl = d.games.some(g => g.ml);  // days before moneyline picks have none
    const rows = d.games.map(g => `<tr>
        <td><div class="player-name">${edgeEsc(g.matchup)}</div>${g.meta ? `<div class="player-meta">${edgeEsc(g.meta)}</div>` : ""}</td>
        <td data-label="Pick"><span class="matchup-team">${edgeEsc(g.pick)}</span></td>
        <td class="num prob" data-label="Win chance">${g.prob.toFixed(0)}%</td>
        ${hasMl ? `<td data-label="Moneyline bet" class="ml-cell">${nbaMoneyline(g.ml)}</td>` : ""}
        <td class="num" data-label="Result"><span>${nbaResult(g)}</span></td>
      </tr>`).join("");
    const s = d.summary;
    const ml = s.ml ? ` · Moneyline ${s.ml.wins}-${s.ml.losses}` : "";
    container.innerHTML = `<div class="section-label">${edgeEsc(d.label)}: ${s.wins}-${s.losses}${s.voided ? `, ${s.voided} no decision` : ""}${ml}</div>
      <table class="data responsive-stack">
        <thead><tr><th>Game</th><th>Pick</th><th class="num">Win chance</th>${hasMl ? "<th>Moneyline bet</th>" : ""}<th class="num">Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  H.order.forEach(day => {
    const opt = document.createElement("option");
    opt.value = day;
    opt.textContent = H.days[day].label;
    picker.appendChild(opt);
  });
  picker.addEventListener("change", () => render(picker.value));
  // Open on the newest day with a graded game; today's pending picks are on Home.
  picker.value = H.order.find(day => H.days[day].games.some(g => g.correct === true || g.correct === false)) || H.order[0];
  render(picker.value);
}
initNbaHistory();
