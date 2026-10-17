// Octave Music — octave-volume.js
// Port dari reference/volume.ts (YouTube Music "exponential-volume" plugin).
//
// Masalah yang sama: slider volume HTML5 itu linear, telinga manusia
// logaritmik. Akibatnya 50% di slider masih terdengar "kencang".
// Solusi: petakan nilai UI (0..1) ke volume asli secara eksponensial.
//
//   UI 50% (0.5) -> aktual 0.5 ** 3 = 0.125
//   UI 5%  (0.05) -> aktual 0.05 ** 3 = 0.000125
//
// Cara kerja: override getter/setter HTMLMediaElement.prototype.volume.
// - set(v): simpan v sebagai "UI value", teruskan v ** EXPONENT ke native.
// - get(): baca nilai native (rendah), kembalikan v ** (1 / EXPONENT).
//   WeakMap menyimpan nilai UI asli untuk hindari error pembulatan
//   (mis. 0.5 ** 3 ** (1/3) != tepat 0.5 di floating point).
//
// Penyesuaian dari versi reference:
// - Tidak ada playerApi / createPlugin / i18n di Octave (Pake inject polos),
//   jadi syncVolume(playerApi) diganti resync elemen <audio>/<video> yang ada
//   + observer untuk elemen baru.
// - Guard double-patch (inject bisa jalan 2x di SPA).
// - EXPONENT di atas, gampang di-tweak (3 = sama kayak PulseAudio).

(function () {
  'use strict';

  // Sama kayak reference: 3 (nilai yang dipakai PulseAudio).
  // Makin besar = makin pelan di slider bawah.
  var EXPONENT = 3;

  // Jangan patch dua kali (Pake kadang inject ulang / HMR SPA).
  if (window.__octaveVolumePatched) return;
  window.__octaveVolumePatched = true;

  var storedOriginalVolumes = new WeakMap();

  var propertyDescriptor;
  try {
    propertyDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'volume'
    );
  } catch (e) {
    propertyDescriptor = undefined;
  }

  // Kalau descriptor tidak ketemu / tidak punya getter-setter, batal aman.
  if (
    !propertyDescriptor ||
    typeof propertyDescriptor.get !== 'function' ||
    typeof propertyDescriptor.set !== 'function'
  ) {
    if (window.console && console.debug) {
      console.debug('[octave-volume] descriptor volume tidak ada, skip');
    }
    return;
  }

  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    enumerable: propertyDescriptor.enumerable,
    get: function () {
      var lowVolume = propertyDescriptor.get.call(this);
      if (typeof lowVolume !== 'number' || isNaN(lowVolume)) return lowVolume;
      var calculatedOriginalVolume = Math.pow(lowVolume, 1 / EXPONENT);

      var storedOriginalVolume = storedOriginalVolumes.has(this)
        ? storedOriginalVolumes.get(this)
        : NaN;
      // Toleransi akurasi floating point (sama kayak reference: 0.01).
      if (
        typeof storedOriginalVolume === 'number' &&
        Math.abs(storedOriginalVolume - calculatedOriginalVolume) < 0.01
      ) {
        return storedOriginalVolume;
      }
      return calculatedOriginalVolume;
    },
    set: function (originalVolume) {
      var v = Number(originalVolume);
      // Biarkan native yang validasi range; tapi jangan simpan NaN.
      if (isNaN(v)) {
        propertyDescriptor.set.call(this, originalVolume);
        return;
      }
      var lowVolume = Math.pow(v, EXPONENT);
      storedOriginalVolumes.set(this, v);
      propertyDescriptor.set.call(this, lowVolume);
    },
  });

  // Pengganti syncVolume(playerApi) di reference:
  // baca-tulis ulang sekali supaya WeakMap terisi dan mapping stabil.
  function resync(el) {
    try {
      if (!el || (el.tagName !== 'AUDIO' && el.tagName !== 'VIDEO')) return;
      var v = el.volume;
      el.volume = v;
    } catch (e) {
      /* abaikan */
    }
  }

  function resyncAll() {
    try {
      document
        .querySelectorAll('audio, video')
        .forEach(function (el) { resync(el); });
    } catch (e) {
      /* abaikan */
    }
  }

  resyncAll();
  document.addEventListener('DOMContentLoaded', resyncAll);
  window.addEventListener('load', resyncAll);

  // Elemen baru (ganti lagu sering bikin <audio> baru di SPA).
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (!n || n.nodeType !== 1) return;
          if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') {
            resync(n);
          } else if (n.querySelectorAll) {
            n.querySelectorAll('audio, video').forEach(function (el) {
              resync(el);
            });
          }
        });
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    /* abaikan */
  }

  if (window.console && console.debug) {
    console.debug('[octave-volume] aktif (exponent=' + EXPONENT + ')');
  }
})();
