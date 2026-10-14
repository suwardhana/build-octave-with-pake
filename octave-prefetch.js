// Octave Music — octave-prefetch.js
// Percepat ganti page (SPA Next.js) dari sisi wrapper:
// hover/intent prefetch + prefetch Next router bila tersedia.
(function () {
  'use strict';

  var prefetched = {};
  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  function nextPrefetch(href) {
    try {
      // Next App Router / Pages Router yang terekspos.
      if (window.next && window.next.router && typeof window.next.router.prefetch === 'function') {
        window.next.router.prefetch(href);
        return true;
      }
      var nav = window.__NEXT_DATA__ || window.__nextRouter;
      if (nav && nav.prefetch) return false;
    } catch (e) {}
    return false;
  }

  function warm(href) {
    if (!href || prefetched[href]) return;
    if (href.charAt(0) !== '/' || href.indexOf('/_next') === 0) return;
    prefetched[href] = true;
    if (nextPrefetch(href)) return;
    try {
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = href;
      document.head.appendChild(l);
    } catch (e) {}
    // Fallback: fetch ringan (HTML) saat idle.
    var run = function () {
      if (origFetch) origFetch(href, { credentials: 'same-origin' }).catch(function () {});
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 1500);
  }

  var timer;
  document.addEventListener('mouseover', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    clearTimeout(timer);
    timer = setTimeout(function () { warm(a.getAttribute('href')); }, 80);
  }, { passive: true });

  document.addEventListener('focusin', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) warm(a.getAttribute('href'));
  });
})();
