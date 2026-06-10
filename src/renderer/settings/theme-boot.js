// Runs in <head> before first paint to set the initial light/dark theme and
// avoid a flash of the wrong palette. Uses the last-applied theme cached in
// localStorage, falling back to the OS appearance. The authoritative value
// (including the "system" preference) is confirmed over IPC once the main
// renderer script loads and calls the theme API. Kept inline-script-free so it
// passes the page CSP (default-src 'self').
(function () {
  try {
    const cached = localStorage.getItem('nowtify-theme');
    const theme =
      cached === 'light' || cached === 'dark'
        ? cached
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    /* no-op: the main script will set the theme over IPC */
  }
})();
