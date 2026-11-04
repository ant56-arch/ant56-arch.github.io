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
  // Listed in the order each sport's cast() adds its players.
  const ROSTER = {
    court: [
      ["Magic", 32, "#FDB927", "#552583"], ["Jordan", 23, "#CE1141", "#FFFFFF"], ["Curry", 30, "#1D428A", "#FFC72C"],
      ["Duncan", 21, "#1B1B1B", "#C4CED4"], ["LeBron", 23, "#860038", "#FDBB30"],
      ["Bird", 33, "#007A33", "#FFFFFF"], ["Kobe", 24, "#552583", "#FDB927"], ["Dirk", 41, "#00538C", "#FFFFFF"],
      ["Hakeem", 34, "#F4F4F4", "#CE1141"], ["Shaq", 32, "#0077C0", "#1B1B1B"],
    ],
    gridiron: [
      ["Munoz", 78, "#FB4F14", "#111111"], ["Ogden", 75, "#241773", "#FFFFFF"], ["Webster", 52, "#101820", "#FFB612"],
      ["Hannah", 73, "#C8102E", "#FFFFFF"], ["Pace", 76, "#003594", "#FFD100"],
      ["Brady", 12, "#002244", "#FFFFFF"], ["Payton", 34, "#0B162A", "#C83803"], ["Rice", 80, "#AA0000", "#B3995D"],
      ["Moss", 84, "#4F2683", "#FFC62F"], ["Gronk", 87, "#F4F4F4", "#002244"],
      ["White", 92, "#203731", "#FFB612"], ["Donald", 99, "#F4F4F4", "#003594"], ["Greene", 75, "#101820", "#FFB612"],
      ["Strahan", 92, "#0B2265", "#FFFFFF"], ["Taylor", 56, "#F4F4F4", "#0B2265"], ["Butkus", 51, "#0B162A", "#FFFFFF"],
      ["Deion", 21, "#A71930", "#111111"], ["Revis", 24, "#125740", "#FFFFFF"], ["Polamalu", 43, "#F4F4F4", "#101820"], ["Reed", 20, "#241773", "#FFFFFF"],
    ],
    park: [
      ["Koufax", 32, "#F4F4F4", "#005A9C"], ["Piazza", 31, "#F4F4F4", "#002D72"], ["Pujols", 5, "#F4F4F4", "#C41E3A"],
      ["Robinson", 42, "#F4F4F4", "#005A9C"], ["Jeter", 2, "#F4F4F4", "#0C2340", "#0C2340"], ["Schmidt", 20, "#F4F4F4", "#E81828"],
      ["Williams", 9, "#F4F4F4", "#BD3039"], ["Mays", 24, "#F4F4F4", "#FD5A1E"], ["Aaron", 44, "#F4F4F4", "#13274F"],
      ["Ruth", 3, "#A2AAAD", "#0C2340"],
    ],
    ice: [
      ["Gretzky", 99, "#041E42", "#FF4C00"], ["Ovechkin", 8, "#C8102E", "#FFFFFF"], ["Lemieux", 66, "#111111", "#FCB514"],
      ["Howe", 9, "#CE1126", "#FFFFFF"], ["Messier", 11, "#0038A8", "#FFFFFF"],
      ["Orr", 4, "#111111", "#FFB81C"], ["Lidstrom", 5, "#F4F4F4", "#CE1126"], ["Bourque", 77, "#6F263D", "#FFFFFF"],
      ["Potvin", 5, "#00539B", "#F47D30"], ["Niedermayer", 27, "#111111", "#F47A38"],
      ["Roy", 33, "#AF1E2D", "#FFFFFF"],
    ],
    pitch: [
      ["Cruyff", 14, "#F36C21", "#111111"], ["Messi", 10, "#75AADB", "#111111", "#FFFFFF"], ["Ronaldo", 7, "#DA291C", "#FFFFFF"],
      ["Pelé", 10, "#FFDF00", "#009C3B"], ["Zidane", 10, "#002395", "#FFFFFF"],
      ["Maldini", 3, "#C8102E", "#FFFFFF", "#111111"], ["Beckenbauer", 5, "#F4F4F4", "#111111"], ["Cannavaro", 5, "#1E5AA8", "#FFFFFF"],
      ["Ramos", 4, "#AA151B", "#F1BF00"], ["Moore", 6, "#F4F4F4", "#1D2A5B"],
      ["Cafu", 2, "#FFDF00", "#009C3B"], ["Baresi", 6, "#C8102E", "#FFFFFF", "#111111"],
      ["Yashin", 1, "#111111", "#FFFFFF"],
    ],
  };
  const CAPTION = {
    court: "Jordan pulls up over Kobe. Splash.",
    gridiron: "Brady goes deep to Rice.",
    park: "Ruth drives one to left-center. Williams runs it down.",
    ice: "Gretzky feeds Ovechkin for the one-timer.",
    pitch: "Messi crosses, Ronaldo heads it in.",
  };
  // A mix of skin tones on every team, light to deep. These are fans of
  // the greats in their jerseys, not likenesses.
  const SKIN = ["#F2CDA8", "#5C3A24", "#D9A577", "#8A5A38", "#EBC096", "#B07A4E", "#6E4429", "#C99367"];

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
      [[0, 12.1, 20.8], [6.5, 12.4, 20.4]],                                // corner
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
          g.arcLine(s * 12.7, zc, 7.24, s > 0 ? Math.PI / 2 + 0.38 : -Math.PI / 2 + 0.38, s > 0 ? Math.PI * 1.5 - 0.38 : Math.PI / 2 - 0.38, 1.8);
          g.line([[s * L, zc - 6.7], [s * (L - 4.3), zc - 6.7]], 1.8); g.line([[s * L, zc + 6.7], [s * (L - 4.3), zc + 6.7]], 1.8);
        });
        g.ellipseW(0, zc, 1.83, "rgba(229,121,59,.28)");
        [-1, 1].forEach(s => g.hoop(s, zc));
      },
      goal: B,
      cast(t) {
        const P = [];
        O.forEach((k, i) => {
          const p = path(k, t);
          if (i === 1 && t > 3.2 && t < 3.85) { p.Y = 0.5 * Math.sin(Math.PI * span(t, 3.2, 3.85)); p.arms = "up"; }
          P.push({ ...p, team: ORANGE, id: i, keys: k });
        });
        O.forEach((k, i) => {
          const p = mark(k, t, B, i === 1 ? 1.1 : 1.5);
          if (i === 1 && t > 3.3 && t < 3.9) { p.Y = 0.35 * Math.sin(Math.PI * span(t, 3.3, 3.9)); p.arms = "up"; }
          if (i === 3 && t > 4.6 && t < 5.2) { p.Y = 0.45 * Math.sin(Math.PI * span(t, 4.6, 5.2)); p.arms = "up"; }
          P.push({ ...p, team: CREAM, keys: k, lag: 0.28 });
        });
        const pg = P[0], w = P[1];
        let ball;
        if (t < 2.4) ball = { X: pg.X + 0.35, Y: 0.15 + Math.abs(Math.sin(t * 6.5)) * 0.85, Z: pg.Z - 0.35 };
        else if (t < 2.95) ball = arc({ X: pg.X + 0.3, Y: 1.2, Z: pg.Z - 0.3 }, { X: w.X - 0.2, Y: 1.3, Z: w.Z - 0.3 }, 0.25, span(t, 2.4, 2.95));
        else if (t < 3.55) ball = { X: w.X, Y: lerp(1.3, 2.5, span(t, 2.95, 3.55)) + (w.Y || 0), Z: w.Z - 0.25 };
        else if (t < 4.6) ball = arc({ X: w.X, Y: 2.55 + (w.Y || 0), Z: w.Z - 0.25 }, B, 2.2, span(t, 3.55, 4.6));
        else if (t < 4.9) ball = { X: B.X, Y: lerp(B.Y, 1.7, span(t, 4.6, 4.9)), Z: B.Z, swish: span(t, 4.6, 4.9) };
        else { const u = span(t, 4.9, 6.2); ball = { X: B.X - 1.5 * u, Y: 0.12 + Math.abs(Math.cos(u * 7)) * 1.5 * (1 - u), Z: B.Z - 0.6 * u }; }
        ball.r = 0.12; ball.color = [214, 106, 44]; ball.lines = true;
        return { players: P, ball, flash: t > 4.6 && t < 5.6 ? 1 - span(t, 4.6, 5.6) : 0 };
      },
    };
  })();

  // Football, from the press box side. Field 120 x 53.3 yd.
  (() => {
    const yd = 0.9144, n = 14, w = 48.77, mid = n + w / 2, los = n + 17;
    const WR = [[0, -1, n + 4.5], [1, -1, n + 4.5], [2.3, 9, n + 5], [3.3, 20, n + 7.5], [3.9, 26, n + 8], [5.6, 41, n + 8.5]];
    const WR2 = [[0, -1, los + 14], [1, -1, los + 14], [3.2, 12, los + 11], [6, 15, los + 10]];
    const TE = [[0, -1, los + 5], [1, -1, los + 5], [3, 6, los + 7], [6, 9, los + 6]];
    const QB = [[0, -4.5, los], [1.1, -4.5, los], [2.1, -8.5, los], [6, -8, los - 0.4]];
    const RB = [[0, -6.8, los + 1.4], [1.1, -6.8, los + 1.4], [2.2, -5.2, los - 1.6]];
    const goal = { X: 46, Z: los };
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
      cast(t) {
        const P = [], set = t < 1;
        for (let i = 0; i < 5; i++) {                                     // offensive line
          const z = los + (i - 2) * 1.15, push = set ? 0 : 0.6 * span(t, 1, 1.6);
          P.push({ X: -0.9 + push + Math.sin(t * 9 + i) * 0.05 * !set, Z: z, team: ORANGE, crouch: set ? 0.72 : 0.86 });
        }
        [QB, RB, WR, WR2, TE].forEach(k => P.push({ ...path(k, t), team: ORANGE, keys: k }));
        for (let i = 0; i < 4; i++) {                                     // defensive line
          const z = los + (i - 1.5) * 1.5, push = set ? 0 : -0.4 * span(t, 1, 1.6);
          P.push({ X: 0.9 + push, Z: z, team: CREAM, crouch: set ? 0.74 : 0.9 });
        }
        P.push({ ...path([[0, 5, los - 3.5], [1, 5, los - 3.5], [3, 3, los - 4.5]], t), team: CREAM });
        P.push({ ...path([[0, 5, los + 3.5], [1, 5, los + 3.5], [3, 4, los + 6]], t), team: CREAM });
        P.push({ ...mark(WR, t, goal, -1.4, 0.38), team: CREAM, keys: WR, lag: 0.38 });
        P.push({ ...mark(WR2, t, goal, -1.4, 0.38), team: CREAM, keys: WR2, lag: 0.38 });
        P.push({ ...path([[0, 14, n + 15], [1.8, 15, n + 13], [4.2, 25, n + 9.5], [6, 37, n + 9]], t), team: CREAM });
        P.push({ ...path([[0, 14, los + 9], [3, 13, los + 4], [6, 22, los - 2]], t), team: CREAM });
        const q = P[5], r = P[7];
        let ball;
        if (t < 1) ball = { X: -0.6, Y: 0.15, Z: los };
        else if (t < 1.2) ball = arc({ X: -0.6, Y: 0.15, Z: los }, { X: q.X + 0.2, Y: 1.2, Z: q.Z - 0.2 }, 0.1, span(t, 1, 1.2));
        else if (t < 2.5) ball = { X: q.X + 0.2, Y: t > 2.2 ? 2 : 1.3, Z: q.Z - 0.25 };
        else if (t < 3.9) { const c = path(WR, 3.9); ball = arc({ X: q.X + 0.3, Y: 2.1, Z: q.Z - 0.2 }, { X: c.X + 0.3, Y: 1.5, Z: c.Z - 0.2 }, 6.5, span(t, 2.5, 3.9)); }
        else ball = { X: r.X + 0.3, Y: 1.25, Z: r.Z - 0.25 };
        ball.r = 0.14; ball.color = [124, 70, 40]; ball.oval = true;
        return { players: P, ball };
      },
    };
  })();

  // Baseball, from high behind home plate.
  (() => {
    const H0 = 9, home = { X: 0, Z: H0 };
    const base = (x, z) => [x, H0 + z];
    const RUN = t => { const u = span(t, 2.15, 5.6); return { X: -0.9 + (19.4 + 0.9) * u, Z: H0 + 19.4 * u }; };
    const LF = [[0, -40, H0 + 70], [2.2, -40, H0 + 70], [5.2, -25, H0 + 84], [6.6, -24, H0 + 83]];
    const CF = [[0, 0, H0 + 92], [2.3, 0, H0 + 92], [5.4, -13, H0 + 88]];
    const LAND = { X: -24.6, Y: 1.9, Z: H0 + 84.4 };
    SPORT.park = {
      zn: 5, zf: H0 + 120, h: 5, ax: 0, az: H0 + 40, centered: true, D: 7.2, surface: [46, 90, 51], fitZf: 90,
      marks(g) {
        g.fillPoly([[-140, 5], [140, 5], [140, 150], [-140, 150]], "rgba(44,88,50,1)");
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
      cast(t) {
        const P = [];
        P.push({ ...path([[0, 0, H0 + 18.4], [1.6, 0, H0 + 18.2], [2, 0.4, H0 + 17]], t), team: CREAM, arms: t > 1.2 && t < 1.6 ? "up" : null });
        P.push({ X: 0, Z: H0 - 1.3, team: CREAM, crouch: t < 2.3 ? 0.62 : 1 });
        P.push({ ...path([[0, 17, H0 + 22], [2.3, 17, H0 + 22], [4.4, 18.6, H0 + 19.6]], t), team: CREAM });
        P.push({ ...path([[0, 8, H0 + 33], [2.3, 8, H0 + 33], [4, 4, H0 + 39]], t), team: CREAM });
        P.push({ ...path([[0, -8, H0 + 33], [2.3, -8, H0 + 33], [4.4, -13, H0 + 48]], t), team: CREAM });
        P.push({ ...path([[0, -17, H0 + 22], [2.3, -17, H0 + 22], [3.4, -15, H0 + 25]], t), team: CREAM });
        P.push({ ...path(LF, t), team: CREAM, arms: t > 4.9 && t < 5.5 ? "up" : null });
        P.push({ ...path(CF, t), team: CREAM });
        P.push({ ...path([[0, 40, H0 + 70], [2.3, 40, H0 + 70], [5, 30, H0 + 72]], t), team: CREAM });
        const bat = t < 2.15 ? { X: -0.9, Z: H0 } : RUN(t);
        P.push({ ...bat, team: ORANGE, bat: t < 2.4 ? clamp((t - 1.85) / 0.3) : null });
        let ball;
        if (t < 1.65) ball = { X: 0.4, Y: 1.9, Z: H0 + 17.8, hide: t < 1.2 };
        else if (t < 2.05) ball = arc({ X: 0.4, Y: 1.9, Z: H0 + 17.6 }, { X: -0.3, Y: 0.9, Z: H0 + 0.4 }, 0.25, span(t, 1.65, 2.05));
        else if (t < 5.25) ball = arc({ X: -0.3, Y: 0.9, Z: H0 + 0.4 }, LAND, 30, span(t, 2.05, 5.25));
        else { const p = P[6]; ball = { X: p.X + 0.3, Y: 1.8, Z: p.Z - 0.2 }; }
        ball.r = 0.2; ball.color = [250, 246, 236];
        return { players: P, ball, hitFlash: t > 2.05 && t < 2.5 ? 1 - span(t, 2.05, 2.5) : 0, hitAt: { X: -0.3, Y: 0.9, Z: H0 + 0.4 } };
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
        g.boards(-L, L, f, 8.5);
        [-1, 1].forEach(s => g.net(s, 26.6, mid));
      },
      cast(t) {
        const P = [];
        [O1, O2, O3, O4, O5].forEach(k => P.push({ ...path(k, t), team: ORANGE, keys: k, stick: 1 }));
        [O1, O2, O3, O4, O5].forEach(k => P.push({ ...mark(k, t, G, 1.8, 0.32), team: CREAM, keys: k, lag: 0.32, stick: 1 }));
        const gz = clamp(lerp(mid - 1.2, mid + 1.2, ((t < 3.6 ? P[0].Z : P[1].Z) - (mid - 7)) / 14), mid - 1.2, mid + 1.2);
        P.push({ X: 25.6, Z: t > 3.75 && t < 4.4 ? gz - 0.8 * span(t, 3.75, 3.95) : gz, team: GOLD, crouch: 0.8, stick: 1 });
        const a = P[0], b = P[1];
        let ball;
        if (t < 2.95) ball = { X: a.X + 1, Y: 0.03, Z: a.Z - 0.5 };
        else if (t < 3.35) ball = arc({ X: a.X + 1, Y: 0.03, Z: a.Z - 0.5 }, { X: b.X + 0.8, Y: 0.03, Z: b.Z - 0.5 }, 0, span(t, 2.95, 3.35));
        else if (t < 3.65) ball = { X: b.X + 0.8, Y: 0.03, Z: b.Z - 0.5 };
        else if (t < 3.95) ball = arc({ X: b.X + 0.8, Y: 0.03, Z: b.Z - 0.5 }, { X: 27.1, Y: 0.7, Z: G.Z }, 0.25, span(t, 3.65, 3.95));
        else ball = { X: 27.5, Y: 0.04, Z: G.Z };
        ball.r = 0.1; ball.color = [16, 16, 18]; ball.puck = true;
        return { players: P, ball, lamp: t > 3.95 ? 1 - span(t, 3.95, 6.2) : 0 };
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
    SPORT.pitch = {
      zn: n, zf: n + w, h: 8, ax: 30, az: mid - 6, D: 6.8, surface: [46, 90, 51],
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
      cast(t) {
        const P = [];
        [O1, O2, O3, O4, O5].forEach(k => P.push({ ...path(k, t), team: ORANGE, keys: k }));
        [O1, O2, O3, O4, O5].forEach(k => P.push({ ...mark(k, t, G, 2.4, 0.34), team: CREAM, keys: k, lag: 0.34 }));
        P.push({ ...path([[0, 38, mid + 14], [4, 40, mid + 6]], t), team: CREAM });
        P.push({ ...path([[0, 31, mid - 10], [4, 37, mid - 13]], t), team: CREAM });
        const kz = t < 3.3 ? mid - 1 : t < 4.3 ? lerp(mid - 1, mid + 1.5, span(t, 3.3, 4.3)) : mid + 1.5 - 2.4 * span(t, 4.3, 4.55);
        P.push({ X: 51.3, Z: kz, team: GOLD, arms: t > 4.3 && t < 4.9 ? "up" : null, Y: t > 4.35 && t < 4.9 ? 0.4 * Math.sin(Math.PI * span(t, 4.35, 4.9)) : 0 });
        const a = P[0], b = P[1], c = P[2];
        if (t > 4.05 && t < 4.55) { c.Y = 0.45 * Math.sin(Math.PI * span(t, 4.05, 4.55)); }
        let ball;
        if (t < 1.4) ball = { X: a.X + 0.6, Y: 0.11, Z: a.Z - 0.3 };
        else if (t < 1.9) ball = arc({ X: a.X + 0.6, Y: 0.11, Z: a.Z - 0.3 }, { X: b.X + 0.5, Y: 0.11, Z: b.Z - 0.3 }, 0, span(t, 1.4, 1.9));
        else if (t < 3.3) ball = { X: b.X + 0.7, Y: 0.11 + Math.abs(Math.sin(t * 5)) * 0.15, Z: b.Z - 0.3 };
        else if (t < 4.3) { const e = path(O3, 4.3); ball = arc({ X: b.X + 0.7, Y: 0.11, Z: b.Z - 0.3 }, { X: e.X + 0.2, Y: 2.1, Z: e.Z }, 6, span(t, 3.3, 4.3)); }
        else if (t < 4.7) ball = arc({ X: c.X + 0.2, Y: 2.1, Z: c.Z }, G, 0.3, span(t, 4.3, 4.7));
        else { const u = span(t, 4.7, 5.2); ball = { X: 53.4, Y: lerp(G.Y, 0.11, u), Z: G.Z }; }
        ball.r = 0.11; ball.color = [246, 242, 232];
        return { players: P, ball, flash: t > 4.7 && t < 5.8 ? 1 - span(t, 4.7, 5.8) : 0, flashAt: G };
      },
    };
  })();

  // ---------- the camera ----------
  function camera(sp, W, H) {
    const zfit = sp.fitZf || sp.zf;
    const top = W < 760 ? 0.3 : 0.36, bot = 0.995;
    const f = (bot - top) * H / (sp.h * (1 / sp.zn - 1 / zfit));
    const hz = top * H - f * sp.h / zfit;
    // keep the action a little right of center on wide screens (the headline sits on the left)
    const cx = sp.ax - (W >= 760 && !sp.centered ? 0.03 * W * sp.az / f : 0);
    return {
      f, hz,
      P: (X, Y, Z) => [W / 2 + f * (X - cx) / Z, hz + f * (sp.h - Y) / Z],
      s: Z => f / Z,
    };
  }

  // ---------- the still background: sky or roof, stands, field, lights ----------
  function background(kind, W, H, dpr) {
    const sp = SPORT[kind], cam = camera(sp, W, H);
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
      boards(L0, L1, zf, r) {
        const top = [], bot = [];
        for (let i = 0; i <= 30; i++) { const X = lerp(L0 + r, L1 - r, i / 30); top.push(cam.P(X, 1.1, zf)); bot.push(cam.P(X, 0, zf)); }
        x.fillStyle = "rgba(232,236,238,.92)"; x.beginPath(); top.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]));
        bot.reverse().forEach(p => x.lineTo(p[0], p[1])); x.fill();
        x.fillStyle = "rgba(186,46,46,.8)"; const a = top[0], b = top[top.length - 1];
        x.fillRect(a[0], a[1] - 2, b[0] - a[0], 3);
        for (let i = 1; i < 6; i++) { const p = cam.P(lerp(L0 + r, L1 - r, i / 6) - 3, 0.75, zf), q = cam.P(lerp(L0 + r, L1 - r, i / 6) + 3, 0.35, zf); x.fillStyle = i % 2 ? "rgba(229,121,59,.55)" : "rgba(30,58,44,.6)"; x.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); }
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
    // stands behind the far side, with the crowd in them
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
    return { canvas: c, cam, back, rise };
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
    let speed = 0;
    if (p.keys) { const q = p.lag ? path(p.keys, t - p.lag - 0.06) : path(p.keys, t - 0.06), r = p.lag ? path(p.keys, t - p.lag) : path(p.keys, t); speed = Math.hypot(r.X - q.X, r.Z - q.Z) / 0.06; }
    const run = clamp(speed / 3), ph = t * (sp.skate ? 5 : 11) + p.X;
    const stride = (p.Y ? 0.08 : (sp.skate ? 0.2 : 0.16) * run) * hgt;
    const hip = fy - 0.5 * hgt, sh = fy - 0.8 * hgt, hr = 0.072 * hgt, lean = (sp.skate ? 0.12 : 0.05) * run * hgt;
    const lw = Math.max(1.2, 0.085 * hgt);
    x.lineCap = "round";
    [1, -1].forEach(d => {                                            // legs: shorts, then shins
      const ex = fx + d * Math.sin(ph) * stride, ey = fy - (p.Y ? (d > 0 ? 0.05 : 0.08) * hgt : 0);
      const kx = lerp(fx, ex, 0.45), ky = lerp(hip, ey, 0.45);
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
    if (kit && hgt > 20) {                                               // the number
      x.fillStyle = kit[3]; x.font = `700 ${Math.round(0.15 * hgt)}px Archivo, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(kit[1]), fx + lean * 0.6, lerp(sh, hip, 0.45));
    }
    // arms
    x.strokeStyle = skin; x.lineWidth = lw * 0.75;
    const sx = fx + lean, arm = 0.3 * hgt;
    x.beginPath();
    if (p.arms === "up") { x.moveTo(sx - bw * 0.4, sh + 2); x.lineTo(sx - bw * 0.25, sh - arm); x.moveTo(sx + bw * 0.4, sh + 2); x.lineTo(sx + bw * 0.3, sh - arm); }
    else { const sw = Math.sin(ph) * 0.12 * hgt * run; x.moveTo(sx - bw * 0.45, sh + 2); x.lineTo(sx - bw * 0.55 - sw, sh + arm); x.moveTo(sx + bw * 0.45, sh + 2); x.lineTo(sx + bw * 0.55 + sw, sh + arm); }
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

  // ---------- running a scene on a canvas ----------
  // kinds: one kind, or a list to rotate through (one play each).
  function runField(c, kinds, onKind) {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    let W = 0, H = 0, dpr = 1, cache = {}, raf = 0, startAt = performance.now(), lastKind = null;
    const x = c.getContext("2d");
    function size() {
      const r = c.getBoundingClientRect();
      W = r.width; H = r.height; dpr = Math.min(2, devicePixelRatio || 1);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      cache = {};
    }
    function bgFor(k) { return cache[k] || (cache[k] = background(k, W, H, dpr)); }
    function frame(now) {
      raf = 0;
      if (!W || !H) { size(); if (!W || !H) return; }
      let el = still ? 3.4 : (now - startAt) / 1000, i = 0;
      // walk through the list, one play per sport
      const total = list.reduce((a, k) => a + SPORT[k].D, 0), loop = el % total;
      let acc = 0;
      for (i = 0; i < list.length; i++) { if (loop < acc + SPORT[list[i]].D) break; acc += SPORT[list[i]].D; }
      if (still) i = 0;
      const kind = list[i], sp = SPORT[kind], t = still ? 3.4 : loop - acc;
      if (kind !== lastKind) { lastKind = kind; if (onKind) onKind(kind); }
      const bg = bgFor(kind), cam = bg.cam;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.globalAlpha = 1;
      x.drawImage(bg.canvas, 0, 0, W, H);
      const fade = still ? 1 : clamp(t / 0.35) * clamp((sp.D - t) / 0.45);
      x.globalAlpha = fade;
      const cast = tt => sp.cast(clamp(tt, 0, sp.D));
      const now0 = cast(t);
      const kits = ROSTER[kind] || [];
      now0.players.forEach((p, j) => { p.kit = kits[j]; p.skin = SKIN[(j * 3 + list.indexOf(kind)) % SKIN.length]; });
      now0.players.slice().sort((a, b) => b.Z - a.Z).forEach(p => figure(x, cam, p, t, sp));
      if (sp.goal && sp.goal.Y) drawRim(x, cam, sp.goal, now0.ball.swish);
      drawBall(x, cam, now0.ball, cast, t);
      if (kind === "court") glow(x, cam, sp.goal, now0.flash, "255,200,140");
      if (now0.flashAt) glow(x, cam, now0.flashAt, now0.flash, "255,236,200");
      if (now0.hitFlash) glow(x, cam, now0.hitAt, now0.hitFlash, "255,236,200");
      if (now0.lamp) glow(x, cam, { X: 27.8, Y: 2.6, Z: 22.5 }, (Math.sin(t * 18) > 0 ? 1 : 0.6) * now0.lamp, "230,40,40");
      x.globalAlpha = 1;
      if (!still) flashes(x, bg, W, el);
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
    field = runField(c, kinds, k => {
      cap.textContent = CAPTION[k] || ""; cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      if (Array.isArray(kinds)) card.show(SPORT_OF_KIND[k]);
    });
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
      <a href="https://ant56-arch.github.io${location.pathname.replace(/^\/lab/, "")}${location.search}">Open the live version</a></div>`;
    const btn = box.querySelector("button"), body = box.querySelector(".lab-panel-body");
    btn.addEventListener("click", () => { body.hidden = !body.hidden; btn.setAttribute("aria-expanded", String(!body.hidden)); });
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
