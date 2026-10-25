// ============================================================
// YardStatus: the one /api/status poller on the page.
// Subscribers get every snapshot plus, immediately on subscribe, the
// last cached one so a page can paint before the first fetch lands.
// ============================================================
window.YardStatus = window.YardStatus || (function () {
  var listeners = [];
  var errorListeners = [];
  var latest = null;

  var cached = YardCache.read('fullStatus');
  if (cached) latest = cached.value;

  var poller = YardCache.createPoller({
    interval: 5000,
    maxInterval: 20000,
    fetchFn: function () {
      // When the request left, handed to every subscriber. A request that was
      // already on its way when something changed answers for the moment
      // before the change, and the run station has to tell those apart from
      // an answer that came after: see where it decides a run has finished.
      var requestedAt = Date.now();
      return fetch('/api/status').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        latest = data;
        YardCache.write('fullStatus', data);
        // Kept as its own key: the nav chip paints from it on every page,
        // including ones that never ask for the full snapshot.
        YardCache.write('roverStatus', data.rover || {});
        var meta = { requestedAt: requestedAt };
        listeners.forEach(function (fn) { try { fn(data, meta); } catch (e) {} });
      });
    },
    onError: function (err) {
      errorListeners.forEach(function (fn) { try { fn(err); } catch (e) {} });
    }
  });

  return {
    // fn is called with each snapshot, and once up front with the cached one
    // if there is one, so callers never need their own cache-read path. The
    // second argument says which: { cached, ts } for the cached one, and
    // { requestedAt } for a fresh one.
    subscribe: function (fn) {
      listeners.push(fn);
      if (latest) { try { fn(latest, { cached: true, ts: cached && cached.ts }); } catch (e) {} }
    },
    onError: function (fn) { errorListeners.push(fn); },
    refreshNow: function () { return poller.refreshNow(); },
    cachedAt: function () { return cached && cached.ts; },
    latest: function () { return latest; }
  };
})();

(function () {
  var el = document.getElementById('sysRover');
  if (el) {
    var dot = el.querySelector('.sys-dot'), txt = el.querySelector('.sys-txt');

    function paint(r) {
      var ok = r.reachable && (r.status == null || r.status === 'ok');
      dot.className = 'sys-dot ' + (ok ? 'ok' : 'bad');
      var q = (r.queue_size != null) ? '  ·  queue ' + r.queue_size : '';
      txt.textContent = ok ? ('Rover online' + q) : (r.reachable ? 'Rover degraded' : 'Rover offline');
    }

    var up = document.getElementById('sysUpload');
    function paintUploads(u) {
      if (!up) return;
      var label, short, tone;
      if (!u || !u.configured) {
        up.hidden = true;
        return;
      }
      if (u.sending) {
        var pct = Math.min(100, Math.round(100 * u.sending.sent / u.sending.total));
        // The one going out counts among the waiting until it lands.
        var more = (u.waiting || 0) - 1;
        label = (pct < 100 ? 'Uploading ' + pct + '%' : 'Uploading') + (more > 0 ? ' \u00b7 ' + more + ' more' : '');
        short = pct + '%';
        tone = 'info';
      } else if (u.waiting) {
        label = u.waiting + (u.waiting === 1 ? ' video' : ' videos') + ' waiting to upload';
        short = String(u.waiting);
        tone = 'warn';
      } else if (u.uploaded) {
        label = 'All on YouTube';
        short = '';
        tone = 'ok';
      } else {
        up.hidden = true;
        return;
      }
      if (u.online === false && !u.sending) label += ' \u00b7 no internet';
      up.hidden = false;
      up.dataset.tone = tone;
      up.querySelector('.sys-txt').textContent = label;
      up.querySelector('.sys-short').textContent = short;
      up.title = label;
      up.setAttribute('aria-label', label + '. Details on Settings.');
    }

    // Instant paint from the last known state so nav between pages doesn't
    // flash "Rover…" on every load while the fresh fetch happens in the background.
    var cachedRover = YardCache.read('roverStatus');
    if (cachedRover) paint(cachedRover.value);

    YardStatus.subscribe(function (d) { paint(d.rover || {}); paintUploads(d.uploads); });
    YardStatus.onError(function () {
      dot.className = 'sys-dot bad';
      txt.textContent = 'Rover offline';
    });
  }

  // The nav collapses to a hamburger below 760px, where four items plus the
  // rover chip do not fit beside the brand. Toggled in JS rather than with a
  // checkbox hack so aria-expanded stays honest for a screen reader.
  var toggle = document.getElementById('navToggle');
  var topnav = document.getElementById('topnav');
  if (toggle && topnav) {
    toggle.addEventListener('click', function () {
      var open = topnav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Tapping a link on a phone should not leave the menu hanging open behind
    // the page it just navigated to.
    topnav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        topnav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

})();

// ============================================================
// Info tip: click a `.info-tip` button to open the `.info-pop`
// its aria-describedby points at, positioned under the button.
// Shared here so every console page gets it for free by including
// this file, rather than each page wiring its own popover logic.
// position:fixed on the popover (set here, not in CSS) is
// deliberate - it has to escape any ancestor's overflow:auto
// (the Settings page's scrolling columns) rather than being
// clipped by it, which a CSS-anchored popover would be.
// ============================================================
(function () {
  function closeAll() {
    document.querySelectorAll('.info-tip[aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.info-pop').forEach(function (pop) {
      pop.style.display = 'none';
    });
  }

  function openFor(btn) {
    var pop = document.getElementById(btn.getAttribute('aria-describedby'));
    if (!pop) return;
    closeAll();
    btn.setAttribute('aria-expanded', 'true');
    pop.style.display = 'block';

    var r = btn.getBoundingClientRect();
    var maxW = 260;
    var left = Math.min(r.left, window.innerWidth - maxW - 16);
    left = Math.max(8, left);
    var top = r.bottom + 8;
    // Flip above the button rather than run off the bottom of the screen.
    if (top + pop.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - 8 - pop.offsetHeight);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.info-tip');
    if (btn) {
      var wasOpen = btn.getAttribute('aria-expanded') === 'true';
      wasOpen ? closeAll() : openFor(btn);
      e.stopPropagation();
      return;
    }
    if (!e.target.closest('.info-pop')) closeAll();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  // A fixed-position popover would otherwise drift away from the button
  // it's anchored to as soon as the page scrolls or the window resizes.
  window.addEventListener('scroll', closeAll, true);
  window.addEventListener('resize', closeAll);
})();
