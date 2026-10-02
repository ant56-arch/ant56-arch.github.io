// --- Score ticker and site settings (shared by every Edge site) ---
// Two scrolling bars under the top bar: a score ticker (live games first,
// then games still to play, then finals; each opens the Schedule tab) and a
// red bar of scoring plays seen in the last 3 hours. Each site's build
// publishes games.json (ESPN's current slate plus our picks) next to its
// summary.json; the ticker asks ESPN for fresh scores in the browser every 30
// seconds while a game is live (every 2 minutes while a game starts within 6
// hours). A gear in the top bar opens the site settings: what the ticker
// shows, which sports, time zone, odds format, theme and home page defaults,
// saved in localStorage. Keep this block identical in home.js (repo root),
// nfl-cfb/web/site.js and mlb-nba-cbb/web/site.js.
const EDGE_SITES = [
  { sport: "NFL", summary: "/nfl/summary.json", games: "/nfl/games.json",
    href: "/nfl/index.html", schedule: "/schedule.html#nfl" },
  { sport: "NBA", summary: "/nba/summary.json", games: "/nba/games.json",
    href: "/nba/index.html", schedule: "/schedule.html#nba" },
  { sport: "MLB", summary: "/mlb/summary.json", games: "/mlb/games.json",
    href: "/mlb/", schedule: "/schedule.html#mlb" },
  { sport: "NHL", summary: "/nhl/summary.json", games: "/nhl/games.json",
    href: "/nhl/index.html", schedule: "/schedule.html#nhl" },
  { sport: "CFB", summary: "/cfb/summary.json", games: "/cfb/games.json",
    href: "/cfb/index.html", schedule: "/schedule.html#cfb" },
  // CBB Edge has no games.json yet, so it shows on the home page only.
  { sport: "CBB", summary: "/cbb/summary.json", games: null,
    href: "/cbb/index.html", schedule: "/cbb/index.html" },
  // Soccer Edge: Premier League, La Liga and Champions League in one games.json
  // with no single ESPN address, so it isn't in the score ticker.
  { sport: "Soccer", summary: "/soccer/summary.json", games: "/soccer/games.json",
    href: "/soccer/index.html", schedule: "/schedule.html#soccer" },
];
const EDGE_LIVE_POLL = 30000;   // while a game is live
const EDGE_IDLE_POLL = 120000;  // while a game starts within EDGE_SOON
const EDGE_SOON = 6 * 3600000;
const EDGE_TICKER_SPORTS = ["MLB", "NFL", "NBA", "NHL", "CFB"];
const EDGE_SCORES_KEY = "edge-ticker-scores";
const EDGE_PLAYS_KEY = "edge-ticker-plays";
const EDGE_CRAWL_KEY = "edge-ticker-pos";
const edgeTicker = { published: {}, slates: {}, plays: [], flash: new Set(), toasts: null, settings: null };

function edgeFetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  return fetch(url, { cache: "no-cache", signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site => edgeFetchJson(site.summary)));
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

// ESPN scoreboard event -> the same shape games.py publishes.
function edgeParseEspn(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const sides = {};
  (comp.competitors || []).forEach(c => { sides[c.homeAway] = c; });
  if (!sides.home || !sides.away) return null;
  const type = ((comp.status || ev.status || {}).type) || {};
  const team = c => {
    const t = c.team || {};
    const rank = (c.curatedRank || {}).current;
    const score = c.score === undefined || c.score === "" ? null : Number(c.score);
    const record = (c.records || []).find(r => !r.type || r.type === "total");
    const probable = ((c.probables || [])[0] || {}).athlete;
    return { abbr: t.abbreviation || "", short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner, record: record ? record.summary : null,
             probable: probable ? probable.shortName : null, color: t.color ? "#" + t.color : "" };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  const lastPlay = ((comp.situation || {}).lastPlay || {}).text || "";
  return { id: String(ev.id), start: ev.date, lastPlay, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           tv: tv.slice(0, 2).join(", "), neutral: !!comp.neutralSite, away: team(sides.away), home: team(sides.home) };
}

async function edgeLoadGames(site) {
  if (!site.games) return null;
  // The published file only changes when the site rebuilds, so fetch it once.
  const published = edgeTicker.published[site.games] || await edgeFetchJson(site.games);
  if (!published) return null;
  edgeTicker.published[site.games] = published;
  const live = published.espn ? await edgeFetchJson(published.espn, 6000) : null;
  if (live && Array.isArray(live.events)) {
    const picks = {};
    (published.games || []).forEach(g => { if (g.pick) picks[g.id] = g.pick; });
    let games = live.events.map(edgeParseEspn).filter(Boolean);
    if (published.top25_only) games = games.filter(g => g.away.rank || g.home.rank);
    games.forEach(g => { if (picks[g.id]) g.pick = picks[g.id]; });
    const week = live.week && live.week.number;
    return { label: week && !["MLB", "NBA", "NHL"].includes(site.sport) ? `Week ${week}` : published.label,
             games, live: true };
  }
  return { label: published.label, games: published.games || [], live: false };
}

// --- Site settings: a gear in the top bar (ticker, sports, display, home) ---
// Saved per device in localStorage. Time zone and odds format also rewrite the
// "7:05 PM ET" times and "+135" prices the sites' builds print into pages.
const EDGE_SETTINGS_KEY = "edge-ticker-settings";
const EDGE_SETTINGS = [
  { group: "Ticker" },
  { k: "ticker", label: "Score ticker", sub: "A scrolling bar of games", on: true },
  { k: "plays", label: "Scoring plays", sub: "A red bar with each score", on: true },
  { k: "popups", label: "Score pop-ups", sub: "A card in the corner when a team scores", on: false },
  { k: "sound", label: "Sound", sub: "A short chime when a team scores", on: false },
  { k: "liveOnly", label: "Live games only", sub: "Hide games still to play and finals", on: false },
  { k: "picks", label: "Our picks", sub: "Show the model's pick next to each game", on: true },
  { k: "myTeams", label: "My teams only", sub: "Teams you star on the home page", on: false },
  { k: "speed", label: "Ticker speed", on: "normal", choices: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] },
  { group: "Sports in the ticker" },
  { k: "MLB", label: "MLB", on: true, sport: true },
  { k: "NFL", label: "NFL", on: true, sport: true },
  { k: "NBA", label: "NBA", on: true, sport: true },
  { k: "NHL", label: "NHL", on: true, sport: true },
  { k: "CFB", label: "College football", sub: "Games with a Top 25 team", on: true, sport: true },
  { group: "Display" },
  { k: "tz", label: "Time zone", on: "ET", choices: [["ET", "Eastern"], ["CT", "Central"], ["MT", "Mountain"], ["PT", "Pacific"], ["device", "My device"]] },
  { k: "odds", label: "Odds", on: "american", choices: [["american", "American (−150)"], ["decimal", "Decimal (1.67)"], ["percent", "Win chance (60%)"]] },
  { k: "theme", label: "Theme", on: "dark", choices: [["dark", "Dark"], ["light", "Light"], ["device", "Match my device"]] },
  { group: "Home page" },
  { k: "homeLayout", label: "Games view", on: "auto", choices: [["auto", "Cards (list on phones)"], ["cards", "Cards"], ["list", "List"]] },
  { k: "homeDay", label: "Opens on", on: "auto", choices: [["auto", "First day with games"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["weekend", "Weekend"]] },
];
const EDGE_TZ = { ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles" };
const EDGE_SPEED = { slow: 35, normal: 60, fast: 100 };  // pixels a second

function edgeStore(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* private mode or blocked storage: settings last for this page only */ }
  return null;
}

function edgeSettings() {
  if (!edgeTicker.settings) {
    const saved = edgeStore(EDGE_SETTINGS_KEY) || {};
    edgeTicker.settings = {};
    EDGE_SETTINGS.forEach(s => {
      if (!s.k) return;
      const ok = s.choices ? s.choices.some(c => c[0] === saved[s.k]) : typeof saved[s.k] === "boolean";
      edgeTicker.settings[s.k] = ok ? saved[s.k] : s.on;
    });
    // The home page's Cards/List buttons save their own choice; show it here.
    try {
      const layout = localStorage.getItem("edge-home-layout");
      if (layout === "cards" || layout === "list") edgeTicker.settings.homeLayout = layout;
    } catch (e) { /* storage blocked */ }
  }
  return edgeTicker.settings;
}

// The time zone picked in settings: { timeZone, label } for Intl formatting.
function edgeTz() {
  const tz = edgeSettings().tz;
  if (EDGE_TZ[tz]) return { timeZone: EDGE_TZ[tz], label: tz };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date()).find(p => p.type === "timeZoneName");
  return { timeZone: zone, label: name ? name.value : "local" };
}

// Minutes a time zone is ahead of UTC right now.
function edgeTzOffset(timeZone) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date()).forEach(x => { p[x.type] = Number(x.value); });
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  return Math.round((asUtc - Date.now()) / 60000);
}

// A moneyline price in the odds format picked in settings.
function edgeOdds(p) {
  const fmt = edgeSettings().odds;
  if (fmt === "decimal") return (p > 0 ? 1 + p / 100 : 1 + 100 / Math.abs(p)).toFixed(2);
  if (fmt === "percent") return Math.round(100 * (p > 0 ? 100 / (p + 100) : -p / (-p + 100))) + "%";
  return p > 0 ? "+" + p : "−" + Math.abs(p);
}

// Rewrites build-printed times ("Sun 1:00 PM ET") and prices ("+135",
// "−150") inside a part of the page to the picked time zone and odds format.
const EDGE_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EDGE_TIME_RE = /\b(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat)([a-z]*)(,?) )?(\d{1,2}):(\d{2}) ?(AM|PM) ET\b/g;
const EDGE_ODDS_RE = /(^|[\s(·])([+−-])(\d{3,5})(?![\d.,%$])/g;
function edgeLocalize(root) {
  const s = edgeSettings();
  const tz = edgeTz();
  const shift = s.tz === "ET" ? 0 : edgeTzOffset(tz.timeZone) - edgeTzOffset(EDGE_TZ.ET);
  const doTime = s.tz !== "ET";
  const doOdds = s.odds !== "american";
  if (!root || (!doTime && !doOdds)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(n.parentNode.nodeName)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    let text = n.nodeValue;
    if (doTime && text.includes("ET")) {
      text = text.replace(EDGE_TIME_RE, (m, day, rest, comma, h, min, ap) => {
        let mins = (Number(h) % 12 + (ap === "PM" ? 12 : 0)) * 60 + Number(min) + shift;
        let dayShift = 0;
        if (mins < 0) { mins += 1440; dayShift = -1; }
        if (mins >= 1440) { mins -= 1440; dayShift = 1; }
        const hh = Math.floor(mins / 60), mm = String(mins % 60).padStart(2, "0");
        let out = `${hh % 12 || 12}:${mm} ${hh < 12 ? "AM" : "PM"} ${tz.label}`;
        if (day) {
          const i = (EDGE_DAYS.findIndex(d => d.startsWith(day)) + dayShift + 7) % 7;
          const name = rest ? EDGE_DAYS[i] : EDGE_DAYS[i].slice(0, 3);
          out = `${name}${comma} ${out}`;
        }
        return out;
      });
    }
    if (doOdds) {
      text = text.replace(EDGE_ODDS_RE, (m, pre, sign, num) => pre + edgeOdds((sign === "+" ? 1 : -1) * Number(num)));
    }
    if (text !== n.nodeValue) n.nodeValue = text;
  });
}

function edgeApplyTheme() {
  const t = edgeSettings().theme;
  const light = t === "light" || (t === "device" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

function initSiteSettings() {
  edgeApplyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", edgeApplyTheme);
  if (document.body) {
    edgeLocalize(document.body);
    // Pages that draw parts with script (the home page, Schedule) get the same.
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 || n.nodeType === 3) edgeLocalize(n.nodeType === 1 ? n : n.parentNode);
    }))).observe(document.body, { childList: true, subtree: true });
  }
  const bar = document.querySelector(".topbar-inner");
  if (!bar || bar.querySelector(".ticker-gear")) return;
  const wrap = edgeNode("div", "ticker-settings");
  const btn = edgeNode("button", "ticker-gear");
  btn.type = "button";
  btn.setAttribute("aria-label", "Settings");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "ticker-panel");
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  const panel = edgeNode("div", "ticker-panel");
  panel.id = "ticker-panel";
  panel.hidden = true;
  panel.append(edgeNode("div", "ticker-panel-title", "Settings"));
  const settings = edgeSettings();
  const save = (k, v) => {
    settings[k] = v;
    edgeStore(EDGE_SETTINGS_KEY, settings);
    if (k === "homeLayout") {
      try {
        if (v === "auto") localStorage.removeItem("edge-home-layout");
        else localStorage.setItem("edge-home-layout", v);
      } catch (e) { /* storage blocked */ }
    }
    if (k === "theme") edgeApplyTheme();
    // Times and prices are already rewritten in the page, so redraw it.
    if (k === "tz" || k === "odds" || ((k === "homeLayout" || k === "homeDay") && document.getElementById("hg-out"))) {
      location.reload();
      return;
    }
    edgeRenderTicker();
  };
  EDGE_SETTINGS.forEach(s => {
    if (s.group) { panel.append(edgeNode("div", "ticker-panel-sub", s.group)); return; }
    if (s.choices) {
      const row = edgeNode("label", "ticker-choice");
      row.append(edgeNode("span", "ticker-switch-label", s.label));
      const sel = edgeNode("select");
      s.choices.forEach(([v, text]) => {
        const o = edgeNode("option", null, text);
        o.value = v;
        sel.append(o);
      });
      sel.value = settings[s.k];
      sel.addEventListener("change", () => save(s.k, sel.value));
      row.append(sel);
      panel.append(row);
      return;
    }
    const row = edgeNode("label", "ticker-switch");
    const text = edgeNode("span", "ticker-switch-text");
    text.append(edgeNode("span", "ticker-switch-label", s.label));
    if (s.sub) text.append(edgeNode("span", "ticker-switch-sub", s.sub));
    const input = edgeNode("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = settings[s.k];
    input.addEventListener("change", () => save(s.k, input.checked));
    row.append(text, input, edgeNode("span", "ticker-switch-knob"));
    panel.append(row);
  });
  const setOpen = open => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", e => { if (!wrap.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });
  wrap.append(btn, panel);
  bar.append(wrap);
}

function edgeGameStatus(g) {
  if (g.state !== "pre") return g.detail || (g.state === "post" ? "Final" : "Live");
  const d = new Date(g.start);
  if (isNaN(d)) return "";
  const tz = edgeTz();
  const opts = { timeZone: tz.timeZone };
  const day = d.toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const today = new Date().toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
  return (day === today ? "" : day + " ") + time + " " + tz.label;
}

// --- Score ticker and scoring plays ---
// What a score is called, by sport and points scored.
function edgeScoreWord(sport, pts) {
  if (sport === "NFL" || sport === "CFB") {
    return { 6: "Touchdown", 7: "Touchdown", 8: "Touchdown", 3: "Field goal", 2: "2 points", 1: "Extra point" }[pts] || `+${pts}`;
  }
  if (sport === "MLB") return pts === 1 ? "Run scores" : `${pts} runs score`;
  if (sport === "NHL") return pts === 1 ? "Goal" : `${pts} goals`;
  return `+${pts}`;
}

// A short two-note chime (when turned on in settings). Browsers allow sound
// only after the visitor has tapped the page, so it can stay quiet until then.
function edgeChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    edgeTicker.audio = edgeTicker.audio || new Ctx();
    const ctx = edgeTicker.audio;
    if (ctx.state === "suspended") ctx.resume();
    [[880, 0], [1320, 0.14]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
  } catch (e) { /* no sound available */ }
}

// A pop-up when a team scores (off unless turned on in settings): the
// scoring team in its color, the new score and the game clock.
function edgeScoreToast(play) {
  if (document.hidden) return;
  if (!edgeTicker.toasts || !edgeTicker.toasts.isConnected) {
    edgeTicker.toasts = edgeNode("div", "score-toasts");
    edgeTicker.toasts.setAttribute("aria-live", "polite");
    document.body.append(edgeTicker.toasts);
  }
  const toast = edgeNode("a", "score-toast");
  toast.href = play.href;
  if (play.color) toast.style.setProperty("--team", play.color);
  const head = edgeNode("span", "score-toast-head");
  head.append(edgeNode("span", "score-toast-sport", play.sport), edgeNode("span", "score-toast-what", play.what));
  const main = edgeNode("span", "score-toast-main");
  if (play.logo) {
    const img = edgeNode("img", "score-toast-logo");
    img.src = play.logo;
    img.alt = "";
    main.append(img);
  }
  main.append(edgeNode("span", "score-toast-team", `${play.team} score!`));
  const line = edgeNode("span", "score-toast-line");
  line.append(edgeNode("b", null, play.score));
  if (play.clock) line.append(edgeNode("span", "score-toast-clock", play.clock));
  toast.append(head, main, line);
  const close = edgeNode("button", "score-toast-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.addEventListener("click", e => { e.preventDefault(); toast.remove(); });
  toast.append(close);
  edgeTicker.toasts.prepend(toast);
  while (edgeTicker.toasts.children.length > 3) edgeTicker.toasts.lastChild.remove();
  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 400);
  }, 6000);
}

// One scrolling bar (the ticker or the red scoring-plays bar). Its items run
// twice in a row and slide left forever. Where the bar is (how far it has
// scrolled, and when) is saved as the page runs and as it closes, and every
// rebuild or new page carries on from there, so a score update or moving to
// another tab doesn't start it over.
function edgeCrawl(cls, label, items) {
  let bar = document.querySelector("." + cls);
  if (!items.length) {
    if (bar) bar.hidden = true;
    return;
  }
  if (!bar) {
    bar = edgeNode("aside", "crawl " + cls);
    const anchor = (cls === "crawl-plays" && document.querySelector(".crawl-ticker")) || document.querySelector(".topbar");
    if (!anchor) return;
    anchor.after(bar);
  }
  edgeCrawlSave(cls);
  bar.setAttribute("aria-label", label);
  bar.hidden = false;
  const tag = edgeNode("span", "crawl-tag", label);
  const view = edgeNode("div", "crawl-view");
  const run = edgeNode("div", "crawl-run");
  [0, 1].forEach(copy => items.forEach(make => {
    const item = make();
    if (copy) item.setAttribute("aria-hidden", "true");
    run.append(item);
  }));
  view.append(run);
  bar.replaceChildren(tag, view);
  const width = run.scrollWidth / 2;
  const secs = Math.max(15, width / (EDGE_SPEED[edgeSettings().speed] || EDGE_SPEED.normal));
  const saved = (edgeStore(EDGE_CRAWL_KEY) || {})[cls];
  // Pixels scrolled so far: the saved spot plus the time since it was saved.
  const px = saved ? saved.px + Math.max(0, Date.now() - saved.t) / 1000 * (width / secs) : 0;
  run.style.animationDuration = secs + "s";
  run.style.animationDelay = -((px % width) / width * secs) + "s";
  if (!edgeTicker.crawlSaving) {
    edgeTicker.crawlSaving = true;
    const saveAll = () => ["crawl-ticker", "crawl-plays"].forEach(edgeCrawlSave);
    setInterval(saveAll, 1000);
    addEventListener("pagehide", saveAll);
    document.addEventListener("visibilitychange", saveAll);
  }
}

// Saves how far a bar has scrolled right now (shared by every page on this
// device).
function edgeCrawlSave(cls) {
  const run = document.querySelector(`.${cls}:not([hidden]) .crawl-run`);
  if (!run || !run.style.animationDuration) return;
  const width = run.scrollWidth / 2;
  const x = -new DOMMatrixReadOnly(getComputedStyle(run).transform).m41;
  if (!width || !Number.isFinite(x)) return;
  const all = edgeStore(EDGE_CRAWL_KEY) || {};
  all[cls] = { px: x, t: Date.now() };
  edgeStore(EDGE_CRAWL_KEY, all);
}

function edgeTickerItem(site, g) {
  return () => {
    const a = edgeNode("a", "crawl-item" + (g.state === "in" ? " is-live" : ""));
    a.href = site.schedule;
    a.append(edgeNode("span", "crawl-sport", site.sport));
    [g.away, g.home].forEach(t => {
      const team = edgeNode("span", "crawl-team" + (g.state === "post" && t.winner ? " is-winner" : "") +
                            (edgeTicker.flash.has(`${site.sport}:${g.id}:${t === g.away ? "away" : "home"}`) ? " just-scored" : ""));
      if (t.logo) {
        const img = edgeNode("img", "crawl-logo");
        img.src = t.logo;
        img.alt = "";
        team.append(img);
      }
      if (t.rank) team.append(edgeNode("span", "crawl-rank", String(t.rank)));
      team.append(edgeNode("span", null, t.abbr || t.short));
      if (g.state !== "pre" && t.score != null) team.append(edgeNode("b", null, String(t.score)));
      a.append(team);
    });
    a.append(edgeNode("span", "crawl-status", edgeGameStatus(g)));
    if (edgeSettings().picks && g.pick && g.pick.text) {
      const pick = edgeNode("span", "crawl-pick");
      pick.append(edgeNode("span", null, "Pick: " + g.pick.text));
      const pill = edgeResultPill(g.pick.result);
      if (pill) pick.append(pill);
      a.append(pick);
    }
    return a;
  };
}

function edgePlayItem(play) {
  return () => {
    const a = edgeNode("a", "crawl-item play-item");
    a.href = play.href;
    a.append(edgeNode("span", "crawl-sport", play.sport), edgeNode("b", "play-what", play.what),
             edgeNode("span", "play-score", play.score));
    if (play.clock) a.append(edgeNode("span", "crawl-status", play.clock));
    if (play.text) a.append(edgeNode("span", "play-text", play.text));
    return a;
  };
}

// Teams starred on the home page ("NFL:KC"), for "My teams only".
function edgeMyTeams() {
  const settings = edgeSettings();
  if (!settings.myTeams) return null;
  const favs = edgeStore("edge-favs");
  return Array.isArray(favs) && favs.length ? new Set(favs) : null;
}

function edgeRenderTicker() {
  const settings = edgeSettings();
  const mine = edgeMyTeams();
  const t = g => new Date(g.start).getTime() || 0;
  const items = [];
  // Live games first, then games still to play, then finals.
  (settings.liveOnly ? ["in"] : ["in", "pre", "post"]).forEach(state => {
    EDGE_TICKER_SPORTS.forEach(sport => {
      const slate = edgeTicker.slates[sport];
      if (!settings[sport] || !slate) return;
      const site = EDGE_SITES.find(s => s.sport === sport);
      slate.games.filter(g => g.state === state)
        .filter(g => !mine || mine.has(`${sport}:${g.away.abbr}`) || mine.has(`${sport}:${g.home.abbr}`))
        .sort((a, b) => (state === "post" ? t(b) - t(a) : t(a) - t(b)))
        .forEach(g => items.push(edgeTickerItem(site, g)));
    });
  });
  edgeCrawl("crawl-ticker", "Scores", settings.ticker ? items : []);
  const plays = edgeTicker.plays
    .filter(p => settings[p.sport] && (!mine || (p.teams || []).some(a => mine.has(`${p.sport}:${a}`))))
    .map(edgePlayItem);
  edgeCrawl("crawl-plays", "Scoring", settings.plays ? plays : []);
}

async function initScoreboard() {
  // The old strip is replaced by the two bars.
  document.querySelectorAll(".scoreboard").forEach(n => n.remove());
  const sites = EDGE_TICKER_SPORTS.map(sport => EDGE_SITES.find(s => s.sport === sport));
  const slates = await Promise.all(sites.map(edgeLoadGames));
  // Scores from the last read, kept across pages for 15 minutes so moving
  // between pages doesn't miss a score or count one twice.
  const saved = edgeStore(EDGE_SCORES_KEY);
  const last = saved && Date.now() - saved.t < 15 * 60000 ? saved.scores : null;
  const scores = Object.assign({}, last || {});
  const fresh = [];
  edgeTicker.flash = new Set();
  sites.forEach((site, i) => {
    const slate = slates[i];
    if (!slate) return;
    edgeTicker.slates[site.sport] = slate;
    // Compare only fresh reads from ESPN; a game that went final since the
    // last read (a walk-off) still counts.
    if (!slate.live) return;
    slate.games.forEach(g => {
      if (g.state === "pre") return;
      ["away", "home"].forEach(side => {
        const key = `${site.sport}:${g.id}:${side}`;
        const now = g[side].score;
        const before = last ? last[key] : null;
        if (now != null) scores[key] = now;
        if (before == null || now == null || now <= before) return;
        edgeTicker.flash.add(key);
        const team = g[side];
        const other = g[side === "away" ? "home" : "away"];
        fresh.push({ id: `${key}:${now}`, sport: site.sport, href: site.schedule, t: Date.now(),
                     teams: [g.away.abbr, g.home.abbr],
                     what: edgeScoreWord(site.sport, now - before), team: team.short || team.abbr,
                     logo: team.logo, color: team.color, text: g.lastPlay || "",
                     score: `${team.abbr} ${now}, ${other.abbr} ${other.score}`,
                     clock: g.state === "post" ? "Final" : g.detail });
      });
    });
  });
  edgeStore(EDGE_SCORES_KEY, { t: Date.now(), scores });
  // Scoring plays from the last 3 hours, newest first, kept across pages.
  const kept = (edgeStore(EDGE_PLAYS_KEY) || []).filter(p => Date.now() - p.t < 3 * 3600000);
  const plays = fresh.reverse().concat(kept.filter(p => !fresh.some(f => f.id === p.id))).slice(0, 12);
  edgeStore(EDGE_PLAYS_KEY, plays);
  edgeTicker.plays = plays;
  edgeRenderTicker();
  const settings = edgeSettings();
  const mine = edgeMyTeams();
  const shown = fresh.filter(p => settings[p.sport] && (!mine || p.teams.some(a => mine.has(`${p.sport}:${a}`))));
  if (settings.popups) shown.slice(0, 3).forEach(edgeScoreToast);
  if (settings.sound && shown.length && !document.hidden) edgeChime();
  const now = Date.now();
  const all = slates.flatMap(s => (s ? s.games : []));
  if (all.some(g => g.state === "in")) setTimeout(initScoreboard, EDGE_LIVE_POLL);
  else if (all.some(g => g.state === "pre" && start(g) - now < EDGE_SOON && now - start(g) < EDGE_SOON)) setTimeout(initScoreboard, EDGE_IDLE_POLL);
  function start(g) { return new Date(g.start).getTime() || 0; }
}
initSiteSettings();
initScoreboard();

// Home page: every sport's games with our pick, live games first, then games
// still to play, then finals, each grouped by sport. Picks come from each
// site's summary.json "slate"; scores, logos, records and TV come from ESPN in
// the browser (the games.json "espn" address, without the CFB Top 25 filter),
// refreshed every minute while a game is live. A pick is matched to its ESPN
// game by start time and one shared team abbreviation. Below it, each site's
// all-time record from summary.json.
const HG_ORDER = ["NFL", "CFB", "MLB", "NHL", "NBA", "CBB", "Soccer"];
const HG_FAV_KEY = "edge-favs";
const HG_LAYOUT_KEY = "edge-home-layout";
const HG_SHOW = 9;  // games per sport group before "See more"
const hg = { day: null, sport: "all", value: false, open: new Set(), layout: null, favs: new Set(), games: [], summaries: [] };

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

async function hgLoadEspn(site) {
  if (!site.games) return [];
  const published = await edgeFetchJson(site.games);
  if (!published) return [];
  const live = published.espn ? await edgeFetchJson(published.espn, 6000) : null;
  if (live && Array.isArray(live.events)) return live.events.map(edgeParseEspn).filter(Boolean);
  return published.games || [];
}

function hgMatch(g, espn) {
  const t = new Date(g.start).getTime();
  const teams = [g.away, g.home];
  return espn.find(e => Math.abs(new Date(e.start).getTime() - t) < 15 * 60000 &&
                        (teams.includes(e.away.abbr) || teams.includes(e.home.abbr))) || null;
}

async function hgLoad() {
  const [summaries, espn] = await Promise.all([edgeFetchSummaries(), Promise.all(EDGE_SITES.map(hgLoadEspn))]);
  hg.summaries = summaries;
  const games = [];
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    (s && s.slate || []).forEach(g => {
      if (!g.start) return;
      const e = hgMatch(g, espn[i]);
      const flip = e && !(e.away.abbr === g.away || e.home.abbr === g.home);  // ESPN lists them the other way
      const side = (ours, theirs) => ({
        abbr: ours, name: theirs ? theirs.short || theirs.name || ours : ours, logo: theirs ? theirs.logo : "",
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
  return hg.favs.has(g.sport + ":" + g.away.abbr) || hg.favs.has(g.sport + ":" + g.home.abbr);
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
  if (t.score != null) row.append(hgEl("span", "hg-sc", String(t.score)));
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
  const res = hgResult(g);
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
  const res = hgResult(g);
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
  } else if (!hg.favs.size && inDay.length) {
    tally.textContent = "Tap ☆ on any game to pin your teams to the top.";
  }

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
      const a = hgEl("a", "hr-tile");
      a.href = href;
      const lbl = hgEl("span", "hr-lbl", sport + " ");
      if (part) lbl.append(hgEl("em", null, part));
      const val = hgEl("span", "hr-val", rec.value);
      if (rec.sub) val.append(hgEl("i", null, rec.sub.replace(/\.\d%$/, "%")));
      a.append(lbl, val, hgEl("small", null, rec.since ? "since " + rec.since.replace(/, \d{4}$/, "") : rec.label));
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

async function initHomeGames() {
  if (!document.getElementById("hg-out")) return;
  const saved = hgStore(HG_FAV_KEY);
  try { const f = JSON.parse(saved); if (Array.isArray(f)) hg.favs = new Set(f); } catch (e) { /* no favorites yet */ }
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
    if (hgIsFav(g)) [g.away.abbr, g.home.abbr].forEach(a => hg.favs.delete(g.sport + ":" + a));
    else hg.favs.add(g.sport + ":" + g.pick);
    hgStore(HG_FAV_KEY, JSON.stringify([...hg.favs]));
    hgRender();
  });
  hgHero();
  const refresh = async () => {
    await hgLoad();
    hgHero();
    hgRecords();
    hgRender();
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

// --- Sport menu on phones (shared by every Edge site) ---
// Adds a menu button (the current sport and three lines) to the top bar; on
// phones the CSS hides the sport tabs behind it and drops them down as a list
// when it's tapped. Keep this block identical in home.js (repo root),
// nfl-cfb/web/site.js and mlb-nba-cbb/web/site.js.
function initSportMenu() {
  const bar = document.querySelector(".topbar-inner");
  const nav = bar && bar.querySelector(".sport-switcher");
  if (!nav || bar.querySelector(".menu-toggle")) return;
  nav.id = nav.id || "sport-menu";
  const active = nav.querySelector(".sport-tab.active");
  const btn = edgeNode("button", "menu-toggle");
  btn.type = "button";
  btn.setAttribute("aria-controls", nav.id);
  btn.setAttribute("aria-expanded", "false");
  const icon = edgeNode("span", "menu-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.append(edgeNode("span"), edgeNode("span"), edgeNode("span"));
  btn.append(edgeNode("span", "menu-current", active ? active.textContent : "Sports"),
             edgeNode("span", "sr-only", " menu"), icon);
  const setOpen = open => {
    bar.classList.toggle("menu-open", open);
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => setOpen(!bar.classList.contains("menu-open")));
  document.addEventListener("click", e => { if (!bar.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && bar.classList.contains("menu-open")) { setOpen(false); btn.focus(); }
  });
  bar.insertBefore(btn, nav);
  bar.classList.add("has-menu");
}
initSportMenu();
