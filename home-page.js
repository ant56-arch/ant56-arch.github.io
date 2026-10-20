// Home site only: the Home, Betting and Schedule pages. Published as home.js,
// after shared/edge.js (see shared/assets.py).

// Every site's summary.json, fetched once per page.
function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site => edgeFetchJson(site.summary)));
  }
  return window.edgeSummaries;
}

// --- Betting tab (home site only) ---
// Each site's summary.json carries "slate" (our picks: games still to play,
// plus the last few days' finished ones marked "final", each with our
// pick, its moneyline price and a link to the game's page), "units" (the
// running total of 1 unit on every graded moneyline pick, split into
// favorites, underdogs and value picks) and "last" (the latest day's
// results). Units and money show only on the Betting tab: a unit is $10.
const EDGE_STAKE = 10;
const EDGE_LINE_COLORS = { MLB: "var(--ours)", NFL: "var(--vegas)", CFB: "#d8c49a", NBA: "#b39ddb", NHL: "#c9d6e3", CBB: "#8fd3c4", Soccer: "#9fd39a" };
const EDGE_ET = { timeZone: edgeTz().timeZone };  // the time zone picked in settings (Eastern unless changed)

function edgeUnits(units) {
  return (units < 0 ? "−" : "+") + Math.abs(units).toFixed(2) + "u";
}

function edgeMoney(units) {
  const d = Math.round(units * EDGE_STAKE * 100) / 100;
  return (d < 0 ? "−" : "+") + "$" + Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function edgePrice(p) {
  return edgeOdds(p);  // in the odds format picked in settings
}

function edgeDayKey(d) {
  return d.toLocaleDateString("en-CA", EDGE_ET);  // YYYY-MM-DD in the picked time zone
}

function edgeShortDay(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// "Today 8:00 PM", "Sat 12:00 PM" in Eastern time.
function edgeWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = edgeDayKey(d) === edgeDayKey(new Date()) ? "Today"
    : d.toLocaleDateString("en-US", { ...EDGE_ET, weekday: "short" });
  return day + " " + d.toLocaleTimeString("en-US", { ...EDGE_ET, hour: "numeric", minute: "2-digit" });
}

function edgeUpcoming(summaries) {
  const now = Date.now();
  const out = [];
  summaries.forEach((s, i) => (s && s.slate || []).forEach(g => {
    const t = new Date(g.start).getTime();
    if (!g.start || t > now) out.push({ ...g, site: EDGE_SITES[i], t: t || Infinity });
  }));
  return out.sort((a, b) => a.t - b.t);
}

// "over BOS" under a pick; a soccer draw pick names both teams instead.
function edgeOverText(g) {
  return g.pick === "Draw" ? `${g.away} vs ${g.home}` : `over ${g.other}`;
}

function edgeValueRow(g) {
  const row = edgeNode("a", "vb-row");
  row.href = g.url;
  row.append(edgeNode("span", "vb-sport", g.sport));
  const who = edgeNode("span", "vb-pick");
  who.append(edgeNode("b", null, `${g.pick} ${edgePrice(g.price)}`), edgeNode("small", null, edgeOverText(g)));
  const bar = edgeNode("span", "vb-bar");
  const track = edgeNode("span", "vb-track");
  track.setAttribute("aria-hidden", "true");
  const fill = edgeNode("span", "vb-fill");
  fill.style.width = g.prob + "%";
  const tick = edgeNode("span", "vb-tick");
  tick.style.left = g.book + "%";
  track.append(fill, tick);
  const say = edgeNode("small");
  say.append("We say ", edgeNode("b", "vb-ours", Math.round(g.prob) + "%"), ", the price says ",
             edgeNode("b", "vb-book", Math.round(g.book) + "%"));
  bar.append(track, say);
  const when = edgeNode("span", "vb-when");
  const pays = g.price >= 100 ? `$100 wins $${g.price}` : `Bet $${-g.price} to win $100`;
  when.append(edgeNode("span", null, edgeWhen(g.start) || "Time TBA"), edgeNode("small", null, pays));
  row.append(who, bar, when);
  return row;
}

function edgeSureCard(eyebrow, name, pct, sub, href) {
  const card = edgeNode("a", "bet-card");
  card.href = href;
  const pick = edgeNode("div", "bet-pick");
  pick.append(edgeNode("b", null, name));
  const big = edgeNode("div", "bet-pct", String(Math.round(pct)));
  big.append(edgeNode("small", null, "%"));
  card.append(edgeNode("div", "bet-when", eyebrow), pick, big, edgeNode("div", "bet-sub", sub));
  return card;
}

async function initBestBets() {
  const list = document.getElementById("value-picks");
  const sure = document.getElementById("surest-picks");
  if (!list || !sure) return;
  const summaries = await edgeFetchSummaries();
  const games = edgeUpcoming(summaries);
  const value = games.filter(g => g.value && g.price != null && g.book != null);
  if (value.length) list.replaceChildren(...value.map(edgeValueRow));
  else list.replaceChildren(edgeNode("div", "empty-state",
    "No value picks right now. They show up here when our chance beats a betting price by 6 points or more."));

  const cards = [];
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    if (!s) return;
    if (site.sport === "MLB") {
      const p = (s.picks || [])[0];
      if (p && p.result == null && (s.heading || "").startsWith("Today")) {
        cards.push(edgeSureCard("MLB hitter · today", p.label, parseFloat(p.value), `to get a hit, ${p.sub}`, site.href));
      }
    }
    const top = games.filter(g => g.site === site).sort((a, b) => b.prob - a.prob)[0];
    if (top) {
      const label = site.sport === "MLB" ? "MLB game" : site.sport;
      const when = edgeWhen(top.start);
      cards.push(edgeSureCard(`${label} · ${when.split(" ")[0] || "soon"}`, top.pick, top.prob,
                              `${top.pick === "Draw" ? edgeOverText(top) : `${top.at === "vs" ? "vs" : (top.pick === top.home ? "vs" : "at")} ${top.other}`}${when ? ", " + when.split(" ").slice(1).join(" ") : ""}`,
                              top.url));
    }
  });
  if (cards.length) sure.replaceChildren(...cards);
  else sure.replaceChildren(edgeNode("div", "empty-state", "No games coming up right now."));
  const stamp = document.getElementById("bets-updated");
  if (stamp) stamp.textContent = `${games.length} games still to play across every sport`;
}
initBestBets();

// The running total of $10 on every moneyline pick, one step line per sport.
function edgeMoneyChart(lines) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 760, H = 300, L = 60, R = 176, T = 16, B = 34;
  const day = s => new Date(s + "T12:00:00Z").getTime();
  const DAY = 86400000;
  const d0 = Math.min(...lines.map(l => day(l.units.series[0][0]) - DAY));
  let d1 = Math.max(...lines.map(l => day(l.units.series[l.units.series.length - 1][0])));
  if (d1 <= d0) d1 = d0 + DAY;
  const vals = [0].concat(...lines.map(l => l.units.series.map(p => p[1] * EDGE_STAKE)));
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find(s => span / s <= 6) || 10000;
  const lo = Math.min(0, Math.floor(Math.min(...vals) / step) * step);
  const hi = Math.max(Math.ceil(Math.max(...vals) / step) * step, lo + step);
  const x = t => L + (W - L - R) * (t - d0) / (d1 - d0);
  const y = v => T + (H - T - B) * (hi - v) / (hi - lo);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Running total from $10 on every moneyline pick: " +
    lines.map(l => `${l.name} ${edgeMoney(l.units.units)} over ${l.units.picks} picks`).join("; "));
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let v = lo; v <= hi + 1e-9; v += step) {
    el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "z" : "g" });
    el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "t" },
       v === 0 ? "$0" : (v > 0 ? "+" : "−") + "$" + Math.abs(v).toLocaleString("en-US"));
  }
  const fmt = t => new Date(t).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const days = Math.round((d1 - d0) / DAY);
  const ticks = days >= 2 ? [d0, d0 + Math.floor(days / 2) * DAY, d1] : [d0, d1];
  ticks.forEach(t => el("text", { x: x(t), y: H - 10, "text-anchor": "middle", class: "t" }, fmt(t)));
  const ends = lines.map((l, i) => [y(l.units.series[l.units.series.length - 1][1] * EDGE_STAKE), i]).sort((a, b) => a[0] - b[0]);
  const placed = {};
  let last = -99;
  ends.forEach(([yy, i]) => { last = Math.max(yy, last + 16); placed[i] = last; });
  lines.forEach((l, i) => {
    const pts = [[day(l.units.series[0][0]) - DAY, 0]].concat(l.units.series.map(p => [day(p[0]), p[1] * EDGE_STAKE]));
    let d = "";
    pts.forEach(([t, v], k) => { d += k ? ` H${x(t).toFixed(1)} V${y(v).toFixed(1)}` : `M${x(t).toFixed(1)},${y(v).toFixed(1)}`; });
    d += ` H${x(d1).toFixed(1)}`;
    const endV = pts[pts.length - 1][1];
    el("path", { d, fill: "none", style: `stroke:${l.color}`, "stroke-width": 2.5, "stroke-linejoin": "round" });
    el("circle", { cx: x(d1), cy: y(endV), r: 4, style: `fill:${l.color}` });
    el("text", { x: x(d1) + 10, y: placed[i] + 4, class: "lab", style: `fill:${l.color}` },
       `${l.name} ${edgeMoney(l.units.units)}`);
  });
  const wrap = edgeNode("div", "money-chart");
  wrap.append(svg);
  return wrap;
}

async function initDollars() {
  const box = document.getElementById("dollars");
  if (!box) return;
  const summaries = await edgeFetchSummaries();
  const lines = [];
  EDGE_SITES.forEach((site, i) => {
    const u = summaries[i] && summaries[i].units;
    if (u && u.series && u.series.length) {
      lines.push({ name: site.sport === "MLB" ? "MLB games" : site.sport, color: EDGE_LINE_COLORS[site.sport], units: u,
                   href: site.sport === "MLB" ? "/mlb/games.html" : site.href });
    }
  });
  if (!lines.length) return;
  const total = lines.reduce((a, l) => a + l.units.units, 0);
  const picks = lines.reduce((a, l) => a + l.units.picks, 0);
  const tiles = edgeNode("div", "money-tiles");
  const tile = (label, units, sub, href) => {
    const t = edgeNode(href ? "a" : "div", "money-tile");
    if (href) t.href = href;
    t.append(edgeNode("span", "mt-label", label), edgeNode("span", "mt-num " + (units >= 0 ? "is-up" : "is-down"), edgeUnits(units)),
             edgeNode("span", "mt-sub", sub));
    return t;
  };
  tiles.append(tile("All sports", total, `${edgeMoney(total)} at $${EDGE_STAKE} a pick, ${picks} picks`));
  lines.forEach(l => tiles.append(tile(l.name, l.units.units,
    `${edgeMoney(l.units.units)}, ${l.units.wins}-${l.units.losses} since ${edgeShortDay(l.units.since).replace(/^\w+, /, "")}`, l.href)));

  // Every sport's picks, and the same picks split by the kind of bet.
  const cell = (t, cls) => {
    const td = edgeNode("td", cls || "num");
    if (!t || !t.picks) { td.append(edgeNode("span", "faint", "—")); return td; }
    td.append(edgeNode("b", t.units >= 0 ? "is-up" : "is-down", edgeUnits(t.units)),
              edgeNode("small", "u-rec", `${t.wins}-${t.losses}`));
    return td;
  };
  const table = edgeNode("table", "data units-table responsive-stack");
  const head = edgeNode("thead");
  const hr = edgeNode("tr");
  ["Sport", "Every pick", "Favorites", "Underdogs", "Value picks", "Return"].forEach((h, i) => hr.append(edgeNode("th", i ? "num" : null, h)));
  head.append(hr);
  const body = edgeNode("tbody");
  lines.forEach(l => {
    const sp = l.units.splits || {};
    const tr = edgeNode("tr");
    const name = edgeNode("td", "row-label");
    const a = edgeNode("a", null, l.name);
    a.href = l.href;
    name.append(a);
    tr.append(name, cell(l.units), cell(sp.favorites), cell(sp.underdogs), cell(sp.value),
              edgeNode("td", "num", `${(l.units.roi * 100 >= 0 ? "+" : "−")}${Math.abs(l.units.roi * 100).toFixed(1)}%`));
    ["", "Every pick", "Favorites", "Underdogs", "Value picks", "Return"].forEach((lab, i) => { if (i) tr.children[i].dataset.label = lab; });
    body.append(tr);
  });
  table.append(head, body);
  const tableWrap = edgeNode("div", "units-wrap");
  tableWrap.append(table);

  const missing = EDGE_SITES.filter(site => site.sport !== "MLB" && !lines.some(l => l.name === site.sport)).map(s => s.sport);
  const note = edgeNode("div", "table-footnote",
    `One unit on the team we pick to win in every game with a price, favorite or underdog, at its moneyline right ` +
    `before the game started; the chart counts a unit as $${EDGE_STAKE}. A winning favorite pays less than it risks ` +
    `(1 unit at −150 wins 0.67) and a winning underdog pays more (1 unit at +130 wins 1.30). Value picks are the ones ` +
    `where our chance beat the price's by 6 points or more. Return is units won per unit risked. Live picks only, ` +
    `never a backtest, and a postponed game or a tie is no bet. MLB hitter picks have no betting price, so they ` +
    `aren't in this.` +
    (missing.length ? ` ${missing.length > 1 ? missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1] : missing[0]}` +
      " join with their first graded pick." : ""));
  box.querySelector(".card-body").replaceChildren(tiles, tableWrap, edgeMoneyChart(lines), note);
  box.hidden = false;
}
initDollars();
