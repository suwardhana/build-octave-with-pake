// Octave Music — octave-native.js
// macOS: drag window + geser logo dari traffic lights.
// Semua kerja dipicu octave-core (route / mutation batch), bukan observer sendiri.
// Di Windows/Linux modul ini no-op: title bar native tidak butuh padding traffic lights.

(function () {
  'use strict';

  if (window.__octaveNative) return;
  window.__octaveNative = true;

  var octave = window.__octave;
  if (!octave) {
    if (window.console && console.warn) console.warn('[octave-native] octave-core belum ada');
    return;
  }

  var IS_MAC = /mac/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      navigator.userAgent ||
      ''
  );
  var TRAFFIC_TOP_PAD = '30px';
  var TRAFFIC_LEFT_PAD = '12px';
  var INTERACTIVE_SEL =
    'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [role="row"], audio, video';

  var marked = new WeakSet();
  var safeContainers = new WeakSet();
  var markedCount = 0;

  function mark(el) {
    if (!el || el.nodeType !== 1 || marked.has(el)) return;
    marked.add(el);
    markedCount += 1;
    if (!el.hasAttribute('data-tauri-drag-region')) {
      el.setAttribute('data-tauri-drag-region', '');
    }
  }

  function markTree(root) {
    if (!root) return;
    mark(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var child = all[i];
      if (marked.has(child)) continue;
      // Elemen interaktif (dan turunannya) jangan dijadikan drag handle.
      if (child.closest && child.closest(INTERACTIVE_SEL)) {
        marked.add(child);
        continue;
      }
      mark(child);
    }
  }

  function fixLogoSpacing() {
    if (!IS_MAC) return;
    var logos = document.querySelectorAll(
      'img[src*="white_logo"], img[src*="logo"], img[alt*="ctave" i]'
    );
    for (var i = 0; i < logos.length; i++) {
      var img = logos[i];
      var container =
        img.closest('header') ||
        img.closest('nav') ||
        img.closest('aside') ||
        (img.parentElement && img.parentElement.parentElement) ||
        img.parentElement;
      if (!container || safeContainers.has(container)) continue;
      safeContainers.add(container);
      container.classList.add('octave-traffic-safe');
      if (!container.style.paddingTop) container.style.paddingTop = TRAFFIC_TOP_PAD;
      if (!container.style.paddingLeft) container.style.paddingLeft = TRAFFIC_LEFT_PAD;
    }
  }

  function makeDragRegions() {
    if (!IS_MAC) return;
    var candidates = [];
    var nodes = document.querySelectorAll('header, nav, aside');
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (rect.top <= 48 && rect.left <= 200 && rect.width > 100) {
        candidates.push(nodes[i]);
      }
    }
    // Fallback kalau layout berubah total: elemen paling atas yang lebar.
    if (candidates.length === 0 && document.body && document.body.firstElementChild) {
      candidates.push(document.body.firstElementChild);
    }
    for (var j = 0; j < candidates.length && j < 3; j++) {
      markTree(candidates[j]);
    }
  }

  function apply() {
    if (!document.body) return;
    var t0 = window.performance && performance.now ? performance.now() : Date.now();
    fixLogoSpacing();
    makeDragRegions();
    var end = window.performance && performance.now ? performance.now() : Date.now();
    octave.metric('native.apply', end - t0);
  }

  var timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      apply();
    }, 100);
  }

  octave.onRoute(function () {
    schedule();
  });

  octave.onMutations(function (batch) {
    if (batch.full) {
      schedule();
      return;
    }
    for (var i = 0; i < batch.records.length; i++) {
      var added = batch.records[i].addedNodes;
      if (added && added.length > 0) {
        schedule();
        return;
      }
    }
  });

  apply();
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('load', apply);

  octave.register('native', function () {
    return {
      mac: IS_MAC,
      marked: markedCount,
      tokens: document.querySelectorAll('[data-tauri-drag-region]').length,
    };
  });

  if (window.console && console.debug) {
    console.debug('[octave-native] aktif (mac=' + IS_MAC + ')');
  }
})();
