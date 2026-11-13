// The Schedule calendar: a month of games with our record on each day, then
// the day you tap, sport by sport. /schedule.html shows every sport with a
// filter; each sport's Schedule tab shows only its own (data-sport on the
// .edge-cal element). Data: /calendar/index.json and one file per month,
// written by shared/schedule_cal.py when the site publishes.
(function () {
  const SPORTS = ["NFL", "CFB", "NBA", "NHL", "CBB", "Soccer", "MLB"];
  const SHOW = 12;  // rows per sport before "Show all"
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const tz = () => (typeof edgeTz === "function" ? edgeTz() : { timeZone: "America/New_York", label: "ET" });
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const nice = d => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const monthName = k => new Date(k + "-01T12:00").toLocaleDateString("en-US", { month: "long" });
  const wl = gs => [gs.filter(g => g.r === 1).length, gs.filter(g => g.r === 0).length];
  const chev = d => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;

  function clock(start) {
    if (!start) return "TBA";
    const d = new Date(start);
    if (isNaN(d)) return "TBA";
    // ESPN lists games without a set time at midnight Eastern.
    if (start.length > 10 && d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }) === "00:00") return "TBA";
    return d.toLocaleTimeString("en-US", { timeZone: tz().timeZone, hour: "numeric", minute: "2-digit" });
  }

  function todayKey() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });  // pick days are Eastern
  }

  function shell(root, fixed) {
    root.innerHTML = `
<section class="cal-sec">
  <div class="sec-label"><b>The month</b><i class="cal-tag" data-k="monthTag"></i></div>
  <h2 class="sec-h2" data-k="monthH2"><span data-loading>Loading the month</span></h2>
  <div class="cal-tools">
    ${fixed ? "" : `<div class="cal-filters" role="group" aria-label="Sport" data-k="filters"></div>`}
    <div class="cal-monthnav">
      <button type="button" data-k="prev" aria-label="Previous month">${chev("M10 3 5 8l5 5")}</button>
      <span data-k="month" aria-live="polite"></span>
      <button type="button" data-k="next" aria-label="Next month">${chev("m6 3 5 5-5 5")}</button>
    </div>
  </div>
  <div class="cal-grid" data-k="grid"></div>
</section>
<section class="cal-sec" data-k="day">
  <div class="sec-label"><b>The day</b><i class="cal-tag" data-k="dayTag"></i></div>
  <h2 class="sec-h2" data-k="dayH2"></h2>
  <div data-k="dayBody"></div>
</section>`;
    const el = {};
    root.querySelectorAll("[data-k]").forEach(n => { el[n.dataset.k] = n; });
    return el;
  }

  async function getJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function init(root) {
    const fixed = SPORTS.find(s => s.toLowerCase() === (root.dataset.sport || "").toLowerCase()) || "";
    const useHash = !fixed && root.hasAttribute("data-hash");
    const el = shell(root, fixed);
    const cache = {};
    const today = todayKey();
    const st = { sport: fixed || "All", month: today.slice(0, 7), sel: today, open: {} };
    let index;
    try {
      index = await getJson("/calendar/index.json");
    } catch (e) {
      el.monthH2.textContent = "The calendar couldn't load right now. Try again in a minute.";
      el.day.hidden = true;
      return;
    }
    const months = index.months || {};
    const fromHash = () => {
      const k = location.hash.slice(1).toLowerCase();
      return SPORTS.find(s => s.toLowerCase() === k) || "All";
    };
    if (useHash) st.sport = fromHash();

    // Months that have games for the sport shown, plus this month.
    const monthList = () => {
      const list = Object.keys(months).filter(m => st.sport === "All" || months[m][st.sport]);
      if (!list.includes(today.slice(0, 7))) list.push(today.slice(0, 7));
      return list.sort();
    };
    // This month when the sport plays in it; otherwise its latest month before now, or its next one.
    const startMonth = () => {
      const list = monthList();
      const has = m => months[m] && (st.sport === "All" ? Object.keys(months[m]).length : months[m][st.sport]);
      const now = today.slice(0, 7);
      if (has(now)) return now;
      const before = list.filter(m => m < now && has(m));
      const after = list.filter(m => m > now && has(m));
      return before.length ? before[before.length - 1] : after.length ? after[0] : now;
    };

    async function load(m) {
      if (!cache[m]) {
        cache[m] = months[m] ? getJson(`/calendar/${m}.json`).then(d => (d.games || []).map(([d0, s, sp, a, h, pk, pr, r]) =>
          ({ d: d0, start: s, sp, a, h, pk, pr, r }))).catch(() => { delete cache[m]; return null; }) : Promise.resolve([]);
      }
      return cache[m];
    }

    const keep = g => st.sport === "All" || g.sp === st.sport;

    // The day to open in a month: today, else the last day with games (past) or the first (ahead).
    function pickDay(games) {
      if (st.month === today.slice(0, 7)) return today;
      const days = [...new Set(games.filter(keep).map(g => g.d))].sort();
      if (!days.length) return `${st.month}-01`;
      return st.month < today.slice(0, 7) ? days[days.length - 1] : days[0];
    }

    function renderFilters(games) {
      if (!el.filters) return;
      const n = s => (s === "All" ? games.length : games.filter(g => g.sp === s).length);
      el.filters.innerHTML = ["All", ...SPORTS].filter(s => s === "All" || n(s) || s === st.sport)
        .map(s => `<button type="button" data-s="${s}" aria-pressed="${s === st.sport}">${s === "All" ? "All sports" : s}<span>${n(s)}</span></button>`).join("");
    }

    function renderMonth(games) {
      const [y, m] = st.month.split("-").map(Number);
      const name = monthName(st.month);
      el.month.textContent = `${name} ${y}`;
      const list = monthList();
      el.prev.disabled = list.indexOf(st.month) <= 0;
      el.next.disabled = list.indexOf(st.month) >= list.length - 1;
      const gs = games.filter(keep);
      const [w, l] = wl(gs);
      const what = st.sport === "All" ? "games" : `${st.sport} games`;
      el.monthH2.textContent = !gs.length ? `No ${what} in ${name}.`
        : w + l ? `${gs.length} ${what} in ${name}. We're ${w}-${l} on the ${w + l} that are final.` : `${gs.length} ${what} in ${name}.`;
      el.monthTag.textContent = w + l ? `${Math.round(w / (w + l) * 100)}% right` : "";
      const byDay = {};
      gs.forEach(g => (byDay[g.d] = byDay[g.d] || []).push(g));
      const first = new Date(y, m - 1, 1).getDay();
      const days = new Date(y, m, 0).getDate();
      let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join("");
      for (let i = 0; i < first; i++) html += `<div class="cal-day is-blank"></div>`;
      for (let d = 1; d <= days; d++) {
        const k = iso(y, m - 1, d);
        const dg = byDay[k] || [];
        const [dw, dl] = wl(dg);
        const per = SPORTS.map(s => [s, dg.filter(g => g.sp === s).length]).filter(([, c]) => c);
        const isToday = k === today;
        html += `<button type="button" class="cal-day${isToday ? " is-today" : ""}${k === st.sel ? " is-sel" : ""}${dg.length ? "" : " is-empty"}" data-d="${k}" aria-pressed="${k === st.sel}" aria-label="${nice(k)}, ${plural(dg.length, "game")}${dw + dl ? `, ${dw}-${dl}` : ""}">
<span class="cal-top"><span class="cal-n">${d}</span>${dw + dl ? `<span class="cal-wl ${dw >= dl ? "is-up" : "is-down"}">${dw}-${dl}</span>` : ""}</span>
${st.sport === "All" ? `<ul>${per.map(([s, c]) => `<li>${s}<b>${c}</b></li>`).join("")}</ul>` : ""}
<span class="cal-tot${st.sport === "All" ? "" : " is-on"}">${dg.length && !(dw + dl) ? `${dg.length}<span class="cal-w"> game${dg.length === 1 ? "" : "s"}</span>` : ""}</span>
${isToday ? `<span class="cal-today">Today</span>` : ""}</button>`;
      }
      for (let i = 0; i < (7 - (first + days) % 7) % 7; i++) html += `<div class="cal-day is-blank"></div>`;
      el.grid.innerHTML = html;
    }

    function row(g) {
      const res = g.r === 1 ? `<span class="cal-res is-hit">Hit</span>` : g.r === 0 ? `<span class="cal-res is-miss">Miss</span>` : "";
      const pick = g.pk ? `<small>Our pick <b>${esc(g.pk)}</b></small>` : `<small>Pick posts on game day</small>`;
      const pct = g.pk && g.pr != null ? `<span class="cal-pct">${g.pr}<sup>%</sup></span>` : "";
      return `<div class="cal-row"><span class="cal-tm">${clock(g.start)}</span>
<span class="cal-mt">${esc(g.a)} at ${esc(g.h)}${pick}</span><span class="cal-out">${pct}${res}</span></div>`;
    }

    function renderDay(games) {
      const gs = games.filter(g => keep(g) && g.d === st.sel)
        .sort((a, b) => (a.start || "~").localeCompare(b.start || "~"));
      const [w, l] = wl(gs);
      const what = st.sport === "All" ? "game" : `${st.sport} game`;
      el.dayH2.textContent = gs.length ? `${plural(gs.length, what)} on ${nice(st.sel)}${w + l ? `, ${w}-${l} for us` : ""}.`
        : `No ${st.sport === "All" ? "" : st.sport + " "}games on ${nice(st.sel)}.`;
      el.dayTag.textContent = st.sel === today ? "Today" : "";
      const many = new Set(gs.map(g => g.sp)).size > 1;
      let html = "";
      SPORTS.forEach(s => {
        const x = gs.filter(g => g.sp === s);
        if (!x.length) return;
        const [sw, sl] = wl(x);
        const list = st.open[s] ? x : x.slice(0, SHOW);
        // The headline counts the day; a sport's own count only when there's more than one sport.
        html += `<div class="cal-sport">${many || st.sport === "All" ? `<h3>${s}<span>${many ? plural(x.length, "game") + (sw + sl ? ` · ${sw}-${sl}` : "") : ""}</span></h3>` : ""}
<div class="cal-rows">${list.map(row).join("")}</div>
${x.length > list.length ? `<button type="button" class="cal-more" data-s="${s}">Show all ${x.length}</button>` : ""}</div>`;
      });
      el.dayBody.innerHTML = html;
    }

    let games = [];
    async function render(newMonth) {
      if (newMonth) {
        el.monthH2.innerHTML = `<span data-loading>Loading ${esc(monthName(st.month))}</span>`;
        const got = await load(st.month);
        if (got === null) {
          el.monthH2.textContent = "This month couldn't load right now. Try again in a minute.";
          return;
        }
        games = got;
        st.sel = pickDay(games);
        st.open = {};
      }
      renderFilters(games);
      renderMonth(games);
      renderDay(games);
    }

    el.prev.addEventListener("click", () => {
      const list = monthList();
      const i = list.indexOf(st.month);
      if (i > 0) { st.month = list[i - 1]; render(true); }
    });
    el.next.addEventListener("click", () => {
      const list = monthList();
      const i = list.indexOf(st.month);
      if (i < list.length - 1) { st.month = list[i + 1]; render(true); }
    });
    el.grid.addEventListener("click", e => {
      const b = e.target.closest("button.cal-day");
      if (!b) return;
      st.sel = b.dataset.d;
      st.open = {};
      renderMonth(games);
      renderDay(games);
      el.day.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
    el.dayBody.addEventListener("click", e => {
      const b = e.target.closest(".cal-more");
      if (b) { st.open[b.dataset.s] = true; renderDay(games); }
    });
    const setSport = s => {
      const before = st.month;
      st.sport = s;
      if (!monthList().includes(st.month) || !games.some(keep)) st.month = startMonth();
      render(st.month !== before);
    };
    if (el.filters) {
      el.filters.addEventListener("click", e => {
        const b = e.target.closest("button");
        if (!b) return;
        if (useHash) history.replaceState(null, "", b.dataset.s === "All" ? location.pathname + location.search : "#" + b.dataset.s.toLowerCase());
        setSport(b.dataset.s);
      });
    }
    if (useHash) window.addEventListener("hashchange", () => setSport(fromHash()));
    st.month = startMonth();
    render(true);
  }

  document.querySelectorAll(".edge-cal").forEach(init);
})();
