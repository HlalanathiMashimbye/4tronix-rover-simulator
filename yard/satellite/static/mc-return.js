/*
 * Where the "Mission Control" back link takes the operator.
 *
 * The link used to point at Mission Control's home page, which is the learner
 * feed: an operator who sent a mission from the console, ran it here and
 * pressed back landed somewhere they had never been. Mission Control now sends
 * the page to come back to with the handoff (`returnTo`), and this remembers
 * it for every page of the console, because the operator usually visits the
 * monitor or settings before going back.
 *
 * ONLY MISSION CONTROL'S OWN ADDRESS IS ACCEPTED. `returnTo` arrives in a URL
 * anybody can craft, and a link that sends an operator to whatever address a
 * crafted link named is an open redirect. Anything on another origin is
 * ignored and the link keeps its server-rendered default (the operator
 * console).
 */
(function () {
  var KEY = 'yard:missionControlReturn';

  function safeReturnTo(raw, missionControlUrl) {
    if (!raw || !missionControlUrl) return null;
    try {
      var target = new URL(raw);
      var home = new URL(missionControlUrl);
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
      if (target.origin !== home.origin) return null;
      return target.toString();
    } catch (e) {
      return null;
    }
  }

  window.MissionControlReturn = { safeReturnTo: safeReturnTo };

  var link = document.querySelector('a.mc-back');
  if (!link) return;
  var home = link.getAttribute('data-mission-control');

  var incoming = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'), home);
  var remembered = null;
  try {
    if (incoming) localStorage.setItem(KEY, incoming);
    remembered = safeReturnTo(localStorage.getItem(KEY), home);
  } catch (e) {
    // Storage refused: this page can still use what it was handed.
    remembered = incoming;
  }
  if (remembered) link.href = remembered;
})();
