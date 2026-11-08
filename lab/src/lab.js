// Sports Edge test build ("lab"). Loaded after a page's own scripts on the
// copies under /lab/ only; the live pages never load it.
//
// 1. Moving field: the banner becomes a fuller playing surface seen from the
//    stands, with two teams running one play on a loop (a jumper and a swish,
//    a deep pass, a fly ball to left-center, a one-timer, a cross and a header).
//    The home page's All view rotates through the sports.
// 2. Pick card and record tab: tonight's surest pick floats on the banner and
//    the record sits in a tab cut into the bottom corner.
// 3. Serif headline: the banner headline set in big serif caps.
// Each one switches on and off from the small Test panel, remembered per browser.
(() => {
  "use strict";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const OPTS = [
    ["touches", "Pick card + record tab"],
    ["serif", "Serif headline"],
  ];
  const on = {};
  OPTS.forEach(([k]) => { on[k] = store.get("lab-" + k) !== "0"; });
  on.field = false;                                                   // the moving field is scrapped (Anthony, Nov 5)
  // 3D players: shelved (glitchy, no basketball motions); only with ?lab3d=1
  on.three = false;
  let three = null;
  function loadThree() {
    if (three || !on.three) return;
    three = { ready: false };
    import(`${location.origin}/lab/lab3d.js`).then(m => m.create("/lab/")).then(r => { three = { ready: true, r }; }).catch(e => { console.warn("3D players unavailable", e); three = null; on.three = false; });
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- small helpers ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = v => v * v * (3 - 2 * v);
  const lerp = (a, b, u) => a + (b - a) * u;
  // keyframed path: keys [[t, X, Z], ...], held outside them. Between keys a
  // smooth curve that keeps its speed through each key (players carry their
  // momentum through a cut instead of stopping dead), easing in from a standing
  // start and out to a stop.
  function path(keys, t) {
    const n = keys.length;
    if (t <= keys[0][0]) return { X: keys[0][1], Z: keys[0][2] };
    if (t >= keys[n - 1][0]) return { X: keys[n - 1][1], Z: keys[n - 1][2] };
    let i = 1;
    while (keys[i][0] < t) i++;
    const tan = j => {
      if (j === 0 || j === n - 1) return [0, 0];
      const a = keys[j - 1], b = keys[j], c = keys[j + 1];
      if ((a[1] === b[1] && a[2] === b[2]) || (c[1] === b[1] && c[2] === b[2])) return [0, 0];   // a hold: stop there
      const dt = c[0] - a[0] || 1;
      return [(c[1] - a[1]) / dt, (c[2] - a[2]) / dt];
    };
    const [t0, x0, z0] = keys[i - 1], [t1, x1, z1] = keys[i], dt = t1 - t0 || 1, u = (t - t0) / dt;
    const m0 = tan(i - 1), m1 = tan(i), u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return { X: h00 * x0 + h10 * dt * m0[0] + h01 * x1 + h11 * dt * m1[0], Z: h00 * z0 + h10 * dt * m0[1] + h01 * z1 + h11 * dt * m1[1] };
  }
  // how far a player has run along his path by time t (so his feet keep pace with the ground)
  function travel(keys, t) {
    let d = 0, prev = path(keys, keys[0][0]);
    const t0 = keys[0][0], t1 = Math.min(t, keys[keys.length - 1][0]);
    if (t1 <= t0) return 0;
    for (let k = 1; k <= 18; k++) { const q = path(keys, lerp(t0, t1, k / 18)); d += Math.hypot(q.X - prev.X, q.Z - prev.Z); prev = q; }
    return d;
  }
  // a ball in flight between two points, with a parabola on top
  function arc(a, b, peak, u) {
    return { X: lerp(a.X, b.X, u), Y: lerp(a.Y, b.Y, u) + 4 * peak * u * (1 - u), Z: lerp(a.Z, b.Z, u), fly: true };
  }
  const span = (t, a, b) => clamp((t - a) / (b - a));
  // a defender between his man and the goal, a step behind in time
  function mark(keys, t, goal, gap, lag = 0.28) {
    const o = path(keys, t - lag), dx = goal.X - o.X, dz = goal.Z - o.Z, d = Math.hypot(dx, dz) || 1;
    return { X: o.X + dx / d * gap, Z: o.Z + dz / d * gap };
  }

  const ORANGE = [229, 121, 59], CREAM = [238, 231, 216], GOLD = [222, 182, 72];
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // Everyone on the field wears an all-time great's jersey: [name, number,
  // jersey color, number color, stripe color]. Team colors only, no logos.
  // Each play draws a fresh lineup from these, so every loop is different.
  const HOOPS = [
    ["Magic", 32, "#FDB927", "#552583"], ["Jordan", 23, "#CE1141", "#FFFFFF"], ["Curry", 30, "#1D428A", "#FFC72C"],
    ["Duncan", 21, "#1B1B1B", "#C4CED4"], ["LeBron", 23, "#860038", "#FDBB30"], ["Bird", 33, "#007A33", "#FFFFFF"],
    ["Kobe", 24, "#552583", "#FDB927"], ["Dirk", 41, "#00538C", "#FFFFFF"], ["Hakeem", 34, "#F4F4F4", "#CE1141"],
    ["Shaq", 32, "#0077C0", "#1B1B1B"], ["Kareem", 33, "#00471B", "#EEE1C6"], ["Wilt", 13, "#006BB6", "#FFFFFF"],
    ["Russell", 6, "#F4F4F4", "#007A33"], ["Iverson", 3, "#ED174C", "#FFFFFF"], ["Giannis", 34, "#00471B", "#EEE1C6"],
    ["Jokic", 15, "#0E2240", "#FEC524"], ["Durant", 35, "#007AC1", "#EF3B24"], ["Isiah", 11, "#1D42BA", "#FFFFFF"],
  ];
  const QB = [["Brady", 12, "#002244", "#FFFFFF"], ["Montana", 16, "#AA0000", "#FFFFFF"], ["Manning", 18, "#002C5F", "#FFFFFF"],
    ["Mahomes", 15, "#E31837", "#FFFFFF"], ["Elway", 7, "#FB4F14", "#002244"], ["Marino", 13, "#008E97", "#FFFFFF"]];
  const RB = [["Payton", 34, "#0B162A", "#C83803"], ["Sanders", 20, "#0076B6", "#FFFFFF"], ["Jim Brown", 32, "#311D00", "#FFFFFF"],
    ["Emmitt", 22, "#F4F4F4", "#041E42"], ["Peterson", 28, "#4F2683", "#FFC62F"]];
  const WR = [["Rice", 80, "#AA0000", "#B3995D"], ["Moss", 84, "#4F2683", "#FFC62F"], ["Owens", 81, "#004C54", "#FFFFFF"],
    ["Fitzgerald", 11, "#97233F", "#FFFFFF"], ["Megatron", 81, "#0076B6", "#B0B7BC"], ["Hill", 10, "#008E97", "#FFFFFF"]];
  const TE = [["Gronk", 87, "#F4F4F4", "#002244"], ["Gonzalez", 88, "#E31837", "#FFFFFF"], ["Kelce", 87, "#E31837", "#FFB81C"],
    ["Gates", 85, "#0080C6", "#FFC20E"]];
  const OL = [["Munoz", 78, "#FB4F14", "#111111"], ["Ogden", 75, "#241773", "#FFFFFF"], ["Webster", 52, "#101820", "#FFB612"],
    ["Hannah", 73, "#C8102E", "#FFFFFF"], ["Pace", 76, "#003594", "#FFD100"], ["Upshaw", 63, "#111111", "#A5ACAF"],
    ["Allen", 71, "#041E42", "#FFFFFF"]];
  const DL = [["White", 92, "#203731", "#FFB612"], ["Donald", 99, "#003594", "#FFD100"], ["Greene", 75, "#101820", "#FFB612"],
    ["Strahan", 92, "#0B2265", "#FFFFFF"], ["Watt", 99, "#03202F", "#A71930"], ["Sapp", 99, "#D50A0A", "#FFFFFF"]];
  const LB = [["Taylor", 56, "#F4F4F4", "#0B2265"], ["Butkus", 51, "#0B162A", "#FFFFFF"], ["Lewis", 52, "#241773", "#FFFFFF"],
    ["Lambert", 58, "#101820", "#FFB612"], ["Urlacher", 54, "#0B162A", "#FFFFFF"]];
  const CB = [["Deion", 21, "#A71930", "#111111"], ["Revis", 24, "#125740", "#FFFFFF"], ["Bailey", 24, "#FB4F14", "#002244"],
    ["Woodson", 26, "#101820", "#FFB612"]];
  const SAF = [["Polamalu", 43, "#F4F4F4", "#101820"], ["Reed", 20, "#241773", "#FFFFFF"], ["Lott", 42, "#AA0000", "#FFFFFF"],
    ["Dawkins", 20, "#004C54", "#FFFFFF"]];
  // baseball: the fielding team in home whites, the batter in road grays
  const PITCHERS = [["Koufax", 32, "#F4F4F4", "#005A9C"], ["Ryan", 34, "#F4F4F4", "#003278"], ["Gibson", 45, "#F4F4F4", "#C41E3A"],
    ["Pedro", 45, "#F4F4F4", "#BD3039"], ["Maddux", 31, "#F4F4F4", "#13274F"]];
  const CATCHERS = [["Piazza", 31, "#F4F4F4", "#002D72"], ["Bench", 5, "#F4F4F4", "#C6011F"], ["Berra", 8, "#F4F4F4", "#0C2340", "#0C2340"],
    ["Pudge", 7, "#F4F4F4", "#003278"]];
  const INFIELD = [["Pujols", 5, "#F4F4F4", "#C41E3A"], ["Robinson", 42, "#F4F4F4", "#005A9C"], ["Jeter", 2, "#F4F4F4", "#0C2340", "#0C2340"],
    ["Schmidt", 20, "#F4F4F4", "#E81828"], ["Gehrig", 4, "#F4F4F4", "#0C2340", "#0C2340"], ["Ripken", 8, "#F4F4F4", "#DF4601"],
    ["Ozzie", 1, "#F4F4F4", "#C41E3A"], ["Brett", 5, "#F4F4F4", "#004687"]];
  const OUTFIELD = [["Williams", 9, "#F4F4F4", "#BD3039"], ["Mays", 24, "#F4F4F4", "#FD5A1E"], ["Aaron", 44, "#F4F4F4", "#13274F"],
    ["Griffey", 24, "#F4F4F4", "#005C5C"], ["Clemente", 21, "#F4F4F4", "#111111"], ["DiMaggio", 5, "#F4F4F4", "#0C2340", "#0C2340"],
    ["Ichiro", 51, "#F4F4F4", "#0C2C56"]];
  const BATTERS = [["Ruth", 3, "#A2AAAD", "#0C2340"], ["Ohtani", 17, "#A2AAAD", "#005A9C"], ["Judge", 99, "#A2AAAD", "#0C2340"],
    ["Bonds", 25, "#A2AAAD", "#FD5A1E"], ["Trout", 27, "#A2AAAD", "#BA0021"], ["Ortiz", 34, "#A2AAAD", "#BD3039"]];
  const SKATERS = [["Gretzky", 99, "#041E42", "#FF4C00"], ["Ovechkin", 8, "#C8102E", "#FFFFFF"], ["Lemieux", 66, "#111111", "#FCB514"],
    ["Howe", 9, "#CE1126", "#FFFFFF"], ["Messier", 11, "#0038A8", "#FFFFFF"], ["Orr", 4, "#111111", "#FFB81C"],
    ["Lidstrom", 5, "#F4F4F4", "#CE1126"], ["Bourque", 77, "#6F263D", "#FFFFFF"], ["Potvin", 5, "#00539B", "#F47D30"],
    ["Crosby", 87, "#F4F4F4", "#111111"], ["McDavid", 97, "#041E42", "#FF4C00"], ["Hull", 16, "#002F87", "#FCB514"],
    ["Richard", 9, "#AF1E2D", "#FFFFFF"], ["Sakic", 19, "#6F263D", "#FFFFFF"], ["Kane", 88, "#CF0A2C", "#FFFFFF"]];
  const GOALIES = [["Roy", 33, "#AF1E2D", "#FFFFFF"], ["Brodeur", 30, "#CE1126", "#FFFFFF"], ["Hasek", 39, "#002654", "#FCB514"],
    ["Fleury", 29, "#111111", "#FCB514"]];
  const FOOTY = [["Cruyff", 14, "#F36C21", "#111111"], ["Messi", 10, "#75AADB", "#111111", "#FFFFFF"], ["Ronaldo", 7, "#DA291C", "#FFFFFF"],
    ["Pelé", 10, "#FFDF00", "#009C3B"], ["Zidane", 10, "#002395", "#FFFFFF"], ["Maldini", 3, "#C8102E", "#FFFFFF", "#111111"],
    ["Beckenbauer", 5, "#F4F4F4", "#111111"], ["Cannavaro", 5, "#1E5AA8", "#FFFFFF"], ["Ramos", 4, "#AA151B", "#F1BF00"],
    ["Moore", 6, "#F4F4F4", "#1D2A5B"], ["Cafu", 2, "#FFDF00", "#009C3B"], ["Maradona", 10, "#75AADB", "#111111", "#FFFFFF"],
    ["Ronaldinho", 10, "#FFDF00", "#009C3B"], ["Henry", 12, "#002395", "#FFFFFF"], ["Van Basten", 9, "#F36C21", "#111111"],
    ["Xavi", 8, "#AA151B", "#F1BF00"], ["Mbappé", 10, "#002395", "#FFFFFF"]];
  const KEEPERS = [["Yashin", 1, "#111111", "#FFFFFF"], ["Buffon", 1, "#4D4D4D", "#FFFFFF"], ["Neuer", 1, "#3E8E41", "#FFFFFF"],
    ["Casillas", 1, "#F2A900", "#111111"]];
  // pick a lineup for one play: [[pool, how many], ...] in the order cast() adds players
  function lineup(roles, r) {
    const used = new Set(), kits = [];
    roles.forEach(([pool, n]) => {
      const avail = pool.filter(k => !used.has(k[0]));
      for (let i = 0; i < n && avail.length; i++) { const j = Math.floor(r() * avail.length); kits.push(avail[j]); used.add(avail[j][0]); avail.splice(j, 1); }
    });
    return kits;
  }
  // skin tones, light to deep, drawn at random for every player on every play
  const SKIN = ["#F6D7B8", "#EBC096", "#D9A577", "#C99367", "#B07A4E", "#8A5A38", "#6E4429", "#5C3A24", "#4A2E1C"];

  // ---------- the sports ----------
  // Each sport: the surface size and camera (zn: near edge distance, zf: far
  // edge, h: camera height, all meters), where the action happens (ax, az),
  // how long one play runs (D seconds), its markings, and cast(t), which
  // returns the players and the ball at time t.
  const SPORT = {};

  // Basketball, from the sideline. Court 28.65 x 15.24 m.
  (() => {
    const zc = 14.6, B = { X: 12.7, Y: 3.05, Z: zc };
    const O = [
      [[0, -3, zc], [2.4, 5.6, 13.4], [4.4, 6, 13.6], [6.5, 4, 14]],      // point guard brings it up
      [[0, 7.2, 9.6], [2.3, 8.8, 9.1], [3.1, 8.6, 9.2]],                  // wing, takes the jumper
      [[0, 12.1, 21.7], [6.5, 12.4, 21.9]],                                // corner
      [[0, 9.4, 17.2], [3.4, 10.4, 16.4], [4.9, 11.6, 15.3]],              // big crashes the glass
      [[0, 3.6, 19.2], [2.6, 6.6, 18.6], [6.5, 6.2, 18]],                  // top
    ];
    SPORT.court = {
      indoor: true, zn: 7, zf: zc + 7.62, h: 7.5, ax: 8, az: zc, D: 6.8, surface: [138, 100, 64],
      marks(g) {
        const L = 14.33, n = 7, f = zc + 7.62, A = 2.4;
        g.fillPoly([[-L - 9, n - 3], [L + 9, n - 3], [L + 9, f + 3.2], [-L - 9, f + 3.2]], "#1C2622");      // the apron, stained dark
        g.planks(-L, L, n - 3, f, 0.36, [158, 112, 70]);                                          // the playing floor
        const ap = (g.V && g.V.apron) || [92, 62, 40], KEY = (g.V && g.V.key) || "rgba(190,84,38,.78)";
        g.planks(-L - A, -L, n - 3, f + 1.2, 0.36, ap); g.planks(L, L + A, n - 3, f + 1.2, 0.36, ap);
        g.planks(-L, L, f, f + 1.2, 0.36, ap);
        [-1, 1].forEach(s => {                                                   // painted keys
          g.fillPoly([[s * L, zc - 2.45], [s * (L - 5.8), zc - 2.45], [s * (L - 5.8), zc + 2.45], [s * L, zc + 2.45]], KEY);
        });
        g.ellipseW(0, zc, 1.83, (g.V && g.V.center) || "rgba(190,84,38,.78)");     // center circle
        g.ellipseW(0, zc, 0.61, "rgba(28,38,34,.85)");
        // the lamps shine in the finish
        [-9.5, -3.2, 3.2, 9.5].forEach((X, i) => g.sheen(X, f - 2.2 - (i % 2) * 1.5, 3.4, 9, 0.16));
        const C = "rgba(250,246,238,.82)";
        g.line([[-L, n], [L, n], [L, f], [-L, f], [-L, n]], 2.4, C);
        g.line([[0, n], [0, f]], 2, C);
        g.circle(0, zc, 1.83, 2, C); g.circle(0, zc, 0.61, 1.6, C);
        [-1, 1].forEach(s => {
          g.line([[s * L, zc - 2.45], [s * (L - 5.8), zc - 2.45], [s * (L - 5.8), zc + 2.45], [s * L, zc + 2.45]], 1.9, C);
          g.circle(s * (L - 5.8), zc, 1.83, 1.8, C);
          g.arcLine(s * 12.7, zc, 1.22, s > 0 ? -Math.PI : 0, s > 0 ? 0 : Math.PI, 1.4, C);         // restricted area
          [1, 2, 3].forEach(i => { const X = s * (L - 2.1 - i * 0.95); g.line([[X, zc - 2.45], [X, zc - 2.75]], 1.6, C); g.line([[X, zc + 2.45], [X, zc + 2.75]], 1.6, C); });
          const k3 = Math.asin(6.7 / 7.24), mid3 = s > 0 ? -Math.PI / 2 : Math.PI / 2;   // the arc meets the corner lines
          g.arcLine(s * 12.7, zc, 7.24, mid3 - k3, mid3 + k3, 1.9, C);
          const c3 = 12.7 - 7.24 * Math.cos(k3); g.line([[s * L, zc - 6.7], [s * c3, zc - 6.7]], 1.9, C); g.line([[s * L, zc + 6.7], [s * c3, zc + 6.7]], 1.9, C);
        });
        g.text("EDGE", 0, zc, 0.7);
        // courtside: the scorer's table across the far sideline, a glowing strip on its face
        g.panel(-5.2, 5.2, f + 1.9, 0, 0.78, "#121816");
        g.panel(-5.2, 5.2, f + 1.9, 0.42, 0.62, "rgba(229,121,59,.75)");
        [-1, 1].forEach(s => { for (let i = 0; i < 7; i++) g.panel(s * (6.6 + i * 0.75), s * (6.6 + i * 0.75) + 0.5 * s, f + 2.2, 0, 0.9, "#0E1412"); });   // bench seats
        [-1, 1].forEach(s => g.hoop(s, zc));
      },
      goal: B,
      variant(r, T, F = {}) {
        const kits = T.kits([["HOOPS", "o", 5], ["HOOPS", "d", 5]], r);
        return { kits, shooter: F.shooter ?? 1 + Math.floor(r() * 4), make: F.make ?? r() < 0.7, spot: F.spot };
      },
      actors(v) { return [[v.shooter, "o"], [0, "o"], [v.shooter + 5, "d"], [v.shooter === 3 ? 9 : 8, "d"]]; },
      // a real play from a live game: which shot, and did it go in
      live(p, r) {
        const t = p.text;
        if (!/\b(makes|misses)\b/.test(t) || /free throw/i.test(t)) return null;
        const three = /three point|three-point|3-pt|3pt/i.test(t), inside = /layup|dunk|tip|hook|driving|alley|putback|finger roll/i.test(t);
        const F = { make: /\bmakes\b/.test(t), shooter: three ? (r() < 0.5 ? 2 : 4) : inside ? 3 : 1 };
        // where he shot it from: the distance in the play, the side from ESPN's shot chart when it has one
        const ft = Number((/(\d+)-foot/.exec(t) || [])[1]) || (inside ? 2 : 0);
        if (ft && F.shooter !== 2) {
          const c = p.xy && Number.isFinite(+p.xy.x) ? clamp((+p.xy.x - 25) / 25, -1, 1) : r() * 2 - 1;
          const d = Math.max(0.8, ft * 0.3048), th = c * 1.15;
          F.spot = { X: Math.max(1, 12.7 - Math.cos(th) * d), Z: zc + Math.sin(th) * d };
        }
        return F;
      },
      quiet: { make: false },
      caption(v) {
        const N = i => nameOf(v.kits[i]), sh = v.shooter, d = sh + 5, reb = sh === 3 ? 9 : 8;
        if (!v.make) return `${N(d)} contests, ${N(sh)} misses. ${N(reb)} grabs the board.`;
        if (sh === 2 || sh === 4) return `${N(sh)} drains a three over ${N(d)}.`;
        if (sh === 3) return `${N(sh)} scores inside over ${N(d)}.`;
        return `${N(sh)} pulls up over ${N(d)}. Splash.`;
      },
      cast(t, v) {
        const sh = v.shooter, reb = sh === 3 ? 9 : 8, P = [], S = v.spot;
        // the shooter's route ends where the real shot came from
        const K = O.map((k, i) => i === sh && S ? [k[0], [2.2, lerp(k[0][1], S.X, 0.7), lerp(k[0][2], S.Z, 0.7) + 0.8], [2.95, S.X, S.Z], [3.6, S.X, S.Z]] : k);
        K.forEach((k, i) => {
          const p = path(k, t);
          if (i === sh && t > 2.95 && t < 3.85) { p.Y = t > 3.2 ? 0.5 * Math.sin(Math.PI * span(t, 3.2, 3.85)) : 0; p.arms = "shoot"; }
          if (i === 0 && t < 2.4) p.arms = "dribble";
          P.push({ ...p, keys: k, face: 1 });
        });
        K.forEach((k, i) => {
          const p = mark(k, t, B, i === sh ? 1.1 : 1.5);
          if (i === sh && t > 3.3 && t < 3.9) { p.Y = 0.35 * Math.sin(Math.PI * span(t, 3.3, 3.9)); p.arms = "up"; }
          if (i + 5 === reb && t > 4.75 && t < 5.3) { p.Y = 0.45 * Math.sin(Math.PI * span(t, 4.75, 5.3)); p.arms = "up"; }
          if (!p.arms && t < 4.6) p.arms = "guard";
          P.push({ ...p, keys: k, lag: 0.28, face: -1 });
        });
        const pg = P[0], w = P[sh], rb = P[reb];
        const w0 = path(K[sh], 2.95), w1 = path(K[sh], 3.55);
        let ball;
        if (t < 2.4) ball = { X: pg.X + 0.35, Y: 0.15 + Math.abs(Math.sin(t * 6.5)) * 0.85, Z: pg.Z - 0.35 };
        else if (t < 2.95) { const p0 = path(K[0], 2.4); ball = arc({ X: p0.X + 0.3, Y: 1.2, Z: p0.Z - 0.3 }, { X: w0.X - 0.2, Y: 1.3, Z: w0.Z - 0.3 }, 0.25, span(t, 2.4, 2.95)); }
        else if (t < 3.55) ball = { X: w.X, Y: lerp(1.3, 2.5, span(t, 2.95, 3.55)) + (w.Y || 0), Z: w.Z - 0.25 };
        else if (t < 4.6) { const d = Math.hypot(B.X - w1.X, B.Z - w1.Z); ball = arc({ X: w1.X, Y: 2.9, Z: w1.Z - 0.25 }, B, 0.9 + 0.2 * d, span(t, 3.55, 4.6)); }
        else if (v.make && t < 4.9) ball = { X: B.X, Y: lerp(B.Y, 1.7, span(t, 4.6, 4.9)), Z: B.Z, swish: span(t, 4.6, 4.9) };
        else if (v.make) { const u = span(t, 4.9, 6.2); ball = { X: B.X - 1.5 * u, Y: 0.12 + Math.abs(Math.cos(u * 7)) * 1.5 * (1 - u), Z: B.Z - 0.6 * u }; }
        else if (t < 5.2) { const r1 = path(K[reb - 5], 5.2 - 0.28); ball = arc({ X: B.X - 0.25, Y: B.Y + 0.1, Z: B.Z }, { X: r1.X - 0.6, Y: 2.7, Z: r1.Z - 0.3 }, 1.3, span(t, 4.6, 5.2)); }
        else ball = { X: rb.X + 0.25, Y: 1.4 + (rb.Y || 0), Z: rb.Z - 0.3 };
        ball.r = 0.12; ball.color = [214, 106, 44]; ball.lines = true;
        return { players: P, ball, flash: v.make && t > 4.6 && t < 5.6 ? 1 - span(t, 4.6, 5.6) : 0 };
      },
    };
  })();

  // Football, from the press box side. Field 120 x 53.3 yd.
  (() => {
    const yd = 0.9144, n = 14, w = 48.77, mid = n + w / 2, los = n + 17;
    const WRK = [[0, -1, n + 4.5], [1, -1, n + 4.5], [2.3, 9, n + 5], [3.3, 20, n + 7.5], [3.9, 26, n + 8], [5.6, 41, n + 8.5]];
    const WR2 = [[0, -1, los + 14], [1, -1, los + 14], [3.2, 12, los + 11], [6, 15, los + 10]];
    const TEK = [[0, -1, los + 5], [1, -1, los + 5], [3, 6, los + 7], [6, 9, los + 6]];
    const QBK = [[0, -4.5, los], [1.1, -4.5, los], [2.1, -8.5, los], [6, -8, los - 0.4]];
    const RBK = [[0, -6.8, los + 1.4], [1.1, -6.8, los + 1.4], [2.2, -5.2, los - 1.6]];
    const goal = { X: 46, Z: los };
    const TGT = {
      7: { keys: WRK, at: 3.9, peak: 6.5, def: 16, say: (q, r) => `${q} goes deep to ${r}.` },
      8: { keys: WR2, at: 3.4, peak: 5.5, def: 17, say: (q, r) => `${q} finds ${r} on the far side.` },
      9: { keys: TEK, at: 3.0, peak: 2.6, def: 15, say: (q, r) => `${q} hits ${r} over the middle.` },
    };
    SPORT.gridiron = {
      zn: n, zf: n + w, h: 9, ax: 8, az: los, D: 6.6, surface: [46, 90, 51],
      marks(g) {
        const G = 50 * yd, E = 60 * yd, f = n + w;
        g.fillPoly([[-E - 4, n], [E + 4, n], [E + 4, f], [-E - 4, f]], "rgba(44,88,50,1)");
        g.stripes(-G, G, n, f, 20, "rgba(255,255,255,.04)", "rgba(0,0,0,.045)");
        const ez = (g.V && g.V.ez) || ["rgba(30,58,44,.9)", "rgba(229,121,59,.42)"];
        g.fillPoly([[G, n], [E, n], [E, f], [G, f]], ez[1]);
        g.fillPoly([[-E, n], [-G, n], [-G, f], [-E, f]], ez[0]);
        if (g.V && g.V.ezLine) [-1, 1].forEach(s => g.line([[s * (G + 0.6), n + 0.6], [s * (E - 0.6), n + 0.6], [s * (E - 0.6), f - 0.6], [s * (G + 0.6), f - 0.6], [s * (G + 0.6), n + 0.6]], 2, g.V.ezLine));
        g.line([[-E, n], [E, n], [E, f], [-E, f], [-E, n]], 2.4);
        for (let i = -10; i <= 10; i++) g.line([[i * 5 * yd, n], [i * 5 * yd, f]], i % 2 ? 1 : 1.6);
        for (let i = -49; i <= 49; i++) {
          if (i % 5 === 0) continue;
          [n + 0.3, mid - 2.8, mid + 2.8, f - 0.3].forEach(z => g.line([[i * yd, z], [i * yd, z + 0.6]], 0.8));
        }
        for (let i = -4; i <= 4; i++) {
          const v = String(50 - Math.abs(i) * 10);
          g.text(v, i * 10 * yd, n + 11, 1.8); g.text(v, i * 10 * yd, f - 11, 1.8);
        }
        g.goalpost(G + 10 * yd, mid);
      },
      goal,
      variant(r, T, F = {}) {
        const kits = T.kits([["OL", "o", 5], ["QB", "o", 1], ["RB", "o", 1], ["WR", "o", 2], ["TE", "o", 1], ["DL", "d", 4], ["LB", "d", 2], ["CB", "d", 2], ["SAF", "d", 2]], r);
        const v = { kits, run: F.run ?? r() < 0.3, target: F.target ?? [7, 8, 9][Math.floor(r() * 3)], caught: F.caught ?? r() < 0.78 };
        v.yards = F.yards ?? Math.round(-2 + r() * r() * 24);
        v.shift = clamp(F.shift ?? (T.mode === "classic" ? 0 : -30 + r() * 38) * yd, -38 * yd, 8 * yd);   // where the ball is snapped, from midfield
        v.cut = (r() * 2 - 1) * 2.5;
        return v;
      },
      actors(v) { return v.run ? [[6, "o"], [14, "d"]] : [[5, "o"], [v.target, "o"], [TGT[v.target].def, "d"]]; },
      live(p) {
        const t = p.text;
        if (/punt|kicks|kickoff|field goal|extra point|penalty|timeout|two-minute|end of|kneels|spiked|sacked|two-point/i.test(t + " " + p.type)) return null;
        const y = /for (-?\d+) yards?/.exec(t), yards = y ? Number(y[1]) : 0;
        const at = Number.isFinite(p.ytez) ? { shift: 50 - p.ytez } : {};
        if (/\bpass\b/i.test(t)) { const caught = !/incomplete|intercept/i.test(t); return { ...at, run: false, caught, target: caught && yards >= 20 ? 7 : /middle/i.test(t) ? 9 : 8 }; }
        if (/rush|left end|right end|up the middle|left tackle|right tackle|left guard|right guard|scrambles|for no gain/i.test(t + " " + p.type)) return { ...at, run: true, yards };
        return null;
      },
      quiet: {},
      caption(v) {
        const N = i => nameOf(v.kits[i]), T = TGT[v.target];
        if (v.run) {
          if (v.yards <= 0) return `${N(14)} stuffs ${N(6)} at the line.`;
          return v.yards >= 15 ? `${N(6)} breaks one for ${v.yards} yards.` : `${N(6)} runs for ${v.yards} yard${v.yards === 1 ? "" : "s"}.`;
        }
        return v.caught ? T.say(N(5), N(v.target)) : `${N(T.def)} breaks up ${N(5)}'s pass to ${N(v.target)}.`;
      },
      cast(t, v) {
        const P = [], set = t < 1, T = TGT[v.target];
        for (let i = 0; i < 5; i++) {                                     // offensive line
          const z = los + (i - 2) * 1.15, push = set ? 0 : 0.6 * span(t, 1, 1.6);
          P.push({ X: -0.9 + push + Math.sin(t * 9 + i) * 0.05 * !set, Z: z, crouch: set ? 0.72 : 0.86, face: 1 });
        }
        // a run: the handoff, a cut through the line, and a linebacker who brings him down
        const end = { X: clamp(v.yards * yd, -2.5, 28), Z: los + v.cut }, tEnd = 2.5 + Math.max(0.5, (end.X + 2) / 8.5);
        const RUNK = [[0, -6.8, los + 1.4], [1.1, -6.8, los + 1.4], [1.55, -3.6, los + 0.5], [2.3, -0.3, los + v.cut * 0.5], [tEnd, end.X, end.Z]];
        const QBRUN = [[0, -4.5, los], [1.1, -4.5, los], [1.5, -4.8, los + 0.6], [2.8, -7.5, los + 1.2]];
        [v.run ? QBRUN : QBK, v.run ? RUNK : RBK, WRK, WR2, TEK].forEach(k => P.push({ ...path(k, t), keys: k, face: 1 }));
        if (v.run && t > tEnd) P[6].crouch = 0.7;
        for (let i = 0; i < 4; i++) {                                     // defensive line
          const z = los + (i - 1.5) * 1.5, push = set ? 0 : -0.4 * span(t, 1, 1.6);
          P.push({ X: 0.9 + push, Z: z, crouch: set ? 0.74 : 0.9, face: -1 });
        }
        const LBK = v.run ? [[0, 5, los - 3.5], [1, 5, los - 3.5], [tEnd, end.X + 0.8, end.Z - 0.5]] : [[0, 5, los - 3.5], [1, 5, los - 3.5], [3, 3, los - 4.5]];
        P.push({ ...path(LBK, t), keys: LBK, face: -1, arms: v.run && Math.abs(t - tEnd) < 0.3 ? "up" : null });
        P.push({ ...path([[0, 5, los + 3.5], [1, 5, los + 3.5], [3, 5, los + 6.5]], t), face: -1 });
        P.push({ ...mark(WRK, t, goal, -1.4, 0.38), keys: WRK, lag: 0.38, face: -1 });
        P.push({ ...mark(WR2, t, goal, -1.4, 0.38), keys: WR2, lag: 0.38, face: -1 });
        P.push({ ...path([[0, 14, n + 15], [1.8, 15, n + 13], [4.2, 25, n + 9.5], [6, 37, n + 9]], t), face: -1 });
        P.push({ ...path([[0, 14, los + 9], [3, 13, los + 4], [6, 22, los - 2]], t), face: -1 });
        if (!v.run && t > 2.0 && t < 2.75) P[5].throw = span(t, 2.1, 2.55);
        if (!v.run && !v.caught && Math.abs(t - T.at) < 0.35) P[T.def].arms = "up";
        if (!v.run && v.caught && Math.abs(t - T.at) < 0.25) P[v.target].arms = "up";
        const q = P[5], r = P[v.target], c = path(T.keys, T.at), q0 = path(QBK, 2.5);
        let ball;
        if (t < 1) ball = { X: -0.6, Y: 0.15, Z: los };
        else if (v.run && t >= 1.55) { const b = P[6]; ball = { X: b.X + 0.25, Y: t > tEnd ? 0.7 : 1.15, Z: b.Z - 0.25 }; }
        else if (t < 1.2) ball = arc({ X: -0.6, Y: 0.15, Z: los }, { X: q.X + 0.2, Y: 1.2, Z: q.Z - 0.2 }, 0.1, span(t, 1, 1.2));
        else if (t < 2.5) ball = { X: q.X + 0.2, Y: t > 2.2 ? 2 : 1.3, Z: q.Z - 0.25 };
        else if (v.run) ball = { X: q.X + 0.2, Y: 1.3, Z: q.Z - 0.25 };
        else if (t < T.at) ball = arc({ X: q0.X + 0.3, Y: 2.1, Z: q0.Z - 0.2 }, { X: c.X + 0.3, Y: 1.6, Z: c.Z - 0.2 }, T.peak, span(t, 2.5, T.at));
        else if (v.caught) ball = { X: r.X + 0.3, Y: 1.25, Z: r.Z - 0.25 };
        else {
          const u = span(t, T.at, T.at + 0.55), rest = { X: c.X + 2.6, Y: 0.12, Z: c.Z + 1.2 };
          ball = u < 1 ? arc({ X: c.X + 0.3, Y: 1.6, Z: c.Z - 0.2 }, rest, 1.1, u) : rest;
        }
        ball.r = 0.14; ball.color = [124, 70, 40]; ball.oval = true;
        if (v.shift) { P.forEach(p => { p.X += v.shift; }); ball.X += v.shift; }
        return { players: P, ball };
      },
    };
  })();

  // Baseball, from high behind home plate.
  (() => {
    const H0 = 9, home = { X: 0, Z: H0 };
    const base = (x, z) => [x, H0 + z];
    // the batter runs to first; on a home run he keeps going toward second
    const runner = (t, t1, hr) => {
      const u = span(t, 2.15, t1);
      if (hr && t > t1) { const w = span(t, t1, 6.8); return { X: lerp(19.4, 0, w), Z: lerp(H0 + 19.4, H0 + 38.8, w), run: w < 1 }; }
      return { X: -0.9 + 20.3 * u, Z: H0 + 19.4 * u, run: u > 0 && u < 1 };
    };
    const SPOT = { 6: [-40, H0 + 70], 7: [0, H0 + 92], 8: [40, H0 + 70] };
    const FIELD_NAME = { 6: "left", 7: "center", 8: "right" };
    const wallR = a => 100 + 22 * Math.cos(a * 2);
    SPORT.park = {
      zn: 5, zf: H0 + 120, h: 5, ax: 0, az: H0 + 40, centered: true, D: 7.2, surface: [46, 90, 51], fitZf: 90,
      marks(g) {
        g.fillPoly([[-140, 5], [140, 5], [140, 134], [-140, 134]], "rgba(44,88,50,1)");
        g.stripes(-110, 110, 5, 140, 22, "rgba(255,255,255,.04)", "rgba(0,0,0,.04)");
        const wall = [];
        for (let i = 0; i <= 40; i++) { const a = -Math.PI / 4 + i / 40 * Math.PI / 2, R = 100 + 22 * Math.cos(a * 2); wall.push([Math.sin(a) * R, H0 + Math.cos(a) * R]); }
        const track = wall.map(([x, z]) => [lerp(0, x, 0.94), lerp(H0, z, 0.94)]);
        g.fillPoly([...track, ...wall.slice().reverse()], "rgba(150,98,62,.85)");
        const dirt = [];
        for (let i = 0; i <= 30; i++) { const a = -Math.PI / 4 - 0.12 + i / 30 * (Math.PI / 2 + 0.24); dirt.push([Math.sin(a) * 29, H0 + Math.cos(a) * 29]); }
        g.fillPoly([[0, H0 - 3], ...dirt], "rgba(160,104,64,.95)");
        g.fillPoly([base(0, 2.4), base(17.2, 19.4), base(0, 36.4), base(-17.2, 19.4)], "rgba(54,100,58,1)");
        g.ellipseW(0, H0 + 18.4, 2.7, "rgba(170,112,70,1)");
        g.ellipseW(0, H0, 3.9, "rgba(170,112,70,1)");
        g.line([[0, H0], [-110, H0 + 110]], 1.8); g.line([[0, H0], [110, H0 + 110]], 1.8);
        g.line([base(0, 0), base(19.4, 19.4), base(0, 38.8), base(-19.4, 19.4), base(0, 0)], 1);
        [base(19.4, 19.4), base(0, 38.8), base(-19.4, 19.4)].forEach(([x, z]) => g.ellipseW(x, z, 0.5, "rgba(242,238,230,.95)"));
        g.ellipseW(0, H0, 0.35, "rgba(242,238,230,.95)");
        g.wall(wall, 3.2);
      },
      variant(r, T, F = {}) {
        const kits = T.kits([["PITCHERS", "d", 1], ["CATCHERS", "d", 1], ["INFIELD", "d", 4], ["OUTFIELD", "d", 3], ["BATTERS", "o", 1]], r);
        const roll = r(), type = F.type ?? (roll < 0.4 ? "fly" : roll < 0.62 ? "hr" : roll < 0.8 ? "ground" : "hit"), a = F.a ?? (r() * 2 - 1) * 0.6;
        const v = { kits, type, a };
        if (type === "ground") { v.f = F.f ?? [3, 4, 5][Math.floor(r() * 3)]; return v; }
        v.f = a < -0.2 ? 6 : a > 0.2 ? 8 : 7;
        const W0 = wallR(a), s0 = SPOT[v.f];
        const R = F.R ?? (type === "hr" ? W0 + 14 : type === "hit" ? 42 + r() * 16 : 64 + r() * 18);
        v.land = { X: Math.sin(a) * R, Y: type === "hr" ? 2 : type === "hit" ? 0.1 : 1.9, Z: H0 + Math.cos(a) * R };
        if (type === "hit") {                                        // drops in; the fielder picks it up on the hop and throws to second
          v.pick = { X: lerp(v.land.X, s0[0], 0.45), Z: lerp(v.land.Z, s0[1], 0.45) };
          v.fpath = [[0, s0[0], s0[1]], [2.25, s0[0], s0[1]], [4.5, v.pick.X + 0.3, v.pick.Z + 0.3], [7.2, v.pick.X + 1, v.pick.Z - 1]];
          return v;
        }
        const C = type === "hr" ? { X: Math.sin(a) * (W0 - 2), Z: H0 + Math.cos(a) * (W0 - 2) } : v.land;
        v.fpath = [[0, s0[0], s0[1]], [2.25, s0[0], s0[1]], [type === "hr" ? 4.9 : 5.15, C.X + 0.3, C.Z + 0.3], [7.2, C.X + 0.3, C.Z + 0.3]];
        return v;
      },
      actors(v) { return [[9, "o"], [0, "d"], [v.f, "d"]]; },
      live(p) {
        const t = p.text;
        const a = /left[- ]center/i.test(t) ? -0.2 : /right[- ]center/i.test(t) ? 0.2 : /\bleft\b/i.test(t) ? -0.45 : /\bright\b/i.test(t) ? 0.45 : 0;
        // where it landed, from the hit chart (home plate at 125, 198; about 2.5 ft a unit) when ESPN has it
        const h = p.hit, ok = h && Number.isFinite(+h.x) && Number.isFinite(+h.y) && (+h.x || +h.y);
        const ca = ok ? clamp(Math.atan2(+h.x - 125.42, 198.27 - +h.y), -0.75, 0.75) : a;
        const R = ok ? clamp(2.5 * Math.hypot(+h.x - 125.42, 198.27 - +h.y) * 0.3048, 30, 120) : undefined;
        if (/homered|home run|grand slam/i.test(t)) return { type: "hr", a: ca };
        if (/singled|doubled|tripled/i.test(t)) return { type: "hit", a: ca, R: R && Math.min(R, 70) };
        if (/flied out|lined out|popped out|fouled out|sacrifice fly|flied into/i.test(t)) return { type: "fly", a: ca, R: R && clamp(R, 50, 110) };
        if (/grounded|ground ball|double play|forced out|fielder's choice/i.test(t)) return { type: "ground", f: /third/i.test(t) ? 5 : /second/i.test(t) ? 3 : 4 };
        return null;
      },
      quiet: { type: "fly" },
      caption(v) {
        const N = i => nameOf(v.kits[i]), bat = N(9);
        if (v.type === "hr") return `${bat} crushes one to deep ${FIELD_NAME[v.f]}. Gone.`;
        if (v.type === "hit") return `${bat} lines a base hit to ${FIELD_NAME[v.f]}.`;
        if (v.type === "fly") return `${bat} lifts one to ${FIELD_NAME[v.f]}. ${N(v.f)} makes the catch.`;
        return `${N(v.f)} fields it and throws out ${bat}.`;
      },
      cast(t, v) {
        const P = [], gr = v.type === "ground";
        const near = v.land || { X: 0, Z: H0 + 40 };
        const drift = i => { const s0 = SPOT[i]; return [[0, s0[0], s0[1]], [2.3, s0[0], s0[1]], [5, lerp(s0[0], near.X, 0.22), lerp(s0[1], near.Z, 0.22)]]; };
        P.push({ ...path([[0, 0, H0 + 18.4], [1.6, 0, H0 + 18.2], [2, 0.4, H0 + 17]], t), arms: t > 1.2 && t < 1.6 ? "up" : null });
        P.push({ X: 0, Z: H0 - 1.3, crouch: t < 2.3 ? 0.62 : 1 });
        // infield: the 1B covers the bag on a grounder; the fielder charges the ball
        const IF = { 2: [17, H0 + 22], 3: [8, H0 + 33], 4: [-8, H0 + 33], 5: [-17, H0 + 22] };
        const FP = gr ? { X: IF[v.f][0] * 0.86, Z: IF[v.f][1] - 3 } : null;
        for (let i = 2; i <= 5; i++) {
          const s0 = IF[i];
          let keys = [[0, s0[0], s0[1]], [2.3, s0[0], s0[1]], [4.4, s0[0] * 0.95, s0[1] + 1]];
          if (gr && i === 2) keys = [[0, s0[0], s0[1]], [2.2, s0[0], s0[1]], [2.9, 18.9, H0 + 19.8]];
          if (gr && i === v.f) keys = [[0, s0[0], s0[1]], [2.1, s0[0], s0[1]], [2.85, FP.X, FP.Z], [4, FP.X + 1, FP.Z - 1]];
          if (v.type === "hit" && i === 3) keys = [[0, s0[0], s0[1]], [2.3, s0[0], s0[1]], [4.6, 0.8, H0 + 37.6]];
          P.push({ ...path(keys, t), keys });
        }
        for (let i = 6; i <= 8; i++) {
          const keys = !gr && i === v.f ? v.fpath : drift(i), p = { ...path(keys, t), keys };
          if (!gr && i === v.f && t > 4.85 && t < 5.45) { p.arms = "up"; if (v.type === "hr") p.Y = 0.5 * Math.sin(Math.PI * span(t, 4.85, 5.45)); }
          P.push(p);
        }
        const bat = t < 2.15 ? { X: -0.9, Z: H0 } : runner(t, v.type === "hr" ? 4.1 : gr ? 3.85 : v.type === "hit" ? 4.3 : 5.6, v.type === "hr");
        P.push({ ...bat, bat: t < 2.4 ? clamp((t - 1.85) / 0.3) : null, face: 1 });
        const hitAt = { X: -0.3, Y: 0.9, Z: H0 + 0.4 };
        let ball;
        if (t < 1.65) ball = { X: 0.4, Y: 1.9, Z: H0 + 17.8, hide: t < 1.2 };
        else if (t < 2.05) ball = arc({ X: 0.4, Y: 1.9, Z: H0 + 17.6 }, hitAt, 0.25, span(t, 1.65, 2.05));
        else if (gr) {
          const bag = { X: 18.9, Y: 1.3, Z: H0 + 19.8 };
          if (t < 2.85) { const u = span(t, 2.05, 2.85); ball = { X: lerp(hitAt.X, FP.X, u), Y: 0.12 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.7 * (1 - u), Z: lerp(hitAt.Z, FP.Z - 0.3, u), fly: true }; }
          else if (t < 3.2) { const f = P[v.f]; ball = { X: f.X + 0.3, Y: 1.2, Z: f.Z - 0.3 }; }
          else if (t < 3.7) { const f0 = path([[0, FP.X, FP.Z], [1, FP.X, FP.Z]], 0); ball = arc({ X: f0.X + 0.3, Y: 1.6, Z: f0.Z - 0.3 }, bag, 1.4, span(t, 3.2, 3.7)); }
          else ball = { ...bag };
        } else if (v.type === "hit") {
          const f = P[v.f], bag = { X: 0.6, Y: 1.3, Z: H0 + 37.9 };
          if (t < 3.5) ball = arc(hitAt, v.land, 5, span(t, 2.05, 3.5));
          else if (t < 4.5) { const u = span(t, 3.5, 4.5); ball = { X: lerp(v.land.X, v.pick.X, u), Y: 0.12 + Math.abs(Math.sin(u * Math.PI * 2)) * 1.2 * (1 - u), Z: lerp(v.land.Z, v.pick.Z - 0.3, u), fly: true }; }
          else if (t < 4.8) ball = { X: f.X + 0.3, Y: 1.4, Z: f.Z - 0.3 };
          else if (t < 5.7) ball = arc({ X: v.pick.X + 0.3, Y: 1.8, Z: v.pick.Z - 0.3 }, bag, 3, span(t, 4.8, 5.7));
          else ball = { ...bag };
        } else if (t < 5.3) ball = arc(hitAt, v.land, v.type === "hr" ? 34 : 28, span(t, 2.05, 5.3));
        else if (v.type === "fly") { const f = P[v.f]; ball = { X: f.X + 0.3, Y: 1.8, Z: f.Z - 0.2 }; }
        else ball = { ...v.land, hide: true };
        ball.r = 0.2; ball.color = [250, 246, 236];
        return { players: P, ball, hitFlash: t > 2.05 && t < 2.5 ? 1 - span(t, 2.05, 2.5) : 0, hitAt };
      },
    };
  })();

  // Hockey, from the side boards. Rink 60 x 26 m.
  (() => {
    const n = 9, w = 26, mid = n + w / 2, G = { X: 26.6, Y: 0.5, Z: mid + 0.5 };
    const O1 = [[0, -12, mid + 3], [2.2, 6, mid + 5], [2.9, 10, mid + 5.4], [5.5, 18, mid + 3]];
    const O2 = [[0, 5, mid - 7], [3.1, 17.5, mid - 6], [3.6, 19.6, mid - 5.4], [5.5, 21, mid - 3]];
    const O3 = [[0, -2, mid - 1], [3.2, 15, mid], [4.4, 22, mid + 0.6]];
    const O4 = [[0, -14, mid - 5], [4.4, 5, mid - 6]];
    const O5 = [[0, -20, mid + 8], [4.4, -1, mid + 7]];
    const O1SOLO = [[0, -12, mid + 3], [2.2, 6, mid + 5], [3.3, 17, mid + 3], [5.5, 20, mid + 1.5]];
    SPORT.ice = {
      indoor: true, zn: n, zf: n + w, h: 8, ax: 14, az: mid, D: 6.4, surface: [180, 196, 204], skate: true,
      marks(g) {
        const L = 30, f = n + w;
        g.fillPoly([[-L - 6, n - 3], [L + 6, n - 3], [L + 6, f + 2], [-L - 6, f + 2]], "rgba(36,44,48,1)");
        g.fillRound(-L, n, L, f, 8.5, "rgba(196,210,216,1)");
        g.line([[0, n], [0, f]], 4, "rgba(186,46,46,.75)");
        [-7.6, 7.6].forEach(x => g.line([[x, n], [x, f]], 4, "rgba(44,84,176,.7)"));
        [-26.6, 26.6].forEach(x => g.line([[x, n + 1.6], [x, f - 1.6]], 1.4, "rgba(186,46,46,.75)"));
        g.circle(0, mid, 4.5, 1.6, "rgba(44,84,176,.7)");
        [[-22, mid - 6.7], [-22, mid + 6.7], [22, mid - 6.7], [22, mid + 6.7]].forEach(([x, z]) => {
          g.circle(x, z, 4.5, 1.4, "rgba(186,46,46,.6)"); g.ellipseW(x, z, 0.3, "rgba(186,46,46,.8)");
        });
        [-1, 1].forEach(s => g.ellipseW(s * 25.6, mid, 1.8, "rgba(110,150,210,.4)", Math.PI));
        g.boards(-L, L, f, 8.5, mid);
        [-1, 1].forEach(s => g.net(s, 26.6, mid));
      },
      variant(r, T, F = {}) {
        const kits = T.kits([["SKATERS", "o", 5], ["SKATERS", "d", 5], ["GOALIES", "d", 1]], r);
        return { kits, solo: F.solo ?? r() < 0.35, goal: F.goal ?? r() < 0.65, high: F.high ?? r() < 0.5, spot: F.spot };
      },
      actors(v) { return v.solo ? [[0, "o"], [10, "d"]] : [[1, "o"], [0, "o"], [10, "d"]]; },
      live(p, r) {
        const goal = p.scoring || /^goal/i.test(p.type);
        if (!goal && !(/shot/i.test(p.type) && !/miss|block|wide/i.test(p.type + " " + p.text))) return null;
        const F = { goal, solo: goal ? !/assist/i.test(p.text) : r() < 0.5 };
        if (p.xy && Number.isFinite(+p.xy.x) && Number.isFinite(+p.xy.y) && (+p.xy.x || +p.xy.y)) {       // feet from center ice
          F.spot = { X: clamp(Math.abs(+p.xy.x) * 0.3048, 9, 24.5), Z: clamp(mid + +p.xy.y * 0.3048, mid - 10, mid + 10) };
        }
        return F;
      },
      quiet: { goal: false },
      caption(v) {
        const N = i => nameOf(v.kits[i]), a = N(0), b = N(1), g = N(10);
        if (v.solo) return v.goal ? `${a} snipes one past ${g}.` : `${g} gloves ${a}'s wrister.`;
        return v.goal ? `${a} feeds ${b} for the one-timer. Goal.` : `${g} robs ${b} on the one-timer.`;
      },
      cast(t, v) {
        const S = v.spot;
        const K1 = v.solo ? (S ? [O1SOLO[0], O1SOLO[1], [3.3, S.X, S.Z], [5.5, S.X + 2.5, lerp(S.Z, mid, 0.4)]] : O1SOLO) : O1;
        const K2 = !v.solo && S ? [O2[0], [3.1, S.X - 2.1, S.Z - 0.6], [3.6, S.X, S.Z], [5.5, S.X + 1.6, lerp(S.Z, mid, 0.5)]] : O2;
        const P = [], ks = [K1, K2, O3, O4, O5];
        ks.forEach(k => P.push({ ...path(k, t), keys: k, face: 1, stick: 1 }));
        ks.forEach(k => { const m = mark(k, t, G, 2.6, 0.32); P.push({ ...m, Z: m.Z + 1.7, keys: k, lag: 0.32, face: -1, stick: 1 }); });
        const shK = v.solo ? K1 : K2, tShot = v.solo ? 3.35 : 3.65, tIn = tShot + 0.3, s0 = path(shK, tShot);
        const track = t < tShot ? path(shK, t).Z : s0.Z;
        const gz = clamp(lerp(mid - 1.1, mid + 1.1, (track - (mid - 7)) / 14), mid - 1.1, mid + 1.1);
        const save = !v.goal && t > tShot;
        P.push({ X: 25.4, Z: gz, crouch: 0.78, stick: 1, goalie: 1, face: -1, arms: save && t < tIn + 0.9 ? "glove" : null });
        const shooter = v.solo ? 0 : 1;
        if (Math.abs(t - tShot) < 0.4) P[shooter].shoot = clamp((t - tShot) / 0.35, -1, 1);
        if (!v.solo && Math.abs(t - 2.95) < 0.3) P[0].shoot = clamp((t - 2.95) / 0.25, -1, 1) * 0.5;
        if (t < (v.solo ? tShot - 0.4 : 2.65)) P[0].carry = 1;
        if (!v.solo && t > 3.35 && t < tShot - 0.4) P[1].carry = 1;
        if (v.fly && t > tShot + 0.05) { const u = span(t, tShot + 0.05, tShot + 1); P[0].Y = 0.75 * Math.sin(Math.PI * u); P[0].dive = u > 0 && u < 1; }
        if (v.fall && t > tShot - 0.7) P[0].crouch = lerp(1, 0.5, span(t, tShot - 0.7, tShot - 0.3));
        const blade = p => ({ X: p.X + 0.95, Y: 0.03, Z: p.Z - 0.4 });
        const net = { X: 27.2, Y: v.high ? 0.95 : 0.2, Z: G.Z + (v.high ? -0.5 : 0.55) };
        const glove = { X: 25.9, Y: v.high ? 1.05 : 0.3, Z: gz - 0.55 };
        let ball;
        if (t < (v.solo ? tShot : 2.95)) ball = blade(P[0]);
        else if (!v.solo && t < 3.35) ball = arc(blade(path(O1, 2.95)), blade(path(K2, 3.35)), 0, span(t, 2.95, 3.35));
        else if (!v.solo && t < tShot) ball = blade(P[1]);
        else if (t < tIn) ball = arc(blade(s0), v.goal ? net : glove, v.high ? 0.35 : 0.05, span(t, tShot, tIn));
        else if (v.goal) ball = { X: 27.5, Y: 0.04, Z: net.Z };
        else if (t < tIn + 0.9) ball = { ...glove };
        else ball = { X: 25.6, Y: 0.03, Z: gz - 0.6 };
        ball.r = 0.1; ball.color = [16, 16, 18]; ball.puck = true;
        return { players: P, ball, lamp: v.goal && t > tIn ? 1 - span(t, tIn, tIn + 2.2) : 0 };
      },
    };
  })();

  // Soccer, from the halfway line stand. Pitch 105 x 68 m.
  (() => {
    const n = 14, w = 68, mid = n + w / 2, G = { X: 52.5, Y: 1.4, Z: mid - 1.2 };
    const O1 = [[0, 9, mid + 8], [1.4, 14, mid + 8], [4, 22, mid + 6]];
    const O2 = [[0, 21, mid - 15], [1.9, 25, mid - 16], [3.3, 40, mid - 22], [5.5, 43, mid - 20]];
    const O3 = [[0, 27, mid + 3], [3.3, 39, mid + 2], [4.3, 44.5, mid]];
    const O4 = [[0, 18, mid - 2], [4.3, 34, mid - 6]];
    const O5 = [[0, 4, mid - 26], [4.3, 16, mid - 24]];
    const O4V = [[0, 18, mid - 2], [4.0, 37, mid - 5], [5, 39, mid - 4]];
    SPORT.pitch = {
      zn: n, zf: n + w, h: 8, ax: 38, az: mid - 6, D: 6.8, surface: [46, 90, 51],
      marks(g) {
        const L = 52.5, f = n + w;
        g.fillPoly([[-L - 8, n - 4], [L + 8, n - 4], [L + 8, f + 6], [-L - 8, f + 6]], "rgba(44,88,50,1)");
        g.stripes(-L, L, n, f, 18, "rgba(255,255,255,.045)", "rgba(0,0,0,.04)");
        g.line([[-L, n], [L, n], [L, f], [-L, f], [-L, n]], 2);
        g.line([[0, n], [0, f]], 1.6);
        g.circle(0, mid, 9.15, 1.6);
        [-1, 1].forEach(s => {
          g.line([[s * L, mid - 20.16], [s * (L - 16.5), mid - 20.16], [s * (L - 16.5), mid + 20.16], [s * L, mid + 20.16]], 1.6);
          g.line([[s * L, mid - 9.16], [s * (L - 5.5), mid - 9.16], [s * (L - 5.5), mid + 9.16], [s * L, mid + 9.16]], 1.4);
          g.ellipseW(s * (L - 11), mid, 0.3, "rgba(242,238,230,.7)");
          g.goal(s, L, mid);
        });
      },
      variant(r, T, F = {}) {
        const roll = r(), kits = T.kits([["FOOTY", "o", 5], ["FOOTY", "d", 7], ["KEEPERS", "d", 1]], r);
        return { kits, type: F.type ?? (roll < 0.45 ? "header" : roll < 0.75 ? "volley" : "long"),
          goal: F.goal ?? r() < 0.62, gz: F.gz ?? mid + (r() * 2 - 1) * 2.8, gy: F.gy ?? 0.4 + r() * 1.6, spot: F.spot };
      },
      actors(v) { const sh = v.type === "header" ? 2 : v.type === "volley" ? 3 : 1; return sh === 1 ? [[1, "o"], [12, "d"]] : [[sh, "o"], [1, "o"], [12, "d"]]; },
      live(p) {
        const t = p.text, goal = p.scoring || /^goal/i.test(p.type) || /^goal!/i.test(t);
        if (!goal && !/saved/i.test(t)) return null;
        if (/own goal|penalty/i.test(t)) return null;
        const F = { goal, type: /header|headed/i.test(t) ? "header" : /outside the box|long range|from distance/i.test(t) ? "long" : "volley" };
        if (Number.isFinite(+p.fx) && Number.isFinite(+p.fy) && (+p.fx || +p.fy)) {   // ESPN's field position, 0 to 1 along and across
          const along = Math.max(+p.fx, 1 - +p.fx);
          F.spot = { X: clamp(52.5 - (1 - along) * 105, 28, 49), Z: clamp(n + +p.fy * w, mid - 18, mid + 18) };
        }
        return F;
      },
      quiet: { goal: false },
      caption(v) {
        const N = i => nameOf(v.kits[i]), k = N(12);
        if (v.type === "header") return v.goal ? `${N(1)} crosses, ${N(2)} heads it in.` : `${k} saves ${N(2)}'s header.`;
        if (v.type === "volley") return v.goal ? `${N(1)} cuts it back, ${N(3)} buries it.` : `${k} stops ${N(3)} from close range.`;
        return v.goal ? `${N(1)} curls one in from distance.` : `${k} tips ${N(1)}'s strike wide.`;
      },
      cast(t, v) {
        // the shooter gets to the spot the real shot came from
        const S0 = v.spot, ty = v.type;
        const K2 = S0 && ty === "long" ? [O2[0], O2[1], [3.3, S0.X - 1.5, S0.Z], [5.5, S0.X + 2, S0.Z]] : O2;
        const K3 = S0 && ty === "header" ? [O3[0], [3.3, S0.X - 4, lerp(O3[1][2], S0.Z, 0.6)], [4.3, S0.X, S0.Z]] : O3;
        const K4 = S0 && ty === "volley" ? [O4V[0], [4.0, S0.X, S0.Z], [5, S0.X + 2, S0.Z + 1]] : O4V;
        const P = [], ks = [O1, K2, K3, ty === "volley" ? K4 : O4, O5];
        ks.forEach(k => P.push({ ...path(k, t), keys: k, face: 1 }));
        ks.forEach(k => P.push({ ...mark(k, t, G, 2.4, 0.34), keys: k, lag: 0.34, face: -1 }));
        P.push({ ...path([[0, 38, mid + 14], [4, 40, mid + 6]], t), face: -1 });
        P.push({ ...path([[0, 31, mid - 10], [4, 37, mid - 13]], t), face: -1 });
        const S = v.type === "header" ? { t0: 4.3, t1: 4.7, from: () => { const c = path(K3, 4.3); return { X: c.X + 0.2, Y: 2.1, Z: c.Z }; }, peak: 0.3 }
          : v.type === "volley" ? { t0: 4.0, t1: 4.4, from: () => { const c = path(K4, 4.0); return { X: c.X + 0.5, Y: 0.3, Z: c.Z }; }, peak: 0.6 }
          : { t0: 3.3, t1: 3.95, from: () => { const c = path(K2, 3.3); return { X: c.X + 0.7, Y: 0.15, Z: c.Z - 0.3 }; }, peak: 2.2 };
        const T = { X: 52.5, Y: v.gy, Z: v.gz };
        const dive = !v.goal && t > S.t1 - 0.4 && t < S.t1 + 0.7;
        const kz = t < S.t1 - 0.4 ? lerp(mid - 1, mid, span(t, 0, S.t0)) : !v.goal ? lerp(mid, T.Z - 0.4, span(t, S.t1 - 0.4, S.t1)) : mid + 0.3 * (T.Z - mid) * span(t, S.t1 - 0.4, S.t1);
        P.push({ X: 51.3, Z: kz, arms: dive || (v.goal && Math.abs(t - S.t1) < 0.3) ? "up" : null, Y: dive ? 0.5 * Math.sin(Math.PI * span(t, S.t1 - 0.4, S.t1 + 0.7)) : 0 });
        const a = P[0], b = P[1];
        if (v.type === "header" && t > 4.05 && t < 4.55) { P[2].Y = 0.45 * Math.sin(Math.PI * span(t, 4.05, 4.55)); P[2].arms = "up"; }
        const kick = (i, at) => { if (t > at - 0.3 && t < at + 0.2) P[i].kick = span(t, at - 0.3, at + 0.15); };
        kick(0, 1.4); kick(1, 3.3);
        if (v.type === "volley") kick(3, S.t0);
        let ball;
        if (t < 1.4) ball = { X: a.X + 0.6, Y: 0.11, Z: a.Z - 0.3 };
        else if (t < 1.9) ball = arc({ X: path(O1, 1.4).X + 0.6, Y: 0.11, Z: path(O1, 1.4).Z - 0.3 }, { X: path(K2, 1.9).X + 0.5, Y: 0.11, Z: path(K2, 1.9).Z - 0.3 }, 0, span(t, 1.4, 1.9));
        else if (t < 3.3) ball = { X: b.X + 0.7, Y: 0.11 + Math.abs(Math.sin(t * 5)) * 0.15, Z: b.Z - 0.3 };
        else if (t < S.t0) {
          const b0 = path(K2, 3.3), from = { X: b0.X + 0.7, Y: 0.11, Z: b0.Z - 0.3 };
          ball = v.type === "header" ? arc(from, S.from(), 6, span(t, 3.3, S.t0)) : arc(from, { ...S.from(), Y: 0.11 }, 0, span(t, 3.3, S.t0));
        } else if (t < S.t1) ball = arc(S.from(), T, S.peak, span(t, S.t0, S.t1));
        else if (v.goal) { const u = span(t, S.t1, S.t1 + 0.5); ball = { X: 53.4, Y: lerp(T.Y, 0.11, u), Z: T.Z }; }
        else { const u = span(t, S.t1, S.t1 + 0.6), out = { X: 54.8, Y: 0.11, Z: T.Z + (T.Z > mid ? 7 : -7) }; ball = u < 1 ? arc(T, out, 1.2, u) : out; }
        ball.r = 0.11; ball.color = [246, 242, 232];
        return { players: P, ball, flash: v.goal && t > S.t1 && t < S.t1 + 1.1 ? 1 - span(t, S.t1, S.t1 + 1.1) : 0, flashAt: T };
      },
    };
  })();

  // ---------- famous plays ----------
  // On days with nothing on, the greats play, and every other play is a real
  // moment: who was in it, both teams' colors, and the outcome. Spots are the
  // indexes cast() uses (see each sport's actors()).
  const kitC = (jersey, num, short) => ({ jersey, num, short });
  SPORT.court.classics = [
    { cap: "1998 Finals, Game 6. Jordan pulls up over Russell for the title.", F: { shooter: 1, make: true },
      o: kitC("#CE1141", "#FFFFFF", "Bulls"), d: kitC("#F4F4F4", "#4B2E83", "Jazz"),
      names: [[1, "Jordan", "23"], [0, "Pippen", "33"], [6, "Russell", "3"], [5, "Stockton", "12"], [8, "Malone", "32"]] },
    { cap: "2013 Finals, Game 6. Allen backpedals to the corner and ties it.", F: { shooter: 2, make: true },
      o: kitC("#F4F4F4", "#98002E", "Heat"), d: kitC("#1B1B1B", "#C4CED4", "Spurs"),
      names: [[2, "Allen", "34"], [0, "Chalmers", "15"], [1, "James", "6"], [3, "Bosh", "1"], [7, "Parker", "9"], [8, "Duncan", "21"], [6, "Leonard", "2"]] },
    { cap: "1987 Finals, Game 4. Magic's junior sky hook over McHale.", F: { shooter: 3, make: true },
      o: kitC("#552583", "#FDB927", "Lakers"), d: kitC("#F4F4F4", "#007A33", "Celtics"),
      names: [[3, "Magic", "32"], [0, "Scott", "4"], [1, "Worthy", "42"], [8, "McHale", "32"], [5, "Bird", "33"], [9, "Parish", "00"]] },
  ];
  SPORT.gridiron.classics = [
    { cap: "1982 NFC title game. Montana to Clark. The Catch.", F: { run: false, target: 8, caught: true },
      o: kitC("#AA0000", "#FFFFFF", "49ers"), d: kitC("#F4F4F4", "#003594", "Cowboys"),
      names: [[5, "Montana", "16"], [8, "Clark", "87"], [7, "Solomon", "88"], [17, "Walls", "24"]] },
    { cap: "Super Bowl XLII. Manning escapes, and Tyree pins it to his helmet.", F: { run: false, target: 7, caught: true },
      o: kitC("#0B2265", "#FFFFFF", "Giants"), d: kitC("#F4F4F4", "#002244", "Patriots"),
      names: [[5, "Manning", "10"], [7, "Tyree", "85"], [16, "Harrison", "37"]] },
    { cap: "2011 playoffs. Lynch breaks every tackle for 67 yards. Beast Quake.", F: { run: true, yards: 67 },
      o: kitC("#002244", "#69BE28", "Seahawks"), d: kitC("#F4F4F4", "#D3BC8D", "Saints"),
      names: [[6, "Lynch", "24"], [5, "Hasselbeck", "8"]] },
  ];
  SPORT.park.classics = [
    { cap: "1954 World Series. Wertz drives it to deep center. Mays, over the shoulder.", F: { type: "fly", a: 0.04, R: 116 },
      o: kitC("#A2AAAD", "#0C2340", "Indians"), d: kitC("#F4F4F4", "#111111", "Giants"),
      names: [[9, "Wertz", ""], [7, "Mays", "24"], [0, "Liddle", ""]] },
    { cap: "1988 World Series. Gibson, on one good leg, walks it off.", F: { type: "hr", a: 0.42 },
      o: kitC("#F4F4F4", "#005A9C", "Dodgers"), d: kitC("#A2AAAD", "#003831", "Athletics"),
      names: [[9, "Gibson", "23"], [0, "Eckersley", "43"], [8, "Canseco", "33"]] },
    { cap: "1951. Thomson's shot heard 'round the world.", F: { type: "hr", a: -0.5 },
      o: kitC("#F4F4F4", "#111111", "Giants"), d: kitC("#A2AAAD", "#005A9C", "Dodgers"),
      names: [[9, "Thomson", "23"], [0, "Branca", "13"], [6, "Pafko", "48"]] },
  ];
  SPORT.ice.classics = [
    { cap: "1970 Cup Final. Orr scores in overtime and flies.", F: { solo: true, goal: true, high: false }, fly: 0,
      o: kitC("#F4F4F4", "#111111", "Bruins"), d: kitC("#002F87", "#FCB514", "Blues"),
      names: [[0, "Orr", "4"], [1, "Sanderson", "16"], [10, "Hall", "1"]] },
    { cap: "2010 Olympic final. Iginla to Crosby. Golden goal.", F: { solo: false, goal: true, high: false },
      o: kitC("#D80621", "#FFFFFF", "Canada"), d: kitC("#F4F4F4", "#002868", "USA"),
      names: [[0, "Iginla", "12"], [1, "Crosby", "87"], [10, "Miller", "39"]] },
    { cap: "2006. Ovechkin, falling on his back, hooks it in. The Goal.", F: { solo: true, goal: true, high: false }, fall: 0,
      o: kitC("#041E42", "#FFFFFF", "Capitals"), d: kitC("#F4F4F4", "#8C2633", "Coyotes"),
      names: [[0, "Ovechkin", "8"], [10, "Boucher", ""]] },
  ];
  SPORT.pitch.classics = [
    { cap: "2002 Champions League final. Roberto Carlos loops it up, Zidane volleys it in.", F: { type: "volley", goal: true, gy: 2.1, gz: 50.4 },
      o: kitC("#F4F4F4", "#3F2A56", "Real Madrid"), d: kitC("#E32221", "#111111", "Leverkusen"),
      names: [[1, "Roberto Carlos", "3"], [3, "Zidane", "5"], [12, "Butt", "1"]] },
    { cap: "Euro 88 final. Mühren's cross, Van Basten's volley from an impossible angle.", F: { type: "volley", goal: true, gy: 2.2, gz: 45.4 },
      o: kitC("#F36C21", "#FFFFFF", "Netherlands"), d: kitC("#F4F4F4", "#CC0000", "USSR"),
      names: [[1, "Mühren", ""], [3, "Van Basten", "12"], [12, "Dasayev", "1"]] },
    { cap: "2010 World Cup final. Fàbregas finds Iniesta. Spain are champions.", F: { type: "volley", goal: true, gy: 0.5, gz: 49.6 },
      o: kitC("#002F6C", "#F1BF00", "Spain"), d: kitC("#F36C21", "#111111", "Netherlands"),
      names: [[1, "Fàbregas", "10"], [3, "Iniesta", "6"], [12, "Stekelenburg", "1"]] },
  ];
  // college pages get college moments
  const CLASSICS_BY = {
    cbb: [
      { cap: "1992 East final. Hill's long pass, Laettner's turnaround at the buzzer.", F: { shooter: 1, make: true },
        o: kitC("#F4F4F4", "#001A57", "Duke"), d: kitC("#0033A0", "#FFFFFF", "Kentucky"),
        names: [[1, "Laettner", "32"], [0, "Hill", "33"], [6, "Pelphrey", "34"]] },
      { cap: "2016 title game. Arcidiacono drops it back, Jenkins wins it at the horn.", F: { shooter: 4, make: true },
        o: kitC("#13294B", "#FFFFFF", "Villanova"), d: kitC("#F4F4F4", "#7BAFD4", "North Carolina"),
        names: [[4, "Jenkins", "2"], [0, "Arcidiacono", "15"], [9, "Jackson", "44"]] },
      { cap: "1983 title game. Whittenburg's long shot falls short, Charles dunks it home.", F: { shooter: 3, make: true },
        o: kitC("#F4F4F4", "#CC0000", "NC State"), d: kitC("#C8102E", "#FFFFFF", "Houston"),
        names: [[3, "Charles", "43"], [0, "Whittenburg", "25"], [8, "Olajuwon", "34"]] },
      { cap: "1982 title game. A freshman named Jordan hits the winner from the wing.", F: { shooter: 1, make: true },
        o: kitC("#F4F4F4", "#7BAFD4", "North Carolina"), d: kitC("#041E42", "#FFFFFF", "Georgetown"),
        names: [[1, "Jordan", "23"], [0, "Black", "21"], [2, "Worthy", "52"], [8, "Ewing", "33"]] },
    ],
    cfb: [
      { cap: "1984. Flutie scrambles and heaves it, Phelan catches the Hail Mary.", F: { run: false, target: 7, caught: true },
        o: kitC("#F4F4F4", "#98002E", "Boston College"), d: kitC("#F47321", "#005030", "Miami"),
        names: [[5, "Flutie", "22"], [7, "Phelan", "80"]] },
      { cap: "2006 Rose Bowl. Fourth and five, Vince Young runs it in for the title.", F: { run: true, yards: 8 },
        o: kitC("#F4F4F4", "#BF5700", "Texas"), d: kitC("#990000", "#FFC72C", "USC"),
        names: [[6, "Young", "10"]] },
      { cap: "2018 title game. Second and 26 in overtime, Tua finds Smith for the win.", F: { run: false, target: 7, caught: true },
        o: kitC("#9E1B32", "#FFFFFF", "Alabama"), d: kitC("#F4F4F4", "#BA0C2F", "Georgia"),
        names: [[5, "Tagovailoa", "13"], [7, "Smith", "6"]] },
    ],
  };
  // a famous play: its teams in their colors, the named players in their spots
  function famous(sp, f, r) {
    const o = { ...f.o, players: [] }, d = { ...f.d, players: [] };
    const T = { mode: "classic", o, d, kits(spec) {
      const out = [];
      spec.forEach(([role, sd, n]) => { for (let i = 0; i < n; i++) { const k = kitFor(sd === "o" ? o : d, null); k.role = role; out.push(k); } });
      return out;
    } };
    const v = sp.variant(r, T, f.F);
    f.names.forEach(([i, nm, num]) => { const k = v.kits[i]; if (k) { k[0] = nm; k[1] = num; k.anon = false; } });
    v.cap = f.cap; v.fly = "fly" in f; v.fall = "fall" in f;
    return v;
  }

  // ---------- the camera ----------
  // M: extra width drawn on each side, so the view can pan with the ball
  function camera(sp, W, H, M = 0, V = null) {
    const zfit = sp.fitZf || sp.zf;
    const top = V ? (W < 760 ? 0.42 : 0.52) : W < 760 ? 0.3 : 0.36, bot = 0.995;     // venues leave more room for the stands
    const f = (bot - top) * H / (sp.h * (1 / sp.zn - 1 / zfit));
    const hz = top * H - f * sp.h / zfit;
    // keep the action a little right of center on wide screens (the headline sits on the left)
    const cx = sp.ax - (W >= 760 && !sp.centered ? 0.03 * W * sp.az / f : 0);
    return {
      f, hz,
      cx, M, h: sp.h,
      P: (X, Y, Z) => [W / 2 + M + f * (X - cx) / Z, hz + f * (sp.h - Y) / Z],
      s: Z => f / Z,
    };
  }

  // ---------- the still background: sky or roof, stands, field, lights ----------
  function background(kind, Wv, H, dpr, M = 0, V = null) {
    const sp = SPORT[kind], cam = camera(sp, Wv, H, M, V), W = Wv + 2 * M;
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext("2d"); x.scale(dpr, dpr);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const back = cam.P(0, 0, sp.zf + (sp.indoor ? 3 : 6))[1];          // where the stands meet the far side
    let g = x.createLinearGradient(0, 0, 0, back);
    if (V && V.sky) V.sky.forEach(([o, c]) => g.addColorStop(o, c));
    else if (sp.indoor) { g.addColorStop(0, "#07090A"); g.addColorStop(0.7, "#141A1C"); g.addColorStop(1, "#2A2620"); }
    else { g.addColorStop(0, "#0B1418"); g.addColorStop(0.5, "#1D2A33"); g.addColorStop(0.82, "#6B4A3A"); g.addColorStop(1, "#C98A55"); }
    x.fillStyle = g; x.fillRect(0, 0, W, back + 2);
    if (sp.indoor && !V) {
      x.strokeStyle = "rgba(242,238,230,.06)"; x.lineWidth = 1;
      for (let i = 0; i <= 14; i++) { x.beginPath(); x.moveTo(W * i / 14, 0); x.lineTo(W * 0.5 + (i - 7) * W * 0.03, back - H * 0.2); x.stroke(); }
    }
    // stands behind the far side (drawn first, so hoops and posts stand in front of them), with the crowd in them
    const rise = H * (sp.indoor ? 0.24 : 0.18);
    if (V) V.stands(venueKit(x, W, H, back, Math.min(rise, back / 2.3), rnd, cam));      // venues fit everything above the far side
    else {
    g = x.createLinearGradient(0, back - rise, 0, back); g.addColorStop(0, "#1B2420"); g.addColorStop(1, "#0F1613");
    x.fillStyle = g;
    x.beginPath(); x.moveTo(-20, back + 1); x.lineTo(-20, back - rise * 0.35);
    x.quadraticCurveTo(W * 0.5, back - rise * 1.5, W + 20, back - rise * 0.35); x.lineTo(W + 20, back + 1); x.fill();
    const crowd = Math.min(3400, W * 1.6);
    for (let i = 0; i < crowd; i++) {
      const px = rnd() * W, t = px / W, top = back - rise * 0.35 - Math.sin(t * Math.PI) * rise * 0.6;
      const py = top + rnd() * (back - top);
      x.fillStyle = `rgba(${200 + rnd() * 55},${170 + rnd() * 60},${140 + rnd() * 60},${0.1 + rnd() * 0.25})`;
      x.fillRect(px, py, 1.3, 1.3);
    }
    if (sp.indoor) {
      const sw = Math.min(170, W * 0.2), sy = Math.max(8, back - rise * 1.55 - sw * 0.5);
      x.fillStyle = "#0C100E"; x.fillRect(W / 2 - sw / 2, sy, sw, sw * 0.42);
      x.fillStyle = "rgba(229,157,114,.55)"; x.fillRect(W / 2 - sw / 2 + 6, sy + 6, sw - 12, 3);
    }
    }
    // the field (everything below the far edge), drawn through the camera
    x.fillStyle = rgb(sp.surface.map(v => v * 0.55)); x.fillRect(0, back - 2, W, H);
    const P = (X, Z, Y = 0) => cam.P(X, Y, Z);
    const LINE = "rgba(242,238,230,.55)";
    const gfx = {
      fillPoly(pts, color) { x.fillStyle = color; x.beginPath(); pts.forEach(([X, Z], i) => { const p = P(X, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.closePath(); x.fill(); },
      line(pts, wd = 1.4, color = LINE) {
        x.strokeStyle = color; x.lineWidth = wd * Math.max(0.6, Math.min(1.4, cam.f / 420)); x.lineJoin = "round";
        x.beginPath(); pts.forEach(([X, Z], i) => { const p = P(X, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.stroke();
      },
      circle(cx, cz, r, wd, color) { gfx.arcLine(cx, cz, r, 0, Math.PI * 2, wd, color); },
      arcLine(cx, cz, r, a0, a1, wd, color) {
        const pts = []; for (let i = 0; i <= 48; i++) { const a = a0 + (a1 - a0) * i / 48; pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
        gfx.line(pts, wd, color);
      },
      ellipseW(cx, cz, r, color, sweep = Math.PI * 2) {
        const pts = []; for (let i = 0; i <= 36; i++) { const a = -sweep / 2 + sweep * i / 36 + (sweep < 6 ? (cx > 0 ? -Math.PI / 2 : Math.PI / 2) : 0); pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
        gfx.fillPoly(pts, color);
      },
      stripes(x0, x1, z0, z1, k, a, b) {
        for (let i = 0; i < k; i++) { const xa = lerp(x0, x1, i / k), xb = lerp(x0, x1, (i + 1) / k); gfx.fillPoly([[xa, z0], [xb, z0], [xb, z1], [xa, z1]], i % 2 ? a : b); }
      },
      fillRound(x0, z0, x1, z1, r, color) {
        const pts = [], corner = (cx, cz, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
        corner(x1 - r, z0 + r, -Math.PI / 2); corner(x1 - r, z1 - r, 0); corner(x0 + r, z1 - r, Math.PI / 2); corner(x0 + r, z0 + r, Math.PI);
        gfx.fillPoly(pts, color);
      },
      text(v, X, Z, size) {
        const p = P(X, Z), px = size * cam.s(Z);
        x.save(); x.fillStyle = "rgba(242,238,230,.5)"; x.font = `700 ${px.toFixed(1)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
        x.translate(p[0], p[1]); x.scale(1, 0.45); x.fillText(v, 0, 0); x.restore();
      },
      // hardwood: boards running the length of the floor, each plank its own shade
      planks(x0, x1, z0, z1, w, base) {
        for (let z = z0; z < z1; z += w) {
          let X = x0 - rnd() * 3;
          while (X < x1) {
            const len = 1.8 + rnd() * 3.4, k = 0.9 + rnd() * 0.16, X1 = Math.min(x1, X + len);
            gfx.fillPoly([[Math.max(x0, X), z], [X1, z], [X1, Math.min(z1, z + w)], [Math.max(x0, X), Math.min(z1, z + w)]], rgb(base.map(v => v * k)));
            X = X1;
          }
          gfx.line([[x0, z], [x1, z]], 0.5, "rgba(40,22,10,.22)");
        }
      },
      // the shine of a lamp on a polished floor, stretched toward the camera
      sheen(X, Z, rx, rz, a) {
        const p = P(X, Z), sx = rx * cam.s(Z), sz = rz * cam.s(Z) * 0.6;
        x.save(); x.globalCompositeOperation = "screen"; x.translate(p[0], p[1]); x.scale(1, sz / sx);
        const g = x.createRadialGradient(0, 0, 0, 0, 0, sx);
        g.addColorStop(0, `rgba(255,226,180,${a})`); g.addColorStop(0.5, `rgba(255,214,160,${a * 0.35})`); g.addColorStop(1, "rgba(255,210,150,0)");
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, sx, 0, Math.PI * 2); x.fill(); x.restore();
      },
      // an upright panel facing the camera (tables, boards, padding)
      panel(X0, X1, Z, Y0, Y1, color) {
        const a = cam.P(X0, Y1, Z), b = cam.P(X1, Y0, Z);
        x.fillStyle = color; x.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      },
      // things that stand up off the field
      post(X, Z, Y0, Y1, wd, color) { const a = P(X, Z, Y0), b = P(X, Z, Y1); x.strokeStyle = color; x.lineWidth = wd; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); },
      seg3(a, b, wd, color) { const p = cam.P(...a), q = cam.P(...b); x.strokeStyle = color; x.lineWidth = wd; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke(); },
      hoop(s, zc) {
        const bx = s * 13.1, s0 = cam.s(zc), dark = "#15191B";
        // padded base off the baseline, the pole up and over, the arm out to the board
        const bz = zc + 0.5;
        gfx.panel(s * 15.2 - 0.6, s * 15.2 + 0.6, bz, 0, 0.9, "#1B2226");
        gfx.panel(s * 15.2 - 0.6, s * 15.2 + 0.6, bz, 0.78, 0.9, "rgba(229,121,59,.85)");
        gfx.seg3([s * 15.2, 0.9, bz], [s * 15.0, 3.6, zc], Math.max(2, 0.16 * s0), dark);
        gfx.seg3([s * 15.0, 3.6, zc], [bx, 3.45, zc], Math.max(2, 0.12 * s0), dark);
        gfx.seg3([s * 15.05, 2.4, zc], [bx, 3.2, zc], Math.max(1, 0.06 * s0), dark);
        const q = (Y, Z) => cam.P(bx, Y, Z), quad = (y0, y1, z0, z1) => { const pts = [q(y1, z0), q(y1, z1), q(y0, z1), q(y0, z0)]; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); };
        quad(2.95, 4.02, zc - 0.915, zc + 0.915); x.fillStyle = "rgba(220,232,236,.18)"; x.fill();
        x.strokeStyle = "rgba(250,248,242,.95)"; x.lineWidth = Math.max(1.4, 0.05 * s0); x.stroke();
        quad(3.1, 3.55, zc - 0.3, zc + 0.3); x.lineWidth = Math.max(1, 0.035 * s0); x.stroke();      // the shooter's square
        quad(2.9, 2.98, zc - 0.915, zc + 0.915); x.fillStyle = "rgba(229,121,59,.9)"; x.fill();      // padding along the bottom
      },
      goalpost(X, Z) {
        const s0 = cam.s(Z), c = "rgba(238,206,96,.95)", wd = Math.max(1.5, 0.12 * s0);
        gfx.post(X, Z, 0, 3.05, wd, c); gfx.seg3([X, 3.05, Z - 2.82], [X, 3.05, Z + 2.82], wd, c);
        gfx.post(X, Z - 2.82, 3.05, 9, wd, c); gfx.post(X, Z + 2.82, 3.05, 9, wd, c);
      },
      wall(pts, h) {
        x.fillStyle = gfx.V && gfx.V.ivy ? "#24461F" : "#16301E"; x.beginPath();
        pts.forEach(([X, Z], i) => { const p = cam.P(X, h, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); });
        pts.slice().reverse().forEach(([X, Z]) => { const p = cam.P(X, 0, Z); x.lineTo(p[0], p[1]); });
        x.fill();
        if (gfx.V && gfx.V.ivy) {                                       // ivy: leaves in a few greens over the brick
          x.save(); x.clip();
          const a = cam.P(pts[0][0], h, pts[0][1]), b = cam.P(pts[pts.length - 1][0], 0, pts[pts.length - 1][1]);
          const y0 = Math.min(...pts.map(([X, Z]) => cam.P(X, h, Z)[1])), y1 = Math.max(...pts.map(([X, Z]) => cam.P(X, 0, Z)[1]));
          for (let i = 0; i < 2600; i++) {
            const px = lerp(a[0], b[0], rnd()), py = lerp(y0, y1, rnd()), k = rnd();
            x.fillStyle = k < 0.4 ? "#3E6B2E" : k < 0.75 ? "#2F5A26" : k < 0.93 ? "#56853A" : "#7A3B26";
            x.beginPath(); x.arc(px, py, 0.8 + rnd() * 1.2, 0, Math.PI * 2); x.fill();
          }
          x.restore();
          x.strokeStyle = "rgba(240,236,224,.85)"; x.lineWidth = 1.1; x.beginPath();
          pts.forEach(([X, Z], i) => { const p = cam.P(X, h, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.stroke();
          return;
        }
        x.strokeStyle = "rgba(229,121,59,.8)"; x.lineWidth = 1.2; x.beginPath();
        pts.forEach(([X, Z], i) => { const p = cam.P(X, h, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.stroke();
        [pts[0], pts[pts.length - 1]].forEach(([X, Z]) => gfx.post(X, Z, 0, h + 12, 2, "rgba(238,206,96,.9)"));
      },
      // the boards and glass around the far half of the rink, corners and ends included
      boards(L0, L1, zf, r, zm) {
        const pts = [[L0, zm], [L0, zf - r]];
        for (let i = 1; i <= 10; i++) { const a = Math.PI - i / 10 * Math.PI / 2; pts.push([L0 + r + Math.cos(a) * r, zf - r + Math.sin(a) * r]); }
        for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 - i / 10 * Math.PI / 2; pts.push([L1 - r + Math.cos(a) * r, zf - r + Math.sin(a) * r]); }
        pts.push([L1, zm]);
        const band = (y0, y1, color) => {
          x.fillStyle = color; x.beginPath();
          pts.forEach(([X, Z], i) => { const q = cam.P(X, y1, Z); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); });
          pts.slice().reverse().forEach(([X, Z]) => { const q = cam.P(X, y0, Z); x.lineTo(q[0], q[1]); });
          x.closePath(); x.fill();
        };
        band(1.07, 2.6, "rgba(190,215,228,.10)");                     // glass
        band(0, 1.07, "rgba(236,239,240,.96)");                       // boards
        band(0, 0.22, "rgba(226,190,60,.9)");                         // kickplate
        band(1.0, 1.07, "rgba(186,46,46,.9)");                        // top rail
        for (let i = 1; i < 6; i++) {                                 // ad panels along the far side
          const X0 = lerp(L0 + r, L1 - r, i / 6) - 3, X1 = X0 + 6, p0 = cam.P(X0, 0.8, zf), p1 = cam.P(X1, 0.35, zf);
          x.fillStyle = i % 2 ? "rgba(229,121,59,.55)" : "rgba(30,58,44,.6)"; x.fillRect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]);
        }
      },
      net(s, X, Z) {
        const c = "rgba(196,40,40,.95)", s0 = cam.s(Z), wd = Math.max(1.2, 0.06 * s0);
        gfx.post(s * X, Z - 0.91, 0, 1.22, wd, c); gfx.post(s * X, Z + 0.91, 0, 1.22, wd, c);
        gfx.seg3([s * X, 1.22, Z - 0.91], [s * X, 1.22, Z + 0.91], wd, c);
        for (let i = 0; i <= 6; i++) { const z = Z - 0.91 + i * 0.3; gfx.seg3([s * X, 1.22, z], [s * (X + 1.1), 0, z], 0.7, "rgba(242,238,230,.5)"); }
      },
      goal(s, X, Z) {
        const c = "rgba(246,244,238,.95)", s0 = cam.s(Z), wd = Math.max(1.3, 0.1 * s0);
        for (let i = 0; i <= 8; i++) { const z = Z - 3.66 + i * 0.915; gfx.seg3([s * X, 2.44, z], [s * (X + 2), 0, z], 0.7, "rgba(242,238,230,.35)"); }
        gfx.post(s * X, Z - 3.66, 0, 2.44, wd, c); gfx.post(s * X, Z + 3.66, 0, 2.44, wd, c);
        gfx.seg3([s * X, 2.44, Z - 3.66], [s * X, 2.44, Z + 3.66], wd, c);
      },
    };
    gfx.V = V;
    sp.marks(gfx);
    if (V && V.floor) V.floor(gfx, venueKit(x, W, H, back, rise, rnd, cam));
    const lamps = V && V.lamps ? V.lamps : sp.indoor ? [[0.2, 0.18], [0.4, 0.12], [0.6, 0.12], [0.8, 0.18]] : [[0.1, 0.14], [0.3, 0.08], [0.7, 0.08], [0.9, 0.14]];
    lamps.forEach(([fx, fy]) => {
      const lx = W * fx, ly = Math.min(H * fy, back - rise - 10);
      const glow = x.createRadialGradient(lx, ly, 0, lx, ly, W * (sp.indoor ? 0.18 : 0.24));
      glow.addColorStop(0, "rgba(255,240,205,.5)"); glow.addColorStop(0.12, "rgba(255,226,170,.16)"); glow.addColorStop(1, "rgba(255,220,160,0)");
      x.fillStyle = glow; x.fillRect(0, 0, W, H);
      x.fillStyle = "#FFF6E2";
      if (sp.indoor) { x.fillRect(lx - 9, ly - 2, 18, 4); return; }
      x.fillStyle = "#0C110F"; x.fillRect(lx - 1.5, ly, 3, back - rise * 0.5 - ly);
      x.fillStyle = "#FFF6E2";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(lx - 14 + i * 7.5, ly - 8 + j * 6, 5, 4);
    });
    g = x.createLinearGradient(0, back - 50, 0, back + 70); g.addColorStop(0, "rgba(255,230,190,0)"); g.addColorStop(0.5, "rgba(255,230,190,.08)"); g.addColorStop(1, "rgba(255,230,190,0)");
    x.fillStyle = g; x.fillRect(0, back - 50, W, 120);
    const grain = Math.min(30000, W * H / 90);
    for (let i = 0; i < grain; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.03})`; x.fillRect(rnd() * W, rnd() * H, 1, 1); }
    return { canvas: c, cam, back, rise, M, W };
  }

  // ---------- famous venues, seen from the middle of the field ----------
  // A wide panorama (a cylinder around the camera): the far stands straight
  // ahead, the ends wrapping round to the edges. Each venue is built from its
  // real shape: the outline of the seating bowl, its tiers (how far back and how
  // high they go), roofs, boards and the buildings around it.
  function pano(V, W, H, dpr) {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext("2d"); x.scale(dpr, dpr);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const phone = W < 760, FOV = (V.fov || 2.8) * (phone ? 0.6 : 1), f = W / FOV, fy = f * (V.vs || 1);
    const hz = H * (phone ? 0.47 : (V.hz || 0.5)), cam = V.cam, LIM = FOV / 2 + 0.45;
    const P = (X, Y, Z) => {
      const dx = X - cam[0], dz = Z - cam[2], th = Math.atan2(dx, dz), d = Math.max(0.6, Math.hypot(dx, dz));
      return [W / 2 + th * f, hz - (Y - cam[1]) / d * fy, d, th];
    };
    const ok = p => Math.abs(p[3]) < LIM;
    const sub = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n), lerp(a[2], b[2], i / n)]); return o; };
    const trace = pts => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); };
    const area = q => { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
    const T = {
      x, W, H, rnd, P, ok, hz, f, cam, phone,
      // a flat piece of the world, edges bent by the lens
      quad(q, color, n = 4) {
        const pts = [];
        for (let i = 0; i < q.length; i++) sub(q[i], q[(i + 1) % q.length], n).slice(0, -1).forEach(w => pts.push(P(...w)));
        if (!pts.every(ok)) return null;
        trace(pts); x.closePath(); x.fillStyle = color; x.fill(); return pts;
      },
      // a line in the world, px wide
      line(pts3, wd, color, n = 10) {
        x.strokeStyle = color; x.lineWidth = wd; x.lineJoin = "round"; x.lineCap = "round"; x.beginPath();
        let open = false;
        for (let i = 0; i < pts3.length - 1; i++) sub(pts3[i], pts3[i + 1], n).forEach(w => { const p = P(...w); if (!ok(p)) { open = false; return; } if (open) x.lineTo(p[0], p[1]); else { x.moveTo(p[0], p[1]); open = true; } });
        x.stroke();
      },
      // a painted line on the ground, meters wide, thinner with distance
      gline(pts, wm, color, n = 14) {
        x.strokeStyle = color; x.lineCap = "round";
        for (let i = 0; i < pts.length - 1; i++) {
          const s = sub([pts[i][0], 0, pts[i][1]], [pts[i + 1][0], 0, pts[i + 1][1]], n).map(w => P(...w));
          for (let j = 0; j < s.length - 1; j++) {
            if (!ok(s[j]) || !ok(s[j + 1])) continue;
            const d = (s[j][2] + s[j + 1][2]) / 2;
            x.lineWidth = clamp(wm * f * cam[1] / (d * d) * 2.2, 0.5, 3.2);
            x.beginPath(); x.moveTo(s[j][0], s[j][1]); x.lineTo(s[j + 1][0], s[j + 1][1]); x.stroke();
          }
        }
      },
      gcircle(cx, cz, r, wm, color, a0 = 0, a1 = Math.PI * 2) {
        const pts = []; for (let i = 0; i <= 48; i++) { const a = lerp(a0, a1, i / 48); pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
        T.gline(pts, wm, color, 3);
      },
      gpoly(pts, color, n = 6) { return T.quad(pts.map(([X, Z]) => [X, 0, Z]), color, n); },
      gdisc(cx, cz, r, color) { const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); } return T.gpoly(pts, color, 2); },
      // the ground in cells, so it bends with the lens (and can be mown or planked)
      ground(x0, x1, z0, z1, sx, sz, color) {
        for (let X = x0; X < x1 - 1e-6; X += sx) for (let Z = z0; Z < z1 - 1e-6; Z += sz) {
          const c0 = color(X, Z); if (!c0) continue;
          x.strokeStyle = c0; x.lineWidth = 0.8;
          if (T.quad([[X, 0, Z], [Math.min(x1, X + sx), 0, Z], [Math.min(x1, X + sx), 0, Math.min(z1, Z + sz)], [X, 0, Math.min(z1, Z + sz)]], c0, 2)) x.stroke();
        }
      },
      // people in a patch of seats
      crowd(q, fans, dens) {
        const pq = q.map(w => P(...w)); if (!pq.every(ok)) return;
        const n = Math.min(900, area(pq) * 0.09 * dens);
        for (let i = 0; i < n; i++) {
          const u = rnd(), v = rnd(), a = q[0], b = q[1], cc = q[2], d = q[3];
          const w = [0, 1, 2].map(k => lerp(lerp(a[k], b[k], u), lerp(d[k], cc[k], u), v)), p = P(...w), s = clamp(f * 0.5 / p[2], 0.7, 2.4);
          x.fillStyle = fans[Math.floor(rnd() * fans.length)]; x.fillRect(p[0], p[1], s, s * 1.2);
        }
      },
      // a tier of seats (or any sloped or upright band) along an outline
      tier(per, o0, h0, o1, h1, seat, fans = null, dens = 1, where = () => true, rows = 8) {
        const at = (p, o, h) => [p.x + p.nx * o, h, p.z + p.nz * o];
        for (let i = 0; i < per.length - 1; i++) {
          const a = per[i], b = per[i + 1]; if (!where(a) || !where(b)) continue;
          const q = [at(a, o0, h0), at(b, o0, h0), at(b, o1, h1), at(a, o1, h1)];
          if (!T.quad(q, typeof seat === "function" ? seat(a) : seat, 2)) continue;
          if (fans) T.crowd(q, typeof fans === "function" ? fans(a) : fans, dens);
        }
        for (let r = 1; r < rows; r++) {                                 // rows of seats
          let run = [];
          const flush = () => { if (run.length > 1) T.line(run, 0.6, "rgba(0,0,0,.22)", 1); run = []; };
          per.forEach(p => { if (where(p)) run.push(at(p, lerp(o0, o1, r / rows), lerp(h0, h1, r / rows))); else flush(); });
          flush();
        }
        // the back rows sit in shadow
        for (let i = 0; i < per.length - 1; i++) {
          const a = per[i], b = per[i + 1]; if (!where(a) || !where(b)) continue;
          const q = [at(a, lerp(o0, o1, 0.55), lerp(h0, h1, 0.55)), at(b, lerp(o0, o1, 0.55), lerp(h0, h1, 0.55)), at(b, o1, h1), at(a, o1, h1)];
          T.quad(q, "rgba(0,0,0,.16)", 1);
        }
      },
      // a band whose depth and heights blend from A to B along the outline (corners joining two stands)
      blend(per, A, B, seat, fans = null, dens = 1) {
        const at = (p, o, h) => [p.x + p.nx * o, h, p.z + p.nz * o], n = per.length - 1;
        for (let i = 0; i < n; i++) {
          const a = per[i], b = per[i + 1], u = A.map((v, k) => lerp(v, B[k], i / n)), w = A.map((v, k) => lerp(v, B[k], (i + 1) / n));
          const q = [at(a, u[0], u[1]), at(b, w[0], w[1]), at(b, w[2], w[3]), at(a, u[2], u[3])];
          if (!T.quad(q, seat, 2)) continue;
          if (fans) T.crowd(q, fans, dens);
          T.quad([at(a, lerp(u[0], u[2], 0.55), lerp(u[1], u[3], 0.55)), at(b, lerp(w[0], w[2], 0.55), lerp(w[1], w[3], 0.55)), q[2], q[3]], "rgba(0,0,0,.16)", 1);
        }
      },
      // points along a corner arc around (cx, cz), normals pointing out
      arc(cx, cz, r, a0, a1, n = 16) { const o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); o.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r, nx: Math.sin(a), nz: Math.cos(a) }); } return o; },
      // lights in a row along an outline (suite windows, roof lights)
      lights(per, o, h, color, every = 2.2, sz = 1.4, where = () => true) {
        per.forEach((p, i) => { if (!where(p) || i % Math.max(1, Math.round(every)) ) return; const q = P(p.x + p.nx * o, h, p.z + p.nz * o); if (!ok(q)) return; const s = clamp(f * sz / q[2], 1, 6); x.fillStyle = color; x.fillRect(q[0] - s / 2, q[1] - s * 0.3, s, s * 0.6); });
      },
      glow(px, py, r, a, col = "255,232,190") {
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
      },
      lamp(X, Y, Z, r = 1, a = 0.5) { const p = P(X, Y, Z); if (!ok(p)) return; const s = clamp(f * 2.5 * r / p[2], 2, 14); T.glow(p[0], p[1], s * 6, a); x.fillStyle = "#FFF6E2"; x.fillRect(p[0] - s / 2, p[1] - s / 4, s, s / 2); },
      // an upright panel facing the middle (boards, screens, facades): from a to b at heights y0..y1
      panel(a, b, y0, y1, color) { return T.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], color, 6); },
      screen(a, b, y0, y1, frame, glowc) {
        T.panel(a, b, y0, y1, frame);
        const k = 0.06, a2 = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], b2 = [lerp(a[0], b[0], 1 - k), lerp(a[1], b[1], 1 - k)];
        const q = T.panel(a2, b2, y0 + (y1 - y0) * 0.1, y1 - (y1 - y0) * 0.1, glowc);
        if (q) { const m = q.reduce((s, p) => [s[0] + p[0] / q.length, s[1] + p[1] / q.length], [0, 0]); T.glow(m[0], m[1], Math.abs(q[0][0] - q[Math.floor(q.length / 2)][0]) * 0.9, 0.12, "180,210,240"); }
      },
    };
    // outlines of seating bowls, with outward normals
    T.rrect = (hw, hd, r, n = 220) => {
      const out = [], L = 4 * (hw - r) + 4 * (hd - r) + 2 * Math.PI * r;
      for (let i = 0; i <= n; i++) {
        let s = i / n * L, X, Z, nx, nz;
        const segs = [
          [2 * (hw - r), u => [-hw + r + u, hd, 0, 1]],
          [Math.PI * r / 2, u => { const a = u / r; return [hw - r + Math.sin(a) * r, hd - r + Math.cos(a) * r, Math.sin(a), Math.cos(a)]; }],
          [2 * (hd - r), u => [hw, hd - r - u, 1, 0]],
          [Math.PI * r / 2, u => { const a = Math.PI / 2 + u / r; return [hw - r + Math.sin(a) * r, -hd + r + Math.cos(a) * r, Math.sin(a), Math.cos(a)]; }],
          [2 * (hw - r), u => [hw - r - u, -hd, 0, -1]],
          [Math.PI * r / 2, u => { const a = Math.PI + u / r; return [-hw + r + Math.sin(a) * r, -hd + r + Math.cos(a) * r, Math.sin(a), Math.cos(a)]; }],
          [2 * (hd - r), u => [-hw, -hd + r + u, -1, 0]],
          [Math.PI * r / 2, u => { const a = 1.5 * Math.PI + u / r; return [-hw + r + Math.sin(a) * r, hd - r + Math.cos(a) * r, Math.sin(a), Math.cos(a)]; }],
        ];
        for (const [len, fn] of segs) { if (s <= len + 1e-9) { [X, Z, nx, nz] = fn(s); break; } s -= len; }
        out.push({ x: X, z: Z, nx, nz });
      }
      // start at the near middle so the far side is one unbroken run
      let k = 0; out.forEach((p, i) => { if (p.nz < -0.99 && Math.abs(p.x) < Math.abs(out[k].x) + (out[k].nz < -0.99 ? 0 : 1e9)) k = i; });
      return out.slice(k).concat(out.slice(1, k + 1));
    };
    T.oval = (rx, rz, n = 200) => {
      const out = []; for (let i = 0; i <= n; i++) { const a = Math.PI + i / n * Math.PI * 2, X = Math.sin(a) * rx, Z = Math.cos(a) * rz, nx = Math.sin(a) / rx, nz = Math.cos(a) / rz, m = Math.hypot(nx, nz); out.push({ x: X, z: Z, nx: nx / m, nz: nz / m }); } return out;
    };
    T.side = p => p.nz > 0.75 ? "far" : p.nz < -0.75 ? "near" : p.nx > 0.75 ? "right" : p.nx < -0.75 ? "left" : "corner";
    // sky or roof
    const g = x.createLinearGradient(0, 0, 0, hz);
    V.sky.forEach(([o, col]) => g.addColorStop(o, col));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    V.draw(T);
    const grain = Math.min(30000, W * H / 90);
    for (let i = 0; i < grain; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.03})`; x.fillRect(rnd() * W, rnd() * H, 1, 1); }
    // a soft darkening at the bottom so the headline reads
    const v = x.createLinearGradient(0, H * 0.55, 0, H); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.35)");
    x.fillStyle = v; x.fillRect(0, H * 0.55, W, H * 0.45);
    return { canvas: c };
  }

  // fields, courts and rinks laid on the ground (centered on 0,0; length along X)
  const FIELD = {
    gridiron(T, o = {}) {
      const yd = 0.9144, G = 50 * yd, E = 60 * yd, hw = 53.33 * yd / 2;
      T.ground(-E - 14, E + 14, -hw - 12, hw + 14, 4, 4, () => o.apron || "#22482A");
      T.ground(-E, E, -hw, hw, 5 * yd, 4.4, (X) => {
        if (X < -G) return o.ez ? o.ez[0] : "#1E3A2C";
        if (X >= G) return o.ez ? o.ez[1] : "#1E3A2C";
        return Math.floor((X + G) / (5 * yd)) % 2 ? "#2F6A37" : "#2A6132";
      });
      const L = "rgba(246,244,236,.9)";
      T.gline([[-E, -hw], [E, -hw], [E, hw], [-E, hw], [-E, -hw]], 0.3, L);
      for (let i = -10; i <= 10; i++) T.gline([[i * 5 * yd, -hw], [i * 5 * yd, hw]], i % 2 ? 0.12 : 0.2, L, 6);
      for (let i = -49; i <= 49; i++) if (i % 5) [-hw + 0.3, -2.8, 2.8, hw - 0.9].forEach(z => T.gline([[i * yd, z], [i * yd, z + 0.6]], 0.1, L, 1));
      if (o.ezLine) [-1, 1].forEach(s => T.gline([[s * (G + 0.7), -hw + 0.7], [s * (E - 0.7), -hw + 0.7], [s * (E - 0.7), hw - 0.7], [s * (G + 0.7), hw - 0.7], [s * (G + 0.7), -hw + 0.7]], 0.4, o.ezLine));
      [-1, 1].forEach(s => {                                           // goal posts
        const X = s * (E + 0.2), c = "rgba(238,206,96,.95)";
        T.line([[X, 0, 0], [X, 3.05, 0]], 3, c, 2); T.line([[X, 3.05, -2.82], [X, 3.05, 2.82]], 3, c, 4);
        T.line([[X, 3.05, -2.82], [X, 10, -2.82]], 2.5, c, 3); T.line([[X, 3.05, 2.82], [X, 10, 2.82]], 2.5, c, 3);
      });
    },
    pitch(T, o = {}) {
      const L = 52.5, D = 34;
      T.ground(-L - 12, L + 12, -D - 10, D + 10, 4, 4, () => "#24502C");
      T.ground(-L, L, -D, D, 105 / 18, 4.25, X => Math.floor((X + L) / (105 / 18)) % 2 ? "#2F6A37" : "#29602F");
      const C = "rgba(246,244,236,.88)";
      T.gline([[-L, -D], [L, -D], [L, D], [-L, D], [-L, -D]], 0.25, C); T.gline([[0, -D], [0, D]], 0.2, C);
      T.gcircle(0, 0, 9.15, 0.18, C); T.gdisc(0, 0, 0.3, C);
      [-1, 1].forEach(s => {
        T.gline([[s * L, -20.16], [s * (L - 16.5), -20.16], [s * (L - 16.5), 20.16], [s * L, 20.16]], 0.18, C);
        T.gline([[s * L, -9.16], [s * (L - 5.5), -9.16], [s * (L - 5.5), 9.16], [s * L, 9.16]], 0.16, C);
        T.gcircle(s * (L - 11), 0, 9.15, 0.16, C, s > 0 ? -2.21 : 0.93, s > 0 ? -0.93 : 2.21);
        const X = s * L, w = "rgba(250,250,248,.95)";
        T.line([[X, 0, -3.66], [X, 2.44, -3.66], [X, 2.44, 3.66], [X, 0, 3.66]], 3, w, 3);
        for (let i = 0; i <= 8; i++) T.line([[X, 2.44, -3.66 + i * 0.915], [X + s * 2, 0, -3.66 + i * 0.915]], 0.6, "rgba(240,240,236,.35)", 2);
      });
    },
    court(T, o = {}) {
      const L = 14.33, D = 7.62;
      T.ground(-L - 4, L + 4, -D - 4, D + 3, 2.4, 0.5, (X, Z) => { const k = 0.9 + T.rnd() * 0.16, inn = Math.abs(X) < L && Math.abs(Z) < D; const b = inn ? (o.wood || [158, 112, 70]) : o.apron || [92, 62, 40]; return rgb(b.map(v => v * k)); });
      [-1, 1].forEach(s => T.gpoly([[s * L, -2.45], [s * (L - 5.8), -2.45], [s * (L - 5.8), 2.45], [s * L, 2.45]], o.key || "rgba(190,84,38,.8)"));
      T.gdisc(0, 0, 1.83, o.center || "rgba(190,84,38,.8)");
      const C = "rgba(250,246,238,.85)";
      T.gline([[-L, -D], [L, -D], [L, D], [-L, D], [-L, -D]], 0.12, C); T.gline([[0, -D], [0, D]], 0.1, C); T.gcircle(0, 0, 1.83, 0.08, C);
      [-1, 1].forEach(s => {
        T.gline([[s * L, -2.45], [s * (L - 5.8), -2.45], [s * (L - 5.8), 2.45], [s * L, 2.45]], 0.08, C);
        T.gcircle(s * (L - 5.8), 0, 1.83, 0.08, C);
        const k3 = Math.asin(6.7 / 7.24); T.gcircle(s * 12.7, 0, 7.24, 0.08, C, s > 0 ? -Math.PI / 2 - k3 : Math.PI / 2 - k3, s > 0 ? -Math.PI / 2 + k3 : Math.PI / 2 + k3);
        const c3 = 12.7 - 7.24 * Math.cos(k3); T.gline([[s * L, -6.7], [s * c3, -6.7]], 0.08, C); T.gline([[s * L, 6.7], [s * c3, 6.7]], 0.08, C);
        // the basket: stanchion, arm, backboard, rim and net
        const dk = "#15191B", bx = s * 13.1;
        T.quad([[s * 15.6, 0, -0.7], [s * 15.6, 0, 0.7], [s * 15.6, 1.0, 0.7], [s * 15.6, 1.0, -0.7]], "#1B2226", 2);
        T.line([[s * 15.4, 1, 0], [s * 15.2, 3.7, 0], [bx, 3.5, 0]], 4, dk, 4);
        T.quad([[bx, 2.9, -0.915], [bx, 2.9, 0.915], [bx, 4.0, 0.915], [bx, 4.0, -0.915]], "rgba(220,232,236,.22)", 3);
        T.line([[bx, 2.9, -0.915], [bx, 2.9, 0.915], [bx, 4.0, 0.915], [bx, 4.0, -0.915], [bx, 2.9, -0.915]], 2, "rgba(250,248,242,.95)", 3);
        const rim = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; rim.push([s * 12.7 + Math.cos(a) * 0.23, 3.05, Math.sin(a) * 0.23]); }
        T.line(rim, 2, "#E5793B", 1);
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; T.line([[s * 12.7 + Math.cos(a) * 0.23, 3.05, Math.sin(a) * 0.23], [s * 12.7 + Math.cos(a) * 0.12, 2.65, Math.sin(a) * 0.12]], 0.8, "rgba(240,238,230,.75)", 2); }
      });
      if (o.table !== false) { T.panel([-5, D + 1.8], [5, D + 1.8], 0, 0.8, "#111614"); T.panel([-5, D + 1.79], [5, D + 1.79], 0.42, 0.62, "rgba(229,121,59,.8)"); }
    },
    ice(T, o = {}) {
      const L = 30.5, D = 13;
      T.ground(-L - 6, L + 6, -D - 5, D + 4, 3, 3, () => "#22282C");
      const rr = T.rrect(L, D, 8.5, 160);
      const inRink = (X, Z) => { const ax = Math.max(0, Math.abs(X) - (L - 8.5)), az = Math.max(0, Math.abs(Z) - (D - 8.5)); return Math.hypot(ax, az) <= 8.5; };
      T.ground(-L, L, -D, D, 1.5, 1.3, (X, Z) => inRink(X + 0.75, Z + 0.65) ? "#D2DEE3" : null);
      const R = "rgba(196,40,46,.85)", B = "rgba(40,80,176,.85)";
      T.gline([[0, -D], [0, D]], 0.3, R); [-7.6, 7.6].forEach(X => T.gline([[X, -D], [X, D]], 0.3, B));
      [-26.6, 26.6].forEach(X => T.gline([[X, -D + 1.7], [X, D - 1.7]], 0.08, R));
      T.gcircle(0, 0, 4.5, 0.08, B); T.gdisc(0, 0, 0.3, B);
      if (o.dot) T.gdisc(0, 0, 2.4, o.dot);
      [[-22, -6.7], [-22, 6.7], [22, -6.7], [22, 6.7]].forEach(([X, Z]) => { T.gcircle(X, Z, 4.5, 0.08, R); T.gdisc(X, Z, 0.3, R); });
      [-1, 1].forEach(s => {                                            // nets
        const X = s * 26.6, c = "rgba(200,40,40,.95)";
        T.line([[X, 0, -0.91], [X, 1.22, -0.91], [X, 1.22, 0.91], [X, 0, 0.91]], 2.5, c, 3);
        for (let i = 0; i <= 6; i++) T.line([[X, 1.22, -0.91 + i * 0.3], [X + s * 1.1, 0, -0.91 + i * 0.3]], 0.6, "rgba(240,240,236,.5)", 2);
      });
      // the boards: white with a yellow kick plate and red rail, glass above
      T.tier(rr, 0, 0, 0, 1.07, "rgba(238,240,242,.97)", null, 1, () => true, 1);
      if (o.ads) { const ad = rr.map(p => p); for (let i = 0; i < ad.length - 1; i += 3) { const seg = ad.slice(i, i + 3); if (seg.length > 1) T.tier(seg, -0.02, 0.32, -0.02, 0.9, o.ads[(i / 3) % o.ads.length], null, 1, () => true, 1); } }
      T.tier(rr, 0, 0, 0, 0.2, "rgba(226,190,60,.95)", null, 1, () => true, 1);
      T.tier(rr, 0, 1.0, 0, 1.07, "rgba(186,46,46,.95)", null, 1, () => true, 1);
      T.tier(rr, 0, 1.07, 0, 2.5, "rgba(190,215,228,.10)", null, 1, () => true, 1);
    },
  };

  const FANS = (...c) => c;
  const VENUES = {
    // Madison Square Garden: a round building, a bowl that rises steeply, the
    // two bridges hung over the upper level and the famous cable ceiling.
    nba: { kind: "court", name: "Madison Square Garden", city: "New York", cam: [0, 11, -22], hz: 0.33, fov: 1.85, vs: 0.68,
      sky: [[0, "#05070C"], [0.7, "#0D1220"], [1, "#151B2A"]],
      draw(T) {
        const { x, P } = T;
        // the ceiling: a ring of cables from the outer wall to a hub over center court
        const ring = T.oval(64, 58), hub = [0, 44, 0];
        ring.forEach((p, i) => { if (i % 4) return; T.line([[p.x, 36, p.z], hub], 1.2, "rgba(220,224,235,.3)", 12); });
        [1, 0.75, 0.5].forEach(k => T.line(ring.map(p => [p.x * k, 36 + (1 - k) * 8, p.z * k]), 1.2, "rgba(190,200,220,.25)", 1));
        T.lights(ring, 0, 36, "rgba(255,238,205,.95)", 2, 1.2);
        const bowl = T.oval(40, 34), fans = FANS("rgba(30,30,36,.7)", "rgba(240,236,228,.45)", "rgba(245,132,38,.5)", "rgba(29,66,138,.55)", "rgba(210,170,140,.4)");
        T.tier(bowl, 4, 15, 22, 31, "#4A361A", fans, 1.45, p => T.side(p) !== "near", 10);           // upper bowl (gold seats)
        // the bridges, hung over the upper bowl along both sides
        [[-26, 33, 22], [26, 33, 22]].forEach(([X, Y, L]) => { T.quad([[X - L / 2, Y, 28], [X + L / 2, Y, 28], [X + L / 2, Y + 1.6, 28], [X - L / 2, Y + 1.6, 28]], "#0F1422", 6); T.line([[X - L / 2, Y + 0.3, 27.9], [X + L / 2, Y + 0.3, 27.9]], 2, "rgba(255,214,150,.55)", 8); });
        T.tier(bowl, 0, 12, 2, 15, "#0A0E18", null, 1, p => T.side(p) !== "near", 1);              // suites
        T.tier(bowl, -0.05, 12, -0.05, 12.8, "rgba(235,240,255,.85)", null, 1, p => T.side(p) !== "near", 1);   // the white ribbon board
        T.tier(bowl, 21.9, 31, 21.9, 32, "rgba(150,110,255,.6)", null, 1, p => T.side(p) !== "near", 1);
        T.lights(bowl, 1, 13.4, "rgba(255,214,150,.8)", 2, 1.2, p => T.side(p) !== "near");
        const low = T.rrect(21, 13, 5);
        T.tier(low, 0, 0.6, 19, 12, "#54401E", fans, 1.7, p => T.side(p) !== "near", 12);           // lower bowl (gold seats)
        low.forEach((p, i) => { if (i % 7 || T.side(p) === "near") return; T.line([[p.x, 0.8, p.z], [p.x + p.nx * 19, 11.8, p.z + p.nz * 19]], 1, "rgba(20,26,50,.8)", 5); });
        bowl.forEach((p, i) => { if (i % 6 || T.side(p) === "near") return; T.line([[p.x + p.nx * 4, 15.2, p.z + p.nz * 4], [p.x + p.nx * 22, 30.8, p.z + p.nz * 22]], 1, "rgba(20,26,50,.8)", 5); });
        FIELD.court(T, { key: "rgba(29,66,138,.85)", center: "rgba(245,132,38,.85)", apron: [26, 52, 104] });
        // the scoreboard hung over center court, just above the view
        T.screen([-6, 4], [6, 4], 22, 27, "#0B0F18", "rgba(120,170,230,.5)");
      },
    },
    // Cameron Indoor (from the photo): a small, packed gym. A cream ceiling of
    // arched steel trusses with lamps hung in rows, the retired jerseys and
    // banners hung down the far side, a four-sided screen over center court,
    // blue fans on every bleacher, a wood-fronted balcony, a pale maple floor.
    cbb: { kind: "court", name: "Cameron Indoor Stadium", city: "Durham", cam: [0, 8, -17], hz: 0.3, fov: 1.85, vs: 0.68,
      sky: [[0, "#B8AE98"], [0.5, "#8E8572"], [1, "#4C463C"]],
      draw(T) {
        const nn = p => T.side(p) !== "near", box = T.rrect(26, 18, 2);
        // the arched trusses across the ceiling, and the lamps hung between them
        for (let i = -6; i <= 6; i++) {
          const X = i * 4.6, arc = []; for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + k / 16 * Math.PI; arc.push([X, 14 + Math.cos(a) * 9, Math.sin(a) * 20 + 2]); }
          T.line(arc, 2.2, "rgba(120,110,92,.9)", 2); T.line(arc.map(([a, b, c]) => [a, b - 1.2, c]), 1, "rgba(120,110,92,.7)", 2);
          for (let k = -2; k <= 3; k++) T.lamp(X + 2.3, 19, k * 6, 0.5, 0.28);
        }
        // the walls under the balcony and the stands at the ends
        T.tier(box, 0, 0, 0, 13, "#4A4236", null, 1, () => true, 1);
        // banners: retired jerseys (white with a number) and title banners (navy)
        for (let i = -9; i <= 9; i++) { const X = i * 2.6, nav = i % 3 === 0; T.quad([[X - 0.8, 21, 17.6], [X + 0.8, 21, 17.6], [X + 0.8, 15.5, 17.6], [X - 0.8, 15.5, 17.6]], nav ? "#0B2A6B" : "rgba(244,244,240,.95)", 2); T.quad([[X - 0.5, 19, 17.5], [X + 0.5, 19, 17.5], [X + 0.5, 17.3, 17.5], [X - 0.5, 17.3, 17.5]], nav ? "rgba(244,244,240,.9)" : "#0B2A6B", 1); }
        const blue = FANS("rgba(30,90,220,.75)", "rgba(20,60,170,.75)", "rgba(245,245,240,.5)", "rgba(220,180,150,.4)", "rgba(25,30,45,.6)");
        T.tier(T.rrect(25, 17, 2), -6, 7, 0, 12, "#2A3550", blue, 1.8, nn, 7);      // balcony
        T.tier(T.rrect(25, 17, 2), -6, 6.6, -6, 7.4, "#8A6A3E", null, 1, nn, 1);   // its wood front
        T.tier(T.rrect(16.5, 9.5, 1), 0, 0.3, 7, 5.5, "#24304A", blue, 2.6, nn, 10);
        FIELD.court(T, { key: "rgba(0,48,135,.9)", center: "rgba(0,48,135,.9)", apron: [176, 140, 98], wood: [200, 160, 112], table: false });
        // the four-sided screen over center court
        T.panel([-2.6, -2], [2.6, -2], 12.5, 15.5, "#1A1E26"); T.screen([-2.6, 2], [2.6, 2], 12.5, 15.5, "#1A1E26", "rgba(60,110,200,.75)");
        T.line([[0, 15.5, 0], [0, 22, 0]], 1, "rgba(80,80,80,.8)", 2);
      },
    },
    // Bell Centre (from the photo): three steep bowls of dark seats full of fans,
    // a ring of LED boards between the decks, white boards covered in sponsor
    // panels under the glass, the CH at center ice, a big blue screen hung over it.
    nhl: { kind: "ice", name: "Bell Centre", city: "Montreal", cam: [0, 12, -26], hz: 0.33, fov: 1.85, vs: 0.68,
      sky: [[0, "#040507"], [0.7, "#0B0C10"], [1, "#15161B"]],
      draw(T) {
        const fans = FANS("rgba(26,26,32,.8)", "rgba(48,46,52,.75)", "rgba(200,30,45,.6)", "rgba(235,232,226,.45)", "rgba(25,33,104,.55)", "rgba(210,170,140,.4)");
        const up = T.rrect(54, 38, 14), mid = T.rrect(42, 26, 10), low = T.rrect(33.5, 16, 8.5);
        const nn = p => T.side(p) !== "near";
        // banners and the retired numbers in the rafters
        for (let i = -6; i <= 6; i++) { const X = i * 4.5; T.quad([[X - 1.3, 40, 30], [X + 1.3, 40, 30], [X + 1.3, 34, 30], [X - 1.3, 34, 30]], "rgba(242,240,236,.85)", 2); T.quad([[X - 1.3, 38.8, 29.9], [X + 1.3, 38.8, 29.9], [X + 1.3, 38.1, 29.9], [X - 1.3, 38.1, 29.9]], "#AF1E2D", 1); T.quad([[X - 1.3, 37.6, 29.9], [X + 1.3, 37.6, 29.9], [X + 1.3, 37.2, 29.9], [X - 1.3, 37.2, 29.9]], "#192168", 1); }
        T.tier(up, 0, 21, 16, 36, "#5A131B", fans, 1.4, nn, 12);
        T.tier(up, -0.1, 36, -0.1, 37.4, "#0A0A0D", null, 1, nn, 1);
        T.lights(up, -0.2, 36.6, "rgba(140,190,255,.8)", 3, 1.6, nn);
        // the deck between: suites, and a lit ribbon of boards running all the way round
        T.tier(mid, 0, 15, 12, 21, "#09090C", null, 1, nn, 1);
        T.tier(mid, 0, 15, 0, 16.4, "rgba(60,214,206,.85)", null, 1, nn, 1);
        T.tier(mid, -0.05, 15.5, -0.05, 15.9, "rgba(240,240,250,.8)", null, 1, p => nn(p) && Math.sin(p.x * 0.35) > 0.2, 1);
        T.lights(mid, 6, 18.5, "rgba(255,214,150,.75)", 2, 1.4, nn);
        T.tier(low, 0, 1.2, 10, 14, "#661520", fans, 1.65, nn, 12);
        FIELD.ice(T, { boards: "rgba(244,244,246,.98)", ads: ["#1F4BA5", "#C8102E", "#F2F2F2", "#0D7A3E", "#F2B705", "#1A1A1A"] });
        // the CH at center ice: a red oval, a white band, the blue ring
        T.gdisc(0, 0, 3.6, "rgba(175,30,45,.75)"); T.gdisc(0, 0, 2.5, "rgba(236,240,244,.9)");
        T.gcircle(0, 0, 3.6, 0.12, "rgba(25,33,104,.8)");
        T.gline([[-1.6, -0.9], [-1.6, 0.9], [0.1, 0.9]], 0.35, "rgba(175,30,45,.9)", 3); T.gline([[-1.6, -0.9], [0.1, -0.9]], 0.35, "rgba(175,30,45,.9)", 3);
        T.gline([[0.6, -0.9], [0.6, 0.9]], 0.3, "rgba(25,33,104,.9)", 3); T.gline([[1.8, -0.9], [1.8, 0.9]], 0.3, "rgba(25,33,104,.9)", 3); T.gline([[0.6, 0], [1.8, 0]], 0.3, "rgba(25,33,104,.9)", 3);
        // the big screen hung over center ice, blue faces with a white band
        T.panel([-6, 3], [6, 3], 25.5, 26.6, "rgba(240,244,250,.9)");
        T.screen([-6, 3], [6, 3], 19, 25.5, "#08090C", "rgba(30,40,70,.9)");
        T.panel([-5.4, 2.9], [5.4, 2.9], 19.2, 19.9, "rgba(60,214,206,.8)");
        // the flags of Quebec, Canada and the US hung with the banners
        [[-16, ["#1B4FA0", "#F4F4F4"]], [-12, ["#D52B1E", "#F4F4F4"]], [-8, ["#B22234", "#3C3B6E"]]].forEach(([X, c]) => { T.quad([[X - 1.5, 41, 29.5], [X + 1.5, 41, 29.5], [X + 1.5, 35, 29.5], [X - 1.5, 35, 29.5]], c[0], 2); T.quad([[X - 0.5, 41, 29.4], [X + 0.5, 41, 29.4], [X + 0.5, 35, 29.4], [X - 0.5, 35, 29.4]], c[1], 1); });
      },
    },
    // Lambeau (from the photo): one continuous bowl of bench seats packed with
    // fans, a long low glass building along the top of the far side, the open
    // frame light towers standing above it, video boards over the end zones,
    // gold-lettered green end zones. Late afternoon, high cloud.
    nfl: { kind: "gridiron", name: "Lambeau Field", city: "Green Bay", cam: [0, 24, -55], hz: 0.252, fov: 1.85, vs: 0.68,
      sky: [[0, "#2A3A52"], [0.5, "#5D6F88"], [0.85, "#A9AAB0"], [1, "#C8C2B8"]],
      draw(T) {
        const bowl = T.rrect(68, 38, 26), nn = p => T.side(p) !== "near";
        const gb = FANS("rgba(40,44,50,.7)", "rgba(240,236,228,.55)", "rgba(255,182,18,.6)", "rgba(32,85,60,.7)", "rgba(120,110,100,.55)", "rgba(230,190,160,.35)");
        // the light towers: open rectangular frames on two legs, over the far side
        for (let i = -3; i <= 3; i++) {
          const X = i * 34, Z = 74, c = "rgba(70,74,78,.95)";
          T.line([[X - 5, 30, Z], [X - 5, 52, Z]], 2, c, 2); T.line([[X + 5, 30, Z], [X + 5, 52, Z]], 2, c, 2);
          T.line([[X - 7, 52, Z], [X + 7, 52, Z], [X + 7, 57, Z], [X - 7, 57, Z], [X - 7, 52, Z]], 2, c, 2);
          T.line([[X - 7, 54.5, Z], [X + 7, 54.5, Z]], 1.2, c, 2);
          for (let k = -5; k <= 5; k += 2) T.lamp(X + k, 56, Z - 0.3, 0.45, 0.18);
        }
        // the glass suites that ring the top of the bowl
        T.tier(bowl, 39, 26, 39, 36, "#3A4E44", null, 1, nn, 1);
        T.tier(bowl, 38.9, 27.5, 38.9, 34.5, "rgba(120,150,150,.75)", null, 1, nn, 1);
        T.tier(bowl, 38.85, 30.8, 38.85, 31.3, "rgba(30,44,40,.9)", null, 1, nn, 1);
        T.lights(bowl, 38.8, 29, "rgba(255,236,200,.5)", 2, 1.2, nn);
        T.tier(bowl, 39, 36, 39, 36.6, "#4A5E52", null, 1, nn, 1);
        // the bowl: rows of aluminum benches, every seat full, yellow rails on the aisles
        T.tier(bowl, 0, 0, 0, 1.4, "#1C3029", null, 1, nn, 1);
        T.tier(bowl, 0, 1.4, 38, 26, "#5A5E64", gb, 1.9, nn, 16);
        bowl.forEach((p, i) => { if (i % 9 || !nn(p)) return; T.line([[p.x, 1.6, p.z], [p.x + p.nx * 37, 25.8, p.z + p.nz * 37]], 1.1, "rgba(255,196,30,.75)", 6); });
        T.line(bowl.filter(nn).map(p => [p.x, 1.5, p.z]), 1.6, "rgba(255,196,30,.9)", 1);
        T.line(bowl.filter(nn).map(p => [p.x + p.nx * 38, 26.2, p.z + p.nz * 38]), 1.4, "rgba(255,196,30,.85)", 1);
        // the video boards over each end zone, on the rim
        [-1, 1].forEach(s => { const X = s * 104; T.screen([X, -22], [X, 22], 28, 44, "#1E2A26", "rgba(120,170,200,.55)"); T.panel([X, -22], [X, 22], 44, 46.5, "#C8102E"); T.line([[X, 0, -12], [X, 28, -12]], 3, "#1E2A26", 2); T.line([[X, 0, 12], [X, 28, 12]], 3, "#1E2A26", 2); });
        FIELD.gridiron(T, { ez: ["#203731", "#203731"], ezLine: "rgba(255,182,18,.95)", apron: "#24472C" });
        [-1, 1].forEach(s => { for (let k = -3; k <= 3; k++) T.gpoly([[s * 51.5, k * 3 - 1], [s * 53.5, k * 3 - 1], [s * 53.5, k * 3 + 1], [s * 51.5, k * 3 + 1]], "rgba(255,182,18,.85)", 1); });
      },
    },
    // Michigan Stadium: the biggest bowl in America, dug into the ground, so it's
    // low and enormous; almost no roof line, just endless rows of maize; the
    // press box tower on one side; boards at both ends; the block M.
    cfb: { kind: "gridiron", name: "Michigan Stadium", city: "Ann Arbor", cam: [0, 24, -55], hz: 0.25, fov: 1.85, vs: 0.68,
      sky: [[0, "#2B4A78"], [0.55, "#5C7FAE"], [0.85, "#C9A27E"], [1, "#EBC08C"]],
      draw(T) {
        // trees and the town beyond the rim
        const far = T.rrect(200, 160, 60);
        T.tier(far, 0, 0, 0, 14, "#2F4A34", null, 1, () => true, 1);
        T.tier(far, 0, 10, 0, 18, "rgba(60,90,64,.7)", null, 1, p => Math.sin(p.x * 0.3) > 0, 1);
        const bowl = T.rrect(62, 34, 24), maize = FANS("rgba(255,203,5,.7)", "rgba(255,203,5,.62)", "rgba(255,214,60,.55)", "rgba(0,39,76,.55)", "rgba(245,240,230,.35)");
        // the press box: three glass decks on a tower over the far side
        T.quad([[-60, 18, 106], [60, 18, 106], [60, 44, 106], [-60, 44, 106]], "#1E3558", 8);
        [[22, 27], [30, 35], [37.5, 42]].forEach(([y0, y1], i) => T.quad([[-58, y0, 105.8], [58, y0, 105.8], [58, y1, 105.8], [-58, y1, 105.8]], i === 1 ? "rgba(255,214,150,.55)" : "rgba(120,160,210,.5)", 8));
        T.quad([[-60, 44, 105.7], [60, 44, 105.7], [60, 45.4, 105.7], [-60, 45.4, 105.7]], "#C9D2DC", 8);
        // the red brick towers at each end of the press box
        [-1, 1].forEach(s => { const X = s * 66; T.quad([[X - 6, 14, 104], [X + 6, 14, 104], [X + 6, 47, 104], [X - 6, 47, 104]], "#8A4632", 4); T.quad([[X - 1.6, 20, 103.8], [X + 1.6, 20, 103.8], [X + 1.6, 42, 103.8], [X - 1.6, 42, 103.8]], "rgba(120,160,200,.55)", 4); T.quad([[X - 6.5, 47, 103.9], [X + 6.5, 47, 103.9], [X + 6.5, 48.4, 103.9], [X - 6.5, 48.4, 103.9]], "#D8D2C8", 4); });
        // the bowl: shallow and huge, every row full
        T.tier(bowl, 0, 0, 0, 0.6, "#00274C", null, 1, p => T.side(p) !== "near", 1);
        T.tier(bowl, 0, 0.6, 70, 18, "#56708F", maize, 1.7, p => T.side(p) !== "near", 18);
        T.tier(bowl, 70, 18, 71, 19.5, "#00274C", null, 1, p => T.side(p) !== "near", 1);
        T.tier(bowl, 71, 19.5, 71.4, 20.1, "#FFCB05", null, 1, p => T.side(p) !== "near", 1);
        // boards at both ends, standing on the rim
        [-1, 1].forEach(s => { const X = s * 134; T.screen([X, -24], [X, 24], 24, 40, "#0E1626", "rgba(255,203,5,.42)"); T.line([[X, 18, -16], [X, 24, -16]], 3, "#0E1626", 1); T.line([[X, 18, 16], [X, 24, 16]], 3, "#0E1626", 1); });
        FIELD.gridiron(T, { ez: ["#00274C", "#00274C"], ezLine: "rgba(255,203,5,.95)", apron: "#5A3A30" });
        const M = [[0, 0], [0.28, 0], [0.28, 0.52], [0.5, 0.22], [0.72, 0.52], [0.72, 0], [1, 0], [1, 1], [0.74, 1], [0.5, 0.62], [0.26, 1], [0, 1]];
        const pts = M.map(([u, v]) => [(u - 0.5) * 9, -4 + v * 8]);
        T.gpoly(pts, "rgba(255,203,5,.95)"); T.gline([...pts, pts[0]], 0.25, "rgba(0,39,76,.95)", 3);
      },
    },
    // Wrigley: from the mound. Ivy on the brick wall, the bleachers, the green
    // scoreboard with its clock and flags, the rooftops across the street, and
    // the old double-deck grandstand running down both lines.
    mlb: { kind: "park", name: "Wrigley Field", city: "Chicago", cam: [0, 20, -34], hz: 0.3, fov: 1.85,
      sky: [[0, "#14223E"], [0.5, "#3C4E73"], [0.82, "#C98262"], [1, "#F2B278"]],
      draw(T) {
        const { x, rnd } = T, R = a => 109 + 13 * Math.cos(a * 2) - 1.5 * Math.sin(a);
        const wall = []; for (let i = 0; i <= 90; i++) { const a = -Math.PI / 4 + i / 90 * Math.PI / 2; wall.push({ x: Math.sin(a) * R(a), z: Math.cos(a) * R(a), nx: Math.sin(a), nz: Math.cos(a) }); }
        // grass everywhere inside the park (fair and foul), the track by the wall; drawn first, under the stands
        T.ground(-200, 200, -30, 200, 4, 4, (X, Z) => {
          X += 2; Z += 2; const a = Math.atan2(X, Z), r = Math.hypot(X, Z);
          if (Math.abs(a) < Math.PI / 4 + 0.03 && r > R(a)) return null;
          if (Math.abs(a) < Math.PI / 4 + 0.03 && r > R(a) - 4.6) return "#7A5236";
          return Math.floor((X + 200) / 8) % 2 ? "#2F6A37" : "#2A6132";
        });
        // rooftops across Waveland and Sheffield, with their own bleachers on top
        [[-1, -0.62, -0.18], [1, 0.18, 0.62]].forEach(([s, a0, a1]) => {
          for (let a = a0; a < a1; a += 0.055 + rnd() * 0.03) {
            const r = 162, hgt = 19 + rnd() * 9, b = a + 0.045, p0 = [Math.sin(a) * r, Math.cos(a) * r], p1 = [Math.sin(b) * r, Math.cos(b) * r];
            T.panel(p0, p1, 0, hgt, ["#4E2C24", "#5E3A2C", "#463630", "#3B2B26"][Math.floor(rnd() * 4)]);
            for (let w = 0; w < 6; w++) if (rnd() < 0.6) { const u = 0.1 + w * 0.14, q0 = [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)], q1 = [lerp(p0[0], p1[0], u + 0.07), lerp(p0[1], p1[1], u + 0.07)]; T.panel(q0, q1, hgt * 0.4, hgt * 0.55, "rgba(255,214,150,.6)"); }
            T.line([[p0[0], hgt, p0[1]], [p0[0], hgt + 5, p0[1]], [p1[0], hgt + 2, p1[1]], [p1[0], hgt, p1[1]]], 1.2, "rgba(25,25,28,.95)", 2);
            T.crowd([[p0[0], hgt, p0[1]], [p1[0], hgt, p1[1]], [p1[0], hgt + 2, p1[1]], [p0[0], hgt + 5, p0[1]]], FANS("rgba(14,51,134,.8)", "rgba(240,236,228,.7)", "rgba(204,52,51,.7)"), 1.2);
          }
        });
        // the bleachers behind the ivy, and the scoreboard on top of center field
        const cubs = FANS("rgba(14,51,134,.65)", "rgba(240,236,228,.55)", "rgba(204,52,51,.5)", "rgba(230,190,160,.35)");
        T.tier(wall, 0.3, 3.5, 26, 15, "#1F4A2C", cubs, 1.8, () => true, 12);
        // the two video boards added in left and right field: tall grey boxes on legs
        [-1, 1].forEach(sd => {
          const a = sd * 0.56, r = 134, c = [Math.sin(a) * r, Math.cos(a) * r], t = [Math.cos(a), -Math.sin(a)], hw = 11;
          const A = [c[0] - t[0] * hw, c[1] - t[1] * hw], B = [c[0] + t[0] * hw, c[1] + t[1] * hw];
          T.line([[A[0], 10, A[1]], [A[0], 18, A[1]]], 3, "#55595C", 2); T.line([[B[0], 10, B[1]], [B[0], 18, B[1]]], 3, "#55595C", 2);
          T.panel(A, B, 18, 40, "#8C8F8E"); T.panel(A, B, 38.5, 40, "#6E7271");
          const k = 0.08, A2 = [lerp(A[0], B[0], k), lerp(A[1], B[1], k)], B2 = [lerp(A[0], B[0], 1 - k), lerp(A[1], B[1], 1 - k)];
          T.screen(A2, B2, 21, 36, "#2A2E30", "rgba(70,120,190,.55)");
        });
        const sbA = [-12, 152], sbB = [12, 152];
        T.panel(sbA, sbB, 13, 27, "#1E4D2B"); T.panel(sbA, sbB, 25, 27, "#183F23");
        for (let r = 0; r < 4; r++) for (let k = 0; k < 12; k++) { const u0 = 0.05 + k * 0.075, y0 = 15 + r * 2.4; T.panel([lerp(-12, 12, u0), 151.8], [lerp(-12, 12, u0 + 0.055), 151.8], y0, y0 + 1.7, rnd() < 0.7 ? "rgba(236,230,212,.95)" : "rgba(20,40,26,.95)"); }
        T.panel([-2.4, 152], [2.4, 152], 27, 31.5, "#1E4D2B");
        const ck = T.P(0, 29.3, 151.7), cr = clamp(T.f * 1.8 / ck[2], 3, 30);
        x.fillStyle = "#F2EEE2"; x.beginPath(); x.arc(ck[0], ck[1], cr, 0, Math.PI * 2); x.fill();
        x.strokeStyle = "#1A1A1A"; x.lineWidth = Math.max(1, cr * 0.12); x.beginPath(); x.moveTo(ck[0], ck[1]); x.lineTo(ck[0], ck[1] - cr * 0.7); x.moveTo(ck[0], ck[1]); x.lineTo(ck[0] + cr * 0.5, ck[1] + cr * 0.15); x.stroke();
        [-9, -3, 3, 9].forEach((X, i) => { T.line([[X, 27, 152], [X, 36, 152]], 1, "#D8D8D0", 2); T.quad([[X, 36, 151.9], [X + 3, 35, 151.9], [X, 34, 151.9]], ["#0E3386", "#CC3433", "#F2EEE2", "#0E3386"][i], 2); });
        // the ivy wall, brick showing through, white line on top
        T.tier(wall, 0, 0, 0, 3.5, "#24461F", null, 1, () => true, 1);
        for (let i = 0; i < 2600; i++) { const k = Math.floor(rnd() * (wall.length - 1)), p = wall[k], a = rnd(), q = T.P(p.x + (wall[k + 1].x - p.x) * a, rnd() * 3.5, p.z + (wall[k + 1].z - p.z) * a); if (!T.ok(q)) continue; const s = clamp(T.f * 0.35 / q[2], 0.7, 2.5), c0 = rnd(); x.fillStyle = c0 < 0.4 ? "#3E6B2E" : c0 < 0.75 ? "#2F5A26" : c0 < 0.93 ? "#56853A" : "#7A3B26"; x.fillRect(q[0], q[1], s, s); }
        T.line(wall.map(p => [p.x, 3.5, p.z]), 1.4, "rgba(240,236,224,.85)", 1);
        // the corners where the lower deck curves around into the bleachers
        [-1, 1].forEach(s => {
          const c = []; for (let i = 0; i <= 14; i++) { const t = i / 14, a = Math.PI * (0.75 - 0.5 * t);
            c.push({ x: s * lerp(84.8, 76.3, t), z: lerp(62.2, 76.3, t), nx: s * Math.sin(a), nz: Math.cos(a) }); }
          if (s < 0) c.reverse();
          T.blend(c, [0, 1, 20, 9], [0.3, 3.5, 26, 15], "#1D3D2A", cubs, 1.5);   // low seats only: the upper deck and roof stop short of the pole
        });
        // the grandstand down both lines: lower deck, upper deck, roof, lights on top
        [-1, 1].forEach(s => {
          const line = []; for (let d = 104; d >= 6; d -= 2) line.push({ x: s * d * Math.SQRT1_2 + s * 16 * Math.SQRT1_2, z: d * Math.SQRT1_2 - 16 * Math.SQRT1_2, nx: s * Math.SQRT1_2, nz: -Math.SQRT1_2 });
          T.tier(line, 0, 1, 20, 9, "#1D3D2A", cubs, 1.5, () => true, 10);
          T.tier(line, 20, 9, 20, 12, "#6A3A2A", null, 1, () => true, 1);
          T.tier(line, 14, 12, 32, 22, "#1D3D2A", cubs, 1.3, () => true, 8);
          T.tier(line, 8, 26, 34, 27, "#1B1E22", null, 1, () => true, 1);
          // the white lattice light towers on the grandstand roof
          line.forEach((p, i) => { if (i % 9 !== 4) return; const bx = p.x + p.nx * 22, bz = p.z + p.nz * 22, tx = -p.nz, tz = p.nx, c = "rgba(236,236,230,.9)";
            T.line([[bx - tx * 3, 27, bz - tz * 3], [bx - tx * 2, 36, bz - tz * 2], [bx + tx * 2, 36, bz + tz * 2], [bx + tx * 3, 27, bz + tz * 3]], 1.3, c, 2);
            T.line([[bx - tx * 2, 36, bz - tz * 2], [bx + tx * 3, 27, bz + tz * 3]], 0.8, c, 2); T.line([[bx + tx * 2, 36, bz + tz * 2], [bx - tx * 3, 27, bz - tz * 3]], 0.8, c, 2);
            T.line([[bx - tx * 4, 36, bz - tz * 4], [bx + tx * 4, 36, bz + tz * 4], [bx + tx * 4, 40, bz + tz * 4], [bx - tx * 4, 40, bz - tz * 4], [bx - tx * 4, 36, bz - tz * 4]], 1.4, c, 2);
            for (let k = -3; k <= 3; k += 2) T.lamp(bx + tx * k, 38.5, bz + tz * k, 0.4, 0.2); });
          const pole = [s * 76.3, 76.3]; T.line([[pole[0], 0, pole[1]], [pole[0], 20, pole[1]]], 2.5, "rgba(238,206,96,.95)", 2);
        });
        // the field: grass, the warning track, the infield dirt and the bases
        const dirt = []; for (let i = 0; i <= 40; i++) { const a = -Math.PI / 4 - 0.12 + i / 40 * (Math.PI / 2 + 0.24); dirt.push([Math.sin(a) * 29, Math.cos(a) * 29]); }
        T.gpoly([[-5, -4], [5, -4], ...dirt.slice().reverse()].reverse(), "#9A6440", 6);
        T.gpoly([[0, 3.6], [16, 19.4], [0, 35.2], [-16, 19.4]], "#2C6534", 6);
        T.gdisc(0, 18.4, 2.7, "#A56B44"); T.gdisc(0, 0, 4, "#9A6440");
        T.gpoly([[-0.22, -0.2], [0.22, -0.2], [0.22, 0.1], [0, 0.32], [-0.22, 0.1]], "rgba(250,250,248,.95)", 1);
        T.gline([[0, 0], [-80, 80]], 0.12, "rgba(246,244,236,.9)"); T.gline([[0, 0], [80, 80]], 0.12, "rgba(246,244,236,.9)");
        [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]].forEach(([X, Z]) => T.gpoly([[X - 0.25, Z - 0.25], [X + 0.25, Z - 0.25], [X + 0.25, Z + 0.25], [X - 0.25, Z + 0.25]], "rgba(250,250,248,.95)", 1));
      },
    },
    // Anfield: from the center circle. The Main Stand's three tiers under a deep
    // roof straight ahead, the Kop rising on the left, the Anfield Road end on the right.
    soccer: { kind: "pitch", name: "Anfield", city: "Liverpool", cam: [0, 26, -62], hz: 0.25, fov: 1.85, vs: 0.68,
      sky: [[0, "#0E1624"], [0.55, "#25314A"], [0.86, "#6E4E44"], [1, "#B88258"]],
      draw(T) {
        const red = FANS("rgba(200,16,46,.65)", "rgba(200,16,46,.55)", "rgba(245,240,235,.42)", "rgba(230,190,160,.3)");
        const st = T.rrect(62, 41, 3), side = T.side;
        // the far corners, filled in so the Kop and the Anfield Road end meet the Main Stand
        const kc = T.arc(-59, 38, 3, -Math.PI / 2, 0), rc = T.arc(59, 38, 3, 0, Math.PI / 2);
        T.blend(kc, [0, 1, 42, 26], [0, 1, 44, 34], "#741020", red, 1.5);
        T.blend(kc, [36, 31, 48, 30], [20, 39, 48, 40], "#D9DCDE");
        T.blend(rc, [0, 1, 44, 34], [0, 1, 30, 20], "#741020", red, 1.5);
        T.blend(rc, [20, 39, 48, 40], [8, 24, 32, 25], "#D9DCDE");
        // the Kop: one huge tier behind the goal on the left, roof over it
        T.tier(st, 0, 1, 42, 26, "#7A0E1C", red, 1.8, p => side(p) === "left", 16);
        T.tier(st, 36, 31, 48, 30, "#D9DCDE", null, 1, p => side(p) === "left", 1);
        T.lights(st, 37, 30.6, "rgba(255,248,226,.95)", 3, 1.6, p => side(p) === "left");
        // the Main Stand: lower tier, boxes, upper tier, a third tier, a deep roof lit along its edge
        const ms = p => side(p) === "far";
        T.tier(st, 0, 1, 18, 9, "#8A1020", red, 1.6, ms, 10);
        T.tier(st, 18, 9, 18, 12, "#101216", null, 1, ms, 1); T.lights(st, 17.9, 10.5, "rgba(255,214,150,.75)", 1, 1.2, ms);
        T.tier(st, 14, 12, 32, 22, "#7A0E1C", red, 1.4, ms, 10);
        T.tier(st, 28, 24, 44, 34, "#6E0C18", red, 1.2, ms, 8);
        T.tier(st, 20, 39, 48, 40, "#E2E4E6", null, 1, ms, 1);
        T.tier(st, 20, 40, 20, 44, "rgba(150,154,158,.25)", null, 1, ms, 1);
        st.forEach((p, i) => { if (i % 2 || !ms(p)) return; const a = [p.x + p.nx * 20, 40, p.z + p.nz * 20]; T.line([a, [a[0], 44, a[2] + 3], [st[Math.min(st.length - 1, i + 2)].x + p.nx * 20, 40, st[Math.min(st.length - 1, i + 2)].z + p.nz * 20]], 1, "rgba(120,124,128,.9)", 3); });
        T.line(st.filter(ms).map(p => [p.x + p.nx * 20, 44, p.z + p.nz * 20 + 3]), 1.6, "rgba(120,124,128,.95)", 1);
        T.lights(st, 21, 38.6, "rgba(255,248,226,1)", 1, 2, ms);
        // the Anfield Road end on the right: two tiers, a lower roof
        const ar = p => side(p) === "right";
        T.tier(st, 0, 1, 16, 8, "#8A1020", red, 1.6, ar, 8); T.tier(st, 12, 10, 30, 20, "#7A0E1C", red, 1.3, ar, 8);
        T.tier(st, 8, 24, 32, 25, "#D9DCDE", null, 1, ar, 1); T.lights(st, 9, 23.6, "rgba(255,248,226,.95)", 3, 1.6, ar);
        FIELD.pitch(T);
        T.lamp(-20, 38.6, 61, 1.4, 0.25); T.lamp(20, 38.6, 61, 1.4, 0.25);
      },
    },
  };

  // ---------- players and the ball ----------
  const kind0 = sp => Object.keys(SPORT).find(k => SPORT[k] === sp);
  // A player, drawn as an illustration: tapered limbs with real knees and
  // elbows (two-bone, fixed lengths), the far arm and leg in shadow behind the
  // body, a shaded jersey with the number printed on it, shorts or pants and
  // socks for the sport, shoes with soles, a neck, hair, caps and helmets.
  // Running plants one foot and swings the other; arms pump against the legs.
  const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, v * k)));
  const lum8 = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  function limb(x, a, b, w0, w1, col) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-3, nx = -dy / L, ny = dx / L;
    x.fillStyle = col; x.beginPath();
    x.moveTo(a[0] + nx * w0 / 2, a[1] + ny * w0 / 2); x.lineTo(b[0] + nx * w1 / 2, b[1] + ny * w1 / 2);
    x.lineTo(b[0] - nx * w1 / 2, b[1] - ny * w1 / 2); x.lineTo(a[0] - nx * w0 / 2, a[1] - ny * w0 / 2); x.closePath(); x.fill();
    x.beginPath(); x.arc(a[0], a[1], w0 / 2, 0, Math.PI * 2); x.arc(b[0], b[1], w1 / 2, 0, Math.PI * 2); x.fill();
  }
  // knee or elbow for a two-bone limb from a to b, bent toward side (+1 forward)
  function joint(a, b, l1, l2, dir, side) {
    const dx = b[0] - a[0], dy = b[1] - a[1], D = Math.min(Math.hypot(dx, dy), (l1 + l2) * 0.999) || 1e-3;
    const u = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - u * u));
    const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
    let px = -uy, py = ux; if (px * dir * side < 0) { px = -px; py = -py; }
    return [a[0] + ux * u + px * h, a[1] + uy * u + py * h];
  }
  function figure(x, cam, p, t, sp) {
    const s = cam.s(p.Z), K = kind0(sp), hgt = 1.9 * s * (p.crouch || 1);
    const foot = cam.P(p.X, 0, p.Z), lift = (p.Y || 0) * s;
    const fx = foot[0], fy = foot[1] - lift;
    const kit = p.kit, jersey = kit ? hex(kit[2]) : p.team, skin = p.skin || "#B07A4E";
    // contact shadow, smaller and softer while in the air
    const air = clamp((p.Y || 0) / 0.6);
    x.fillStyle = `rgba(0,0,0,${0.34 - 0.18 * air})`;
    x.beginPath(); x.ellipse(fx, foot[1], (0.42 - 0.12 * air) * s, (0.11 - 0.03 * air) * s, 0, 0, Math.PI * 2); x.fill();
    if (hgt < 5) { x.fillStyle = rgb(jersey); x.fillRect(fx - 1, fy - hgt, 2, hgt); return; }
    // moving? compare with where this player was a moment ago
    let speed = 0, dir = p.face || 1;
    if (p.keys) {
      const q = p.lag ? path(p.keys, t - p.lag - 0.06) : path(p.keys, t - 0.06), r = p.lag ? path(p.keys, t - p.lag) : path(p.keys, t);
      speed = Math.hypot(r.X - q.X, r.Z - q.Z) / 0.06;
      if (Math.abs(r.X - q.X) > 0.02) dir = r.X > q.X ? 1 : -1;
    }
    if (p.run) speed = 5;
    const run = clamp(speed / 3.5);
    const ph = p.keys ? travel(p.keys, t - (p.lag || 0)) / (sp.skate ? 2.4 : 1.2) * Math.PI + (p.X * 7 % 3) : t * (sp.skate ? 5 : 10) + p.X;
    if (sp.skate) {
      const d = p.face || 1, bl = cam.P(p.X + d * (p.goalie ? 0.55 : 0.95), 0, p.Z - 0.4);
      return skater(x, p, { fx, fy, hgt, jersey, skin, kit, run, ph, d, blade: [bl[0], bl[1] - lift] });
    }
    const H = hgt, guard = p.arms === "guard" && !p.Y;
    const seed = kit && kit[0] ? [...String(kit[0])].reduce((a, ch) => a + ch.charCodeAt(0), 0) : Math.round(p.X * 13);
    // body proportions (fractions of standing height)
    const TH = 0.245 * H, SH = 0.245 * H, UA = 0.165 * H, FA = 0.155 * H;
    const bob = p.Y ? 0 : Math.abs(Math.cos(ph)) * 0.03 * H * run + (1 - run) * Math.sin(t * 1.9 + seed) * 0.004 * H;
    const drop = guard ? 0.06 * H : 0.012 * H + 0.03 * H * run + (p.Y ? 0.05 * H : 0);
    const hipY = fy - 0.485 * H + drop + bob;
    const lean = dir * (0.1 * run + (guard ? 0.06 : 0)) * H + (1 - run) * Math.sin(t * 1.7 + p.X) * 0.008 * H;
    const hip = [fx + lean * 0.15, hipY], shY = hipY - 0.29 * H, sh = [fx + lean, shY];
    // sport kit pieces
    const white = lum8(jersey) > 205, trim = kit ? hex(kit[3]) : [240, 240, 240];
    let shorts, pantsTo, sock = null, sleeve = 0, sleeveCol = jersey, shoe = [24, 24, 26], sole = [235, 232, 225];
    if (K === "court") { shorts = jersey; pantsTo = 0.82; sock = [238, 236, 232]; shoe = seed % 3 ? [24, 24, 26] : [236, 234, 228]; sole = seed % 3 ? [235, 232, 225] : [40, 40, 42]; }
    else if (K === "pitch") { shorts = white ? trim : (lum8(trim) > 200 ? [242, 242, 240] : shade(jersey, 0.9)); pantsTo = 0.42; sock = shade(jersey, 0.95); sleeve = 0.55; }
    else if (K === "park") { shorts = jersey; pantsTo = 1.55; sock = trim; sleeve = 1; sleeveCol = shade(trim, 0.9); }
    else if (K === "gridiron") { shorts = white ? shade(trim, 0.95) : [233, 228, 214]; pantsTo = 1.15; sock = white ? trim : jersey; sleeve = 0.35; }
    else { shorts = shade(jersey, 0.7); pantsTo = 1; }
    const skinA = hex(skin);
    // feet: running plants one foot and swings the other; standing spreads them; jumping tucks them
    const stride = (p.Y ? 0.06 : 0.24 * run) * H;
    const feet = [1, -1].map(d => {
      const phi = ph + (d > 0 ? 0 : Math.PI);
      let ex = fx + Math.sin(phi) * stride * dir + (1 - run) * d * (guard ? 0.07 : 0.045) * H * dir;
      let ey = fy - Math.max(0, Math.cos(phi)) * 0.11 * H * run;
      if (p.Y) { ex = fx + d * 0.05 * H * dir; ey = fy - (d > 0 ? 0.07 : 0.11) * H; }
      if (p.kick != null && d > 0) {                                    // a shot or a header's jump: the kicking leg swings through
        const u = Math.sin(Math.PI * clamp(p.kick));
        ex = fx + dir * (lerp(-0.2, 0.36, clamp(p.kick)) * H); ey = fy - u * 0.26 * H;
      }
      return { d, phi, e: [ex, ey] };
    });
    // arms: angle from straight down, + is forward (toward dir); elbow bends forward
    const swing = d => -Math.sin(ph + (d > 0 ? 0 : Math.PI)) * 0.75 * run;
    let A = { 1: [swing(1), 0.35 + 1.15 * run], [-1]: [swing(-1), 0.35 + 1.15 * run] };
    if (!run) A = { 1: [0.12 + Math.sin(t * 1.3 + seed) * 0.03, 0.25], [-1]: [-0.05, 0.3] };
    if (p.arms === "up") A = { 1: [2.85, 0.1], [-1]: [2.7, 0.15] };
    else if (p.arms === "shoot") A = { 1: [2.35, 0.75], [-1]: [2.0, 0.7] };
    else if (p.arms === "dribble") { const b = Math.abs(Math.sin(t * 6.5)); A = { 1: [0.55 + 0.15 * b, 0.55 - 0.35 * b], [-1]: [1.25, 0.35] }; }
    else if (guard) A = { 1: [1.35, 0.35], [-1]: [2.45, 0.2] };
    else if (p.throw != null) { const u = ease(clamp(p.throw)); A = { 1: [lerp(-2.4, 2.1, u), lerp(1.4, 0.2, u)], [-1]: [1.2, 0.6] }; }
    else if (p.bat != null) A = { 1: [1.1, 1.6], [-1]: [0.9, 1.7] };
    const arm = d => {
      const [a1, a2] = A[d], s0 = [sh[0] + d * dir * 0.105 * H * (K === "gridiron" ? 1.2 : 1), shY + 0.035 * H];
      const e = [s0[0] + Math.sin(a1) * UA * dir, s0[1] + Math.cos(a1) * UA];
      const h = [e[0] + Math.sin(a1 + a2) * FA * dir, e[1] + Math.cos(a1 + a2) * FA];
      return { s0, e, h };
    };
    const W = 0.11 * H;                                                // a thigh's width
    const drawLeg = (f, far) => {
      const k = far ? 0.72 : 1, hp = [hip[0] - f.d * 0.012 * H * dir, hip[1]];
      const kn = joint(hp, f.e, TH, SH, dir, 1);
      const sk = shade(skinA, k);
      limb(x, kn, f.e, 0.072 * H, 0.05 * H, rgb(sk));                  // shin
      limb(x, hp, kn, W, 0.075 * H, rgb(sk));                          // thigh
      if (sock) {                                                      // socks up the shin
        const top = K === "court" ? 0.32 : K === "park" ? 0.55 : 0.82;
        limb(x, [lerp(f.e[0], kn[0], top), lerp(f.e[1], kn[1], top)], f.e, 0.066 * H, 0.054 * H, rgb(shade(sock, k)));
      }
      // shorts or pants: down the thigh, past the knee for long pants
      if (pantsTo <= 1) limb(x, hp, [lerp(hp[0], kn[0], pantsTo), lerp(hp[1], kn[1], pantsTo)], W * (K === "court" ? 1.35 : 1.15), W * (K === "court" ? 1.25 : 1.05), rgb(shade(shorts, k * 0.94)));
      else {
        limb(x, hp, kn, W * 1.12, W * 0.9, rgb(shade(shorts, k * 0.94)));
        const u = pantsTo - 1; limb(x, kn, [lerp(kn[0], f.e[0], u), lerp(kn[1], f.e[1], u)], W * 0.86, W * 0.7, rgb(shade(shorts, k * 0.94)));
      }
      // shoe: heel to toe, with a sole
      const L = 0.12 * H, hh = 0.04 * H, toe = [f.e[0] + dir * L * 0.7, f.e[1]], heel = [f.e[0] - dir * L * 0.3, f.e[1]];
      x.fillStyle = rgb(shade(shoe, k)); x.beginPath();
      x.moveTo(heel[0], heel[1]); x.lineTo(toe[0], toe[1]); x.quadraticCurveTo(toe[0] + dir * hh * 0.3, toe[1] - hh * 1.1, f.e[0] + dir * L * 0.1, f.e[1] - hh * 1.3);
      x.lineTo(heel[0], heel[1] - hh * 1.2); x.closePath(); x.fill();
      x.fillStyle = rgb(shade(sole, k)); x.fillRect(Math.min(heel[0], toe[0]), f.e[1] - hh * 0.3, Math.abs(toe[0] - heel[0]), Math.max(1, hh * 0.35));
      return kn;
    };
    const drawArm = (d, far) => {
      const k = far ? 0.72 : 1, { s0, e, h } = arm(d), sk = rgb(shade(skinA, k));
      limb(x, e, h, 0.055 * H, 0.045 * H, sk);
      limb(x, s0, e, 0.07 * H, 0.056 * H, sk);
      if (sleeve) {
        const u = Math.min(1, sleeve); limb(x, s0, [lerp(s0[0], e[0], u), lerp(s0[1], e[1], u)], 0.085 * H, 0.072 * H, rgb(shade(sleeveCol, k * 0.95)));
        if (sleeve > 0.9) limb(x, e, [lerp(e[0], h[0], 0.6), lerp(e[1], h[1], 0.6)], 0.064 * H, 0.056 * H, rgb(shade(sleeveCol, k * 0.95)));
      }
      x.fillStyle = sk; x.beginPath(); x.arc(h[0], h[1], 0.03 * H, 0, Math.PI * 2); x.fill();   // hand
      return h;
    };
    // far side first, in shadow
    const farLeg = feet.find(f => f.d < 0), nearLeg = feet.find(f => f.d > 0);
    drawArm(-1, true);
    drawLeg(farLeg, true);
    drawLeg(nearLeg, false);
    // torso: hips to shoulders, rounded at the shoulders, shaded away from the lamps
    const hw = 0.105 * H, sw = (K === "gridiron" ? 0.175 : 0.14) * H, top = shY - 0.01 * H;
    const torso = () => {
      x.beginPath();
      x.moveTo(hip[0] - hw, hipY + 0.03 * H); x.lineTo(hip[0] + hw, hipY + 0.03 * H);
      x.quadraticCurveTo(sh[0] + sw * 1.02, lerp(hipY, top, 0.55), sh[0] + sw, top + 0.035 * H);
      x.quadraticCurveTo(sh[0] + sw * 0.9, top, sh[0] + sw * 0.55, top);
      x.lineTo(sh[0] - sw * 0.55, top);
      x.quadraticCurveTo(sh[0] - sw * 0.9, top, sh[0] - sw, top + 0.035 * H);
      x.quadraticCurveTo(sh[0] - sw * 1.02, lerp(hipY, top, 0.55), hip[0] - hw, hipY + 0.03 * H);
      x.closePath();
    };
    torso();
    const g = x.createLinearGradient(sh[0] - sw, top, sh[0] + sw, hipY);
    g.addColorStop(0, rgb(shade(jersey, 1.08))); g.addColorStop(0.55, rgb(jersey)); g.addColorStop(1, rgb(shade(jersey, 0.72)));
    x.fillStyle = g; x.fill();
    x.save(); torso(); x.clip();
    if (kit && kit[4] && H > 14) {                                     // striped kits
      x.strokeStyle = kit[4]; x.lineWidth = Math.max(1, sw * (kit[4] === kit[3] ? 0.05 : 0.18));
      for (let k = -3; k <= 3; k++) { const sx0 = sh[0] + k * sw * 0.36; x.beginPath(); x.moveTo(sx0, top); x.lineTo(sx0 + (hip[0] - sh[0]), hipY + 0.04 * H); x.stroke(); }
    }
    if (K === "court" && H > 18) {                                     // tank-top trim at the neck and arms, side panel
      x.strokeStyle = rgb(trim); x.lineWidth = Math.max(1, 0.014 * H);
      x.beginPath(); x.arc(sh[0], top - 0.005 * H, 0.05 * H, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    }
    if (kit && kit[1] && H > 20) {                                     // the number, printed on the jersey
      const n = String(kit[1]), fs = Math.round((n.length > 1 ? 0.12 : 0.13) * H);
      x.font = `800 ${fs}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      const nx = lerp(sh[0], hip[0], 0.45) + dir * 0.01 * H, ny = lerp(top, hipY, 0.5);
      x.lineJoin = "round"; x.lineWidth = Math.max(1, fs * 0.14); x.strokeStyle = rgb(lum8(trim) > 150 ? shade(jersey, 0.45) : [245, 242, 235], 0.8);
      x.strokeText(n, nx, ny); x.fillStyle = rgb(trim); x.fillText(n, nx, ny);
    }
    // a soft shadow at the waist and light along the shoulders
    x.fillStyle = "rgba(0,0,0,.16)"; x.fillRect(hip[0] - hw * 1.2, hipY - 0.02 * H, hw * 2.4, 0.06 * H);
    x.restore();
    if (K === "gridiron") {                                            // shoulder pads read as a ridge
      x.strokeStyle = rgb(shade(jersey, 1.12)); x.lineWidth = Math.max(1, 0.02 * H); x.lineCap = "round";
      x.beginPath(); x.moveTo(sh[0] - sw * 0.9, top + 0.03 * H); x.quadraticCurveTo(sh[0], top - 0.025 * H, sh[0] + sw * 0.9, top + 0.03 * H); x.stroke();
    }
    x.strokeStyle = "rgba(255,236,200,.32)"; x.lineWidth = Math.max(0.8, 0.012 * H); x.lineCap = "round";
    x.beginPath(); x.moveTo(sh[0] - sw * 0.75, top + 0.01 * H); x.lineTo(sh[0] + sw * 0.4, top + 0.005 * H); x.stroke();
    // neck and head
    const hr = 0.066 * H, head = [sh[0] + dir * 0.012 * H + lean * 0.12, top - 0.035 * H - hr];
    limb(x, [sh[0], top + 0.01 * H], [head[0], head[1] + hr * 0.6], 0.055 * H, 0.05 * H, rgb(shade(skinA, 0.85)));
    const hg = x.createRadialGradient(head[0] - hr * 0.35, head[1] - hr * 0.4, hr * 0.1, head[0], head[1], hr * 1.1);
    hg.addColorStop(0, rgb(shade(skinA, 1.12))); hg.addColorStop(1, rgb(shade(skinA, 0.78)));
    x.fillStyle = hg; x.beginPath(); x.ellipse(head[0], head[1], hr * 0.92, hr, 0, 0, Math.PI * 2); x.fill();
    if (K === "park") {                                                // batting helmet or cap, brim out front
      x.fillStyle = rgb(white ? trim : shade(jersey, 0.85).map(v => Math.min(v, 120)));
      x.beginPath(); x.arc(head[0], head[1] - hr * 0.1, hr * 1.02, Math.PI, 0); x.fill();
      x.fillRect(Math.min(head[0], head[0] + dir * hr * 1.55), head[1] - hr * 0.2, hr * 1.55, hr * 0.22);
    } else if (K === "gridiron") {                                     // helmet with a facemask
      const hc = white ? trim : jersey;
      x.fillStyle = rgb(hc); x.beginPath(); x.arc(head[0] - dir * hr * 0.08, head[1] - hr * 0.05, hr * 1.2, 0, Math.PI * 2); x.fill();
      x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = Math.max(0.8, hr * 0.18);
      x.beginPath(); x.arc(head[0] - dir * hr * 0.08, head[1] - hr * 0.05, hr * 0.85, Math.PI * 1.15, Math.PI * 1.6); x.stroke();
      x.strokeStyle = "rgba(220,220,220,.9)"; x.lineWidth = Math.max(0.7, hr * 0.14);
      x.beginPath(); x.moveTo(head[0] + dir * hr * 0.75, head[1] - hr * 0.3); x.lineTo(head[0] + dir * hr * 1.3, head[1] - hr * 0.1);
      x.lineTo(head[0] + dir * hr * 1.3, head[1] + hr * 0.55); x.lineTo(head[0] + dir * hr * 0.7, head[1] + hr * 0.75);
      x.moveTo(head[0] + dir * hr * 0.8, head[1] + hr * 0.2); x.lineTo(head[0] + dir * hr * 1.3, head[1] + hr * 0.2); x.stroke();
    } else {                                                           // hair, cut a few ways
      x.fillStyle = seed % 5 === 0 ? "#3A2A1E" : "#16110E";
      const style = seed % 9 === 3 ? 3 : seed % 3;
      if (style !== 3) {                                               // from the back of the neck over the crown to the hairline
        const r = hr * (style === 2 ? 1.12 : 1.02), a0 = style === 1 ? 0.8 : 0.7, a1 = style === 2 ? 1.95 : 1.85;
        x.beginPath();
        for (let i = 0; i <= 16; i++) { const a = Math.PI * lerp(a0, a1, i / 16), c = Math.cos(a) * (dir > 0 ? 1 : -1); x.lineTo(head[0] + c * r, head[1] + Math.sin(a) * r * 0.98); }
        x.closePath(); x.fill();
      }
      if (K === "court" && seed % 6 === 1) { x.fillStyle = rgb(trim); x.fillRect(head[0] - hr, head[1] - hr * 0.45, hr * 2, hr * 0.25); }   // headband
    }
    x.strokeStyle = "rgba(255,236,200,.5)"; x.lineWidth = Math.max(0.8, hr * 0.22);
    x.beginPath(); x.arc(head[0], head[1], hr * 0.95, Math.PI * 1.1, Math.PI * 1.55); x.stroke();
    // near arm last, in front of the body
    const hand = drawArm(1, false);
    if (p.stick) { x.strokeStyle = "#2A2420"; x.lineWidth = Math.max(1, 0.03 * H); x.beginPath(); x.moveTo(hand[0], hand[1]); x.lineTo(fx + 0.9 * s, foot[1] - 0.02 * s - lift); x.stroke(); }
    if (p.bat != null) {
      const a = -2.3 + p.bat * 3.4;
      x.strokeStyle = "#D9B98C"; x.lineWidth = Math.max(1.4, 0.04 * H); x.lineCap = "round";
      x.beginPath(); x.moveTo(hand[0], hand[1]); x.lineTo(hand[0] + Math.cos(a) * 0.45 * H, hand[1] + Math.sin(a) * 0.45 * H); x.stroke();
    }
  }

  // 3D players: shadows and numbers in 2D, bodies from the 3D renderer
  function draw3d(x, cam, players, t, sp, o) {
    const list = players.map(p => {
      let speed = 0, dirX = 0, dirZ = 0;
      if (p.keys) {
        const a = path(p.keys, t - (p.lag || 0) - 0.08), b = path(p.keys, t - (p.lag || 0));
        dirX = b.X - a.X; dirZ = b.Z - a.Z; speed = Math.hypot(dirX, dirZ) / 0.08;
      }
      if (p.run) speed = 5;
      return { ...p, speed, dirX, dirZ, moving: speed > 0.35 };
    });
    list.forEach(p => {                                                   // contact shadows
      const s = cam.s(p.Z), f0 = cam.P(p.X, 0, p.Z);
      x.fillStyle = "rgba(0,0,0,.3)"; x.beginPath(); x.ellipse(f0[0], f0[1], 0.45 * s, 0.12 * s, 0, 0, Math.PI * 2); x.fill();
    });
    three.r.draw(x, list, { ...o, f: cam.f, hz: cam.hz, cx: cam.cx, h: cam.h }, o.dt);
    list.forEach(p => {                                                   // numbers on the chest
      const k = p.kit, s = cam.s(p.Z);
      if (!k || !k[1] || s * 1.9 < 40) return;
      const c = cam.P(p.X + (p.dirX ? Math.sign(p.dirX) * 0.06 : 0), (p.Y || 0) + (p.arms === "guard" ? 1.02 : 1.28), p.Z);
      x.fillStyle = k[3]; x.font = `700 ${Math.round(0.26 * s)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(k[1]), c[0], c[1]);
    });
  }

  // A hockey player: knees bent, leaning over the puck, both hands on the
  // stick, skates and a helmet. The stick has a taped knob, a tapered shaft and
  // a curved blade; it sways while he carries the puck, comes back on a
  // wind-up and follows through on the shot. Strides push out and back.
  // Goalies get a wide stance, white pads, a glove and a blocker.
  function skater(x, p, o) {
    const { fx, fy, hgt: h, jersey, skin, kit, run, ph, d, blade } = o, g = !!p.goalie;
    const lw = Math.max(1.2, 0.085 * h), sleeve = rgb(jersey.map(v => v * 0.9)), trim = kit ? kit[3] : "#FFFFFF";
    const pants = rgb(jersey.every(v => v > 225) ? [30, 30, 34] : jersey.map(v => v * 0.32));
    const sh0 = p.shoot != null ? p.shoot : null;                      // -1..0 wind-up, 0..1 follow-through
    const lean = (g ? 0.05 : 0.13 + 0.09 * run + (sh0 != null ? 0.05 : 0)) * h;
    const hipX = fx - d * 0.03 * h, hipY = fy - (g ? 0.38 : 0.42) * h;
    const shX = hipX + d * lean, shY = fy - (g ? 0.68 : 0.7) * h;
    x.lineCap = "round"; x.lineJoin = "round";
    // legs: the pushing skate drives out and back, the other glides under him
    [[1, 0], [-1, Math.PI]].forEach(([side, off]) => {
      const phi = ph + off, push = Math.sin(phi), kick = g ? 0 : (0.35 + 0.65 * run);
      const footX = g ? fx + side * 0.2 * h : fx + d * 0.04 * h - d * Math.max(0, push) * 0.24 * h * kick + d * Math.min(0, push) * -0.05 * h * kick;
      const up = g ? 0 : Math.max(0, -push) * 0.05 * h * kick;            // the recovering skate comes off the ice
      const kneeX = g ? fx + side * 0.13 * h : lerp(hipX, footX, 0.5) + d * (0.1 + 0.04 * run) * h, kneeY = lerp(hipY, fy - up, g ? 0.6 : 0.5);
      x.strokeStyle = pants; x.lineWidth = lw * 1.6;
      x.beginPath(); x.moveTo(hipX + side * 0.05 * h, hipY); x.lineTo(kneeX, kneeY); x.stroke();
      x.strokeStyle = g ? "#EDEAE2" : sleeve; x.lineWidth = lw * (g ? 2.4 : 1.1);
      x.beginPath(); x.moveTo(kneeX, kneeY - (g ? 0.06 * h : 0)); x.lineTo(footX, fy - 0.05 * h - up); x.stroke();
      if (!g) { x.strokeStyle = trim; x.lineWidth = Math.max(0.6, lw * 0.35); const sx = lerp(kneeX, footX, 0.35), sy = lerp(kneeY, fy - up, 0.35); x.beginPath(); x.moveTo(sx - lw * 0.5, sy); x.lineTo(sx + lw * 0.5, sy); x.stroke(); }
      // skate: boot, holder and a steel runner
      const by = fy - up;
      x.fillStyle = "#151515"; x.beginPath();
      x.moveTo(footX - d * 0.03 * h, by - 0.06 * h); x.lineTo(footX + d * 0.02 * h, by - 0.06 * h); x.lineTo(footX + d * 0.1 * h, by - 0.025 * h); x.lineTo(footX - d * 0.035 * h, by - 0.02 * h); x.closePath(); x.fill();
      x.strokeStyle = "rgba(225,232,236,.95)"; x.lineWidth = Math.max(0.8, lw * 0.28);
      x.beginPath(); x.moveTo(footX - d * 0.045 * h, by - 0.004 * h); x.lineTo(footX + d * 0.11 * h, by - 0.004 * h); x.stroke();
    });
    // hockey pants
    x.fillStyle = pants; x.beginPath();
    x.moveTo(hipX - 0.15 * h, hipY - 0.03 * h); x.lineTo(hipX + 0.15 * h, hipY - 0.03 * h); x.lineTo(hipX + 0.14 * h, hipY + 0.09 * h); x.lineTo(hipX - 0.14 * h, hipY + 0.09 * h); x.closePath(); x.fill();
    // the stick: where the blade is (on the ice in front; back and up on a wind-up; out front after the shot)
    let heel = [blade[0], blade[1] - 0.01 * h];
    if (!g && p.carry) heel = [heel[0] + Math.sin(ph * 1.7) * 0.07 * h, heel[1] + Math.cos(ph * 1.7) * 0.012 * h];
    if (!g && sh0 != null) {
      const back = [fx - d * 0.2 * h, fy - 0.3 * h], thru = [fx + d * 0.62 * h, fy - 0.34 * h];
      heel = sh0 < 0 ? [lerp(heel[0], back[0], ease(-sh0)), lerp(heel[1], back[1], ease(-sh0))]
        : [lerp(back[0], thru[0], ease(Math.min(1, sh0 * 1.6))), lerp(back[1], heel[1], Math.min(1, sh0 * 3)) - Math.max(0, sh0 - 0.3) * 0.45 * h];
    }
    const top = [shX - d * 0.02 * h, shY + 0.16 * h];
    const len = Math.hypot(heel[0] - top[0], heel[1] - top[1]) || 1, ux = (heel[0] - top[0]) / len, uy = (heel[1] - top[1]) / len;
    const knob = [top[0] - ux * 0.1 * h, top[1] - uy * 0.1 * h], bot = [lerp(top[0], heel[0], 0.4), lerp(top[1], heel[1], 0.4)];
    // shaft: tapered, a sheen down one side, a graphic band and tape at the knob
    const sw = Math.max(1.2, lw * 0.5), nx = -uy, ny = ux;
    x.fillStyle = "#1B1B1D"; x.beginPath();
    x.moveTo(knob[0] + nx * sw * 0.5, knob[1] + ny * sw * 0.5); x.lineTo(heel[0] + nx * sw * 0.3, heel[1] + ny * sw * 0.3);
    x.lineTo(heel[0] - nx * sw * 0.3, heel[1] - ny * sw * 0.3); x.lineTo(knob[0] - nx * sw * 0.5, knob[1] - ny * sw * 0.5); x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,.22)"; x.lineWidth = Math.max(0.5, sw * 0.18);
    x.beginPath(); x.moveTo(knob[0] + nx * sw * 0.2, knob[1] + ny * sw * 0.2); x.lineTo(heel[0] + nx * sw * 0.12, heel[1] + ny * sw * 0.12); x.stroke();
    if (h > 26) { x.strokeStyle = trim; x.lineWidth = sw * 0.9; const b0 = 0.55, b1 = 0.66; x.beginPath(); x.moveTo(lerp(knob[0], heel[0], b0), lerp(knob[1], heel[1], b0)); x.lineTo(lerp(knob[0], heel[0], b1), lerp(knob[1], heel[1], b1)); x.stroke(); }
    x.strokeStyle = "#F2F0EA"; x.lineWidth = sw * 1.15;
    x.beginPath(); x.moveTo(knob[0], knob[1]); x.lineTo(knob[0] + ux * 0.05 * h, knob[1] + uy * 0.05 * h); x.stroke();
    // blade: off the heel at the lie angle, curved up at the toe, white tape in the middle
    const bl = (g ? 0.17 : 0.15) * h, bh = Math.max(1.2, (g ? 0.045 : 0.032) * h), tx = heel[0] + d * bl, ty = heel[1] + 0.004 * h;
    x.fillStyle = "#1B1B1D"; x.beginPath();
    x.moveTo(heel[0] - d * 0.01 * h, heel[1] - bh); x.quadraticCurveTo(heel[0] + d * bl * 0.6, ty - bh * 0.7, tx, ty - bh * 1.4);
    x.quadraticCurveTo(tx + d * 0.012 * h, ty - bh * 0.2, tx - d * 0.01 * h, ty + bh * 0.15);
    x.quadraticCurveTo(heel[0] + d * bl * 0.5, ty + bh * 0.35, heel[0] - d * 0.015 * h, heel[1] + bh * 0.2); x.closePath(); x.fill();
    if (h > 18) {
      x.fillStyle = "rgba(245,245,240,.92)"; x.beginPath();
      const t0 = 0.25, t1 = 0.72, at = u => [heel[0] + d * bl * u, lerp(heel[1], ty, u) - bh * (0.5 + 0.6 * u * u)];
      const a0 = at(t0), a1 = at(t1);
      x.moveTo(a0[0], a0[1] - bh * 0.35); x.lineTo(a1[0], a1[1] - bh * 0.35); x.lineTo(a1[0], a1[1] + bh * 0.55); x.lineTo(a0[0], a0[1] + bh * 0.55); x.closePath(); x.fill();
    }
    // jersey: bulky shoulders over the pads, stripes at the hem
    const bw = 0.17 * h;
    x.fillStyle = rgb(jersey); x.beginPath();
    x.moveTo(hipX - bw * 0.95, hipY); x.lineTo(hipX + bw * 0.95, hipY);
    x.lineTo(shX + bw * 1.15, shY + 0.02 * h); x.quadraticCurveTo(shX, shY - 0.05 * h, shX - bw * 1.15, shY + 0.02 * h); x.closePath(); x.fill();
    x.strokeStyle = trim; x.lineWidth = Math.max(0.8, 0.025 * h);
    x.beginPath(); x.moveTo(lerp(hipX, shX, 0.15) - bw, lerp(hipY, shY, 0.15)); x.lineTo(lerp(hipX, shX, 0.15) + bw, lerp(hipY, shY, 0.15)); x.stroke();
    x.beginPath(); x.moveTo(lerp(hipX, shX, 0.24) - bw * 1.02, lerp(hipY, shY, 0.24)); x.lineTo(lerp(hipX, shX, 0.24) + bw * 1.02, lerp(hipY, shY, 0.24)); x.stroke();
    if (kit && kit[1] && h > 20) {
      x.fillStyle = trim; x.font = `700 ${Math.round(0.13 * h)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(kit[1]), lerp(hipX, shX, 0.58), lerp(hipY, shY, 0.58));
    }
    // arms in sleeves, gloves on the stick (a goalie's glove and blocker)
    const glove = rgb(jersey.every(v => v > 225) ? [40, 40, 44] : jersey.map(v => v * 0.6));
    const hands = g
      ? [[shX - d * 0.16 * h, p.arms === "glove" ? shY - 0.08 * h : hipY - 0.02 * h], [lerp(top[0], heel[0], 0.3), lerp(top[1], heel[1], 0.3)]]
      : [top, bot];
    [[shX - d * 0.1 * h, shY + 0.02 * h], [shX + d * 0.1 * h, shY + 0.02 * h]].forEach((shp, i) => {
      const hd = hands[i];
      x.strokeStyle = sleeve; x.lineWidth = lw * 1.05;
      x.beginPath(); x.moveTo(shp[0], shp[1]); x.quadraticCurveTo((shp[0] + hd[0]) / 2 - d * 0.04 * h, (shp[1] + hd[1]) / 2 + 0.05 * h, hd[0], hd[1]); x.stroke();
      x.fillStyle = g && i === 0 ? "#7A5A3A" : glove;
      x.beginPath(); x.arc(hd[0], hd[1], (g ? 0.06 : 0.038) * h, 0, Math.PI * 2); x.fill();
      if (!g) { x.strokeStyle = trim; x.lineWidth = Math.max(0.5, 0.012 * h); x.beginPath(); x.arc(hd[0], hd[1], 0.038 * h, Math.PI * 0.2, Math.PI * 0.8); x.stroke(); }
      if (g && i === 1) { x.fillStyle = "#EDEAE2"; x.fillRect(hd[0] - 0.04 * h, hd[1] - 0.07 * h, 0.08 * h, 0.1 * h); }
    });
    // head in a helmet with a visor (a goalie's mask)
    const hx = shX + d * 0.05 * h, hy = shY - 0.07 * h, hr = 0.068 * h;
    x.fillStyle = skin; x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
    const lid = rgb(jersey.every(v => v > 225) ? hex(trim) : jersey.map(v => v * 0.55));
    x.fillStyle = g ? "#EDEAE2" : lid;
    x.beginPath(); x.arc(hx, hy - hr * 0.1, hr * 1.12, g ? 0 : Math.PI * 1.02, g ? Math.PI * 2 : Math.PI * 1.98); x.fill();
    if (g) { x.strokeStyle = "#333"; x.lineWidth = Math.max(0.6, hr * 0.15); for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(hx + d * hr * 0.2, hy + i * hr * 0.35); x.lineTo(hx + d * hr * 1.05, hy + i * hr * 0.35); x.stroke(); } }
    else { x.strokeStyle = "rgba(200,225,240,.8)"; x.lineWidth = Math.max(0.7, hr * 0.28); x.beginPath(); x.moveTo(hx + d * hr * 0.1, hy - hr * 0.05); x.lineTo(hx + d * hr * 1.1, hy + hr * 0.05); x.stroke(); }
  }

  function drawBall(x, cam, b, cast, t) {
    if (b.hide) return;
    const s = cam.s(b.Z), r = Math.max(b.puck ? 1.6 : 2.2, b.r * s), p = cam.P(b.X, b.Y, b.Z), g = cam.P(b.X, 0, b.Z);
    x.fillStyle = "rgba(0,0,0,.3)"; x.beginPath(); x.ellipse(g[0], g[1], r * 1.1, r * 0.35, 0, 0, Math.PI * 2); x.fill();
    if (b.fly) {                                                      // the tracer behind a ball in flight
      x.lineCap = "round";
      for (let i = 1; i <= 14; i++) {
        const q = cast(t - i * 0.025).ball; if (!q.fly) break;
        const a = cam.P(q.X, q.Y, q.Z), c = i === 1 ? p : cam.P(...(() => { const z = cast(t - (i - 1) * 0.025).ball; return [z.X, z.Y, z.Z]; })());
        x.strokeStyle = `rgba(255,236,200,${0.5 * (1 - i / 15)})`; x.lineWidth = r * 1.2 * (1 - i / 16);
        x.beginPath(); x.moveTo(c[0], c[1]); x.lineTo(a[0], a[1]); x.stroke();
      }
    }
    x.save(); x.shadowColor = "rgba(255,230,180,.7)"; x.shadowBlur = b.fly ? 10 : 4;
    x.fillStyle = rgb(b.color);
    x.beginPath();
    if (b.oval) { const q = cast(t + 0.02).ball, d = cam.P(q.X, q.Y, q.Z); x.ellipse(p[0], p[1], r * 1.5, r * 0.9, Math.atan2(d[1] - p[1], d[0] - p[0]), 0, Math.PI * 2); }
    else if (b.puck) x.ellipse(p[0], p[1], r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
    else x.arc(p[0], p[1], r, 0, Math.PI * 2);
    x.fill(); x.restore();
    if (b.lines && r > 3) { x.strokeStyle = "rgba(30,16,8,.7)"; x.lineWidth = 0.8; x.beginPath(); x.moveTo(p[0] - r, p[1]); x.lineTo(p[0] + r, p[1]); x.moveTo(p[0], p[1] - r); x.lineTo(p[0], p[1] + r); x.stroke(); }
  }

  // the rim and net go in front of the ball as it drops through
  function drawRim(x, cam, B, swish) {
    const s = cam.s(B.Z), rw = 0.23 * s, c = cam.P(B.X, B.Y, B.Z);
    x.strokeStyle = "rgba(242,238,230,.75)"; x.lineWidth = Math.max(0.7, 0.02 * s);
    const depth = 0.45 * s * (1 + 0.5 * Math.sin(Math.PI * (swish || 0)));
    for (let i = 0; i <= 6; i++) {
      const u = i / 6, top = c[0] - rw + 2 * rw * u, bot = c[0] - rw * 0.55 + 1.1 * rw * u;
      x.beginPath(); x.moveTo(top, c[1]); x.quadraticCurveTo(top + (bot - top) * 0.5 + Math.sin(i + (swish || 0) * 12) * rw * 0.25 * (swish ? 1 : 0), c[1] + depth * 0.55, bot, c[1] + depth); x.stroke();
    }
    x.strokeStyle = "#E5793B"; x.lineWidth = Math.max(1.5, 0.05 * s);
    x.beginPath(); x.ellipse(c[0], c[1], rw, rw * 0.28, 0, 0, Math.PI * 2); x.stroke();
  }

  function glow(x, cam, at, a, color) {
    if (!a) return;
    const p = cam.P(at.X, at.Y || 0, at.Z), R = 4 * cam.s(at.Z);
    const g = x.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
    g.addColorStop(0, `rgba(${color},${0.55 * a})`); g.addColorStop(1, `rgba(${color},0)`);
    x.fillStyle = g; x.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
  }

  // camera flashes in the crowd
  function flashes(x, bg, W, t) {
    for (let i = 0; i < 4; i++) {
      const k = Math.floor(t * 1.3 + i * 0.37), ph = (t * 1.3 + i * 0.37) % 1;
      if (ph > 0.12) continue;
      let seed = (k * 7919 + i * 104729) % 2147483647 || 1;
      const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const px = r() * W, py = bg.back - r() * bg.rise * 0.8;
      x.fillStyle = `rgba(255,250,235,${0.9 * (1 - ph / 0.12)})`;
      x.beginPath(); x.arc(px, py, 1.4, 0, Math.PI * 2); x.fill();
    }
  }

  // ---------- who's on the field: today's teams, a live game, or the classics ----------
  // While a game is on, its real plays are acted out as they happen (from ESPN's
  // game feed, the same one the game pages read). Before games start, the two
  // teams in tonight's surest pick play, with their real players. With nothing
  // on, the all-time greats play, mixed with famous plays.
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const PATHS = { nfl: "football/nfl", cfb: "football/college-football", mlb: "baseball/mlb", nhl: "hockey/nhl",
    nba: "basketball/nba", cbb: "basketball/mens-college-basketball" };
  const SOCCER_LEAGUE = { "Premier League": "eng.1", "La Liga": "esp.1", "LaLiga": "esp.1", "Champions League": "uefa.champions",
    "Europa League": "uefa.europa", "Serie A": "ita.1", "Bundesliga": "ger.1", "Ligue 1": "fra.1", "MLS": "usa.1" };
  const espnPath = (sp, g) => sp === "soccer" ? "soccer/" + (SOCCER_LEAGUE[(g && g.league) || ""] || "eng.1") : PATHS[sp];
  function jget(url, ms = 8000) {
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const tm = ac && setTimeout(() => ac.abort(), ms);
    return fetch(url, ac ? { signal: ac.signal } : {}).then(r => r.ok ? r.json() : null).catch(() => null).finally(() => tm && clearTimeout(tm));
  }
  const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  const near = (a, b) => Math.abs(lum(a) - lum(b)) < 0.22 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 120;
  const hx6 = s => "#" + String(s || "333333").replace(/^#/, "").padStart(6, "0").slice(0, 6);
  const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV)$/i;
  function lastName(a) {
    if (a.lastName) return a.lastName.replace(SUFFIX, "");
    const s = String(a.shortName || a.displayName || "").replace(SUFFIX, "").trim();
    const m = /^[A-Z][a-z]?\.\s*(.+)$/.exec(s);
    if (m) return m[1];
    const parts = s.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : s;
  }
  const person = (a, extra = {}) => ({ id: String(a.id || ""), name: lastName(a), full: a.displayName || a.fullName || "",
    jersey: a.jersey != null && a.jersey !== "" ? String(a.jersey) : "", pos: ((a.position || {}).abbreviation || extra.pos || "").toUpperCase(),
    grp: extra.grp || "", starter: !!(extra.starter || a.starter), rank: extra.rank || 0 });

  // which pool a player belongs in, by position (or by the box score group he's listed in)
  function roleOf(kind, p) {
    const pos = p.pos, g = (p.grp || "").toLowerCase();
    if (kind === "court") return "HOOPS";
    if (kind === "ice") return pos === "G" || /goal/.test(g) ? "GOALIES" : "SKATERS";
    if (kind === "pitch") return pos === "G" || pos === "GK" || /keeper/.test(g) ? "KEEPERS" : "FOOTY";
    if (kind === "park") {
      if (/^(SP|RP|P)$/.test(pos) || /pitch/.test(g)) return "PITCHERS";
      if (pos === "C") return "CATCHERS";
      if (/^(1B|2B|3B|SS|IF)$/.test(pos)) return "INFIELD";
      if (/^(LF|CF|RF|OF)$/.test(pos)) return "OUTFIELD";
      return "BATTERS";
    }
    if (pos === "QB" || (!pos && g === "passing")) return "QB";
    if (/^(RB|FB|HB)$/.test(pos) || (!pos && g === "rushing")) return "RB";
    if (pos === "WR" || (!pos && g === "receiving")) return "WR";
    if (pos === "TE") return "TE";
    if (/^(C|G|T|OT|OG|OL|LT|RT|LG|RG)$/.test(pos)) return "OL";
    if (/^(DE|DT|NT|DL)$/.test(pos)) return "DL";
    if (/^(LB|OLB|ILB|MLB)$/.test(pos)) return "LB";
    if (/^(CB|DB)$/.test(pos)) return "CB";
    if (/^(S|FS|SS)$/.test(pos)) return "SAF";
    if (!pos && /defens|intercept/.test(g)) return "LB";
    return "";
  }
  // baseball batters come from the whole lineup, not just the bench
  const fitsRole = (kind, role, p) => role === "BATTERS" ? roleOf(kind, p) !== "PITCHERS" : roleOf(kind, p) === role;

  // every player ESPN lists for each team in a game summary: box score, leaders, lineups
  function summaryPlayers(d) {
    const by = {};
    const add = (tid, a, extra) => {
      if (!tid || !a || !(a.displayName || a.shortName)) return;
      const list = by[tid] || (by[tid] = []), q = person(a, extra);
      const old = list.find(o => (q.id && o.id === q.id) || o.full === q.full);
      if (old) { if (!old.pos) old.pos = q.pos; if (!old.jersey) old.jersey = q.jersey; old.starter = old.starter || q.starter; old.rank = Math.max(old.rank, q.rank); }
      else list.push(q);
    };
    ((d.boxscore || {}).players || []).forEach(tp => {
      const tid = String((tp.team || {}).id || "");
      (tp.statistics || []).forEach(st => (st.athletes || []).forEach(a => add(tid, a.athlete, { grp: st.name || st.type || "", starter: a.starter, rank: a.starter ? 2 : 1 })));
    });
    (d.leaders || []).forEach(tl => {
      const tid = String((tl.team || {}).id || "");
      (tl.leaders || []).forEach(cat => (cat.leaders || []).forEach(l => add(tid, l.athlete, { grp: cat.name || "", rank: 3 })));
    });
    (d.rosters || []).forEach(tr => {
      const tid = String((tr.team || {}).id || "");
      (tr.roster || []).forEach(a => add(tid, { ...(a.athlete || {}), jersey: a.jersey || (a.athlete || {}).jersey, position: a.position || (a.athlete || {}).position }, { starter: a.starter, rank: a.starter ? 2 : 0 }));
    });
    return by;
  }
  function rosterPlayers(d) {
    const out = [];
    ((d && d.athletes) || []).forEach(e => (e.items ? e.items : [e]).forEach(a => a && a.displayName && out.push(person(a))));
    return out;
  }

  // One side of a game: colors and players. The home team wears its color, the
  // road team white (in baseball: home whites, road grays), trimmed in its color.
  function side(t, home, kind) {
    const c = hex(hx6(t.color)), a = hex(hx6(t.alt));
    let jersey, num;
    if (kind === "park") { jersey = home ? [244, 244, 244] : [162, 170, 173]; num = lum(c) > 0.8 ? a : c; }
    else if (home) { jersey = c; num = near(a, c) ? (lum(c) > 0.55 ? [17, 17, 17] : [255, 255, 255]) : a; }
    else { jersey = [244, 244, 244]; num = lum(c) > 0.8 ? (lum(a) > 0.8 ? [17, 17, 17] : a) : c; }
    const toHex = v => "#" + v.map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
    return { abbr: t.abbr || "", short: t.short || t.abbr || "", jersey: toHex(jersey), num: toHex(num), home, players: [], id: "" };
  }
  // fix two clashing kits: the road side switches to its own color
  function unclash(h, a, t) {
    if (near(hex(h.jersey), hex(a.jersey))) {
      const c = hex(hx6(t.color)), alt = hex(hx6(t.alt));
      const pick = near(c, hex(h.jersey)) ? alt : c;
      a.jersey = "#" + pick.map(n => n.toString(16).padStart(2, "0")).join("");
      a.num = lum(pick) > 0.55 ? "#111111" : "#FFFFFF";
    }
  }
  // a kit for one player: [name, number, jersey, number color, stripe]; .anon when we don't know who
  function kitFor(s, p) {
    const k = [p ? p.name : "", p ? p.jersey : "", s.jersey, s.num];
    k.anon = !p; k.side = s; return k;
  }
  // pools for one team, named players first (starters and leaders ahead of the bench)
  function teamKits(kind, s, role, n, r, used) {
    const fits = s.players.filter(p => !used.has(p.full) && fitsRole(kind, role, p));
    const top = fits.filter(p => p.rank >= 2), rest = fits.filter(p => p.rank < 2);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const order = [...shuffle(top), ...shuffle(rest)], out = [];
    for (let i = 0; i < n; i++) { const p = order[i]; if (p) used.add(p.full); out.push(kitFor(s, p)); }
    return out;
  }
  // the lineup builders the sports call: T.kits([[role, "o" | "d", n], ...], r)
  const POOLS = { HOOPS, QB, RB, WR, TE, OL, DL, LB, CB, SAF, PITCHERS, CATCHERS, INFIELD, OUTFIELD, BATTERS, SKATERS, GOALIES, FOOTY, KEEPERS };
  const CLASSIC = { mode: "classic", kits: (spec, r) => lineup(spec.map(([role, , n]) => [POOLS[role], n]), r) };
  function teamsT(kind, m, off) {
    const o = off === "home" ? m.home : m.away, d = off === "home" ? m.away : m.home;
    return { mode: m.mode, m, o, d, kits(spec, r) {
      const used = new Set(), out = [];
      spec.forEach(([role, sd, n]) => teamKits(kind, sd === "o" ? o : d, role, n, r, used).forEach(k => { k.role = role; out.push(k); }));
      return out;
    } };
  }
  // put named players in the spots the caption talks about
  function feature(kits, idx) {
    idx.forEach(i => {
      const k = kits[i];
      if (!k || !k.anon) return;
      const j = kits.findIndex((q, jj) => !q.anon && q.side === k.side && q.role === k.role && !idx.includes(jj));
      if (j >= 0) [kits[i], kits[j]] = [kits[j], kits[i]];
    });
  }
  // the name a caption uses for kit i: the player, or his team when we don't know who
  const nameOf = k => k ? (k[0] || (k.side ? k.side.short : "")) : "";

  // a player named in a play's text, matched against both teams
  function namesIn(text, m) {
    const found = [];
    [m.home, m.away].forEach(s => s.players.forEach(p => {
      const at = p.full && text.indexOf(p.full) >= 0 ? text.indexOf(p.full) : p.name && p.name.length > 2 ? text.search(new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)) : -1;
      if (at >= 0) found.push({ at, p, s });
    }));
    found.sort((a, b) => a.at - b.at);
    return found.filter((f, i) => found.findIndex(g => g.p === f.p) === i);
  }

  const director = (() => {
    const state = {}, plays = {}, seen = {};
    // the game to show for a sport: a live one first, then tonight's surest pick
    async function pick(sp, force) {
      const d = await games(sp), list = (d && d.games) || [], now = Date.now();
      if (force === "replay") {                       // test mode: act out a finished game's plays as if live
        const done = list.filter(g => g.state === "post").sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
        for (const g of done.slice(0, 3)) {
          const sum = await jget(`${ESPN}${espnPath(sp, g)}/summary?event=${g.id}`);
          if (sum) return { g, sum, live: true, replay: true };
        }
      }
      const best = surest(d);
      const startsIn = g => (Date.parse(g.start) || 0) - now;
      const maybeLive = list.filter(g => g.state === "in" || (g.state === "pre" && startsIn(g) < 0 && startsIn(g) > -5 * 3600e3));
      maybeLive.sort((a, b) => (best && a.id === best.g.id ? -1 : 0) - (best && b.id === best.g.id ? -1 : 0));
      for (const g of maybeLive.slice(0, 4)) {
        const sum = await jget(`${ESPN}${espnPath(sp, g)}/summary?event=${g.id}`);
        const st = ((((sum || {}).header || {}).competitions || [])[0] || {}).status;
        if (st && st.type && st.type.state === "in") return { g, sum, live: true };
      }
      const pre = best ? best.g : list.find(g => g.state === "pre" && startsIn(g) > -15 * 60e3);
      return pre ? { g: pre, live: false } : null;
    }
    async function load(sp, kind, force) {
      const got = await pick(sp, force);
      if (!got) return { mode: "classic" };
      const { g } = got, m = { mode: got.live ? "live" : "teams", replay: !!got.replay, sp, kind, g, path: espnPath(sp, g) };
      m.home = side(g.home, true, kind); m.away = side(g.away, false, kind); unclash(m.home, m.away, g.away);
      const sum = got.sum || await jget(`${ESPN}${m.path}/summary?event=${g.id}`);
      const comps = ((((sum || {}).header || {}).competitions || [])[0] || {}).competitors || [];
      comps.forEach(c => { const s = c.homeAway === "home" ? m.home : m.away; s.id = String((c.team || {}).id || ""); });
      const by = sum ? summaryPlayers(sum) : {};
      [m.home, m.away].forEach(s => { s.players = by[s.id] || []; });
      // fill out thin lists (before a game, ESPN lists only a few leaders) from the team roster
      await Promise.all([[m.home, g.home], [m.away, g.away]].map(async ([s, t]) => {
        if (s.players.length >= 9) return;
        const key = (/\/(\d+)\.png/.exec(t.logo || "") || [])[1] || s.id || String(t.abbr || "").toLowerCase();
        const ro = rosterPlayers(await jget(`${ESPN}${m.path}/teams/${key}/roster`));
        ro.forEach(p => { if (!s.players.some(q => q.full === p.full)) s.players.push(p); });
      }));
      // probable pitchers and goalies from our own slate
      [[m.home, g.home], [m.away, g.away]].forEach(([s, t]) => {
        if (!t.probable) return;
        const nm = lastName({ shortName: t.probable });
        const p = s.players.find(q => q.name === nm) || (s.players.push({ name: nm, full: t.probable, jersey: "", pos: kind === "ice" ? "G" : "SP", rank: 3 }), s.players[s.players.length - 1]);
        p.rank = 4; if (!p.pos) p.pos = kind === "ice" ? "G" : "SP"; p.probable = true;
      });
      if (m.mode === "live" && sum) { m.status = liveStatus(sum, m); m.sum = m.replay ? sum : null; queuePlays(sp, kind, sum, m, !m.replay); }
      return m;
    }
    function liveStatus(sum, m) {
      const comp = ((sum.header || {}).competitions || [])[0] || {}, st = comp.status || {};
      const score = {};
      (comp.competitors || []).forEach(c => { score[c.homeAway] = c.score; });
      return { state: (st.type || {}).state, detail: (st.type || {}).shortDetail || (st.type || {}).detail || "", away: score.away, home: score.home };
    }
    // the latest plays from ESPN, normalized: {id, text, team ("home" | "away"), type, scoring}
    function feedPlays(sum, m) {
      const teamOf = id => String(id) === m.home.id ? "home" : String(id) === m.away.id ? "away" : "";
      if (m.kind === "gridiron") {
        const dr = sum.drives || {}, list = [...(dr.previous || []).slice(-2), dr.current].filter(Boolean);
        const out = [];
        list.forEach(d => (d.plays || []).forEach(p => out.push({ id: String(p.id || p.sequenceNumber || p.text), text: p.text || "", team: teamOf((d.team || {}).id), type: (p.type || {}).text || "", scoring: !!p.scoringPlay,
          ytez: Number.isFinite(+((p.start || {}).yardsToEndzone)) && (p.start || {}).yardsToEndzone !== "" ? +p.start.yardsToEndzone : NaN })));
        return out;
      }
      if (m.kind === "pitch") return (sum.keyEvents || []).map(e => ({ id: String(e.id || e.text), text: e.text || "", team: teamOf((e.team || {}).id), type: (e.type || {}).text || (e.type || {}).type || "", scoring: !!e.scoringPlay,
        fx: e.fieldPositionX, fy: e.fieldPositionY }));
      // basketball and hockey plays can carry a shot location; baseball a hit location
      return (sum.plays || []).map(p => ({ id: String(p.id || p.sequenceNumber || p.text), text: String(p.text || "").trim(), team: teamOf((p.team || {}).id), type: (p.type || {}).text || "", scoring: !!p.scoringPlay,
        xy: p.coordinate || null, hit: p.hitCoordinate || null }));
    }
    function queuePlays(sp, kind, sum, m, first) {
      const all = feedPlays(sum, m).filter(p => p.text), q = plays[sp] || (plays[sp] = []), s = seen[sp] || (seen[sp] = new Set());
      // the first time, act out only the most recent play we can draw
      const fresh = all.filter(p => !s.has(p.id));
      fresh.forEach(p => s.add(p.id));
      const drawable = fresh.filter(p => p.team && SPORT[kind].live && SPORT[kind].live(p, () => 0.5));
      if (m.replay) { q.push(...drawable); return; }
      if (first) { if (drawable.length) q.push(drawable[drawable.length - 1]); }
      else q.push(...drawable.slice(-3));
      while (q.length > 3) q.shift();
    }
    async function refresh(sp, kind, force) {
      const m = state[sp];
      if (m && m.replay) { if (!(plays[sp] || []).length) { seen[sp] = new Set(); queuePlays(sp, kind, m.sum, m, false); } return; }
      if (m && m.mode === "live") {
        const sum = await jget(`${ESPN}${m.path}/summary?event=${m.g.id}`);
        if (sum) {
          m.status = liveStatus(sum, m);
          if (m.status.state !== "in") { state[sp] = await load(sp, kind, force); return; }
          queuePlays(sp, kind, sum, m, false);
        }
        return;
      }
      state[sp] = await load(sp, kind, force);
    }
    const timers = {}, ready = {};
    return {
      // resolves once the first look at the slate is done (the field waits a moment for it)
      watch(sp, kind) {
        if (timers[sp]) return ready[sp];
        const force = (new URLSearchParams(location.search).get("labmode") || store.get("lab-mode") || "").toLowerCase();
        if (force === "classic") { state[sp] = { mode: "classic" }; timers[sp] = 1; return (ready[sp] = Promise.resolve()); }
        let done; ready[sp] = new Promise(res => { done = res; });
        const tick = () => refresh(sp, kind, force).catch(() => {}).finally(() => {
          done();
          timers[sp] = setTimeout(tick, state[sp] && state[sp].mode === "live" ? (state[sp].replay ? 6000 : 20000) : 5 * 60e3);
        });
        tick();
        return ready[sp];
      },
      now(sp) { return state[sp] || null; },
      take(sp) { const q = plays[sp]; return q && q.length ? q.shift() : null; },
    };
  })();

  // put the players a live play names into the spots that act it out
  function placeNames(v, actors, text, T) {
    const found = namesIn(text, T.m), used = new Set();
    actors.forEach(([i, sd], n) => {
      const team = sd === "o" ? T.o : T.d;
      let f = found.find(x => x.s === team && !used.has(x));
      if (!f && n === 0) {                                   // no roster match: the name the play starts with
        const lead = /^([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2})\s+[a-z(]/.exec(text);
        if (lead) f = { p: { name: lastName({ displayName: lead[1] }), full: lead[1], jersey: "" }, s: team };
      }
      if (!f) return;
      used.add(f);
      const j = v.kits.findIndex(k => k.side === team && k[0] === f.p.name);
      if (j >= 0 && j !== i) [v.kits[i], v.kits[j]] = [v.kits[j], v.kits[i]];
      else if (j < 0) { const k = kitFor(team, f.p); k.role = v.kits[i].role; v.kits[i] = k; }
    });
  }
  function shortText(t) {
    t = String(t).replace(/\s+/g, " ").replace(/^\(\d+:\d+\)\s*/, "").trim();
    return t.length <= 96 ? t : t.slice(0, 94).replace(/\s+\S*$/, "") + "…";
  }
  function liveLine(m) {
    const st = m.status || {};
    return `${m.away.abbr} ${st.away ?? ""}, ${m.home.abbr} ${st.home ?? ""}${st.detail ? " · " + st.detail : ""}`;
  }

  // ---------- running a scene on a canvas ----------
  // kinds: one kind, or a list to rotate through (one play each).
  // next(n): which sport plays the nth play, {kind, key}
  function runField(c, next, onKind) {
    let W = 0, H = 0, dpr = 1, cache = {}, raf = 0, startAt = performance.now(), v = null;
    let play = -1, playStart = 0, kind = null, key = null;
    const salt = parseInt(new URLSearchParams(location.search).get("labseed"), 10) || Math.floor(Math.random() * 1e6);                     // a different run of plays on every visit
    const x = c.getContext("2d");
    function size() {
      const r = c.getBoundingClientRect();
      W = r.width; H = r.height; dpr = Math.min(2, devicePixelRatio || 1);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      cache = {};
    }
    const margin = k => SPORT[k].centered ? 0 : Math.round(W * (W < 760 ? 0.5 : 0.1));
    function bgFor(k) { return cache[k] || (cache[k] = background(k, W, H, dpr, margin(k))); }
    let pan = 0, lastNow = 0, lastDraw = 0;
    function frame(now) {
      raf = 0;
      if (!W || !H) { size(); if (!W || !H) return; }
      const el = still ? 3.4 : Math.max(0, (now - startAt) / 1000);   // the first frame can stamp a hair before startAt
      // a new play: the next sport in line, a fresh lineup, fresh skin tones, a fresh outcome
      if (play < 0 || (!still && el - playStart >= SPORT[kind].D)) {
        playStart = play < 0 ? 0 : playStart + SPORT[kind].D;
        if (el - playStart > 1) playStart = el;                         // back from a hidden tab: start fresh
        play++;
        ({ kind, key } = next(play));
        const sp = SPORT[kind];
        let seed = (salt + play * 7919) % 2147483646 + 1;
        const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        r(); r();
        // today's teams (a real play when a game is live), or the greats and their famous plays
        const m = key ? director.now(key) : null, classics = CLASSICS_BY[key] || sp.classics;
        let said;
        if (m && m.home) {
          const lp = m.mode === "live" ? director.take(key) : null;
          const T = teamsT(kind, m, lp ? lp.team : r() < 0.5 ? "home" : "away");
          v = sp.variant(r, T, (lp ? sp.live(lp, r) : m.mode === "live" ? sp.quiet : null) || {});
          if (lp) placeNames(v, sp.actors(v), lp.text, T);
          feature(v.kits, sp.actors(v).map(a => a[0]));
          const tag = m.replay ? "Replay" : "Live";
          const named = sp.actors(v).every(([i]) => v.kits[i] && !v.kits[i].anon);
          const when = new Date(m.g.start).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
          said = lp ? `${tag} · ${shortText(lp.text)}` : m.mode === "live" ? `${tag} · ${liveLine(m)}`
            : `${m.away.abbr} @ ${m.home.abbr} · ${named ? sp.caption(v) : `${m.away.short} at ${m.home.short}, ${when} ET`}`;
        } else if (classics && r() < 0.5) {
          v = famous(sp, classics[Math.floor(r() * classics.length)], r); said = v.cap;
        } else { v = sp.variant(r, CLASSIC); said = sp.caption(v); }
        v.skins = Array.from({ length: 24 }, () => SKIN[Math.floor(r() * SKIN.length)]);
        if (onKind) onKind(kind, said, key);
      }
      const sp = SPORT[kind], t = still ? 3.4 : el - playStart;
      const bg = bgFor(kind), cam = bg.cam;
      const cast = tt => sp.cast(clamp(tt, 0, sp.D), v);
      const now0 = cast(t);
      // the camera pans to keep the ball in view, a little left of center on wide screens (clear of the pick card)
      if (bg.M) {
        const b = now0.ball, bx = cam.P(b.X, b.Y || 0, b.Z)[0] - bg.M, focus = W * (W >= 980 ? 0.55 : 0.5);
        const want = clamp(focus - bx, -bg.M, bg.M), dt = clamp((now - lastNow) / 1000, 0, 0.1);
        pan = t < 0.05 || still ? want : pan + (want - pan) * Math.min(1, dt * 1.8);
      } else pan = 0;
      lastNow = now;
      const ox = pan - bg.M;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.globalAlpha = 1;
      x.drawImage(bg.canvas, ox, 0, bg.W, H);
      x.setTransform(dpr, 0, 0, dpr, dpr * ox, 0);
      const fade = still ? 1 : clamp(t / 0.35) * clamp((sp.D - t) / 0.45);
      x.globalAlpha = fade;
      now0.players.forEach((p, j) => { p.kit = v.kits[j]; p.skin = v.skins[j]; });
      if (three && three.ready && kind === "court") draw3d(x, cam, now0.players, t, sp, { W, H, ox, M: bg.M, kind, dpr, dt: clamp((now - (lastDraw || now)) / 1000, 0, 0.1) });
      else now0.players.slice().sort((a, b) => b.Z - a.Z).forEach(p => figure(x, cam, p, t, sp));
      lastDraw = now;
      if (sp.goal && sp.goal.Y) drawRim(x, cam, sp.goal, now0.ball.swish);
      drawBall(x, cam, now0.ball, cast, t);
      if (kind === "court") glow(x, cam, sp.goal, now0.flash, "255,200,140");
      if (now0.flashAt) glow(x, cam, now0.flashAt, now0.flash, "255,236,200");
      if (now0.hitFlash) glow(x, cam, now0.hitAt, now0.hitFlash, "255,236,200");
      if (now0.lamp) glow(x, cam, { X: 27.8, Y: 2.6, Z: 22.5 }, (Math.sin(t * 18) > 0 ? 1 : 0.6) * now0.lamp, "230,40,40");
      x.globalAlpha = 1;
      if (!still) flashes(x, bg, bg.W, el);
      if (!still) raf = requestAnimationFrame(frame);
    }
    size();
    let w0 = W, timer;
    addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { const r = c.getBoundingClientRect(); if (Math.abs(r.width - w0) > 1 || Math.abs(r.height - H) > 40) { w0 = r.width; size(); if (!raf) raf = requestAnimationFrame(frame); } }, 150);
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf && !still) raf = requestAnimationFrame(frame); });
    raf = requestAnimationFrame(frame);
    return { stop() { if (raf) cancelAnimationFrame(raf); raf = 0; } };
  }

  // ---------- where this page is ----------
  const KIND_OF = { NFL: "gridiron", CFB: "gridiron", MLB: "park", NHL: "ice", NBA: "court", CBB: "court", SOCCER: "pitch" };
  const SPORT_OF_KIND = { court: "nba", gridiron: "nfl", park: "mlb", ice: "nhl", pitch: "soccer" };
  const ROTATION = ["court", "gridiron", "park", "ice", "pitch"];
  const isHome = !!document.getElementById("heroArt");
  const leagueParam = (new URLSearchParams(location.search).get("l") || "").toUpperCase();
  const pageSport = isHome ? leagueParam : String((document.querySelector("header.masthead") || {}).dataset?.sport || "").toUpperCase();
  const head = isHome ? document.querySelector("header.hero") : document.querySelector("header.masthead");
  if (!head) return;
  let field = null;

  function startField() {
    if (field) return;
    let c = isHome ? document.getElementById("heroArt") : head.querySelector("canvas.stadium");
    if (!c) return;
    // a fresh canvas, so the page's own drawing can't paint over ours
    const n = c.cloneNode(false); n.classList.add("lab-field"); c.replaceWith(n); c = n;
    let cap = head.querySelector(".lab-caption");
    if (!cap) { cap = document.createElement("div"); cap.className = "lab-caption"; cap.setAttribute("aria-hidden", "true"); head.append(cap); }
    const pageKey = pageSport && NAME[pageSport.toLowerCase()] ? pageSport.toLowerCase() : null;
    const keys = pageKey ? [pageKey] : HOME_SPORTS;
    const waits = keys.map(k => director.watch(k, KIND_OF[k.toUpperCase()]));
    let lastKey = null;
    const go = () => { if (!field.c) field.c = runField(c, pageKey ? () => ({ kind: KIND_OF[pageSport], key: pageKey }) : homeNext, (k, said, key) => {
      cap.textContent = said || ""; cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      if (!pageKey && key !== lastKey) card.show(key);
      lastKey = key;
    }); };
    field = {};
    Promise.race([Promise.all(waits), new Promise(res => setTimeout(res, 3000))]).then(go);
  }
  // The home page's order: sports with a game on right now come first (a
  // today's game slips in every third play); then sports with games later
  // today; the greats and their famous plays only when no game is on today.
  const HOME_SPORTS = ["nfl", "cfb", "mlb", "nhl", "nba", "cbb", "soccer"];
  let homeTurn = 0;
  function homeNext() {
    const tier = k => { const m = director.now(k); return m && m.mode === "live" ? 2 : m && m.home ? 1 : 0; };
    const live = HOME_SPORTS.filter(k => tier(k) === 2), today = HOME_SPORTS.filter(k => tier(k) === 1);
    const n = homeTurn++;
    let pool = live.length ? live : today.length ? today : ["nba", "nfl", "mlb", "nhl", "soccer"];
    if (live.length && today.length && n % 3 === 2) pool = today;
    const key = pool[n % pool.length];
    return { kind: KIND_OF[key.toUpperCase()], key };
  }
  function stopField() { location.reload(); }
  // a still header: the page's sport in a famous venue, no players. On the
  // home page it turns from sport to sport (sports with games today first),
  // and the pick card and record tab turn with it.
  function drawStadium(keys) {
    keys = keys.filter(k => VENUES[k]); if (!keys.length) return false;
    let c = isHome ? document.getElementById("heroArt") : head.querySelector("canvas.stadium");
    if (!c) return false;
    const n = c.cloneNode(false); n.classList.add("lab-field"); c.replaceWith(n); c = n;
    let cap = head.querySelector(".lab-caption");
    if (!cap) { cap = document.createElement("div"); cap.className = "lab-caption"; cap.setAttribute("aria-hidden", "true"); head.append(cap); }
    const x = c.getContext("2d");
    let cache = {}, W = 0, H = 0, dpr = 1, i = 0, from = null, at = 0, raf = 0;
    const bg = k => cache[k] || (cache[k] = pano(VENUES[k], W, H, dpr).canvas);
    const size = () => { const r = c.getBoundingClientRect(); W = r.width; H = r.height; dpr = Math.min(2, devicePixelRatio || 1); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); cache = {}; };
    const paint = () => {
      const u = from == null || still ? 1 : clamp((performance.now() - at) / 1200);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
      if (from != null && u < 1) x.drawImage(bg(from), 0, 0);
      x.globalAlpha = ease(u); x.drawImage(bg(keys[i]), 0, 0); x.globalAlpha = 1;
      raf = u < 1 ? requestAnimationFrame(paint) : 0;
    };
    const turn = () => {
      const k = keys[i], V = VENUES[k];
      cap.textContent = `${V.name} · ${V.city}`; cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      if (isHome) card.show(k);
      at = performance.now(); if (!raf) raf = requestAnimationFrame(paint);
    };
    size(); turn();
    if (keys.length > 1 && !still) setInterval(() => { if (document.hidden) return; from = keys[i]; i = (i + 1) % keys.length; turn(); }, 8000);
    let w0 = W, tm;
    addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(() => { const w = c.getBoundingClientRect().width; if (Math.abs(w - w0) > 1) { w0 = w; size(); from = null; paint(); } }, 150); });
    return true;
  }
  // home: sports with a game today first, the rest after
  async function venueOrder() {
    const all = ["nfl", "cfb", "mlb", "nhl", "nba", "cbb", "soccer"];
    const today = await Promise.all(all.map(k => games(k).then(d => ((d && d.games) || []).some(g => g.state === "in" || g.state === "pre")).catch(() => false)));
    const on = all.filter((k, j) => today[j]);
    return on.length ? on : all;
  }

  // ---------- pick card and record tab ----------
  const ROOT = window.LAB_ROOT == null ? "/" : window.LAB_ROOT;  // "" in the self-contained preview
  const summaries = {};
  function summary(sp) {
    if (!summaries[sp]) summaries[sp] = fetch(`${ROOT}${sp}/summary.json`, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
    return summaries[sp];
  }
  const gamesCache = {};
  function games(sp) {
    if (!gamesCache[sp]) gamesCache[sp] = fetch(`${ROOT}${sp}/games.json`, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
    return gamesCache[sp];
  }
  // the surest pick among games that haven't started, from the same games.json the score bar uses
  function surest(d) {
    let best = null;
    ((d && d.games) || []).forEach(g => {
      if (g.state !== "pre" || !g.pick || !g.pick.text) return;
      const m = /^(\S+)(?: to win,)? (\d+(?:\.\d+)?)%/.exec(g.pick.text);
      if (!m) return;
      const prob = parseFloat(m[2]);
      if (!best || prob > best.prob) best = { g, prob, team: m[1] };
    });
    return best;
  }
  const NAME = { nfl: "NFL", cfb: "CFB", mlb: "MLB", nhl: "NHL", nba: "NBA", cbb: "CBB", soccer: "Soccer" };
  const card = (() => {
    let el = null, tab = null, shown = null;
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    function build() {
      if (el) return;
      el = document.createElement("a"); el.className = "lab-pick"; el.setAttribute("aria-live", "polite");
      tab = document.createElement("div"); tab.className = "lab-tab";
      head.append(el, tab);
    }
    async function show(sp) {
      if (!on.touches) return;
      build();
      shown = sp;
      const [d, gs] = await Promise.all([summary(sp), games(sp)]);
      if (shown !== sp || !d) return;
      const best = surest(gs), rec = d.record || {};
      if (best) {
        const { g } = best, us = g.away.abbr === best.team ? g.away : g.home, them = us === g.away ? g.home : g.away;
        const when = new Date(g.start).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
        el.href = `${ROOT ? "/" : "https://ant56-arch.github.io/"}${sp}/${g.url || "index.html"}`;
        el.innerHTML = `<div class="lab-pick-top"><span>${esc(NAME[sp])}</span><span>Surest pick</span></div>
           <b class="lab-pick-name">${esc(us.short || us.abbr)} over ${esc(them.short || them.abbr)}</b><small>${esc(g.away.abbr)} ${g.neutral ? "vs" : "@"} ${esc(g.home.abbr)} · ${esc(when)} ET</small>
           <div class="lab-pick-num">${Math.round(best.prob)}<i>%</i></div>
           <div class="lab-pick-bar"><span style="width:${best.prob}%"></span></div><small class="lab-pick-cap">Our chance to win</small>`;
      } else {
        el.removeAttribute("href");
        el.innerHTML = `<div class="lab-pick-top"><span>${esc(NAME[sp])}</span><span>Surest pick</span></div><b class="lab-pick-name">${(gs && (gs.games || []).length) ? "No picks left to play today." : "No games today."}</b>`;
      }
      tab.innerHTML = `<div><b>${esc(rec.value || "")}</b><span>${esc(NAME[sp])} record</span></div><div><b>${esc(rec.sub || "")}</b><span>Right</span></div><div><b>${esc((rec.since || "").replace(/, \d{4}$/, ""))}</b><span>Graded since</span></div>`;
      head.style.setProperty("--lab-tab-w", tab.offsetWidth + "px");
      el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
      const sheet = document.querySelector(".edge-sheet, .sheet, main");
      if (sheet) { const cs = getComputedStyle(sheet); head.style.setProperty("--lab-sheet", cs.backgroundColor); head.style.setProperty("--lab-sheet-ink", cs.color); }
    }
    return { show };
  })();

  // ---------- the Test panel ----------
  function panel() {
    const box = document.createElement("div");
    box.className = "lab-panel";
    box.innerHTML = `<button type="button" class="lab-panel-btn" aria-expanded="false">Test</button>
      <div class="lab-panel-body" hidden><p>Test build. The live site is unchanged.</p>
      ${OPTS.map(([k, label]) => `<label><input type="checkbox" data-k="${k}" ${on[k] ? "checked" : ""}> ${label}</label>`).join("")}
      <label class="lab-mode">Players <select>${[["", "Today's teams (live when on)"], ["classic", "All-time greats"], ["replay", "Replay a finished game"]]
        .map(([k, l]) => `<option value="${k}"${(store.get("lab-mode") || "") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <a href="https://ant56-arch.github.io${location.pathname.replace(/^\/lab/, "")}${location.search}">Open the live version</a></div>`;
    const btn = box.querySelector("button"), body = box.querySelector(".lab-panel-body");
    btn.addEventListener("click", () => { body.hidden = !body.hidden; btn.setAttribute("aria-expanded", String(!body.hidden)); });
    box.querySelector("select").addEventListener("change", e => { store.set("lab-mode", e.target.value); location.reload(); });
    box.querySelectorAll("input").forEach(i => i.addEventListener("change", () => {
      on[i.dataset.k] = i.checked; store.set("lab-" + i.dataset.k, i.checked ? "1" : "0");
      apply(i.dataset.k);
    }));
    document.body.append(box);
  }

  function apply(k) {
    document.body.classList.toggle("lab-touches", on.touches);
    document.body.classList.toggle("lab-serif", on.serif);
    if (k === "three") { location.reload(); return; }
    if (k == null && new URLSearchParams(location.search).get("labvenue") !== "0") {      // stadium headers are the lab default
      if (pageSport) drawStadium([pageSport.toLowerCase()]); else venueOrder().then(drawStadium);
      if (on.touches && pageSport) card.show(pageSport.toLowerCase());
      return;
    }
    else if (k === "field" || k == null) { loadThree(); if (on.field) startField(); else if (field) stopField(); }
    if ((k === "touches" || k == null) && on.touches && (!on.field || KIND_OF[pageSport])) {
      card.show((pageSport && NAME[pageSport.toLowerCase()]) ? pageSport.toLowerCase() : "nba");
    }
  }

  // the home page redraws its hero on league and resize changes; leave the canvas to us
  if (isHome && typeof window.drawHero === "function") {
    const own = window.drawHero;
    window.drawHero = function () { if (!on.field) own(); };
  }
  if (!isHome && typeof window.edgeStadium === "function") {
    const own = window.edgeStadium;
    window.edgeStadium = function (c, kind) { if (!c.classList.contains("lab-field")) own(c, kind); };
  }

  document.body.classList.add("lab");
  panel();
  apply();
})();
