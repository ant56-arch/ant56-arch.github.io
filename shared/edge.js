// --- Score ticker and site settings (shared by every Edge site) ---
// Two scrolling bars under the top bar: a score ticker (live games first,
// then games still to play, then finals; each opens the Schedule tab) and a
// red bar of scoring plays seen in the last 3 hours (for basketball, only
// standout finals). Each site's build publishes games.json (ESPN's current
// slate plus our picks) next to its summary.json; the ticker asks ESPN for
// fresh scores in the browser every 30 seconds while a game is live (every 2
// minutes while a game starts within 6 hours). A gear in the top bar opens
// the site settings: what the ticker shows, which sports, time zone, odds
// format, theme and home page defaults, saved in localStorage. Every Edge
// site's script starts from this file (see shared/assets.py).
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
    // The team's top scorer (basketball), for standout games in the red bar.
    const pts = ((c.leaders || []).find(l => l.name === "points") || {}).leaders;
    const top = pts && pts[0];
    const leader = top && top.athlete ? { name: top.athlete.shortName || top.athlete.displayName || "", pts: Number(top.value || top.displayValue) || 0 } : null;
    return { leader, abbr: t.abbreviation || "", short: t.shortDisplayName || t.name || "", logo: t.logo || "",
             rank: rank >= 1 && rank <= 25 ? rank : null, score: Number.isFinite(score) ? score : null,
             winner: !!c.winner, record: record ? record.summary : null,
             probable: probable ? probable.shortName : null, color: t.color ? "#" + t.color : "" };
  };
  const tv = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => { if (!tv.includes(n)) tv.push(n); }));
  const lastPlay = ((comp.situation || {}).lastPlay || {}).text || "";
  return { id: String(ev.id), start: ev.date, lastPlay, state: type.state || "pre", detail: type.shortDetail || type.detail || "",
           tv: tv.slice(0, 2).join(", "), neutral: !!comp.neutralSite, series: edgeSeriesLabel(ev, comp),
           away: team(sides.away), home: team(sides.home) };
}

// A playoff game's round and series score, like "NLCS · Game 2 · MIL leads series 1-0"
// ("" outside the postseason). Same rule as series_label in shared/games.py.
function edgeSeriesLabel(ev, comp) {
  const series = comp.series || {};
  if ((ev.season || {}).type !== 3 && series.type !== "playoff") return "";
  const note = ((comp.notes || []).find(n => n.headline) || {}).headline || "";
  const parts = note ? [note.replace(/ - /g, " · ")] : [];
  if (series.summary && (series.competitors || []).some(c => c.wins)) parts.push(series.summary);
  return parts.join(" · ");
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
  { k: "plays", label: "Scoring plays", sub: "A red bar with each score (NBA: big finals only)", on: true },
  { k: "popups", label: "Score pop-ups", sub: "A card in the corner when a team scores", on: false },
  { k: "sound", label: "Sound", sub: "A short chime when a team scores", on: false },
  { k: "liveOnly", label: "Live games only", sub: "Hide games still to play and finals", on: false },
  { k: "picks", label: "Our picks", sub: "Show the model's pick next to each game", on: true },
  { k: "myTeamsFirst", label: "My teams first", sub: "Games with teams you pick lead the ticker", on: true },
  { button: "pickTeams", label: "Pick my teams" },
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
  { k: "theme", label: "Theme", on: "device", choices: [["light", "Paper (light)"], ["dark", "Night (dark)"], ["device", "Match my device"]] },
  { group: "Home page" },
  { k: "homeLayout", label: "Games view", on: "auto", choices: [["auto", "Slate"], ["cards", "Cards"], ["list", "List"]] },
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
      else if (layout === "slate") edgeTicker.settings.homeLayout = "auto";
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

// ---------- Stadium hero ----------
// Every page's masthead is a stadium under lights, drawn on a canvas: a
// ballpark on the home page and MLB, an open-air stadium for football and
// soccer, an indoor arena with ice or hardwood for hockey and basketball.
// Seeded random, so the crowd and grain are the same on every visit.

function edgeStadiumKind(sport) {
  const s = String(sport || "").toUpperCase();
  if (s === "NHL") return "ice";
  if (s === "NBA" || s === "CBB") return "court";
  if (s === "NFL" || s === "CFB" || s === "SOCCER") return "pitch";
  return "park";
}

function edgeStadium(c, kind) {
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const x = c.getContext("2d"); x.scale(dpr, dpr);
  const W = r.width, H = r.height, hz = H * (kind === "park" || kind === "pitch" ? 0.5 : 0.46);
  const indoor = kind === "ice" || kind === "court";
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let g = x.createLinearGradient(0, 0, 0, hz);
  if (indoor) { g.addColorStop(0, "#07090A"); g.addColorStop(0.7, "#141A1C"); g.addColorStop(1, "#2A2620"); }
  else { g.addColorStop(0, "#0B1418"); g.addColorStop(0.55, "#1D2A33"); g.addColorStop(0.85, "#6B4A3A"); g.addColorStop(1, "#C98A55"); }
  x.fillStyle = g; x.fillRect(0, 0, W, hz + 2);
  if (indoor) {
    // roof trusses
    x.strokeStyle = "rgba(242,238,230,.06)"; x.lineWidth = 1;
    for (let i = 0; i <= 14; i++) { x.beginPath(); x.moveTo(W * i / 14, 0); x.lineTo(W * 0.5 + (i - 7) * W * 0.03, hz - 90); x.stroke(); }
    // scoreboard
    const sw = Math.min(160, W * 0.18);
    x.fillStyle = "#0C100E"; x.fillRect(W / 2 - sw / 2, H * 0.06, sw, sw * 0.42);
    x.fillStyle = "rgba(229,157,114,.55)"; x.fillRect(W / 2 - sw / 2 + 6, H * 0.06 + 6, sw - 12, 3);
  } else {
    x.fillStyle = "#2A2F33";
    x.beginPath(); x.moveTo(0, hz);
    for (let i = 0; i <= 12; i++) x.lineTo(W * i / 12, hz - 20 - Math.sin(i * 1.7) * 14 - Math.cos(i * 0.9) * 10);
    x.lineTo(W, hz); x.fill();
  }
  // the stands, a long low bowl, and the crowd in them
  g = x.createLinearGradient(0, hz - 70, 0, hz + 30); g.addColorStop(0, "#1B2420"); g.addColorStop(1, "#0F1613");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(-20, hz + 30); x.lineTo(-20, hz - 30);
  x.quadraticCurveTo(W * 0.5, hz - (indoor ? 150 : 110), W + 20, hz - 30); x.lineTo(W + 20, hz + 30); x.fill();
  const crowd = Math.min(2600, W * 1.2);
  for (let i = 0; i < crowd; i++) {
    const px = rnd() * W, t = px / W, top = hz - 30 - Math.sin(t * Math.PI) * (indoor ? 105 : 70);
    const py = top + rnd() * (hz + 26 - top);
    x.fillStyle = `rgba(${200 + rnd() * 55},${170 + rnd() * 60},${140 + rnd() * 60},${0.08 + rnd() * 0.22})`;
    x.fillRect(px, py, 1.2, 1.2);
  }
  // the playing surface
  const top = hz + 20;
  if (kind === "ice") {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#9FB3BC"); g.addColorStop(1, "#56666C");
  } else if (kind === "court") {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#8A6440"); g.addColorStop(1, "#3E2A19");
  } else {
    g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, "#2E5A33"); g.addColorStop(1, "#14301B");
  }
  x.fillStyle = g; x.fillRect(0, top, W, H);
  const stripe = (w0, w1, a, b) => {
    for (let i = -14; i < 26; i++) {
      x.fillStyle = i % 2 ? a : b;
      x.beginPath();
      x.moveTo(W * 0.5 + i * w0, top); x.lineTo(W * 0.5 + (i + 1) * w0, top);
      x.lineTo(W * 0.5 + (i + 1) * w1, H); x.lineTo(W * 0.5 + i * w1, H); x.fill();
    }
  };
  if (kind === "court") stripe(14, 90, "rgba(255,255,255,.025)", "rgba(0,0,0,.05)");
  else if (kind !== "ice") stripe(40, 260, "rgba(255,255,255,.035)", "rgba(0,0,0,.05)");
  // a horizon-to-viewer line at fraction f across the field, in perspective
  const across = (f, color, w) => {
    const y = top + (H - top) * f;
    x.strokeStyle = color; x.lineWidth = w || 1.2;
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
  };
  const line = "rgba(242,238,230,.24)";
  if (kind === "park") {
    x.strokeStyle = line; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(W * 0.5, H * 0.98); x.lineTo(W * 0.05, hz + 40); x.moveTo(W * 0.5, H * 0.98); x.lineTo(W * 0.95, hz + 40); x.stroke();
    x.fillStyle = "rgba(160,104,64,.55)";
    x.beginPath(); x.ellipse(W * 0.5, H * 0.9, W * 0.2, H * 0.12, 0, Math.PI, 2 * Math.PI); x.fill();
  } else if (kind === "pitch") {
    [0.08, 0.2, 0.36, 0.58, 0.86].forEach(f => across(f, line, 1 + f));
    x.strokeStyle = line; x.lineWidth = 1.4;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.36, W * 0.09, (H - top) * 0.07, 0, 0, 2 * Math.PI); x.stroke();
  } else if (kind === "ice") {
    across(0.42, "rgba(176,40,40,.65)", 4);
    across(0.18, "rgba(40,80,170,.55)", 3);
    across(0.78, "rgba(40,80,170,.55)", 4);
    x.strokeStyle = "rgba(176,40,40,.6)"; x.lineWidth = 2;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.42, W * 0.08, (H - top) * 0.09, 0, 0, 2 * Math.PI); x.stroke();
  } else if (kind === "court") {
    across(0.4, line, 2);
    x.strokeStyle = line; x.lineWidth = 2;
    x.beginPath(); x.ellipse(W * 0.5, top + (H - top) * 0.4, W * 0.07, (H - top) * 0.1, 0, 0, 2 * Math.PI); x.stroke();
    x.beginPath(); x.ellipse(W * 0.5, H * 1.02, W * 0.28, (H - top) * 0.32, 0, Math.PI, 2 * Math.PI); x.stroke();
  }
  // light towers outdoors, a ring of lamps indoors, each with its glow
  const lamps = indoor ? [[0.2, 0.2], [0.4, 0.14], [0.6, 0.14], [0.8, 0.2]] : [[0.12, 0.16], [0.3, 0.1], [0.7, 0.1], [0.88, 0.16]];
  lamps.forEach(([fx, fy]) => {
    const lx = W * fx, ly = H * fy;
    const glow = x.createRadialGradient(lx, ly, 0, lx, ly, W * (indoor ? 0.16 : 0.22));
    glow.addColorStop(0, "rgba(255,240,205,.55)"); glow.addColorStop(0.12, "rgba(255,226,170,.18)"); glow.addColorStop(1, "rgba(255,220,160,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    x.fillStyle = "#FFF6E2";
    if (indoor) { x.fillRect(lx - 9, ly - 2, 18, 4); return; }
    x.fillStyle = "#0C110F"; x.fillRect(lx - 1.5, ly, 3, hz - ly);
    x.fillStyle = "#FFF6E2";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(lx - 14 + i * 7.5, ly - 8 + j * 6, 5, 4);
  });
  // haze and film grain
  g = x.createLinearGradient(0, hz - 60, 0, hz + 80); g.addColorStop(0, "rgba(255,230,190,0)"); g.addColorStop(0.5, "rgba(255,230,190,.10)"); g.addColorStop(1, "rgba(255,230,190,0)");
  x.fillStyle = g; x.fillRect(0, hz - 60, W, 140);
  const grain = Math.min(30000, W * H / 90);
  for (let i = 0; i < grain; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; x.fillRect(rnd() * W, rnd() * H, 1, 1); }
}

function initStadium() {
  const head = document.querySelector("header.masthead");
  if (!head || head.querySelector("canvas.stadium")) return;
  const c = document.createElement("canvas");
  c.className = "stadium";
  c.setAttribute("aria-hidden", "true");
  head.prepend(c);
  const kind = edgeStadiumKind(head.dataset.sport);
  const draw = () => edgeStadium(c, kind);
  draw();
  let w = c.clientWidth, timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (c.clientWidth !== w) { w = c.clientWidth; draw(); } }, 150);
  });
}

function initSiteSettings() {
  edgeApplyTheme();
  initStadium();
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
  window.addEventListener("edge-favs-change", () => edgeRenderTicker());
  EDGE_SETTINGS.forEach(s => {
    if (s.group) { panel.append(edgeNode("div", "ticker-panel-sub", s.group)); return; }
    if (s.button === "pickTeams") {
      const b = edgeNode("button", "ticker-teams-btn");
      b.type = "button";
      const count = () => { const n = edgeFavs().size; b.textContent = n ? `★ ${s.label} (${n})` : `☆ ${s.label}`; };
      count();
      window.addEventListener("edge-favs-change", count);
      b.addEventListener("click", () => { setOpen(false); edgeOpenTeamPicker(); });
      panel.append(b);
      return;
    }
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

function edgeTickerItem(site, g, mine) {
  return () => {
    const a = edgeNode("a", "crawl-item" + (g.state === "in" ? " is-live" : ""));
    a.href = site.schedule;
    a.append(edgeNode("span", "crawl-sport", (mine ? "\u2605 " : "") + site.sport));
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
      const pill = edgeResultPill(g.pick.result, g.pick.labels);
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

// --- My teams: favorite teams in any league ("NFL:KC"), saved per device ---
// Picked from the gear menu or the home page's "My teams" button, or starred on
// a home game card. Keys use ESPN's abbreviations; a few of our data sources
// spell some teams differently, so those are mapped onto ESPN's.
const EDGE_FAV_KEY = "edge-favs";
const EDGE_FAV_ALIAS = { "MLB:AZ": "MLB:ARI", "MLB:CWS": "MLB:CHW", "NFL:LA": "NFL:LAR", "NFL:WAS": "NFL:WSH" };
// ESPN team lists per sport: [path, query] for each list.
const EDGE_TEAM_LISTS = {
  NFL: [["football/nfl", ""]],
  CFB: [["football/college-football", "limit=1000"]],
  MLB: [["baseball/mlb", ""]],
  NBA: [["basketball/nba", ""]],
  NHL: [["hockey/nhl", ""]],
  CBB: [["basketball/mens-college-basketball", "groups=50&limit=500"]],
  Soccer: [["soccer/eng.1", ""], ["soccer/esp.1", ""], ["soccer/uefa.champions", ""]],
};
const EDGE_TEAM_SPORT_NAMES = { CFB: "College football", CBB: "College basketball" };

function edgeFavKey(sport, abbr) {
  const k = `${sport}:${abbr}`;
  return EDGE_FAV_ALIAS[k] || k;
}

function edgeFavs() {
  const favs = edgeStore(EDGE_FAV_KEY);
  return new Set(Array.isArray(favs) ? favs.map(k => EDGE_FAV_ALIAS[k] || k) : []);
}

function edgeIsFav(sport, ...abbrs) {
  const favs = edgeFavs();
  return abbrs.some(a => a && favs.has(edgeFavKey(sport, a)));
}

function edgeSetFav(sport, abbr, on) {
  const favs = edgeFavs();
  const k = edgeFavKey(sport, abbr);
  if (on) favs.add(k); else favs.delete(k);
  edgeStore(EDGE_FAV_KEY, [...favs]);
  window.dispatchEvent(new CustomEvent("edge-favs-change"));
}

// Teams starred, for "My teams first" in the ticker. The ticker still shows
// every game; starred teams' games just come first.
function edgeMyTeams() {
  const settings = edgeSettings();
  if (!settings.myTeamsFirst) return null;
  const favs = edgeFavs();
  return favs.size ? favs : null;
}

// teams.json is built weekly from ESPN (shared/teams.py), since ESPN's team
// lists can't be read from the browser; ESPN is only a fallback.
const edgeTeamCache = {};
let edgeTeamFile = null;
async function edgeLoadTeams(sport) {
  if (!edgeTeamFile) edgeTeamFile = edgeFetchJson("/teams.json");
  const file = await edgeTeamFile;
  if (!file) edgeTeamFile = null;
  if (file && Array.isArray(file[sport]) && file[sport].length) return file[sport];
  if (!edgeTeamCache[sport]) {
    edgeTeamCache[sport] = Promise.all((EDGE_TEAM_LISTS[sport] || []).map(([path, q]) =>
      edgeFetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams${q ? "?" + q : ""}`, 8000)))
      .then(lists => {
        const seen = new Map();
        lists.forEach(data => {
          const teams = (((((data || {}).sports || [])[0] || {}).leagues || [])[0] || {}).teams || [];
          teams.forEach(({ team: t }) => {
            if (!t || !t.abbreviation || seen.has(t.abbreviation)) return;
            seen.set(t.abbreviation, { abbr: t.abbreviation, name: t.displayName || t.shortDisplayName || t.abbreviation,
                                       logo: ((t.logos || [])[0] || {}).href || "" });
          });
        });
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
  }
  const teams = await edgeTeamCache[sport];
  if (!teams.length) delete edgeTeamCache[sport];  // try again next time
  return teams;
}

// A sheet to pick favorite teams: a tab per sport, a search box and every team.
function edgeOpenTeamPicker(startSport) {
  if (document.querySelector(".team-picker")) return;
  const sports = Object.keys(EDGE_TEAM_LISTS);
  let sport = sports.includes(startSport) ? startSport : sports[0];
  const opener = document.activeElement;
  const back = edgeNode("div", "team-picker");
  const box = edgeNode("div", "team-picker-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "My teams");
  const head = edgeNode("div", "team-picker-head");
  const close = edgeNode("button", "team-picker-close", "Done");
  close.type = "button";
  head.append(edgeNode("div", "team-picker-title", "My teams"), close);
  const note = edgeNode("p", "team-picker-note", "Star teams in any league. Their games go to the top of the home page, and the ticker can show only them.");
  const mine = edgeNode("div", "team-picker-mine");
  const tabs = edgeNode("div", "team-picker-tabs");
  tabs.setAttribute("role", "tablist");
  const search = edgeNode("input", "team-picker-search");
  search.type = "search";
  search.placeholder = "Search teams";
  search.setAttribute("aria-label", "Search teams");
  const list = edgeNode("div", "team-picker-list");
  box.append(head, note, mine, tabs, search, list);
  back.append(box);

  const drawMine = () => {
    const favs = [...edgeFavs()];
    mine.replaceChildren();
    if (!favs.length) { mine.append(edgeNode("span", "team-picker-none", "No teams yet.")); return; }
    favs.sort().forEach(k => {
      const [sp, abbr] = k.split(":");
      const chip = edgeNode("button", "team-picker-chip", `${sp === "Soccer" ? "" : sp + " "}${abbr} ×`);
      chip.type = "button";
      chip.setAttribute("aria-label", `Remove ${sp} ${abbr}`);
      chip.addEventListener("click", () => { edgeSetFav(sp, abbr, false); drawMine(); drawList(); });
      mine.append(chip);
    });
  };
  let token = 0;
  const drawList = async () => {
    const mineToken = ++token;
    if (!list.childElementCount) list.append(edgeNode("p", "team-picker-none", "Loading teams."));
    const teams = await edgeLoadTeams(sport);
    if (mineToken !== token) return;
    const q = search.value.trim().toLowerCase();
    const shown = teams.filter(t => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase() === q);
    list.replaceChildren();
    if (!teams.length) { list.append(edgeNode("p", "team-picker-none", "Couldn't load teams. Check your connection and try again.")); return; }
    if (!shown.length) { list.append(edgeNode("p", "team-picker-none", "No team matches that.")); return; }
    shown.forEach(t => {
      const on = edgeIsFav(sport, t.abbr);
      const b = edgeNode("button", "team-picker-team");
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      if (t.logo) {
        const img = edgeNode("img");
        img.src = t.logo; img.alt = ""; img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        b.append(img);
      }
      b.append(edgeNode("span", "team-picker-name", t.name), edgeNode("span", "team-picker-star", on ? "★" : "☆"));
      b.addEventListener("click", () => {
        const now = !edgeIsFav(sport, t.abbr);
        edgeSetFav(sport, t.abbr, now);
        b.setAttribute("aria-pressed", String(now));
        b.lastChild.textContent = now ? "★" : "☆";
        drawMine();
      });
      list.append(b);
    });
  };
  sports.forEach(sp => {
    const t = edgeNode("button", null, sp);
    t.type = "button";
    t.setAttribute("role", "tab");
    if (EDGE_TEAM_SPORT_NAMES[sp]) t.title = EDGE_TEAM_SPORT_NAMES[sp];
    t.setAttribute("aria-selected", String(sp === sport));
    t.addEventListener("click", () => {
      sport = sp;
      tabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", String(x === t)));
      search.value = "";
      list.replaceChildren();
      drawList();
    });
    tabs.append(t);
  });
  search.addEventListener("input", drawList);
  const done = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("team-picker-open");
    if (opener && opener.focus) opener.focus();
  };
  const onKey = e => { if (e.key === "Escape") done(); };
  close.addEventListener("click", done);
  back.addEventListener("click", e => { if (e.target === back) done(); });
  document.addEventListener("keydown", onKey);
  document.documentElement.classList.add("team-picker-open");
  document.body.append(back);
  drawMine();
  drawList();
  close.focus();
}

function edgeRenderTicker() {
  const settings = edgeSettings();
  const mine = edgeMyTeams();
  const t = g => new Date(g.start).getTime() || 0;
  const items = [];
  const later = [];
  const isMine = (sport, g) => mine && (mine.has(edgeFavKey(sport, g.away.abbr)) || mine.has(edgeFavKey(sport, g.home.abbr)));
  // My teams' games first, then live games, games still to play, finals.
  (settings.liveOnly ? ["in"] : ["in", "pre", "post"]).forEach(state => {
    EDGE_TICKER_SPORTS.forEach(sport => {
      const slate = edgeTicker.slates[sport];
      if (!settings[sport] || !slate) return;
      const site = EDGE_SITES.find(s => s.sport === sport);
      slate.games.filter(g => g.state === state)
        .sort((a, b) => (state === "post" ? t(b) - t(a) : t(a) - t(b)))
        .forEach(g => (isMine(sport, g) ? items : later).push(edgeTickerItem(site, g, isMine(sport, g))));
    });
  });
  edgeCrawl("crawl-ticker", "Scores", settings.ticker ? items.concat(later) : []);
  const plays = edgeTicker.plays.filter(p => settings[p.sport]).map(edgePlayItem);
  edgeCrawl("crawl-plays", "Scoring", settings.plays ? plays : []);
}

// Sports whose red-bar entries are standout finals instead of every score.
const EDGE_FINALS_ONLY = ["NBA"];
// The red bar stays short: one line per game, the newest few games only.
const EDGE_PLAYS_MAX = 6;
// ESPN's "last play" is often a later, non-scoring play ("X pitches to Y");
// it is shown only when it reads like the score itself.
const EDGE_SCORING_TEXT = /\b(homer(s|ed)?|home run|grand slam|scores?|scored|runs? in|walk-off|sacrifice fly|touchdown|field goal|safety|extra point|two-point|goal)\b/i;
const edgePlayGame = p => p.id.split(":").slice(0, 2).join(":");

// A basketball final worth a line in the red bar: a blowout (20+ points), a
// big scoring night for a team (130+) or a player (40+), or overtime. Only
// games that started in the last 4 hours, so an old final doesn't come back
// after its line has expired.
function edgeStandout(site, g) {
  if (g.state !== "post" || g.away.score == null || g.home.score == null) return null;
  if (Date.now() - new Date(g.start).getTime() > 4 * 3600000) return null;
  const [win, lose] = g.away.score > g.home.score ? [g.away, g.home] : [g.home, g.away];
  const notes = [];
  if (/OT/.test(g.detail || "")) notes.push(g.detail.replace(/^Final\/?/i, "").trim() || "OT");
  if (win.score - lose.score >= 20) notes.push(`Won by ${win.score - lose.score}`);
  [win, lose].filter(t => t.score >= 130).forEach(t => notes.push(`${t.abbr} scored ${t.score}`));
  const stars = [g.away, g.home].map(t => t.leader).filter(l => l && l.pts >= 40);
  stars.forEach(l => notes.push(`${l.name} ${l.pts} pts`));
  if (!notes.length) return null;
  const what = stars.length ? `${stars[0].pts}-point night` : /OT/.test(g.detail || "") ? "Overtime final" : win.score - lose.score >= 20 ? "Blowout" : "Big final";
  return { id: `${site.sport}:${g.id}:final`, sport: site.sport, href: site.schedule, t: Date.now(),
           teams: [g.away.abbr, g.home.abbr], what, team: win.short || win.abbr, logo: win.logo, color: win.color,
           text: notes.join(" \u00b7 "), score: `${win.abbr} ${win.score}, ${lose.abbr} ${lose.score}`, clock: "Final" };
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
  const finals = [];
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
      // Basketball scores too often for a play per basket: the red bar only
      // gets its big finals (see edgeStandout).
      if (EDGE_FINALS_ONLY.includes(site.sport)) {
        const standout = edgeStandout(site, g);
        if (standout) finals.push(standout);
        return;
      }
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
                     logo: team.logo, color: team.color, text: EDGE_SCORING_TEXT.test(g.lastPlay || "") ? g.lastPlay : "",
                     score: `${team.abbr} ${now}, ${other.abbr} ${other.score}`,
                     clock: g.state === "post" ? "Final" : g.detail });
      });
    });
  });
  edgeStore(EDGE_SCORES_KEY, { t: Date.now(), scores });
  // Scoring plays from the last 3 hours, newest first, kept across pages.
  // Lines saved by older versions (every basket, any last play) are dropped.
  const kept = (edgeStore(EDGE_PLAYS_KEY) || [])
    .filter(p => p && p.id && Date.now() - p.t < 3 * 3600000)
    .filter(p => !EDGE_FINALS_ONLY.includes(p.sport) || /:final$/.test(p.id))
    .map(p => Object.assign({}, p, { text: /:final$/.test(p.id) || EDGE_SCORING_TEXT.test(p.text || "") ? p.text : "" }));
  const newFinals = finals.filter(f => !kept.some(p => p.id === f.id));
  const seen = new Set();
  const plays = fresh.reverse().concat(newFinals, kept)
    .filter(p => !seen.has(edgePlayGame(p)) && seen.add(edgePlayGame(p)))
    .slice(0, EDGE_PLAYS_MAX);
  edgeStore(EDGE_PLAYS_KEY, plays);
  edgeTicker.plays = plays;
  edgeRenderTicker();
  const settings = edgeSettings();
  const shown = fresh.filter(p => settings[p.sport]);
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

// --- Sport menu on phones (shared by every Edge site) ---
// Adds a menu button (the current sport and three lines) to the top bar; on
// phones the CSS hides the sport tabs behind it and drops them down as a list
// when it's tapped.
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

// --- Motion and record helpers (home page and sport pages) ---
// Sliding tab highlight, rolling score digits, records that count up, and
// the per-day results (summary.json "daily": [[date, wins, losses], ...])
// behind trend lines, the record chart and the Model tab's results
// calendar. Streak badges read "ml_streak": moneyline picks won or lost in
// a row. Every animation is skipped for prefers-reduced-motion.
const EDGE_REDUCE = matchMedia("(prefers-reduced-motion: reduce)");

// Puts a highlight behind (kind "pill") or under (kind "line") a button
// group's pressed button and slides it to the next one. Safe to call after
// the group's buttons are re-rendered: it starts from where it last was.
function edgeSlide(group, kind) {
  if (!group) return;
  group.classList.add("has-slide", kind === "line" ? "slide-line" : "slide-pill");
  let mark = group.querySelector(":scope > .slide-mark");
  if (!mark) {
    mark = edgeNode("span", "slide-mark");
    mark.setAttribute("aria-hidden", "true");
    if (group._slideAt) { mark.style.left = group._slideAt[0] + "px"; mark.style.width = group._slideAt[1] + "px"; }
    group.prepend(mark);
  }
  const place = () => {
    const b = group.querySelector('button[aria-pressed="true"]');
    if (!b || !b.offsetWidth) { mark.hidden = true; return; }
    mark.hidden = false;
    group._slideAt = [b.offsetLeft, b.offsetWidth];
    mark.style.left = b.offsetLeft + "px";
    mark.style.width = b.offsetWidth + "px";
  };
  void mark.offsetWidth;  // start the slide from the previous spot
  place();
  if (!group._slideBound) {
    group._slideBound = true;
    group.addEventListener("click", () => requestAnimationFrame(() => edgeSlide(group, kind)));
    window.addEventListener("resize", () => edgeSlide(group, kind));
    if (document.fonts) document.fonts.ready.then(() => edgeSlide(group, kind));
  }
}

// Sets el to a number, rolling each changed digit like a slot reel when it
// already showed a different number.
function edgeRoll(el, value) {
  const str = String(value);
  const was = el.dataset.roll;
  el.dataset.roll = str;
  el.setAttribute("aria-label", str);
  if (was === undefined || was === str || EDGE_REDUCE.matches || !/^\d+$/.test(str)) { el.textContent = str; return; }
  el.textContent = "";
  [...str].forEach((c, k) => {
    const slot = edgeNode("span", "roll");
    slot.setAttribute("aria-hidden", "true");
    const reel = edgeNode("span", "roll-reel");
    for (let d = 0; d <= 9; d++) reel.append(edgeNode("span", null, String(d)));
    const from = was.padStart(str.length, "0")[k];
    reel.style.transform = `translateY(${-Number(/\d/.test(from) ? from : 0)}em)`;
    slot.append(reel);
    el.append(slot);
    void reel.offsetWidth;
    reel.style.transitionDelay = k * 60 + "ms";
    reel.style.transform = `translateY(${-Number(c)}em)`;
  });
  el.classList.remove("roll-flash");
  void el.offsetWidth;
  el.classList.add("roll-flash");
}

// A "W-L" record that counts up from 0-0 the first time it's shown.
function edgeCountUp(el, wins, losses) {
  const end = `${wins}-${losses}`;
  if (EDGE_REDUCE.matches || el.dataset.counted) { el.textContent = end; return; }
  el.dataset.counted = "1";
  const t0 = performance.now(), dur = 1000;
  const step = t => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = p < 1 ? `${Math.round(wins * e)}-${Math.round(losses * e)}` : end;
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = "0-0";
  requestAnimationFrame(step);
}

// Running winning % after each day: [{date, pct, w, l}], oldest first. The
// first days, before EDGE_MIN_PICKS graded picks, are left out: a 1-0 or 0-1
// start (100% or 0%) would swamp the scale.
const EDGE_MIN_PICKS = 20;
function edgeRunning(daily) {
  let w = 0, l = 0;
  return (daily || []).map(([date, dw, dl]) => { w += dw; l += dl; return { date, w, l, pct: w / Math.max(1, w + l) }; })
    .filter(r => r.w + r.l >= EDGE_MIN_PICKS);
}

// A badge for summary.json "ml_streak" ({kind: "W"|"L", n}): moneyline
// picks won or lost in a row, one game at a time. null without one.
function edgeStreakBadge(s) {
  if (!s || !s.n) return null;
  const won = s.kind === "W";
  const b = edgeNode("span", "streak " + (won ? "is-w" : "is-l"), s.kind + s.n);
  b.title = `${won ? "Won" : "Lost"} the last ${s.n === 1 ? "" : s.n + " "}moneyline ${s.n === 1 ? "pick" : "picks"}`;
  b.setAttribute("aria-label", b.title);
  return b;
}

// A small trend line of the running winning % over the last `days` days with
// a graded pick, its high and low on the left and a caption under it.
function edgeSpark(daily, days) {
  const run = edgeRunning(daily).slice(-(days || 30));
  if (run.length < 2) return null;
  const vals = run.map(r => r.pct);
  const lo = Math.max(0, Math.floor(Math.min(...vals) * 100) - 1) / 100, hi = Math.min(100, Math.ceil(Math.max(...vals) * 100) + 1) / 100;
  const x = i => 2 + i * (156 / (run.length - 1)), y = v => 32 - (v - lo) / (hi - lo) * 28;
  const line = run.map((r, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(r.pct).toFixed(1)).join("");
  const wrap = edgeNode("div", "spk");
  const axis = edgeNode("div", "spk-y");
  axis.append(edgeNode("span", null, Math.round(hi * 100) + "%"), edgeNode("span", null, Math.round(lo * 100) + "%"));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 160 34");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path class="spark-area" d="${line}L158 34L2 34Z"/><path class="spark-line" d="${line}" vector-effect="non-scaling-stroke"/>` +
                  `<circle class="spark-dot" cx="${x(run.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.6"/>`;
  wrap.append(axis, svg);
  const box = edgeNode("div", "spk-box");
  box.append(wrap, edgeNode("span", "spk-cap", `Winning %, last ${run.length} days with picks`));
  return box;
}

// --- Slate picker (home page and each sport's game board) ---
// One game at a time: a big number, the matchup, our pick, win chance and
// price, a line of text written from the numbers, and a drawing of the
// sport's field with both teams on it. Up to EDGE_SP_NUMBERED games are
// numbered squares; past that, a list grouped by start time. Games use the
// home page's shape: {key, sport, start, date, at, away/home: {abbr, name,
// logo, score}, pick, pickName, prob, price, book, value, state ("pre", "in"
// or "post"), hit, detail, url, why: [label, team it helps] or null}.
const EDGE_SP_NUMBERED = 12;

function edgeSpTime(g) {
  if (!g.start) return "";
  const tz = edgeTz();
  return new Date(g.start).toLocaleTimeString("en-US", { timeZone: tz.timeZone, hour: "numeric", minute: "2-digit" }) + " " + tz.label;
}

function edgeSpDay(g) {
  if (!g.start) return "";
  return new Date(g.start).toLocaleDateString("en-US", { timeZone: edgeTz().timeZone, weekday: "short" });
}

// What the text under the numbers says, from the numbers alone.
function edgePickNote(g) {
  const name = abbr => abbr === g.away.abbr ? g.away.name : abbr === g.home.abbr ? g.home.name : abbr;
  const scored = g.away.score != null && g.home.score != null;
  const line = scored ? `${g.away.abbr} ${g.away.score}, ${g.home.abbr} ${g.home.score}` : "";
  if (!g.pick) return g.state === "pre" ? "No pick yet. Our pick posts once the model has this game's lineups and prices." : "We didn't post a pick for this game.";
  const pk = g.pick === "Draw" ? "a draw" : name(g.pick);
  if (g.hit === true) return `Final${line ? ": " + line : ""}. Our pick, ${pk}, hit.`;
  if (g.hit === false) return `Final${line ? ": " + line : ""}. Our pick, ${pk}, missed.`;
  if (g.state === "in" && scored) {
    if (g.pick === "Draw") return `Live: ${line}. We picked a draw.`;
    const ours = g.pick === g.away.abbr ? g.away.score : g.home.score;
    const theirs = g.pick === g.away.abbr ? g.home.score : g.away.score;
    return `Live${g.detail ? ", " + g.detail : ""}: ${line}. Our pick, ${pk}, is ${ours > theirs ? "ahead" : ours < theirs ? "behind" : "tied"}.`;
  }
  if (g.state === "post") return `Final${line ? ": " + line : ""}. Grading this one shortly.`;
  const p = g.prob.toFixed(0), them = g.pick === "Draw" ? "it" : "them";
  let s;
  if (g.book == null) s = `We have ${pk} at ${p}% to win. No price is posted yet, so there's nothing to compare it with.`;
  else {
    const gap = g.prob - g.book, b = g.book.toFixed(0);
    if (g.value) s = `Value pick. We have ${pk} at ${p}%, ${gap.toFixed(0)} points higher than the ${b}% the price implies.`;
    else if (gap >= 2) s = `We like ${pk} a little more than the market does, ${p}% to ${b}%, but not by enough for a Value tag.`;
    else if (gap <= -2) s = `We pick ${pk} too, but the market likes ${them} more, ${b}% to our ${p}%, so the price runs ahead of our numbers.`;
    else s = `Our numbers and the market agree on ${pk}, ${p}% to ${b}%.`;
  }
  if (g.why && g.why[0]) s += ` The biggest factor is ${g.why[0].toLowerCase()}, which helps ${name(g.why[1])}.`;
  return s;
}

// The field, court, rink or pitch, drawn in an 800 x 500 box.
function edgeSpField(sport) {
  if (sport === "NHL") return `
    <rect class="sp-turf" x="120" y="110" width="560" height="290" rx="110"/>
    <line class="sp-red" x1="400" y1="110" x2="400" y2="400" stroke-width="3"/>
    <line class="sp-blue" x1="315" y1="110" x2="315" y2="400" stroke-width="5"/><line class="sp-blue" x1="485" y1="110" x2="485" y2="400" stroke-width="5"/>
    <line class="sp-red" x1="162" y1="122" x2="162" y2="388"/><line class="sp-red" x1="638" y1="122" x2="638" y2="388"/>
    <circle class="sp-line" cx="400" cy="255" r="42"/>
    <circle class="sp-line" cx="232" cy="185" r="30"/><circle class="sp-line" cx="232" cy="325" r="30"/>
    <circle class="sp-line" cx="568" cy="185" r="30"/><circle class="sp-line" cx="568" cy="325" r="30"/>
    <path class="sp-line" d="M162 235 a20 20 0 0 1 0 40"/><path class="sp-line" d="M638 235 a20 20 0 0 0 0 40"/>`;
  if (sport === "MLB") return `<g transform="translate(0 -34)">
    <path class="sp-turf" d="M400 450 L140 190 A370 370 0 0 1 660 190 Z"/>
    <path class="sp-dirt" d="M400 450 L292 342 L400 234 L508 342 Z"/>
    <circle class="sp-line" cx="400" cy="352" r="12"/>
    <path class="sp-line sp-dash" d="M252 302 A210 210 0 0 1 548 302"/>
    <rect class="sp-base" x="394" y="228" width="12" height="12"/><rect class="sp-base" x="502" y="336" width="12" height="12"/>
    <rect class="sp-base" x="286" y="336" width="12" height="12"/><path class="sp-base" d="M392 444 h16 v8 l-8 8 l-8 -8 z"/></g>`;
  if (sport === "Soccer") return `
    <rect class="sp-turf" x="110" y="100" width="580" height="310"/>
    <line class="sp-line" x1="400" y1="100" x2="400" y2="410"/><circle class="sp-line" cx="400" cy="255" r="48"/>
    <rect class="sp-line" x="110" y="172" width="84" height="166"/><rect class="sp-line" x="606" y="172" width="84" height="166"/>
    <rect class="sp-line" x="110" y="218" width="30" height="74"/><rect class="sp-line" x="660" y="218" width="30" height="74"/>
    <path class="sp-line" d="M194 226 a32 32 0 0 1 0 58"/><path class="sp-line" d="M606 226 a32 32 0 0 0 0 58"/>`;
  if (sport === "NBA" || sport === "CBB") return `
    <rect class="sp-wood" x="110" y="110" width="580" height="290"/>
    <line class="sp-line" x1="400" y1="110" x2="400" y2="400"/><circle class="sp-line" cx="400" cy="255" r="40"/>
    <rect class="sp-paint" x="110" y="205" width="120" height="100"/><rect class="sp-paint" x="570" y="205" width="120" height="100"/>
    <circle class="sp-line" cx="230" cy="255" r="40"/><circle class="sp-line" cx="570" cy="255" r="40"/>
    <path class="sp-line" d="M110 130 H223 A150 150 0 0 1 223 380 H110"/><path class="sp-line" d="M690 130 H577 A150 150 0 0 0 577 380 H690"/>
    <circle class="sp-red" cx="140" cy="255" r="7"/><circle class="sp-red" cx="660" cy="255" r="7"/>`;
  // NFL and CFB
  let yards = "";
  for (let i = 0; i <= 10; i++) {
    const x = 170 + i * 46;
    yards += `<line class="sp-line" x1="${x}" y1="120" x2="${x}" y2="390" stroke-width="${i === 5 ? 2.5 : 1.2}"/>`;
    if (i > 0 && i < 10) yards += `<text class="sp-yd" x="${x}" y="146" text-anchor="middle">${(i <= 5 ? i : 10 - i) * 10}</text>`;
  }
  return `<rect class="sp-turf" x="110" y="120" width="580" height="270"/>
    <rect class="sp-end" x="110" y="120" width="60" height="270"/><rect class="sp-end" x="630" y="120" width="60" height="270"/>${yards}`;
}

function edgeSpMarker(g, t, x, side) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const isPick = g.pick === t.abbr;
  const id = "spc" + Math.random().toString(36).slice(2, 8);
  // The abbreviation sits under the logo, so it shows if the logo can't load.
  const short = t.abbr.length > 4 ? t.abbr.slice(0, 4).toUpperCase() : t.abbr;
  const art = `<text class="sp-abbr" x="${x}" y="261" text-anchor="middle">${esc(short)}</text>` + (t.logo
    ? `<clipPath id="${id}"><circle cx="${x}" cy="255" r="25"/></clipPath><image href="${esc(t.logo)}" x="${x - 25}" y="230" width="50" height="50" clip-path="url(#${id})" preserveAspectRatio="xMidYMid meet" onerror="this.remove()"/>`
    : "");
  const score = t.score != null ? `<text class="sp-score" x="${x}" y="345" text-anchor="middle">${esc(t.score)}</text>` : "";
  const flag = isPick ? `<path class="sp-pole" d="M${x + 24} 196 v26"/><path class="sp-flag" d="M${x + 24} 196 l16 6 l-16 6 z"/>` : "";
  return `<g class="sp-team${isPick ? " is-pick" : ""}"><circle class="sp-disc" cx="${x}" cy="255" r="32"/>${art}${flag}
    <text class="sp-side" x="${x}" y="${t.score != null ? 307 : 312}" text-anchor="middle">${side}${isPick ? " · PICK" : ""}</text>${score}</g>`;
}

function edgeSpDrawing(g) {
  const away = g.at === "vs" ? "" : "AWAY", home = g.at === "vs" ? "" : "HOME";
  let bar = "";
  if (g.pick && g.prob != null) {
    const w = 560 * g.prob / 100;
    bar = `<text class="sp-cap" x="120" y="452">OUR CHANCE</text><text class="sp-cap" x="680" y="452" text-anchor="end">${g.prob.toFixed(1)}%</text>
      <rect class="sp-track" x="120" y="460" width="560" height="5"/><rect class="sp-fill" x="120" y="460" width="${w.toFixed(1)}" height="5"/>`;
    if (g.book != null) {
      const bx = 120 + 560 * g.book / 100;
      bar += `<line class="sp-book" x1="${bx.toFixed(1)}" y1="454" x2="${bx.toFixed(1)}" y2="471"/>` +
             `<text class="sp-cap sp-book-t" x="${Math.min(640, Math.max(160, bx)).toFixed(1)}" y="488" text-anchor="middle">VEGAS ${g.book.toFixed(1)}%</text>`;
    }
  }
  return edgeSpField(g.sport) + edgeSpMarker(g, g.away, 262, away) + edgeSpMarker(g, g.home, 538, home) + bar;
}

// opts: {multiSport, filters, onSelect(key)}. Returns {el, set(games, key)}.
function edgeSlatePicker(opts) {
  opts = opts || {};
  const st = { games: [], list: [], cur: 0, filter: "all", key: null };
  const el = edgeNode("div", "sp");
  el.innerHTML = `
    <div class="sp-left">
      <div class="sp-head"><span class="sp-num">01</span><div class="sp-hd"><small class="sp-of"></small><h3 class="sp-title"></h3></div></div>
      <dl class="sp-facts"><div><dt>Our pick</dt><dd class="sp-pick"></dd></div><div><dt>Win chance</dt><dd class="sp-prob"></dd></div><div><dt>Price</dt><dd class="sp-price"></dd></div></dl>
      <p class="sp-note" aria-live="polite"></p>
      <div class="sp-choose">
        <div class="sp-choose-top"><span>Choose a game</span><span class="sp-arrows">
          <button type="button" class="sp-prev" aria-label="Previous game">&larr;</button><button type="button" class="sp-next" aria-label="Next game">&rarr;</button></span></div>
        <div class="sp-filters" role="group" aria-label="Filter games" hidden></div>
        <div class="sp-chips"></div>
        <div class="sp-list" hidden></div>
      </div>
    </div>
    <div class="sp-frame">
      <div class="sp-bar"><span class="sp-tag"></span><span class="sp-pill"></span><a class="sp-open" href="#">Game page &rarr;</a></div>
      <svg class="sp-svg" viewBox="0 0 800 500" role="img"><title></title><g></g></svg>
    </div>`;
  const $ = s => el.querySelector(s);
  const chips = $(".sp-chips"), list = $(".sp-list"), filters = $(".sp-filters");

  function stateTag(g) {
    if (g.hit === true) return "HIT";
    if (g.hit === false) return "MISS";
    if (g.state === "in") return "LIVE";
    if (g.state === "post") return "FINAL";
    return null;
  }
  function renderChooser() {
    st.list = st.games.filter(g => st.filter === "all" || (st.filter === "value" && g.value));
    const many = st.games.length > EDGE_SP_NUMBERED;
    chips.hidden = many;
    list.hidden = !many;
    filters.hidden = !many || !opts.filters;
    if (!filters.hidden) {
      const nv = st.games.filter(g => g.value).length;
      filters.innerHTML = `<button type="button" data-f="all" aria-pressed="${st.filter === "all"}">All<span>${st.games.length}</span></button>` +
        `<button type="button" data-f="value" aria-pressed="${st.filter === "value"}">Value<span>${nv}</span></button>`;
    }
    if (!many) {
      chips.replaceChildren(...st.list.map((g, i) => {
        const b = edgeNode("button", null, String(i + 1).padStart(2, "0"));
        b.type = "button";
        b.dataset.i = i;
        const tag = stateTag(g);
        const sm = edgeNode("small", tag ? "is-" + tag.toLowerCase() : null, tag || (opts.multiSport ? g.sport : edgeSpTime(g).replace(/ \S+$/, "")));
        b.append(sm);
        b.setAttribute("aria-label", `${g.away.abbr} at ${g.home.abbr}${tag ? ", " + tag.toLowerCase() : ""}`);
        return b;
      }));
      return;
    }
    const keep = list.scrollTop;
    const nodes = [];
    let last = null;
    st.list.forEach((g, i) => {
      const head = g.state === "in" ? "Live now" : (opts.withDay ? edgeSpDay(g) + " " : "") + edgeSpTime(g);
      if (head !== last) {
        const n = st.list.filter(x => (x.state === "in" ? "Live now" : (opts.withDay ? edgeSpDay(x) + " " : "") + edgeSpTime(x)) === head).length;
        const h = edgeNode("h4", null);
        h.append(edgeNode("span", null, head), edgeNode("span", null, `${n} ${n === 1 ? "game" : "games"}`));
        nodes.push(h);
        last = head;
      }
      const b = edgeNode("button", null);
      b.type = "button";
      b.dataset.i = i;
      const tag = stateTag(g);
      b.append(edgeNode("span", "sp-lg", opts.multiSport ? g.sport : (tag || "")),
               edgeNode("span", "sp-mt", `${g.away.abbr} ${g.at === "vs" ? "vs" : "@"} ${g.home.abbr}`));
      const pk = edgeNode("span", "sp-pk", g.pick ? `${g.pick} ${Math.round(g.prob)}%` : "No pick yet");
      if (g.value && g.state === "pre") pk.append(edgeNode("i", "sp-vdot"));
      if (opts.multiSport && tag) pk.prepend(edgeNode("b", "is-" + tag.toLowerCase(), tag + " "));
      b.append(pk);
      nodes.push(b);
    });
    if (!nodes.length) nodes.push(edgeNode("div", "sp-empty", "No games match this filter."));
    list.replaceChildren(...nodes);
    list.scrollTop = keep;
  }
  function show(i, animate) {
    const L = st.list;
    if (!L.length) return;
    st.cur = (i + L.length) % L.length;
    const g = L[st.cur];
    st.key = g.key;
    const n = String(st.cur + 1).padStart(2, "0");
    $(".sp-num").textContent = n;
    const tag = stateTag(g);
    $(".sp-of").textContent = [`Game ${st.cur + 1} of ${L.length}`, g.sport, g.value && g.state === "pre" ? "Value" : tag ? tag[0] + tag.slice(1).toLowerCase() : ""].filter(Boolean).join(" · ");
    const title = `${g.away.abbr} ${g.at === "vs" ? "vs" : "@"} ${g.home.abbr}`;
    $(".sp-title").textContent = title;
    $(".sp-title").classList.toggle("is-long", title.length > 13);
    $(".sp-pick").textContent = !g.pick ? "None yet" : g.pick === "Draw" ? "Draw" : g.pick;
    $(".sp-prob").textContent = g.pick && g.prob != null ? Math.round(g.prob) + "%" : "–";
    $(".sp-price").textContent = g.price != null ? (typeof edgePrice === "function" ? edgePrice(g.price) : (g.price > 0 ? "+" : "") + g.price) : "–";
    $(".sp-note").textContent = edgePickNote(g);
    $(".sp-tag").textContent = `${g.sport} · ${g.away.name} ${g.at === "vs" ? "vs" : "at"} ${g.home.name}`;
    const open = $(".sp-open");
    open.hidden = !g.url;
    if (g.url) open.href = g.url;
    const pill = $(".sp-pill");
    pill.className = "sp-pill" + (g.state === "in" ? " is-live" : g.hit === true ? " is-hit" : g.hit === false ? " is-miss" : "");
    pill.textContent = g.state === "in" ? (g.detail || "Live") : g.hit != null ? (g.hit ? "Final · Hit" : "Final · Miss")
      : g.state === "post" ? "Final" : `Game ${n} · ${opts.withDay ? edgeSpDay(g) + " " : ""}${edgeSpTime(g)}`;
    const box = list.hidden ? chips : list;
    box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === st.cur)));
    const on = box.querySelector('button[aria-pressed="true"]');
    if (on && !list.hidden && animate) {
      const top = on.offsetTop, h = on.offsetHeight;
      if (top < list.scrollTop + 36 || top + h > list.scrollTop + list.clientHeight) list.scrollTop = top - 44;
    }
    const svg = $(".sp-svg");
    const draw = () => {
      svg.querySelector("title").textContent = `${g.sport}: ${g.away.name} ${g.at === "vs" ? "vs" : "at"} ${g.home.name}${g.pick ? ", our pick " + g.pick : ""}`;
      svg.querySelector("g").innerHTML = edgeSpDrawing(g);
    };
    if (animate && !EDGE_REDUCE.matches) {
      svg.classList.add("is-swap");
      clearTimeout(st.swap);
      st.swap = setTimeout(() => { draw(); svg.classList.remove("is-swap"); }, 180);
    } else draw();
    if (opts.onSelect) opts.onSelect(g.key);
  }
  const pickFrom = e => { const b = e.target.closest("button[data-i]"); if (b) show(+b.dataset.i, true); };
  chips.addEventListener("click", pickFrom);
  list.addEventListener("click", pickFrom);
  filters.addEventListener("click", e => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    st.filter = b.dataset.f;
    renderChooser();
    list.scrollTop = 0;
    show(0, true);
  });
  $(".sp-prev").addEventListener("click", () => show(st.cur - 1, true));
  $(".sp-next").addEventListener("click", () => show(st.cur + 1, true));
  el.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); show(st.cur + 1, true); el.querySelector('.sp-chips:not([hidden]) button[aria-pressed="true"], .sp-list:not([hidden]) button[aria-pressed="true"]')?.focus(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); show(st.cur - 1, true); el.querySelector('.sp-chips:not([hidden]) button[aria-pressed="true"], .sp-list:not([hidden]) button[aria-pressed="true"]')?.focus(); }
  });

  // New games (a refresh, a filter outside the picker): keeps the game that
  // was showing when it's still there, else starts with the next to play.
  function set(games, key) {
    const want = key || st.key;
    st.games = games;
    if (st.filter === "value" && !games.some(g => g.value)) st.filter = "all";
    renderChooser();
    el.hidden = !st.list.length;
    if (!st.list.length) return;
    let i = st.list.findIndex(g => g.key === want);
    if (i < 0) i = st.list.findIndex(g => g.state === "in");
    if (i < 0) i = st.list.findIndex(g => g.state === "pre");
    show(Math.max(0, i), false);
  }
  return { el, set, state: st };
}
