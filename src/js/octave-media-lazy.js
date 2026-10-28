// Octave Music — octave-media-lazy.js
// Potong beban awal: video di bawah fold tidak preload sampai terlihat.
//
// Versi lama menjalankan `document.querySelectorAll('video')` pada SETIAP
// mutation batch. Di app musik yang tidak punya <video>, itu murni overhead.
// Versi ini hanya scan kalau memang ada video yang ditambahkan / route baru.

(function () {
  'use strict';

  if (window.__octaveMediaLazy) return;
  window.__octaveMediaLazy = true;

  var octave = window.__octave;
  if (!octave) return;

  var videos = 0;
  var armed = 0;

  function isVisible(el) {
    try {
      var rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < (window.innerHeight || 800);
    } catch (e) {
      return true;
    }
  }

  function armVideo(video) {
    if (!video || video.dataset.octaveLazy === '1') return;
    video.dataset.octaveLazy = '1';
    armed += 1;

    try {
      video.preload = 'none';
      if (video.autoplay && !isVisible(video) && video.pause) video.pause();
    } catch (e) {
      /* abaikan */
    }

    try {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            try {
              video.preload = 'metadata';
            } catch (e) {
              /* abaikan */
            }
            obs.disconnect();
          });
        }, { rootMargin: '400px' }).observe(video);
      }
    } catch (e) {
      /* abaikan */
    }
  }

  function scan() {
    var nodes = document.querySelectorAll('video');
    videos = nodes.length;
    for (var i = 0; i < nodes.length; i++) armVideo(nodes[i]);
  }

  var timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      scan();
    }, 200);
  }

  octave.onRoute(function () {
    schedule();
  });

  octave.onMutations(function (batch) {
    if (batch.full) {
      schedule();
      return;
    }

    if (videos > 0) {
      schedule();
      return;
    }

    // Belum ada video: cuma scan kalau ada node video yang benar-benar masuk.
    for (var i = 0; i < batch.records.length; i++) {
      var added = batch.records[i].addedNodes;
      if (!added) continue;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (!node || node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
          scan();
          return;
        }
      }
    }
  });

  scan();
  document.addEventListener('DOMContentLoaded', scan);
  window.addEventListener('load', scan);

  octave.register('media-lazy', function () {
    return { videos: videos, armed: armed };
  });
})();
