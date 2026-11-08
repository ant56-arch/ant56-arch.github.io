/* Lab 2: content tweaks that need a look at the text. Runs again whenever the
   page's own scripts redraw something. */
(() => {
  const hide = e => e && e.classList.add("ds-hide");
  const tidy = () => {
    // "NFL Edge · our picks to win": the page already says NFL
    document.querySelectorAll(".rb-eyebrow").forEach(e => { const t = e.textContent.replace(/^[A-Za-z ]+ Edge\s*·\s*/, ""); if (t !== e.textContent) e.textContent = t.charAt(0).toUpperCase() + t.slice(1); });
    // "League" over a column of league names
    document.querySelectorAll("th").forEach(e => { if (e.textContent.trim() === "League") e.textContent = ""; });
    // a spread pill showing a raw code instead of "Covered"
    document.querySelectorAll(".pill").forEach(e => { if (/^CO[0-9A-F]{6,}$/.test(e.textContent.trim())) e.textContent = "Covered"; });
  };
  let t = 0;
  const run = () => { clearTimeout(t); t = setTimeout(() => { mo.disconnect(); tidy(); mo.observe(document.body, { childList: true, subtree: true }); }, 50); };
  const mo = new MutationObserver(run);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
