// Octave Music — octave-media-lazy.js
// Potong beban awal: video di bawah fold tidak preload sampai terlihat.
(function () {
  'use strict';

  function armVideo(v) {
    if (!v || v.dataset.octaveLazy === '1') return;
    v.dataset.octaveLazy = '1';
    try {
      v.preload = 'none';
      if (!v.poster) v.preload = 'none';
      // Jangan autoplay sebelum terlihat.
      if (v.autoplay && !isVisible(v)) v.pause && v.pause();
    } catch (e) {}
    try {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              try { v.preload = 'metadata'; } catch (e) {}
              obs.disconnect();
            }
          });
        }, { rootMargin: '400px' }).observe(v);
      }
    } catch (e) {}
  }

  function isVisible(el) {
    try {
      var r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 800);
    } catch (e) { return true; }
  }

  function scan() {
    document.querySelectorAll('video').forEach(armVideo);
  }

  scan();
  window.addEventListener('load', scan);
  try {
    new MutationObserver(function () { scan(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
