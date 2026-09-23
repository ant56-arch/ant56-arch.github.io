// --- Scoreboard strip (shared by every Edge site) ---
// Fills <div class="scoreboard"> under the top bar with each site's latest
// top picks, read from the summary.json files the sites publish. They're all
// on ant56-arch.github.io, so these are same-origin fetches. The strip stays
// hidden unless at least one summary loads. Keep this block identical in
// home.js (ant56-arch.github.io), web/site.js (nfl-edge) and web/site.js
// (mlb-hit-predictor).
const EDGE_SITES = [
  { sport: "NFL", summary: "/nfl-edge/nfl/summary.json", href: "/nfl-edge/nfl/index.html" },
  { sport: "CFB", summary: "/nfl-edge/cfb/summary.json", href: "/nfl-edge/cfb/index.html" },
  { sport: "MLB", summary: "/mlb-hit-predictor/summary.json", href: "/mlb-hit-predictor/" },
  { sport: "NBA", summary: "/mlb-hit-predictor/nba/summary.json", href: "/mlb-hit-predictor/nba/index.html" },
];

function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site =>
      fetch(site.summary, { cache: "no-cache" })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)));
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

async function initScoreboard() {
  const board = document.querySelector(".scoreboard");
  if (!board) return;
  const summaries = await edgeFetchSummaries();
  const track = edgeNode("div", "scoreboard-track");
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    const picks = s ? (s.picks || []).slice(0, 3) : [];
    if (!picks.length && !(s && s.record)) return;
    const head = edgeNode("a", "score-cell score-sport");
    head.href = site.href;
    head.append(edgeNode("span", "score-sport-name", site.sport), edgeNode("span", "score-top", s.heading || ""));
    track.append(head);

    picks.forEach((p, rank) => {
      const cell = edgeNode("a", "score-cell");
      cell.href = site.href;
      cell.append(edgeNode("span", "score-top", rank === 0 ? "Top pick" : `Pick ${rank + 1}`));
      const main = edgeNode("span", "score-main");
      main.append(edgeNode("span", "score-label", p.label), edgeNode("span", "score-value", p.value));
      const sub = edgeNode("span", "score-sub");
      sub.append(edgeNode("span", null, p.sub || ""));
      const pill = edgeResultPill(p.result, s.result_labels);
      if (pill) sub.append(pill);
      cell.append(main, sub);
      track.append(cell);
    });
    if (!picks.length && s.record) {
      const cell = edgeNode("a", "score-cell");
      cell.href = site.href;
      cell.append(edgeNode("span", "score-top", s.record.label));
      const main = edgeNode("span", "score-main");
      main.append(edgeNode("span", "score-label", s.record.value));
      cell.append(main, edgeNode("span", "score-sub", s.record.sub || ""));
      track.append(cell);
    }
  });
  if (!track.children.length) return;
  board.replaceChildren(track);
  board.hidden = false;
}
initScoreboard();

// Home page: the scoreboard strip, the record row in the hero and one card per
// site, all filled from the summary.json each site's build publishes next to
// its pages (nfl-edge: <sport>/summary.json, mlb-hit-predictor: summary.json
// and nba/summary.json). If one fails, its card keeps its link.

function formatUpdated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Updated " + d.toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

function renderCard(box, s) {
  box.replaceChildren();

  const meta = edgeNode("div", "picks-meta");
  if (s.heading) meta.append(edgeNode("span", "picks-heading", s.heading));
  const updated = formatUpdated(s.updated);
  if (updated) meta.append(edgeNode("span", "picks-updated", updated));
  box.append(meta);

  if (s.picks && s.picks.length) {
    const list = edgeNode("ol", "pick-list");
    for (const p of s.picks) {
      const row = edgeNode("li", "pick-row");
      const who = edgeNode("div", "pick-who");
      who.append(edgeNode("div", "pick-label", p.label));
      if (p.sub) who.append(edgeNode("div", "pick-sub", p.sub));
      const val = edgeNode("div", "pick-value");
      val.append(edgeNode("span", "pick-number", p.value));
      // A summary can name its own result labels (NBA Edge: ["WIN", "LOSS"]).
      const pill = edgeResultPill(p.result, s.result_labels);
      if (pill) val.append(pill);
      row.append(who, val);
      list.append(row);
    }
    box.append(list);
  } else {
    box.append(edgeNode("div", "picks-status", s.empty || "No picks yet."));
  }

  if (s.record) {
    const rec = edgeNode("div", "site-record");
    rec.append(edgeNode("span", "record-value", s.record.value), edgeNode("span", "record-label", s.record.label));
    if (s.record.sub) rec.append(edgeNode("span", "record-sub", s.record.sub));
    box.append(rec);
  }
}

async function initHome() {
  const summaries = await edgeFetchSummaries();
  const bySummary = new Map(EDGE_SITES.map((site, i) => [site.summary, summaries[i]]));

  document.querySelectorAll(".site-card[data-summary]").forEach(card => {
    const box = card.querySelector(".site-picks");
    const s = bySummary.get(card.dataset.summary);
    if (s) renderCard(box, s);
    else box.replaceChildren(edgeNode("div", "picks-status", "Picks couldn't load here. Open the site to see them."));
  });

  const stats = document.querySelector(".hero-stats");
  if (!stats) return;
  EDGE_SITES.forEach((site, i) => {
    const r = summaries[i] && summaries[i].record;
    if (!r) return;
    const stat = edgeNode("div", "hero-stat");
    const value = edgeNode("dd");
    value.append(edgeNode("span", "hero-stat-value", r.value));
    stat.append(edgeNode("dt", null, `${site.sport} · ${r.label}`), value);
    stats.append(stat);
  });
}
initHome();
