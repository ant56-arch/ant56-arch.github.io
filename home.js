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
  // CBB isn't on the Schedule tab or in the ticker yet; its games.json feeds
  // the live scores on its own game cards.
  { sport: "CBB", summary: "/cbb/summary.json", games: "/cbb/games.json",
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

// Text made safe to put inside HTML.
function edgeEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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
  { group: "Owner" },
  // Password-locked page built by model_room/ (the Model Room workflow).
  { link: "/model-room/", label: "Model Room" },
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
  // Sport pages keep it in the top bar; the home page in its own nav.
  const bar = document.querySelector(".topbar-inner") || document.querySelector("nav.nav");
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
    if (s.link) {
      // Pages on this site open in the same tab; other sites open in a new one.
      const local = s.link.startsWith("/");
      const a = edgeNode("a", "ticker-teams-btn", local ? s.label : s.label + " \u2197");
      a.href = s.link;
      if (!local) {
        a.target = "_blank";
        a.rel = "noopener";
      }
      panel.append(a);
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
  const isPick = g.pick === t.abbr;
  const id = "spc" + Math.random().toString(36).slice(2, 8);
  // The abbreviation sits under the logo, so it shows if the logo can't load.
  const short = t.abbr.length > 4 ? t.abbr.slice(0, 4).toUpperCase() : t.abbr;
  const art = `<text class="sp-abbr" x="${x}" y="261" text-anchor="middle">${edgeEsc(short)}</text>` + (t.logo
    ? `<clipPath id="${id}"><circle cx="${x}" cy="255" r="25"/></clipPath><image href="${edgeEsc(t.logo)}" x="${x - 25}" y="230" width="50" height="50" clip-path="url(#${id})" preserveAspectRatio="xMidYMid meet" onerror="this.remove()"/>`
    : "");
  const score = t.score != null ? `<text class="sp-score" x="${x}" y="345" text-anchor="middle">${edgeEsc(t.score)}</text>` : "";
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

// Home site only: the Home, Betting and Schedule pages. Published as home.js,
// after shared/edge.js (see shared/assets.py).

// Every site's summary.json, fetched once per page.
function edgeFetchSummaries() {
  if (!window.edgeSummaries) {
    window.edgeSummaries = Promise.all(EDGE_SITES.map(site => edgeFetchJson(site.summary)));
  }
  return window.edgeSummaries;
}

// Home page: every game in every league for the day, live games first, then
// games still to play, then finals, each grouped by sport. Picks come from
// each site's summary.json "slate"; the games, scores, logos, records and TV
// come from ESPN in the browser (the games.json "espn" address, without the CFB
// Top 25 filter), refreshed every minute while a game is live. A pick is
// matched to its ESPN game by start time and one shared team abbreviation; a
// game with no pick yet (MLB and NHL picks post the morning of) still shows,
// marked "No pick yet". Below it, each site's all-time record from summary.json.
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
// day the home page shows (today, tomorrow, the weekend) or a slate covers that
// it doesn't cover is fetched by date (dates=YYYYMMDD, an ET day).
async function hgLoadEspn(site, summary, want) {
  if (!site.games) return [];
  const published = await edgeFetchJson(site.games);
  if (!published) return [];
  if (!published.espn) return published.games || [];
  const parse = data => data && Array.isArray(data.events) ? data.events.map(edgeParseEspn).filter(Boolean) : null;
  const live = parse(await edgeFetchJson(published.espn, 6000));
  const events = live || [];
  const ids = new Set(events.map(e => e.id));
  const covered = new Set(events.map(e => new Date(e.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" })));
  const days = [...new Set([...want, ...(summary && summary.slate || []).filter(g => !g.final).map(g => g.date).filter(Boolean)])]
    .filter(d => !covered.has(d)).slice(0, 6);
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
  const want = [...new Set(hgDays().flatMap(d => d.dates))];
  const espn = await Promise.all(EDGE_SITES.map((site, i) => hgLoadEspn(site, summaries[i], want)));
  hg.summaries = summaries;
  const games = [];
  EDGE_SITES.forEach((site, i) => {
    const s = summaries[i];
    const used = new Set();
    (s && s.slate || []).forEach(g => {
      if (!g.start) return;
      const e = hgMatch(g, espn[i]);
      if (e) used.add(e.id);
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
      // Soccer picks can be a draw ("Draw"); a team pick misses on a draw or tie.
      if (state === "post" && away.score != null && home.score != null) {
        if (g.pick === "Draw") hit = away.score === home.score;
        else if (away.score !== home.score) hit = (g.pick === g.away) === (away.score > home.score);
        else hit = false;
      }
      games.push({ ...g, key: site.sport + ":" + g.id, date: edgeDayKey(new Date(g.start)), away, home, state,
                   detail: e ? e.detail : "", tv: e ? e.tv : "", series: e ? e.series : "", hit });
    });
    // Every other game that day, without a pick (yet).
    espn[i].forEach(e => {
      if (used.has(e.id) || !e.start) return;
      const date = edgeDayKey(new Date(e.start));
      if (!want.includes(date) && e.state !== "in") return;
      const side = t => ({ abbr: t.abbr, espn: t.abbr, name: t.short || t.name || t.abbr, logo: t.logo || "",
                           rank: t.rank, record: t.record, score: e.state !== "pre" ? t.score : null });
      games.push({ id: e.id, key: site.sport + ":espn-" + e.id, sport: site.sport, start: e.start, date,
                   at: e.neutral ? "vs" : "@", url: site.schedule, pick: null, prob: null,
                   away: side(e.away), home: side(e.home), state: e.state || "pre",
                   detail: e.detail || "", tv: e.tv || "", series: e.series || "", hit: null });
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
  if (!g.pick) return null;
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
  if (!g.pick) {
    pick.append(hgEl("span", "hg-lbl", g.state === "pre" ? "No pick yet" : "No pick"));
  } else {
    pick.append(hgEl("span", "hg-lbl", "Pick to win"),
                hgEl("b", null, g.pick === "Draw" ? "Draw" : (g.pick === g.away.abbr ? g.away : g.home).name));
    const res = hgPickState(g);
    if (res) pick.append(res);
    const pct = hgEl("span", "hg-pct", String(Math.round(g.prob)));
    pct.append(hgEl("i", null, "%"));
    pick.append(pct);
  }
  card.append(head);
  if (g.series) card.append(hgEl("div", "hg-series", g.series));
  card.append(hgTeamRow(g, g.away), hgTeamRow(g, g.home));
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
  const sub = hgEl("small", null, !g.pick ? `${g.sport} · ${g.state === "pre" ? "No pick yet" : "No pick"}`
    : `${g.sport} · Pick ${g.pick}${g.price != null ? " " + edgePrice(g.price) : ""}`);
  const res = hgPickState(g);
  if (res) sub.append(" ", res);
  mu.append(sub);
  const pct = hgEl("span", "hg-pct", g.prob == null ? "–" : String(Math.round(g.prob)));
  if (g.prob != null) pct.append(hgEl("i", null, "%"));
  row.append(when, mu, pct, hgStar(g));
  return row;
}

function hgRender() {
  const out = document.getElementById("hg-out");
  if (!out) return;
  const days = hgDays();
  // A game still going past midnight stays on Today.
  const onDay = (d, g) => d.dates.includes(g.date) || (d.k === "today" && g.state === "in");
  const counts = days.map(d => hg.games.filter(g => onDay(d, g)).length);
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

  const inDay = hg.games.filter(g => onDay(day, g));
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
  const top = new Set(inDay.filter(g => g.pick).sort((a, b) => b.prob - a.prob).slice(0, 3).map(g => g.key));
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
  // Slate: one game at a time beside its field, every game in the day's
  // list (live, to play and final) in start order.
  if (hg.layout === "slate" && list.length) {
    if (!hg.picker || hg.picker.withDay !== withDay) {
      hg.picker = edgeSlatePicker({ multiSport: true, withDay, onSelect: k => { hg.slateKey = k; } });
      hg.picker.withDay = withDay;
    }
    hg.picker.set(list.map(g => ({ ...g, why: null })), hg.slateKey);
    out.replaceChildren(hg.picker.el);
    out.removeAttribute("aria-busy");
    hgTop3(inDay, withDay);
    hgCountdown();
    edgeSlide(dayBtns, "pill");
    edgeSlide(document.getElementById("hg-sports"), "line");
    edgeSlide(document.getElementById("hg-layout"), "pill");
    return;
  }
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
    const msg = !inDay.length ? `No games ${day.k === "today" ? "today" : day.k === "tomorrow" ? "tomorrow" : "this weekend"}.`
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
  const top = inDay.filter(g => g.pick).sort((a, b) => b.prob - a.prob).slice(0, 3);
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
  const next = today.filter(g => g.pick && g.state === "pre" && new Date(g.start) > Date.now())
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  el.classList.toggle("is-live", live > 0);
  if (live) {
    el.replaceChildren(hgEl("b", null, "Live now"), ` · ${live} ${live === 1 ? "game" : "games"}`);
  } else if (next) {
    const left = new Date(next.start) - Date.now();
    const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), sec = Math.floor(left % 60000 / 1000);
    const started = today.some(g => g.pick && g.state !== "pre");
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
      // Moneyline picks won or lost in a row (summary.json "ml_streak").
      const streak = edgeStreakBadge(data.ml_streak);
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
  const saved = hgStore(HG_LAYOUT_KEY);
  hg.layout = ["slate", "cards", "list"].includes(saved) ? saved : "slate";
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
    const n = (summaries[EDGE_SITES.indexOf(g.site)].slate || []).filter(x => x.start && !x.final && edgeDayKey(new Date(x.start)) === key).length;
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
