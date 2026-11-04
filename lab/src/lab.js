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
    ["field", "Moving field"],
    ["touches", "Pick card + record tab"],
    ["serif", "Serif headline"],
  ];
  const on = {};
  OPTS.forEach(([k]) => { on[k] = store.get("lab-" + k) !== "0"; });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- small helpers ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = v => v * v * (3 - 2 * v);
  const lerp = (a, b, u) => a + (b - a) * u;
  // keyframed path: keys [[t, X, Z], ...], smooth between keys, held outside them
  function path(keys, t) {
    if (t <= keys[0][0]) return { X: keys[0][1], Z: keys[0][2] };
    for (let i = 1; i < keys.length; i++) {
      const [t1, x1, z1] = keys[i], [t0, x0, z0] = keys[i - 1];
      if (t <= t1) { const u = ease((t - t0) / (t1 - t0 || 1)); return { X: lerp(x0, x1, u), Z: lerp(z0, z1, u) }; }
    }
    const k = keys[keys.length - 1];
    return { X: k[1], Z: k[2] };
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
        const L = 14.33, n = 7, f = zc + 7.62;
        g.fillPoly([[-L, n], [L, n], [L, f], [-L, f]], "rgba(160,116,72,1)");
        g.stripes(-L, L, n, f, 32, "rgba(255,255,255,.035)", "rgba(0,0,0,.05)");
        [-1, 1].forEach(s => {                                                   // painted keys
          g.fillPoly([[s * L, zc - 2.45], [s * (L - 5.8), zc - 2.45], [s * (L - 5.8), zc + 2.45], [s * L, zc + 2.45]], "rgba(229,121,59,.34)");
        });
        g.line([[-L, n], [L, n], [L, f], [-L, f], [-L, n]], 2.2);
        g.line([[0, n], [0, f]], 2);
        g.circle(0, zc, 1.83, 2);
        [-1, 1].forEach(s => {
          g.line([[s * L, zc - 2.45], [s * (L - 5.8), zc - 2.45], [s * (L - 5.8), zc + 2.45], [s * L, zc + 2.45]], 1.8);
          g.circle(s * (L - 5.8), zc, 1.83, 1.8);
          const k3 = Math.asin(6.7 / 7.24), mid3 = s > 0 ? -Math.PI / 2 : Math.PI / 2;   // the arc meets the corner lines
          g.arcLine(s * 12.7, zc, 7.24, mid3 - k3, mid3 + k3, 1.8);
          const c3 = 12.7 - 7.24 * Math.cos(k3); g.line([[s * L, zc - 6.7], [s * c3, zc - 6.7]], 1.8); g.line([[s * L, zc + 6.7], [s * c3, zc + 6.7]], 1.8);
        });
        g.ellipseW(0, zc, 1.83, "rgba(229,121,59,.28)");
        [-1, 1].forEach(s => g.hoop(s, zc));
      },
      goal: B,
      variant(r, T, F = {}) {
        const kits = T.kits([["HOOPS", "o", 5], ["HOOPS", "d", 5]], r);
        return { kits, shooter: F.shooter ?? 1 + Math.floor(r() * 4), make: F.make ?? r() < 0.7 };
      },
      actors(v) { return [[v.shooter, "o"], [0, "o"], [v.shooter + 5, "d"], [v.shooter === 3 ? 9 : 8, "d"]]; },
      // a real play from a live game: which shot, and did it go in
      live(p, r) {
        const t = p.text;
        if (!/\b(makes|misses)\b/.test(t) || /free throw/i.test(t)) return null;
        const three = /three point|three-point|3-pt|3pt/i.test(t), inside = /layup|dunk|tip|hook|driving|alley|putback|finger roll/i.test(t);
        return { make: /\bmakes\b/.test(t), shooter: three ? (r() < 0.5 ? 2 : 4) : inside ? 3 : 1 };
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
        const sh = v.shooter, reb = sh === 3 ? 9 : 8, P = [];
        O.forEach((k, i) => {
          const p = path(k, t);
          if (i === sh && t > 2.95 && t < 3.85) { p.Y = t > 3.2 ? 0.5 * Math.sin(Math.PI * span(t, 3.2, 3.85)) : 0; p.arms = "shoot"; }
          if (i === 0 && t < 2.4) p.arms = "dribble";
          P.push({ ...p, keys: k, face: 1 });
        });
        O.forEach((k, i) => {
          const p = mark(k, t, B, i === sh ? 1.1 : 1.5);
          if (i === sh && t > 3.3 && t < 3.9) { p.Y = 0.35 * Math.sin(Math.PI * span(t, 3.3, 3.9)); p.arms = "up"; }
          if (i + 5 === reb && t > 4.75 && t < 5.3) { p.Y = 0.45 * Math.sin(Math.PI * span(t, 4.75, 5.3)); p.arms = "up"; }
          if (!p.arms && t < 4.6) p.arms = "guard";
          P.push({ ...p, keys: k, lag: 0.28, face: -1 });
        });
        const pg = P[0], w = P[sh], rb = P[reb];
        const w0 = path(O[sh], 2.95), w1 = path(O[sh], 3.55);
        let ball;
        if (t < 2.4) ball = { X: pg.X + 0.35, Y: 0.15 + Math.abs(Math.sin(t * 6.5)) * 0.85, Z: pg.Z - 0.35 };
        else if (t < 2.95) { const p0 = path(O[0], 2.4); ball = arc({ X: p0.X + 0.3, Y: 1.2, Z: p0.Z - 0.3 }, { X: w0.X - 0.2, Y: 1.3, Z: w0.Z - 0.3 }, 0.25, span(t, 2.4, 2.95)); }
        else if (t < 3.55) ball = { X: w.X, Y: lerp(1.3, 2.5, span(t, 2.95, 3.55)) + (w.Y || 0), Z: w.Z - 0.25 };
        else if (t < 4.6) { const d = Math.hypot(B.X - w1.X, B.Z - w1.Z); ball = arc({ X: w1.X, Y: 2.9, Z: w1.Z - 0.25 }, B, 0.9 + 0.2 * d, span(t, 3.55, 4.6)); }
        else if (v.make && t < 4.9) ball = { X: B.X, Y: lerp(B.Y, 1.7, span(t, 4.6, 4.9)), Z: B.Z, swish: span(t, 4.6, 4.9) };
        else if (v.make) { const u = span(t, 4.9, 6.2); ball = { X: B.X - 1.5 * u, Y: 0.12 + Math.abs(Math.cos(u * 7)) * 1.5 * (1 - u), Z: B.Z - 0.6 * u }; }
        else if (t < 5.2) { const r1 = path(O[reb - 5], 5.2 - 0.28); ball = arc({ X: B.X - 0.25, Y: B.Y + 0.1, Z: B.Z }, { X: r1.X - 0.6, Y: 2.7, Z: r1.Z - 0.3 }, 1.3, span(t, 4.6, 5.2)); }
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
        g.fillPoly([[G, n], [E, n], [E, f], [G, f]], "rgba(229,121,59,.42)");
        g.fillPoly([[-E, n], [-G, n], [-G, f], [-E, f]], "rgba(30,58,44,.9)");
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
        v.cut = (r() * 2 - 1) * 2.5;
        return v;
      },
      actors(v) { return v.run ? [[6, "o"], [14, "d"]] : [[5, "o"], [v.target, "o"], [TGT[v.target].def, "d"]]; },
      live(p) {
        const t = p.text;
        if (/punt|kicks|kickoff|field goal|extra point|penalty|timeout|two-minute|end of|kneels|spiked|sacked|two-point/i.test(t + " " + p.type)) return null;
        const y = /for (-?\d+) yards?/.exec(t), yards = y ? Number(y[1]) : 0;
        if (/\bpass\b/i.test(t)) { const caught = !/incomplete|intercept/i.test(t); return { run: false, caught, target: caught && yards >= 20 ? 7 : /middle/i.test(t) ? 9 : 8 }; }
        if (/rush|left end|right end|up the middle|left tackle|right tackle|left guard|right guard|scrambles|for no gain/i.test(t + " " + p.type)) return { run: true, yards };
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
        if (/homered|home run|grand slam/i.test(t)) return { type: "hr", a };
        if (/singled|doubled|tripled/i.test(t)) return { type: "hit", a };
        if (/flied out|lined out|popped out|fouled out|sacrifice fly|flied into/i.test(t)) return { type: "fly", a };
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
        return { kits, solo: F.solo ?? r() < 0.35, goal: F.goal ?? r() < 0.65, high: F.high ?? r() < 0.5 };
      },
      actors(v) { return v.solo ? [[0, "o"], [10, "d"]] : [[1, "o"], [0, "o"], [10, "d"]]; },
      live(p, r) {
        const goal = p.scoring || /^goal/i.test(p.type);
        if (!goal && !(/shot/i.test(p.type) && !/miss|block|wide/i.test(p.type + " " + p.text))) return null;
        return { goal, solo: goal ? !/assist/i.test(p.text) : r() < 0.5 };
      },
      quiet: { goal: false },
      caption(v) {
        const N = i => nameOf(v.kits[i]), a = N(0), b = N(1), g = N(10);
        if (v.solo) return v.goal ? `${a} snipes one past ${g}.` : `${g} gloves ${a}'s wrister.`;
        return v.goal ? `${a} feeds ${b} for the one-timer. Goal.` : `${g} robs ${b} on the one-timer.`;
      },
      cast(t, v) {
        const P = [], K1 = v.solo ? O1SOLO : O1, ks = [K1, O2, O3, O4, O5];
        ks.forEach(k => P.push({ ...path(k, t), keys: k, face: 1, stick: 1 }));
        ks.forEach(k => { const m = mark(k, t, G, 2.6, 0.32); P.push({ ...m, Z: m.Z + 1.7, keys: k, lag: 0.32, face: -1, stick: 1 }); });
        const shK = v.solo ? K1 : O2, tShot = v.solo ? 3.35 : 3.65, tIn = tShot + 0.3, s0 = path(shK, tShot);
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
        else if (!v.solo && t < 3.35) ball = arc(blade(path(O1, 2.95)), blade(path(O2, 3.35)), 0, span(t, 2.95, 3.35));
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
          goal: F.goal ?? r() < 0.62, gz: F.gz ?? mid + (r() * 2 - 1) * 2.8, gy: F.gy ?? 0.4 + r() * 1.6 };
      },
      actors(v) { const sh = v.type === "header" ? 2 : v.type === "volley" ? 3 : 1; return sh === 1 ? [[1, "o"], [12, "d"]] : [[sh, "o"], [1, "o"], [12, "d"]]; },
      live(p) {
        const t = p.text, goal = p.scoring || /^goal/i.test(p.type) || /^goal!/i.test(t);
        if (!goal && !/saved/i.test(t)) return null;
        if (/own goal|penalty/i.test(t)) return null;
        return { goal, type: /header|headed/i.test(t) ? "header" : /outside the box|long range|from distance/i.test(t) ? "long" : "volley" };
      },
      quiet: { goal: false },
      caption(v) {
        const N = i => nameOf(v.kits[i]), k = N(12);
        if (v.type === "header") return v.goal ? `${N(1)} crosses, ${N(2)} heads it in.` : `${k} saves ${N(2)}'s header.`;
        if (v.type === "volley") return v.goal ? `${N(1)} cuts it back, ${N(3)} buries it.` : `${k} stops ${N(3)} from close range.`;
        return v.goal ? `${N(1)} curls one in from distance.` : `${k} tips ${N(1)}'s strike wide.`;
      },
      cast(t, v) {
        const P = [], ks = [O1, O2, O3, v.type === "volley" ? O4V : O4, O5];
        ks.forEach(k => P.push({ ...path(k, t), keys: k, face: 1 }));
        ks.forEach(k => P.push({ ...mark(k, t, G, 2.4, 0.34), keys: k, lag: 0.34, face: -1 }));
        P.push({ ...path([[0, 38, mid + 14], [4, 40, mid + 6]], t), face: -1 });
        P.push({ ...path([[0, 31, mid - 10], [4, 37, mid - 13]], t), face: -1 });
        const S = v.type === "header" ? { t0: 4.3, t1: 4.7, from: () => { const c = path(O3, 4.3); return { X: c.X + 0.2, Y: 2.1, Z: c.Z }; }, peak: 0.3 }
          : v.type === "volley" ? { t0: 4.0, t1: 4.4, from: () => { const c = path(O4V, 4.0); return { X: c.X + 0.5, Y: 0.3, Z: c.Z }; }, peak: 0.6 }
          : { t0: 3.3, t1: 3.95, from: () => { const c = path(O2, 3.3); return { X: c.X + 0.7, Y: 0.15, Z: c.Z - 0.3 }; }, peak: 2.2 };
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
        else if (t < 1.9) ball = arc({ X: path(O1, 1.4).X + 0.6, Y: 0.11, Z: path(O1, 1.4).Z - 0.3 }, { X: path(O2, 1.9).X + 0.5, Y: 0.11, Z: path(O2, 1.9).Z - 0.3 }, 0, span(t, 1.4, 1.9));
        else if (t < 3.3) ball = { X: b.X + 0.7, Y: 0.11 + Math.abs(Math.sin(t * 5)) * 0.15, Z: b.Z - 0.3 };
        else if (t < S.t0) {
          const b0 = path(O2, 3.3), from = { X: b0.X + 0.7, Y: 0.11, Z: b0.Z - 0.3 };
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
  function camera(sp, W, H, M = 0) {
    const zfit = sp.fitZf || sp.zf;
    const top = W < 760 ? 0.3 : 0.36, bot = 0.995;
    const f = (bot - top) * H / (sp.h * (1 / sp.zn - 1 / zfit));
    const hz = top * H - f * sp.h / zfit;
    // keep the action a little right of center on wide screens (the headline sits on the left)
    const cx = sp.ax - (W >= 760 && !sp.centered ? 0.03 * W * sp.az / f : 0);
    return {
      f, hz,
      P: (X, Y, Z) => [W / 2 + M + f * (X - cx) / Z, hz + f * (sp.h - Y) / Z],
      s: Z => f / Z,
    };
  }

  // ---------- the still background: sky or roof, stands, field, lights ----------
  function background(kind, Wv, H, dpr, M = 0) {
    const sp = SPORT[kind], cam = camera(sp, Wv, H, M), W = Wv + 2 * M;
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext("2d"); x.scale(dpr, dpr);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const back = cam.P(0, 0, sp.zf + (sp.indoor ? 3 : 6))[1];          // where the stands meet the far side
    let g = x.createLinearGradient(0, 0, 0, back);
    if (sp.indoor) { g.addColorStop(0, "#07090A"); g.addColorStop(0.7, "#141A1C"); g.addColorStop(1, "#2A2620"); }
    else { g.addColorStop(0, "#0B1418"); g.addColorStop(0.5, "#1D2A33"); g.addColorStop(0.82, "#6B4A3A"); g.addColorStop(1, "#C98A55"); }
    x.fillStyle = g; x.fillRect(0, 0, W, back + 2);
    if (sp.indoor) {
      x.strokeStyle = "rgba(242,238,230,.06)"; x.lineWidth = 1;
      for (let i = 0; i <= 14; i++) { x.beginPath(); x.moveTo(W * i / 14, 0); x.lineTo(W * 0.5 + (i - 7) * W * 0.03, back - H * 0.2); x.stroke(); }
    }
    // stands behind the far side (drawn first, so hoops and posts stand in front of them), with the crowd in them
    const rise = H * (sp.indoor ? 0.24 : 0.18);
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
      // things that stand up off the field
      post(X, Z, Y0, Y1, wd, color) { const a = P(X, Z, Y0), b = P(X, Z, Y1); x.strokeStyle = color; x.lineWidth = wd; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); },
      seg3(a, b, wd, color) { const p = cam.P(...a), q = cam.P(...b); x.strokeStyle = color; x.lineWidth = wd; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke(); },
      hoop(s, zc) {
        const bx = s * 13.1, s0 = cam.s(zc);
        gfx.post(s * 14.4, zc, 0, 3.3, Math.max(2, 0.14 * s0), "#14181A");
        gfx.seg3([s * 14.4, 3.3, zc], [bx, 3.3, zc], Math.max(2, 0.1 * s0), "#14181A");
        const tl = cam.P(bx, 4.0, zc - 0.9), br = cam.P(bx, 2.95, zc + 0.9), tr = cam.P(bx, 4.0, zc + 0.9), bl = cam.P(bx, 2.95, zc - 0.9);
        x.fillStyle = "rgba(242,238,230,.16)"; x.strokeStyle = "rgba(242,238,230,.85)"; x.lineWidth = Math.max(1.2, 0.04 * s0);
        x.beginPath(); x.moveTo(tl[0], tl[1]); x.lineTo(tr[0], tr[1]); x.lineTo(br[0], br[1]); x.lineTo(bl[0], bl[1]); x.closePath(); x.fill(); x.stroke();
      },
      goalpost(X, Z) {
        const s0 = cam.s(Z), c = "rgba(238,206,96,.95)", wd = Math.max(1.5, 0.12 * s0);
        gfx.post(X, Z, 0, 3.05, wd, c); gfx.seg3([X, 3.05, Z - 2.82], [X, 3.05, Z + 2.82], wd, c);
        gfx.post(X, Z - 2.82, 3.05, 9, wd, c); gfx.post(X, Z + 2.82, 3.05, 9, wd, c);
      },
      wall(pts, h) {
        x.fillStyle = "#16301E"; x.beginPath();
        pts.forEach(([X, Z], i) => { const p = cam.P(X, h, Z); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); });
        pts.slice().reverse().forEach(([X, Z]) => { const p = cam.P(X, 0, Z); x.lineTo(p[0], p[1]); });
        x.fill();
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
    sp.marks(gfx);
    const lamps = sp.indoor ? [[0.2, 0.18], [0.4, 0.12], [0.6, 0.12], [0.8, 0.18]] : [[0.1, 0.14], [0.3, 0.08], [0.7, 0.08], [0.9, 0.14]];
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

  // ---------- players and the ball ----------
  const kind0 = sp => Object.keys(SPORT).find(k => SPORT[k] === sp);
  function figure(x, cam, p, t, sp) {
    const s = cam.s(p.Z), hgt = 1.9 * s * (p.crouch || 1);
    const foot = cam.P(p.X, 0, p.Z), lift = (p.Y || 0) * s;
    const fx = foot[0], fy = foot[1] - lift;
    x.fillStyle = "rgba(0,0,0,.32)";
    x.beginPath(); x.ellipse(fx, foot[1], 0.42 * s, 0.11 * s, 0, 0, Math.PI * 2); x.fill();
    const kit = p.kit, jersey = kit ? hex(kit[2]) : p.team, skin = p.skin || "#B07A4E";
    if (hgt < 5) { x.fillStyle = rgb(jersey); x.fillRect(fx - 1, fy - hgt, 2, hgt); return; }
    // moving? compare with where this player was a moment ago
    let speed = 0, dir = p.face || 1;
    if (p.keys) {
      const q = p.lag ? path(p.keys, t - p.lag - 0.06) : path(p.keys, t - 0.06), r = p.lag ? path(p.keys, t - p.lag) : path(p.keys, t);
      speed = Math.hypot(r.X - q.X, r.Z - q.Z) / 0.06;
      if (Math.abs(r.X - q.X) > 0.02) dir = r.X > q.X ? 1 : -1;
    }
    if (p.run) speed = 5;
    const run = clamp(speed / 3), ph = t * (sp.skate ? 5 : 11) + p.X;
    const stride = (p.Y ? 0.08 : (sp.skate ? 0.2 : 0.16) * run) * hgt;
    const hip = fy - 0.5 * hgt, sh = fy - 0.8 * hgt, hr = 0.072 * hgt, lean = (sp.skate ? 0.12 : 0.05) * run * hgt;
    const lw = Math.max(1.2, 0.085 * hgt);
    x.lineCap = "round";
    if (sp.skate) {
      const d = p.face || 1, bl = cam.P(p.X + d * (p.goalie ? 0.55 : 0.95), 0, p.Z - 0.4);
      return skater(x, p, { fx, fy, hgt, jersey, skin, kit, run, ph, d, blade: [bl[0], bl[1] - lift] });
    }
    [1, -1].forEach(d => {                                            // legs: thighs, bent knees, shins
      const phi = ph + (d > 0 ? 0 : Math.PI);
      let ex = fx + Math.sin(phi) * stride * dir, ey = fy - (p.Y ? (d > 0 ? 0.05 : 0.08) * hgt : Math.max(0, Math.cos(phi)) * 0.07 * hgt * run);
      if (p.kick != null && d > 0) {                                   // a shot or a header's jump: the kicking leg swings through
        const u = Math.sin(Math.PI * clamp(p.kick));
        ex = fx + dir * (lerp(-0.18, 0.34, clamp(p.kick)) * hgt); ey = fy - u * 0.24 * hgt;
      }
      const bend = (0.05 + 0.06 * run) * hgt * (p.kick != null && d > 0 ? 0.4 : 1);
      const kx = lerp(fx, ex, 0.5) + dir * bend, ky = lerp(hip, ey, 0.5);
      x.strokeStyle = sp.skate || kind0(sp) === "park" ? rgb(jersey.map(v => v * 0.8)) : skin; x.lineWidth = lw * 0.9;
      x.beginPath(); x.moveTo(kx, ky); x.lineTo(ex, ey); x.stroke();
      x.strokeStyle = rgb(jersey.map(v => v * 0.72)); x.lineWidth = lw * 1.25;
      x.beginPath(); x.moveTo(fx + d * 0.05 * hgt, hip); x.lineTo(kx, ky); x.stroke();
      x.fillStyle = "#121314"; x.fillRect(ex - lw * 0.6, ey - lw * 0.4, lw * 1.4, lw * 0.6);
    });
    // jersey
    const bw = 0.27 * hgt;
    x.fillStyle = rgb(jersey);
    x.beginPath();
    x.moveTo(fx - bw * 0.42, hip + 0.04 * hgt); x.lineTo(fx + bw * 0.42, hip + 0.04 * hgt);
    x.lineTo(fx + bw * 0.5 + lean, sh); x.lineTo(fx - bw * 0.5 + lean, sh); x.closePath(); x.fill();
    if (kit && kit[4] && hgt > 14) {                                     // striped kits
      x.save(); x.clip();
      x.strokeStyle = kit[4]; x.lineWidth = Math.max(1, bw * (kit[4] === kit[3] ? 0.04 : 0.14));
      for (let k = -2; k <= 2; k++) { const sx0 = fx + lean * 0.5 + k * bw * 0.26; x.beginPath(); x.moveTo(sx0, sh); x.lineTo(sx0, hip + 0.04 * hgt); x.stroke(); }
      x.restore();
    }
    x.fillStyle = "rgba(255,240,210,.3)"; x.fillRect(fx - bw * 0.5 + lean, sh, bw, Math.max(1, 0.03 * hgt));
    if (kit && kit[1] && hgt > 20) {                                     // the number
      x.fillStyle = kit[3]; x.font = `700 ${Math.round(0.15 * hgt)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(kit[1]), fx + lean * 0.6, lerp(sh, hip, 0.45));
    }
    // arms
    x.strokeStyle = skin; x.lineWidth = lw * 0.75;
    const sx = fx + lean, arm = 0.3 * hgt;
    x.beginPath();
    if (p.arms === "up") { x.moveTo(sx - bw * 0.4, sh + 2); x.lineTo(sx - bw * 0.25, sh - arm); x.moveTo(sx + bw * 0.4, sh + 2); x.lineTo(sx + bw * 0.3, sh - arm); }
    else if (p.arms === "shoot") {                                     // set shot: elbow under the ball, ball over the head
      x.moveTo(sx - bw * 0.35, sh + 2); x.quadraticCurveTo(sx - bw * 0.5, sh - arm * 0.3, sx - bw * 0.1, sh - arm * 0.85);
      x.moveTo(sx + bw * 0.35, sh + 2); x.quadraticCurveTo(sx + bw * 0.6, sh - arm * 0.35, sx + bw * 0.15, sh - arm * 0.95);
    } else if (p.arms === "dribble") {                                 // one hand on the ball, the other out to shield it
      const b = Math.abs(Math.sin(t * 6.5));
      x.moveTo(sx + dir * bw * 0.45, sh + 2); x.lineTo(sx + dir * bw * 0.75, sh + arm * (0.75 + 0.2 * b));
      x.moveTo(sx - dir * bw * 0.45, sh + 2); x.lineTo(sx - dir * bw * 0.95, sh + arm * 0.55);
    } else if (p.throw != null) {                                      // the throwing arm comes back, then over the top
      const u = clamp(p.throw), a = lerp(Math.PI * 0.95, Math.PI * 0.2, ease(u));
      x.moveTo(sx + bw * 0.4, sh + 2); x.lineTo(sx - dir * Math.cos(a) * arm, sh - Math.sin(a) * arm * 0.9);
      x.moveTo(sx - bw * 0.4, sh + 2); x.lineTo(sx + dir * bw * 0.8, sh + arm * 0.45);
    } else if (p.arms === "guard") {                                   // defense: arms out
      x.moveTo(sx - bw * 0.45, sh + 2); x.lineTo(sx - bw * 1.25, sh + arm * 0.35); x.moveTo(sx + bw * 0.45, sh + 2); x.lineTo(sx + bw * 1.25, sh + arm * 0.35);
    } else { const sw = Math.sin(ph) * 0.12 * hgt * run; x.moveTo(sx - bw * 0.45, sh + 2); x.lineTo(sx - bw * 0.55 - sw, sh + arm); x.moveTo(sx + bw * 0.45, sh + 2); x.lineTo(sx + bw * 0.55 + sw, sh + arm); }
    x.stroke();
    if (p.stick) { x.strokeStyle = "#2A2420"; x.lineWidth = Math.max(1, lw * 0.5); x.beginPath(); x.moveTo(sx + bw * 0.5, sh + arm * 0.9); x.lineTo(fx + 0.9 * s, foot[1] - 0.02 * s - lift); x.stroke(); }
    if (p.bat != null) {
      const a = -2.3 + p.bat * 3.4, hx = sx + bw * 0.3, hy = sh + arm * 0.5;
      x.strokeStyle = "#D9B98C"; x.lineWidth = Math.max(1.4, lw * 0.7);
      x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx + Math.cos(a) * 0.45 * hgt, hy + Math.sin(a) * 0.45 * hgt); x.stroke();
    }
    // head, lit from the lamps above
    x.fillStyle = skin; x.beginPath(); x.arc(sx, sh - hr * 1.25, hr, 0, Math.PI * 2); x.fill();
    if (kind0(sp) === "park" || sp.skate) {                             // caps and helmets in the team color
      x.fillStyle = rgb(jersey.every(v => v > 230) ? hex(kit ? kit[3] : "#333333") : jersey.map(v => v * 0.85));
      x.beginPath(); x.arc(sx, sh - hr * 1.3, hr * 1.05, Math.PI, 0); x.fill();
    } else if (sp.zn === 14 && sp.h === 9) {                            // football helmet
      x.fillStyle = rgb(jersey.every(v => v > 230) ? hex(kit ? kit[3] : "#333333") : jersey);
      x.beginPath(); x.arc(sx, sh - hr * 1.25, hr * 1.12, 0, Math.PI * 2); x.fill();
      x.strokeStyle = "rgba(240,240,240,.8)"; x.lineWidth = Math.max(0.6, hr * 0.2); x.beginPath(); x.moveTo(sx, sh - hr * 1.1); x.lineTo(sx + hr * 1.1, sh - hr * 1.1); x.stroke();
    }
    x.strokeStyle = "rgba(255,236,200,.55)"; x.lineWidth = Math.max(0.8, hr * 0.3);
    x.beginPath(); x.arc(sx, sh - hr * 1.25, hr, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
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
        list.forEach(d => (d.plays || []).forEach(p => out.push({ id: String(p.id || p.sequenceNumber || p.text), text: p.text || "", team: teamOf((d.team || {}).id), type: (p.type || {}).text || "", scoring: !!p.scoringPlay })));
        return out;
      }
      if (m.kind === "pitch") return (sum.keyEvents || []).map(e => ({ id: String(e.id || e.text), text: e.text || "", team: teamOf((e.team || {}).id), type: (e.type || {}).text || (e.type || {}).type || "", scoring: !!e.scoringPlay }));
      return (sum.plays || []).map(p => ({ id: String(p.id || p.sequenceNumber || p.text), text: String(p.text || "").trim(), team: teamOf((p.team || {}).id), type: (p.type || {}).text || "", scoring: !!p.scoringPlay }));
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
  function runField(c, kinds, onKind, dataOf) {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    let W = 0, H = 0, dpr = 1, cache = {}, raf = 0, startAt = performance.now(), lastPlay = -2, v = null;
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
    let pan = 0, lastNow = 0;
    function frame(now) {
      raf = 0;
      if (!W || !H) { size(); if (!W || !H) return; }
      let el = still ? 3.4 : Math.max(0, (now - startAt) / 1000), i = 0;   // the first frame can stamp a hair before startAt
      // walk through the list, one play per sport
      const total = list.reduce((a, k) => a + SPORT[k].D, 0), loop = el % total;
      let acc = 0;
      for (i = 0; i < list.length; i++) { if (loop < acc + SPORT[list[i]].D) break; acc += SPORT[list[i]].D; }
      if (still) i = 0;
      const kind = list[i], sp = SPORT[kind], t = still ? 3.4 : loop - acc;
      // a new play: fresh lineup, fresh skin tones, fresh outcome
      const play = still ? 0 : Math.floor(el / total) * list.length + i;
      if (play !== lastPlay) {
        lastPlay = play;
        let seed = (salt + play * 7919) % 2147483646 + 1;
        const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        r(); r();
        // today's teams (a real play when a game is live), or the greats and their famous plays
        const key = dataOf ? dataOf(kind) : null, m = key ? director.now(key) : null;
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
        } else if (sp.classics && r() < 0.5) {
          v = famous(sp, sp.classics[Math.floor(r() * sp.classics.length)], r); said = v.cap;
        } else { v = sp.variant(r, CLASSIC); said = sp.caption(v); }
        v.skins = Array.from({ length: 24 }, () => SKIN[Math.floor(r() * SKIN.length)]);
        if (onKind) onKind(kind, said);
      }
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
      now0.players.slice().sort((a, b) => b.Z - a.Z).forEach(p => figure(x, cam, p, t, sp));
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
    const kinds = KIND_OF[pageSport] || (isHome ? ROTATION : "park");
    let cap = head.querySelector(".lab-caption");
    if (!cap) { cap = document.createElement("div"); cap.className = "lab-caption"; cap.setAttribute("aria-hidden", "true"); head.append(cap); }
    let lastKind = null;
    const dataOf = k => pageSport && NAME[pageSport.toLowerCase()] ? pageSport.toLowerCase() : SPORT_OF_KIND[k];
    const first = (Array.isArray(kinds) ? kinds : [kinds]).map(k => director.watch(dataOf(k), k))[0];
    const go = () => { if (!field.c) field.c = runField(c, kinds, (k, said) => {
      cap.textContent = said || ""; cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      if (Array.isArray(kinds) && k !== lastKind) card.show(SPORT_OF_KIND[k]);
      lastKind = k;
    }, dataOf); };
    field = {};
    Promise.race([first, new Promise(res => setTimeout(res, 2500))]).then(go);
  }
  function stopField() { location.reload(); }

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
    if (k === "field" || k == null) { if (on.field) startField(); else if (field) stopField(); }
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
