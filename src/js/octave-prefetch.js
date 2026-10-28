// Octave Music — octave-prefetch.js
// Prefetch navigasi SPA saat hover/focus.
//
// Versi lama melakukan DUA request untuk href yang sama: <link rel=prefetch>
// DAN fetch() manual. Di WKWebView yang benar-benar jalan adalah fetch(),
// jadi <link> dihapus. Sekarang:
// - satu jalur request saja (fetch manual, atau Next router kalau tersedia)
// - dwell 120ms + cek :hover, jadi tidak menembak saat kursor cuma lewat
// - maksimal 2 request paralel, dedupe per path, hormati saveData
// - tidak prefetch halaman yang sedang dibuka / aset statis / API

(function () {
  'use strict';

  if (window.__octavePrefetch) return;
  window.__octavePrefetch = true;

  var octave = window.__octave;
  if (!octave) return;

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  var prefetched = new Set();
  var inflight = 0;
  var MAX_INFLIGHT = 2;
  var MAX_REMEMBER = 300;
  var hoverTimer = 0;

  function saveData() {
    try {
      return !!(navigator.connection && navigator.connection.saveData);
    } catch (e) {
      return false;
    }
  }

  function normalize(href) {
    try {
      var url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      if (url.pathname === location.pathname && url.search === location.search) return null;
      if (/^\/(?:_next|api|audio|static|assets)\//.test(url.pathname)) return null;
      if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|woff2?|ttf|pdf|zip|dmg)$/i.test(url.pathname)) {
        return null;
      }
      return url.pathname + url.search;
    } catch (e) {
      return null;
    }
  }

  function nextPrefetch(path) {
    try {
      if (window.next && window.next.router && typeof window.next.router.prefetch === 'function') {
        var result = window.next.router.prefetch(path);
        if (result && result.catch) result.catch(function () {});
        return true;
      }
    } catch (e) {
      /* fallback fetch */
    }
    return false;
  }

  function remember(path) {
    prefetched.add(path);
    if (prefetched.size > MAX_REMEMBER) {
      var oldest = prefetched.values().next().value;
      prefetched.delete(oldest);
    }
  }

  function warm(path) {
    if (!path || !origFetch || saveData()) return;
    if (prefetched.has(path) || inflight >= MAX_INFLIGHT) return;
    remember(path);

    if (nextPrefetch(path)) {
      octave.metric('prefetch.router', 0);
      return;
    }

    var run = function () {
      if (document.visibilityState === 'hidden') {
        prefetched.delete(path);
        return;
      }

      inflight += 1;
      var t0 = window.performance && performance.now ? performance.now() : Date.now();

      try {
        origFetch(path, { credentials: 'same-origin' })
          .then(function () {
            var end = window.performance && performance.now ? performance.now() : Date.now();
            octave.metric('prefetch.fetch', end - t0);
          })
          .catch(function () {
            prefetched.delete(path);
          })
          .then(function () {
            inflight -= 1;
          });
      } catch (e) {
        inflight -= 1;
        prefetched.delete(path);
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 300);
    }
  }

  function pathFromEvent(event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return null;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
    return normalize(anchor.getAttribute('href'));
  }

  document.addEventListener('pointerover', function (event) {
    var path = pathFromEvent(event);
    if (!path) return;
    var anchor = event.target.closest('a[href]');
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      // Jangan prefetch kalau kursor sudah pindah ke link lain.
      if (anchor && anchor.matches && anchor.matches(':hover')) warm(path);
    }, 120);
  }, { passive: true });

  document.addEventListener('focusin', function (event) {
    var path = pathFromEvent(event);
    if (path) warm(path);
  });

  octave.register('prefetch', function () {
    return { remembered: prefetched.size, inflight: inflight };
  });
})();
