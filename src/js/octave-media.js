// Octave Music — fix macOS Now Playing: tombol prev/next track,
// bukan seek mundur/maju 15 detik.
//
// Penyebab: situs mendaftarkan handler MediaSession `seekbackward`/
// `seekforward` (±15s) tapi tidak mendaftarkan `previoustrack`/
// `nexttrack`, sehingga Control Center + tombol media (F7/F8/F9,
// AirPods, Touch Bar) menampilkan/memicu seek, bukan ganti lagu.
//
// Script ini: hapus handler seek bawaan situs, pasang handler
// prev/next yang meng-klik tombol player di halaman. Dijalankan ulang
// berkala karena situs (SPA) suka mendaftarkan ulang handler-nya
// setiap ganti lagu.

(function () {
  'use strict';

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
      var r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    } catch (e) {
      return false;
    }
  }

  // Cari tombol prev/next. Prioritaskan yang berada di player bar
  // (sepertiga bawah viewport) supaya tidak salah klik tombol
  // "next" di playlist/konten lain.
  function findButton(re) {
    var els = Array.prototype.slice.call(
      document.querySelectorAll('button, [role="button"]')
    );
    var cands = els.filter(function (el) {
      if (!isVisible(el)) return false;
      if (el.closest(INTERACTIVE_STOP)) return false;
      return re.test(describe(el));
    });
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
      // (play/pause sengaja tidak disentuh: bawaan situs sudah benar,
      // terlihat dari ikon pause yang tampil di Now Playing.)
      ms.setActionHandler('previoustrack', function () {
        clickButton(PREV_RE, 'previous');
      });
      ms.setActionHandler('nexttrack', function () {
        clickButton(NEXT_RE, 'next');
      });
    } catch (e) {
      /* abaikan */
    }
  }

  enforce();
  // Situs mendaftarkan ulang handler tiap ganti lagu → tegakkan ulang.
  setInterval(enforce, 2000);
  // Tegakkan segera saat judul halaman (lagu) berubah.
  var lastTitle = document.title;
  setInterval(function () {
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      setTimeout(enforce, 500);
    }
  }, 1000);
})();
