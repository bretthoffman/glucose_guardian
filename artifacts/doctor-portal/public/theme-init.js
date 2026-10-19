// Applies the saved light/dark theme before first paint (no flash). Loaded synchronously
// from index.html; an external file because the CSP disallows inline scripts.
// Mirrors src/lib/theme.tsx — keep the two in sync.
(function () {
  var dark = false;
  try {
    var t = window.localStorage.getItem("gg_theme");
    if (t === "dark") dark = true;
    else if (t !== "light") dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e2) {}
  }
  if (dark) document.documentElement.classList.add("dark");
})();
