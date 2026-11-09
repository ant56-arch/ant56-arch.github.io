(() => { // stick the page tabs just under whatever is pinned at the top
  const bar = document.querySelector(".edge-jump, .jump"); if (!bar) return;
  const top = () => Math.max(0, ...[...document.querySelectorAll("body *")].filter(e => { const s = getComputedStyle(e); return (s.position === "fixed" || (s.position === "sticky" && e !== bar)) && e.getBoundingClientRect().top < 160 && e.getBoundingClientRect().bottom > 0 && e.offsetHeight < 200 && !bar.contains(e); }).map(e => e.getBoundingClientRect().bottom));
  const set = () => bar.style.top = top() + "px"; set(); addEventListener("scroll", set, { passive: true }); addEventListener("resize", set);
})();
