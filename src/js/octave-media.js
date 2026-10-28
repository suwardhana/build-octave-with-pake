// Octave Music — octave-media.js
// Fix macOS Now Playing: tombol prev/next track, bukan seek mundur/maju 15 detik.
//
// Penyebab: situs mendaftarkan handler MediaSession `seekbackward`/`seekforward`
// (±15s) tapi tidak mendaftarkan `previoustrack`/`nexttrack`, sehingga
// Control Center + tombol media menampilkan/memicu seek, bukan ganti lagu.
//
// Versi lama memakai dua setInterval (2 dtk + 1 dtk). Sekarang tidak ada
// polling: handler ditegakkan ulang saat media play / metadata baru / route.
// API `__octave.media` disediakan untuk plugin lain (shortcut, diag).

(function () {
  'use strict';

  if (window.__octaveMedia) return;
  window.__octaveMedia = true;

  var octave = window.__octave;
  if (!octave) return;

  var NEXT_RE = /(next|skip[\s_-]?forward|suivant)/i;
  var PREV_RE = /(prev(ious)?|skip[\s_-]?back|pr[eé]c[eé]dent)/i;
  var INTERACTIVE_STOP = 'audio, video, input, textarea, select';

  function describe(el) {
    var parts = [
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-testid'),
      (el.textContent || '').trim().slice(0, 80),
    ];
    return parts.filter(Boolean).join(' | ');
  }

  function isVisible(el) {
    try {
      var rect = el.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4;
    } catch (e) {
      return false;
    }
  }

  // Cari tombol prev/next. Prioritaskan yang berada di player bar
  // (sepertiga bawah viewport) supaya tidak salah klik tombol
  // "next" di playlist/konten lain.
  function findButton(re) {
    var els = document.querySelectorAll('button, [role="button"]');
    var cands = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!isVisible(el)) continue;
      if (el.closest(INTERACTIVE_STOP)) continue;
      if (re.test(describe(el))) cands.push(el);
    }
    if (cands.length === 0) return null;
    var h = window.innerHeight || 800;
    cands.sort(function (a, b) {
      var aLow = a.getBoundingClientRect().top > h * 0.66 ? 0 : 1;
      var bLow = b.getBoundingClientRect().top > h * 0.66 ? 0 : 1;
      return aLow - bLow;
    });
    return cands[0];
  }

  function clickButton(re, name) {
    var btn = findButton(re);
    if (btn) {
      btn.click();
      return true;
    }
    if (window.console && console.debug) {
      console.debug('[octave-media] tombol ' + name + ' tidak ketemu');
    }
    return false;
  }

  function next() {
    return clickButton(NEXT_RE, 'next');
  }

  function prev() {
    return clickButton(PREV_RE, 'previous');
  }

  function primary() {
    return document.querySelector('audio') || document.querySelector('video');
  }

  function toggle() {
    var el = primary();
    if (!el) return false;
    if (el.paused) {
      var result = el.play();
      if (result && result.catch) result.catch(function () {});
    } else {
      el.pause();
    }
    return true;
  }

  function seek(delta) {
    var el = primary();
    if (!el) return false;
    var max = isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.max(0, Math.min(max, el.currentTime + delta));
    return true;
  }

  function enforce() {
    var ms;
    try {
      ms = navigator.mediaSession;
      if (!ms) return;
    } catch (e) {
      return;
    }
    try {
      // Hapus seek ±15s bawaan situs...
      ms.setActionHandler('seekbackward', null);
      ms.setActionHandler('seekforward', null);
      // ...ganti dengan prev/next track.
      // (play/pause sengaja tidak disentuh: bawaan situs sudah benar.)
      ms.setActionHandler('previoustrack', function () {
        prev();
      });
      ms.setActionHandler('nexttrack', function () {
        next();
      });
    } catch (e) {
      /* abaikan */
    }
  }

  // Media event tidak bubble, tapi capture di document tetap menangkapnya.
  ['play', 'pause', 'loadedmetadata', 'ended'].forEach(function (event) {
    document.addEventListener(event, enforce, true);
  });

  document.addEventListener('DOMContentLoaded', enforce);
  window.addEventListener('load', enforce);
  octave.onRoute(function () {
    setTimeout(enforce, 120);
  });

  enforce();

  octave.media = {
    next: next,
    prev: prev,
    toggle: toggle,
    seek: seek,
    enforce: enforce,
  };

  octave.register('media', function () {
    var el = primary();
    var title = null;
    try {
      title = navigator.mediaSession && navigator.mediaSession.metadata
        ? navigator.mediaSession.metadata.title
        : null;
    } catch (e) {
      title = null;
    }
    return {
      audio: !!el,
      paused: el ? el.paused : null,
      title: title,
    };
  });

  if (window.console && console.debug) console.debug('[octave-media] aktif');
})();
