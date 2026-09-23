// Fills each site card from that site's summary.json, which its own build
// publishes next to its pages (nfl-edge: <sport>/summary.json,
// mlb-hit-predictor: summary.json and nba/summary.json). Everything is on ant56-arch.github.io, so
// these are same-origin fetches. If one fails, the card keeps its link.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatUpdated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Updated " + d.toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

// A summary can name its own result labels (NBA Edge: ["WIN", "LOSS"]).
function resultPill(result, labels) {
  const [yes, no] = labels || ["HIT", "MISS"];
  if (result === true) return el("span", "pill pill-positive", yes);
  if (result === false) return el("span", "pill pill-danger", no);
  return null;
}

function render(box, s) {
  box.replaceChildren();

  const meta = el("div", "picks-meta");
  if (s.heading) meta.append(el("span", "picks-heading", s.heading));
  const updated = formatUpdated(s.updated);
  if (updated) meta.append(el("span", "picks-updated", updated));
  box.append(meta);

  if (s.picks && s.picks.length) {
    const list = el("ol", "pick-list");
    for (const p of s.picks) {
      const row = el("li", "pick-row");
      const who = el("div", "pick-who");
      who.append(el("div", "pick-label", p.label));
      if (p.sub) who.append(el("div", "pick-sub", p.sub));
      const val = el("div", "pick-value");
      val.append(el("span", "pick-number", p.value));
      const pill = resultPill(p.result, s.result_labels);
      if (pill) val.append(pill);
      row.append(who, val);
      list.append(row);
    }
    box.append(list);
  } else {
    box.append(el("div", "picks-status", s.empty || "No picks yet."));
  }

  if (s.record) {
    const rec = el("div", "site-record");
    rec.append(el("span", "record-value", s.record.value), el("span", "record-label", s.record.label));
    if (s.record.sub) rec.append(el("span", "record-sub", s.record.sub));
    box.append(rec);
  }
}

document.querySelectorAll(".site-card[data-summary]").forEach(async (card) => {
  const box = card.querySelector(".site-picks");
  try {
    const res = await fetch(card.dataset.summary, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    render(box, await res.json());
  } catch (e) {
    box.replaceChildren(el("div", "picks-status", "Picks couldn't load here. Open the site to see them."));
  }
});
