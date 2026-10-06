/*
 * Light or dark, decided before the page paints, the way Mission Control does it.
 *
 * Mission Control follows the laptop's setting unless the operator picked a
 * theme, and it runs a script like this one in <head> so the first paint is
 * already right. The console did not: it was dark only, so an operator on a
 * light-mode laptop went from paper to deep space the moment they pressed
 * Send to Rover.
 *
 * WHICH THEME. The one Mission Control handed over, if it did: Send to Rover
 * adds `theme` to the handoff, because the operator may have picked a theme
 * there, and this page is on another address and cannot read that choice.
 * It is remembered, so the other console pages keep it. Without one, the
 * laptop's setting, which is what Mission Control would have shown.
 *
 * Loaded by the console pages only. The kiosk pages (/code/, /monitor/) do
 * not load it and stay on the dark palette they were designed for.
 */
(function () {
  var KEY = 'yard:theme';

  function valid(theme) {
    return theme === 'light' || theme === 'dark' ? theme : null;
  }

  var theme = null;
  try {
    var handed = valid(new URLSearchParams(window.location.search).get('theme'));
    if (handed) localStorage.setItem(KEY, handed);
    theme = handed || valid(localStorage.getItem(KEY));
  } catch (e) {
    // Storage refused. The laptop's setting still applies below.
  }
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
  // Scrollbars, inputs and selects follow too, not only our own colours.
  document.documentElement.style.colorScheme = theme;
})();
