// Home site only: the Home, Betting and Schedule pages. Published as home.js,
// after shared/edge.js (see shared/assets.py).

// Every site's summary.json, fetched once per page.
function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site => edgeFetchJson(site.summary)));
  }
  return window.edgeSummaries;
}

// Home page: every sport's games with our pick, live games first, then games
// still to play, then finals, each grouped by sport. Picks come from each
// site's summary.json "slate"; scores, logos, records and TV come from ESPN in
// the browser (the games.json "espn" address, without the CFB Top 25 filter),
// refreshed every minute while a game is live. A pick is matched to its ESPN
// game by start time and one shared team abbreviation. Below it, each site's
// all-time record from summary.json.
const HG_ORDER = ["NFL", "CFB", "MLB", "NHL", "NBA", "CBB", "Soccer"];
const HG_LAYOUT_KEY = "edge-home-layout";
const HG_SHOW = 9;  // games per sport group before "See more"
const hg = { day: null, sport: "all", value: false, open: new Set(), layout: null, games: [], summaries: [],
             scores: {}, results: {}, counted: new Set(), loaded: false };

function hgStore(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { return null; }
  return null;
}

function hgEl(tag, cls, text, attrs) {
  const n = edgeNode(tag, cls, text);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

// YYYY-MM-DD in Eastern time, `days` after today.
function hgDayKey(days) {
  return edgeDayKey(new Date(Date.now() + (days || 0) * 86400000));
}

function hgDays() {
  const dow = new Date(hgDayKey() + "T12:00:00Z").getUTCDay();  // 0 Sun .. 6 Sat
  // The weekend is the coming Saturday through Monday night (today on a weekend).
  const toSat = dow === 0 ? -1 : dow === 1 ? -2 : 6 - dow;
  const weekend = [0, 1, 2].map(i => hgDayKey(toSat + i)).filter(k => k >= hgDayKey());
  return [
    { k: "today", label: "Today", dates: [hgDayKey()], title: "Today's games" },
    { k: "tomorrow", label: "Tomorrow", dates: [hgDayKey(1)], title: "Tomorrow's games" },
    { k: "weekend", label: "Weekend", dates: weekend, title: "This weekend's games" },
  ];
}

// ESPN's default scoreboard keeps showing yesterday until late morning ET, so any
// slate day it doesn't cover is fetched by date (dates=YYYYMMDD, an ET day).
async function hgLoadEspn(site, summary) {
  if (!site.games) return [];
  const published = await edgeFetchJson(site.games);
  if (!published) return [];
  if (!published.espn) return published.games || [];
  const parse = data => data && Array.isArray(data.events) ? data.events.map(edgeParseEspn).filter(Boolean) : null;
  const live = parse(await edgeFetchJson(published.espn, 6000));
  const events = live || [];
  const ids = new Set(events.map(e => e.id));
  const covered = new Set(events.map(e => new Date(e.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" })));
  const days = [...new Set((summary && summary.slate || []).map(g => g.date).filter(Boolean))]
    .filter(d => !covered.has(d)).slice(0, 4);
  const sep = published.espn.includes("?") ? "&" : "?";
  const extra = await Promise.all(days.map(d => edgeFetchJson(published.espn + sep + "dates=" + d.replace(/-/g, ""), 6000)));
  extra.forEach(data => (parse(data) || []).forEach(e => { if (!ids.has(e.id)) { ids.add(e.id); events.push(e); } }));
  return live || days.length ? events : published.games || [];
}

function hgMatch(g, espn) {
  const t = new Date(g.start).getTime();
  const teams = [g.away, g.home];
  return espn.find(e => Math.abs(new Date(e.start).getTime() - t) < 15 * 60000 &&
                        (teams.includes(e.away.abbr) || teams.includes(e.home.abbr))) || null;
}

async function hgLoad() {
  const summaries = await edgeFetchSummaries();
  const espn = await Promise.all(EDGE_SITES.map((site, i) => hgLoadEspn(site, summaries[i])));
  hg.summaries = summaries;
  const games = [];
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    (s && s.slate || []).forEach(g => {
      if (!g.start) return;
      const e = hgMatch(g, espn[i]);
      const flip = e && !(e.away.abbr === g.away || e.home.abbr === g.home);  // ESPN lists them the other way
      const side = (ours, theirs) => ({
        abbr: ours, espn: theirs ? theirs.abbr : "", name: theirs ? theirs.short || theirs.name || ours : ours, logo: theirs ? theirs.logo : "",
        rank: theirs ? theirs.rank : null, record: theirs ? theirs.record : null,
        score: theirs && e.state !== "pre" ? theirs.score : null,
      });
      const away = side(g.away, e && (flip ? e.home : e.away));
      const home = side(g.home, e && (flip ? e.away : e.home));
      const state = e ? e.state : "pre";
      let hit = null;
      // Soccer picks can be a draw ("Draw"), and a team pick loses on a draw.
      if (state === "post" && away.score != null && home.score != null) {
        if (g.pick === "Draw") hit = away.score === home.score;
        else if (away.score !== home.score) hit = (g.pick === g.away) === (away.score > home.score);
        else if (site.sport === "Soccer") hit = false;
      }
      games.push({ ...g, key: site.sport + ":" + g.id, date: edgeDayKey(new Date(g.start)), away, home, state,
                   detail: e ? e.detail : "", tv: e ? e.tv : "", hit });
    });
  });
  hg.games = games;
}

function hgIsFav(g) {
  return edgeIsFav(g.sport, g.away.abbr, g.away.espn, g.home.abbr, g.home.espn);
}

function hgTime(g, withDay) {
  const d = new Date(g.start);
  const t = d.toLocaleTimeString("en-US", { ...EDGE_ET, hour: "numeric", minute: "2-digit" });
  return withDay ? d.toLocaleDateString("en-US", { ...EDGE_ET, weekday: "short" }) + " " + t : t;
}

function hgStatus(g, withDay) {
  if (g.state === "in") return hgEl("span", "hg-live", g.detail || "Live");
  if (g.state === "post") return hgEl("span", null, g.detail || "Final");
  return hgEl("span", null, hgTime(g, withDay) + " " + edgeTz().label);
}

function hgResult(g) {
  if (g.hit === true) return hgEl("span", "hg-res is-hit", "Hit");
  if (g.hit === false) return hgEl("span", "hg-res is-miss", "Miss");
  return g.value && g.state === "pre" ? hgEl("span", "hg-val", "Value") : null;
}

// How our pick is doing: Leading / Tied / Trailing while live, then a Hit or
// Miss stamp at the final (stamped in when it goes final while the page is
// open). Before the game, the Value tag if it has one. The pick % never moves.
function hgPickState(g) {
  if (g.hit != null) {
    const s = hgEl("span", "stamp " + (g.hit ? "is-hit" : "is-miss"), g.hit ? "✓ Hit" : "✗ Miss");
    if (hg.loaded && hg.results[g.key] == null) s.classList.add("stamp-in");
    hg.results[g.key] = g.hit;
    return s;
  }
  hg.results[g.key] = null;
  if (g.state === "in" && g.pick !== "Draw" && g.away.score != null && g.home.score != null) {
    const ours = g.pick === g.away.abbr ? g.away.score : g.home.score;
    const theirs = g.pick === g.away.abbr ? g.home.score : g.away.score;
    const k = ours > theirs ? "lead" : ours < theirs ? "trail" : "tied";
    return hgEl("span", "pick-state is-" + k, k === "lead" ? "Leading" : k === "tied" ? "Tied" : "Trailing");
  }
  return hgResult(g);
}

function hgStar(g) {
  const on = hgIsFav(g);
  const names = `${g.away.name} and ${g.home.name}`;
  const b = hgEl("button", "hg-star", on ? "★" : "☆",
                 { type: "button", "aria-pressed": String(on), "aria-label": (on ? "Unpin " : "Pin ") + names });
  b.dataset.key = g.key;
  return b;
}

function hgTeamRow(g, t) {
  const other = t === g.away ? g.home : g.away;
  const row = hgEl("a", "hg-tm" + (t.abbr === g.pick ? " is-pick" : "") +
                   (t.score != null && other.score != null && t.score >= other.score ? " is-lead" : ""));
  row.href = g.url;
  const tile = hgEl("span", "hg-tile", t.abbr, { "aria-hidden": "true" });
  if (t.logo) {
    const img = hgEl("img", "hg-logo", null, { src: t.logo, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(tile));
    row.append(img);
  } else {
    row.append(tile);
  }
  const nm = hgEl("span", "hg-nm");
  const b = hgEl("b", null, (t.rank ? t.rank + " " : "") + t.name);
  const bits = [t.record, t === g.away ? (g.at === "vs" ? "" : "Away") : (g.at === "vs" ? "" : "Home")].filter(Boolean);
  nm.append(b, hgEl("small", null, bits.join(" · ") || "Neutral site"));
  row.append(nm);
  if (t.abbr === g.pick) row.append(hgEl("span", "hg-ours", "Our pick"));
  if (t.score != null) {
    // Rolls to a new score when a refresh brings one (not on the first load).
    const sc = hgEl("span", "hg-sc");
    const k = g.key + ":" + (t === g.away ? "a" : "h");
    if (hg.scores[k] != null) sc.dataset.roll = String(hg.scores[k]);
    edgeRoll(sc, t.score);
    hg.scores[k] = t.score;
    row.append(sc);
  }
  return row;
}

function hgCard(g, top, withDay) {
  const card = hgEl("div", "hg-card" + (top ? " is-top" : "") + (g.hit === true ? " is-hit" : g.hit === false ? " is-miss" : ""));
  const head = hgEl("div", "hg-card-head");
  const left = hgEl("span", "hg-when");
  left.append(hgEl("b", null, g.sport), hgStatus(g, withDay));
  if (g.tv && g.state !== "post") left.append(hgEl("span", "hg-tv", g.tv));
  const right = hgEl("span", "hg-card-tools");
  if (top) right.append(hgEl("em", "hg-top", "Top 3 pick"));
  right.append(hgStar(g));
  head.append(left, right);
  const lines = hgEl("dl", "hg-lines");
  const cell = (dt, dd, cls) => { const d = hgEl("div"); d.append(hgEl("dt", null, dt), hgEl("dd", cls, dd)); lines.append(d); };
  if (g.price != null) cell("Odds", `${g.pick} ${edgePrice(g.price)}`);
  if (g.book != null) cell("Vegas gives", Math.round(g.book) + "%", "hg-vg");
  const pick = hgEl("div", "hg-pick");
  pick.append(hgEl("span", "hg-lbl", "Pick to win"),
              hgEl("b", null, g.pick === "Draw" ? "Draw" : (g.pick === g.away.abbr ? g.away : g.home).name));
  const res = hgPickState(g);
  if (res) pick.append(res);
  const pct = hgEl("span", "hg-pct", String(Math.round(g.prob)));
  pct.append(hgEl("i", null, "%"));
  pick.append(pct);
  card.append(head, hgTeamRow(g, g.away), hgTeamRow(g, g.home));
  if (lines.children.length) card.append(lines);
  card.append(pick);
  return card;
}

function hgRow(g, withDay) {
  const row = hgEl("div", "hg-row");
  const when = hgEl("div", "hg-row-when");
  if (g.state === "pre") {
    when.append(hgEl("span", null, withDay ? new Date(g.start).toLocaleDateString("en-US", { ...EDGE_ET, weekday: "short" }) : g.sport),
                hgEl("b", null, hgTime(g)));
  } else {
    when.append(g.state === "in" ? hgEl("span", "hg-live", "Live") : hgEl("span", null, "Final"),
                hgEl("b", null, `${g.away.score ?? ""}-${g.home.score ?? ""}`));
  }
  const mu = hgEl("a", "hg-mu");
  mu.href = g.url;
  const team = abbr => abbr === g.pick ? hgEl("strong", null, abbr) : document.createTextNode(abbr);
  mu.append(team(g.away.abbr), ` ${g.at === "vs" ? "vs" : "@"} `, team(g.home.abbr));
  const sub = hgEl("small", null, `${g.sport} · Pick ${g.pick}${g.price != null ? " " + edgePrice(g.price) : ""}`);
  const res = hgPickState(g);
  if (res) sub.append(" ", res);
  mu.append(sub);
  const pct = hgEl("span", "hg-pct", String(Math.round(g.prob)));
  pct.append(hgEl("i", null, "%"));
  row.append(when, mu, pct, hgStar(g));
  return row;
}

function hgRender() {
  const out = document.getElementById("hg-out");
  if (!out) return;
  const days = hgDays();
  const counts = days.map(d => hg.games.filter(g => d.dates.includes(g.date)).length);
  const opensOn = edgeSettings().homeDay;
  if (!hg.day && days.some(d => d.k === opensOn)) hg.day = opensOn;
  if (!hg.day) hg.day = (days[counts.findIndex(n => n > 0)] || days[0]).k;
  const day = days.find(d => d.k === hg.day);
  const withDay = day.dates.length > 1;
  document.getElementById("hg-title").textContent = day.title;
  const dayBtns = document.getElementById("hg-days");
  dayBtns.replaceChildren(...days.map((d, i) => {
    const b = hgEl("button", null, d.label, { type: "button", "aria-pressed": String(d.k === hg.day) });
    b.dataset.v = d.k;
    b.append(hgEl("span", null, String(counts[i])));
    return b;
  }));

  const inDay = hg.games.filter(g => day.dates.includes(g.date));
  const sports = HG_ORDER.filter(sp => inDay.some(g => g.sport === sp));
  if (hg.sport !== "all" && !sports.includes(hg.sport)) hg.sport = "all";
  const chip = (v, label, n) => {
    const b = hgEl("button", null, label, { type: "button", "aria-pressed": String(hg.sport === v) });
    b.dataset.v = v;
    b.append(hgEl("span", null, String(n)));
    return b;
  };
  document.getElementById("hg-sports").replaceChildren(chip("all", "All", inDay.length),
    ...sports.map(sp => chip(sp, sp, inDay.filter(g => g.sport === sp).length)));
  document.querySelectorAll("#hg-layout button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.v === hg.layout)));
  document.getElementById("hg-value").setAttribute("aria-pressed", String(hg.value));

  const done = inDay.filter(g => g.hit != null);
  const live = inDay.filter(g => g.state === "in").length;
  const won = done.filter(g => g.hit).length;
  const tally = document.getElementById("hg-tally");
  tally.replaceChildren();
  if (done.length || live) {
    if (done.length) tally.append("So far: ", hgEl("b", null, `${won}-${done.length - won}`), " on finished games");
    if (live) tally.append(done.length ? ", " : "", hgEl("b", null, String(live)), " live now");
    tally.append(".");
  } else if (!edgeFavs().size && inDay.length) {
    tally.textContent = "Tap ★ My teams to pick your teams in any league. Their games go to the top.";
  }
  const favCount = edgeFavs().size;
  document.getElementById("hg-teams").textContent = favCount ? `★ My teams (${favCount})` : "☆ My teams";

  let list = inDay.filter(g => (hg.sport === "all" || g.sport === hg.sport) && (!hg.value || g.value));
  const byTime = (a, b) => new Date(a.start) - new Date(b.start);
  list.sort(byTime);
  const top = new Set([...inDay].sort((a, b) => b.prob - a.prob).slice(0, 3).map(g => g.key));
  const block = gs => {
    const wrap = hgEl("div", hg.layout === "list" ? "hg-list" : "hg-grid");
    wrap.append(...gs.map(g => hg.layout === "list" ? hgRow(g, withDay) : hgCard(g, top.has(g.key), withDay)));
    return wrap;
  };
  // Long groups (a 26-game CFB Saturday) show HG_SHOW games and a See more button.
  const group = (title, gs, cls, key) => {
    const sub = hgEl("div", "hg-sub" + (cls ? " " + cls : ""));
    const h = hgEl("h4", null, title);
    h.append(hgEl("span", null, String(gs.length)));
    const open = !key || hg.open.has(key) || gs.length <= HG_SHOW + 2;
    sub.append(h, block(open ? gs : gs.slice(0, HG_SHOW)));
    if (key && gs.length > HG_SHOW + 2) {
      const more = hgEl("button", "hg-more", open ? "Show fewer" : `See all ${gs.length} ${title} games`,
                        { type: "button", "aria-expanded": String(open) });
      more.dataset.group = key;
      sub.append(more);
    }
    return sub;
  };
  const n = k => `${k} ${k === 1 ? "game" : "games"}`;
  const sections = [];
  [["Live now", "in", "is-live"], ["Still to play", "pre", ""], ["Final", "post", ""]].forEach(([title, state, cls]) => {
    const gs = list.filter(g => g.state === state);
    if (!gs.length) return;
    const sec = hgEl("section", "hg-sec" + (cls ? " " + cls : ""));
    const h = hgEl("h3", null, title);
    h.append(hgEl("span", null, n(gs.length)));
    sec.append(h);
    const favs = gs.filter(hgIsFav);
    if (favs.length) sec.append(group("★ Your teams", favs, "is-fav"));
    const rest = gs.filter(g => !hgIsFav(g));
    HG_ORDER.forEach(sp => { const sg = rest.filter(g => g.sport === sp); if (sg.length) sec.append(group(sp, sg, "", `${hg.day}:${state}:${sp}`)); });
    sections.push(sec);
  });
  if (!sections.length) {
    const msg = !inDay.length ? `No games with our picks ${day.k === "today" ? "today" : day.k === "tomorrow" ? "tomorrow" : "this weekend"}.`
      : "No value picks here. Value picks are games where we like a team more than Vegas does.";
    sections.push(hgEl("div", "empty-state", msg));
  }
  out.replaceChildren(...sections);
  out.removeAttribute("aria-busy");
  hgTop3(inDay, withDay);
  hgCountdown();
  edgeSlide(dayBtns, "pill");
  edgeSlide(document.getElementById("hg-sports"), "line");
  edgeSlide(document.getElementById("hg-layout"), "pill");
}

// Top 3: the day's three surest picks as small cards above the games. On
// phones they're a row you swipe through one at a time, with dots.
function hgTop3(inDay, withDay) {
  const box = document.getElementById("hg-top3");
  if (!box) return;
  const top = [...inDay].sort((a, b) => b.prob - a.prob).slice(0, 3);
  box.hidden = top.length < 3;
  if (box.hidden) return;
  const row = hgEl("div", "t3-row");
  top.forEach((g, i) => {
    const a = hgEl("a", "t3");
    a.href = g.url;
    const other = g.pick === g.away.abbr ? g.home : g.away;
    const pickName = g.pick === "Draw" ? "Draw" : (g.pick === g.away.abbr ? g.away : g.home).name;
    const when = g.state === "pre" ? hgTime(g, withDay) + " " + edgeTz().label : g.state === "in" ? "Live" : "Final";
    a.append(hgEl("span", "t3-rk", `#${i + 1} · ${g.sport} · ${when}`),
             hgEl("b", "t3-mu", g.pick === "Draw" ? `${g.away.name} vs ${g.home.name}: draw` : `${pickName} over ${other.name}`));
    const foot = hgEl("span", "t3-ft");
    const state = hgPickState(g);
    foot.append(state || hgEl("span", "t3-lbl", "Pick to win"));
    const pct = hgEl("span", "hg-pct", String(Math.round(g.prob)));
    pct.append(hgEl("i", null, "%"));
    foot.append(pct);
    a.append(foot);
    row.append(a);
  });
  const dots = hgEl("div", "t3-dots", null, { "aria-hidden": "true" });
  top.forEach((_, i) => dots.append(hgEl("i", i ? null : "on")));
  row.addEventListener("scroll", () => {
    const k = Math.round(row.scrollLeft / Math.max(1, row.firstChild.offsetWidth));
    [...dots.children].forEach((d, j) => d.classList.toggle("on", j === k));
  }, { passive: true });
  const h = hgEl("h3", "t3-h", "Top 3 picks");
  box.replaceChildren(h, row, dots);
}

// Countdown to the next game we pick today, or how many are live.
function hgCountdown() {
  const el = document.getElementById("hg-cd");
  if (!el) return;
  const today = hg.games.filter(g => g.date === hgDayKey());
  const live = today.filter(g => g.state === "in").length;
  const next = today.filter(g => g.state === "pre" && new Date(g.start) > Date.now())
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  el.classList.toggle("is-live", live > 0);
  if (live) {
    el.replaceChildren(hgEl("b", null, "Live now"), ` · ${live} ${live === 1 ? "game" : "games"}`);
  } else if (next) {
    const left = new Date(next.start) - Date.now();
    const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), sec = Math.floor(left % 60000 / 1000);
    const started = today.some(g => g.state !== "pre");
    el.replaceChildren(started ? "Next pick in " : "First pick in ",
                       hgEl("b", null, h ? `${h}h ${m}m` : `${m}m ${String(sec).padStart(2, "0")}s`));
  }
  el.hidden = !live && !next;
  clearTimeout(hg.cdTimer);
  if (next || live) hg.cdTimer = setTimeout(hgCountdown, 1000);
}

function hgHero() {
  const date = document.getElementById("home-date");
  if (date) date.textContent = new Date().toLocaleDateString("en-US", { ...EDGE_ET, weekday: "long", month: "short", day: "numeric" });
  const count = document.getElementById("home-count");
  const today = hg.games.filter(g => g.date === hgDayKey());
  if (count && today.length) {
    const sports = HG_ORDER.filter(sp => today.some(g => g.sport === sp));
    const list = sports.length > 1 ? sports.slice(0, -1).join(", ") + " and " + sports[sports.length - 1] : sports[0];
    count.replaceChildren(hgEl("b", null, `${today.length} ${today.length === 1 ? "game" : "games"} today`),
                          ` across ${list}`, hgEl("br"), "Every pick graded against the final score");
  }
}

function hgRecords() {
  const box = document.getElementById("home-records");
  if (!box) return;
  const tiles = [];
  const soon = [];
  EDGE_SITES.forEach((site, i) => {
    const s = hg.summaries[i];
    const parts = site.sport === "MLB"
      ? [["MLB", "hits", s, site.href], ["MLB", "games", s && s.games, "/mlb/games.html"]]
      : [[site.sport, "", s, site.href]];
    parts.forEach(([sport, part, data, href]) => {
      const rec = data && data.record;
      if (!rec) { if (!soon.includes(sport)) soon.push(sport); return; }
      // This season's record big (a finished season's stays up until the next
      // one's first graded pick), with the all-time record under it.
      const cur = data.season_record || rec;
      const a = hgEl("a", "hr-tile");
      a.href = href;
      const lbl = hgEl("span", "hr-lbl", sport + " ");
      if (part) lbl.append(hgEl("em", null, part));
      const streak = edgeStreakBadge(data.daily);
      if (data.season_record) {
        const season = hgEl("b", null, cur.season + " season");
        if (streak) season.append(streak);
        lbl.append(season);
      } else if (streak) lbl.append(streak);
      const val = hgEl("span", "hr-val");
      const num = hgEl("span", null, cur.value);
      const [w, l] = cur.value.split("-").map(Number);
      const key = sport + part;
      if (!hg.counted.has(key) && w >= 0 && l >= 0) { hg.counted.add(key); edgeCountUp(num, w, l); }
      val.append(num);
      if (cur.sub) val.append(hgEl("i", null, cur.sub.replace(/\.\d%$/, "%")));
      a.append(lbl, val, hgEl("small", null, !data.season_record
        ? (rec.since ? "since " + rec.since.replace(/, \d{4}$/, "") : rec.label)
        : `All-time ${rec.value}` + (rec.since ? " since " + rec.since.replace(/ \d+,/, "") : "")));
      const spark = edgeSpark(data.daily, 30);
      if (spark) a.append(spark);
      tiles.push(a);
    });
  });
  if (soon.length) {
    const d = hgEl("div", "hr-tile is-soon");
    d.append(hgEl("span", "hr-lbl", soon.join(" · ")), hgEl("span", "hr-val", "Starts with the first graded pick"));
    tiles.push(d);
  }
  box.replaceChildren(...tiles);
}

// Winning % over time: each sport's running record since we started
// counting, from summary.json "daily". 7 days, 30 days or all of it; tap a
// sport to hide its line; hover or drag to read a day. The y-axis fits the
// lines shown, so small moves are readable.
const RC = { range: "30", hidden: new Set(), lines: null };
const RC_COLORS = { NFL: "--l-nfl", "MLB Hits": "--l-mlbh", "MLB Games": "--l-mlbg", NHL: "--l-nhl", CFB: "--l-cfb",
                    NBA: "--l-nba", CBB: "--l-cbb", Soccer: "--l-soc" };

function hgChart() {
  const sec = document.getElementById("rchart");
  if (!sec) return;
  if (!RC.lines) {
    RC.lines = [];
    EDGE_SITES.forEach((site, i) => {
      const s = hg.summaries[i];
      const parts = site.sport === "MLB" ? [["MLB Hits", s && s.daily], ["MLB Games", s && s.games && s.games.daily]]
                                         : [[site.sport, s && s.daily]];
      parts.forEach(([name, daily]) => { if (daily && daily.length >= 2) RC.lines.push({ name, run: edgeRunning(daily) }); });
    });
    if (!RC.lines.length) return;
    sec.hidden = false;
    const range = document.getElementById("rchart-range");
    range.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      RC.range = b.dataset.v;
      range.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      rcDraw(true);
    });
    edgeSlide(range, "pill");
    const legend = document.getElementById("rchart-legend");
    RC.lines.forEach(l => {
      const b = hgEl("button", null, null, { type: "button", "aria-pressed": "true" });
      const dot = hgEl("i");
      dot.style.background = `var(${RC_COLORS[l.name]})`;
      b.append(dot, l.name);
      b.addEventListener("click", () => {
        const on = RC.hidden.has(l.name);
        if (!on && RC.hidden.size >= RC.lines.length - 1) return;  // keep one line
        on ? RC.hidden.delete(l.name) : RC.hidden.add(l.name);
        b.setAttribute("aria-pressed", String(on));
        rcDraw(false);
      });
      legend.append(b);
    });
    const svg = document.getElementById("rchart-svg");
    svg.addEventListener("pointermove", rcHover);
    svg.addEventListener("pointerdown", rcHover);
    svg.addEventListener("pointerleave", () => { document.getElementById("rchart-tip").hidden = true; const c = svg.querySelector(".rc-cross"); if (c) c.setAttribute("visibility", "hidden"); });
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => rcDraw(false), 150); });
  }
  rcDraw(true);
}

function rcDays() {
  // Every calendar day in range, oldest first, as YYYY-MM-DD.
  const end = hgDayKey();
  const first = RC.range === "all"
    ? RC.lines.reduce((m, l) => (l.run[0].date < m ? l.run[0].date : m), end)
    : hgDayKey(-(Number(RC.range) - 1));
  const out = [];
  for (let d = new Date(first + "T12:00:00Z"); edgeDayKey(d) <= end && out.length < 800; d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

function rcDraw(animate) {
  const svg = document.getElementById("rchart-svg");
  const W = svg.getBoundingClientRect().width < 560 ? 420 : 800, H = 300, PL = 44, PR = 52, PT = 14, PB = 30;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const days = rcDays();
  // Each line's running % as of each day (carried over days without picks;
  // null before its first graded pick).
  const shown = RC.lines.filter(l => !RC.hidden.has(l.name)).map(l => {
    let j = -1;
    const vals = days.map(d => { while (j + 1 < l.run.length && l.run[j + 1].date <= d) j++; return j < 0 ? null : l.run[j]; });
    return { ...l, vals };
  }).filter(l => l.vals.some(v => v));
  const all = shown.flatMap(l => l.vals.filter(Boolean).map(v => v.pct));
  if (!all.length) { svg.innerHTML = ""; return; }
  const span = Math.max(...all) - Math.min(...all);
  const step = [0.01, 0.02, 0.05, 0.1, 0.2].find(st => span / st <= 5) || 0.25;
  const lo = Math.floor((Math.min(...all) - 0.005) / step) * step, hi = Math.ceil((Math.max(...all) + 0.005) / step) * step;
  const n = days.length;
  const X = i => PL + (n > 1 ? i * (W - PL - PR) / (n - 1) : (W - PL - PR) / 2), Y = v => PT + (hi - v) / (hi - lo) * (H - PT - PB);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g += `<line class="rc-grid" x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>` +
         `<text class="rc-ax" x="${PL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  }
  const lab = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const ticks = n <= 7 ? [...Array(n).keys()] : [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
  [...new Set(ticks)].forEach(i => { g += `<text class="rc-ax" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${lab(days[i])}</text>`; });
  g += `<line class="rc-cross" x1="0" x2="0" y1="${PT}" y2="${H - PB}" visibility="hidden"/>`;
  const ends = [];
  shown.forEach(l => {
    const color = `var(${RC_COLORS[l.name]})`;
    let d = "";
    l.vals.forEach((v, i) => { if (v) d += (d && l.vals[i - 1] ? "L" : "M") + X(i).toFixed(1) + " " + Y(v.pct).toFixed(1); });
    g += `<path class="rc-line" d="${d}" style="stroke:${color}"/>`;
    const last = l.vals[n - 1];
    if (last) {
      g += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(last.pct).toFixed(1)}" r="4" style="fill:${color}"/>`;
      ends.push({ y: Y(last.pct), text: (last.pct * 100).toFixed(1) + "%", color });
    }
  });
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  ends.forEach(e => { g += `<text class="rc-end" x="${X(n - 1) + 8}" y="${(e.y + 4).toFixed(1)}" style="fill:${e.color}">${e.text}</text>`; });
  svg.innerHTML = g;
  RC.view = { days, shown, X, W, n };
  if (animate && !EDGE_REDUCE.matches) svg.querySelectorAll(".rc-line").forEach(p => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.getBoundingClientRect();
    p.style.transition = "stroke-dashoffset 0.9s ease-out";
    p.style.strokeDashoffset = "0";
    p.addEventListener("transitionend", () => { p.style.strokeDasharray = ""; }, { once: true });
  });
}

function rcHover(ev) {
  const v = RC.view;
  if (!v) return;
  const svg = document.getElementById("rchart-svg"), tip = document.getElementById("rchart-tip");
  const r = svg.getBoundingClientRect();
  const px = (ev.clientX - r.left) / r.width * v.W;
  let i = 0;
  for (let k = 1; k < v.n; k++) if (Math.abs(v.X(k) - px) < Math.abs(v.X(i) - px)) i = k;
  const cross = svg.querySelector(".rc-cross");
  cross.setAttribute("x1", v.X(i));
  cross.setAttribute("x2", v.X(i));
  cross.setAttribute("visibility", "visible");
  const rows = v.shown.filter(l => l.vals[i]).map(l => {
    const d = hgEl("div");
    const nm = hgEl("span", null, l.name);
    nm.style.color = `var(${RC_COLORS[l.name]})`;
    d.append(nm, hgEl("span", null, `${(l.vals[i].pct * 100).toFixed(1)}% (${l.vals[i].w}-${l.vals[i].l})`));
    return d;
  });
  tip.replaceChildren(hgEl("b", null, new Date(v.days[i] + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })), ...rows);
  tip.hidden = false;
  const left = v.X(i) / v.W * r.width;
  tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12) + "px";
}

async function initHomeGames() {
  if (!document.getElementById("hg-out")) return;
  hg.layout = hgStore(HG_LAYOUT_KEY) || (matchMedia("(max-width: 560px)").matches ? "list" : "cards");
  const pick = (id, key, save) => document.getElementById(id).addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    hg[key] = b.dataset.v;
    if (save) hgStore(save, b.dataset.v);
    hgRender();
  });
  pick("hg-days", "day");
  pick("hg-sports", "sport");
  pick("hg-layout", "layout", HG_LAYOUT_KEY);
  document.getElementById("hg-value").addEventListener("click", () => { hg.value = !hg.value; hgRender(); });
  document.getElementById("hg-teams").addEventListener("click", () => edgeOpenTeamPicker(hg.sport === "all" ? null : hg.sport));
  window.addEventListener("edge-favs-change", () => hgRender());
  document.getElementById("hg-out").addEventListener("click", e => {
    const more = e.target.closest(".hg-more");
    if (more) {
      const k = more.dataset.group;
      if (hg.open.has(k)) {
        hg.open.delete(k);
        hgRender();
        const again = document.querySelector(`.hg-more[data-group="${k}"]`);
        if (again) again.closest(".hg-sub").scrollIntoView({ block: "start" });
      } else {
        hg.open.add(k);
        hgRender();
      }
      return;
    }
    const b = e.target.closest(".hg-star");
    if (!b) return;
    const g = hg.games.find(x => x.key === b.dataset.key);
    if (!g) return;
    // The star adds the team we pick; on a starred game it clears both teams.
    if (hgIsFav(g)) [g.away, g.home].forEach(t => [t.abbr, t.espn].forEach(a => a && edgeSetFav(g.sport, a, false)));
    else { const t = g.pick === g.away.abbr ? g.away : g.home; edgeSetFav(g.sport, t.espn || t.abbr, true); }
  });
  hgHero();
  const refresh = async () => {
    await hgLoad();
    hgHero();
    hgRecords();
    hgRender();
    hgChart();
    hg.loaded = true;
    if (hg.games.some(g => g.state === "in")) setTimeout(refresh, 60000);
  };
  await refresh();
}

// --- Betting tab and Last night (home site only) ---
// Each site's summary.json carries "slate" (games still to play, with our
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

// Last night: every sport's latest results in one strip at the top of the home page.
async function initLastNight() {
  const box = document.getElementById("last-night");
  if (!box) return;
  const summaries = await edgeFetchSummaries();
  const lasts = [];
  EDGE_SITES.forEach((site, i) => { const l = summaries[i] && summaries[i].last; if (l) lasts.push({ site, last: l }); });
  if (!lasts.length) return;
  const latest = lasts.map(l => l.last.date).sort().pop();
  const today = edgeDayKey(new Date());
  const ago = d => Math.round((new Date(today + "T12:00:00Z") - new Date(d + "T12:00:00Z")) / 86400000);
  if (ago(latest) > 3) return;  // nothing recent: offseason or a quiet stretch
  const recent = lasts.filter(l => ago(l.last.date) - ago(latest) <= 2);
  const yesterday = ago(latest) === 1;
  let wins = 0, losses = 0;
  const rows = edgeNode("div", "ln-rows");
  const addRow = (label, items, date, href) => {
    const w = items.filter(it => it.hit).length;
    wins += w; losses += items.length - w;
    const row = edgeNode("div", "ln-row");
    const name = edgeNode("a", "ln-sport");
    name.href = href;
    name.append(edgeNode("b", null, label), edgeNode("span", null, `${w}-${items.length - w}`));
    if (date !== latest) name.append(edgeNode("small", null, edgeShortDay(date).split(",")[0]));
    const list = edgeNode("span", "ln-items");
    items.forEach(it => {
      const item = edgeNode(it.url ? "a" : "span", "ln-item " + (it.hit ? "is-hit" : "is-miss"));
      if (it.url) item.href = it.url;
      item.append(edgeNode("span", "ln-mark", it.hit ? "✓" : "✗"));
      item.setAttribute("aria-label", (it.hit ? "Hit: " : "Miss: ") + it.text);
      item.append(it.text);
      list.append(item);
    });
    row.append(name, list);
    rows.append(row);
  };
  recent.forEach(({ site, last }) => {
    if (last.games && last.games.length) {
      addRow(site.sport === "MLB" ? "MLB games" : site.sport, last.games, last.date,
             site.sport === "MLB" ? "/mlb/games.html" : site.href);
    }
    if (last.hits && last.hits.length) {
      addRow("MLB hits", last.hits.map(h => ({ hit: h.hit, text: `${h.name.split(" ").slice(1).join(" ") || h.name} ${h.line}` })),
             last.date, site.href);
    }
  });
  if (!rows.children.length) return;

  // Next up: each sport's next game day still to come.
  const next = [];
  const seen = new Set();
  edgeUpcoming(summaries).forEach(g => {
    if (seen.has(g.site.sport) || !g.start) return;
    seen.add(g.site.sport);
    const key = edgeDayKey(new Date(g.start));
    const n = (summaries[EDGE_SITES.indexOf(g.site)].slate || []).filter(x => x.start && edgeDayKey(new Date(x.start)) === key).length;
    const when = key === today ? "today" : "on " + new Date(g.start).toLocaleDateString("en-US", { ...EDGE_ET, weekday: "long" });
    next.push(`${n} ${g.site.sport} ${n === 1 ? "game" : "games"} ${when}`);
  });
  if (next.length) {
    const row = edgeNode("div", "ln-row ln-next");
    const name = edgeNode("span", "ln-sport");
    name.append(edgeNode("b", null, "Next up"));
    row.append(name, edgeNode("span", "ln-items", next.join(", ") + "."));
    rows.append(row);
  }

  const head = edgeNode("div", "ln-head");
  head.append(edgeNode("span", "rb-eyebrow", `${yesterday ? "Last night" : "Latest results"} · ${edgeShortDay(latest)}`),
              edgeNode("span", "ln-num", `${wins}-${losses}`));
  box.querySelector(".card-body").replaceChildren(head, rows);
  box.hidden = false;
}
initLastNight();
initHomeGames();  // after the shared helpers above (EDGE_ET) are defined
