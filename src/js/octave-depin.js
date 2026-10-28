// Octave Music — octave-depin.js
// Hilangkan kata "Pinned" dekoratif di sidebar:
// "Pinned · 40 songs" -> "40 songs", "Pinned · Playlist" -> "Playlist".
//
// Versi lama menyapu SELURUH body tiap 150 ms dan mengamati characterData.
// Akibatnya mengetik di search / timer progres lagu memicu walk O(N) terus.
// Versi ini hanya menyapu elemen sidebar, dipicu route + mutation batch dari
// octave-core, dan tidak pernah mengamati text node global.

(function () {
  'use strict';

  if (window.__octaveDepin) return;
  window.__octaveDepin = true;

  var octave = window.__octave;
  if (!octave) return;

  // Awalan "Pinned · " / "Épinglé · " (EN + FR) di node teks.
  var ANY_RE = /(pinned|épingl[ée]e?s?)\s*[·•∙|]\s*/gi;
  var ONLY_RE = /^\s*(pinned|épingl[ée]e?s?)\s*$/i;
  var SCOPE_SEL =
    'aside, nav, [data-testid*="sidebar" i], [class*="sidebar" i], [class*="Sidebar"]';

  function scope() {
    return document.querySelector(SCOPE_SEL);
  }

  function cleanTextNode(node) {
    var value = node.nodeValue;
    if (!value || value.length < 4) return;
    ANY_RE.lastIndex = 0;
    var next = value.replace(ANY_RE, '');
    if (next !== value) node.nodeValue = next;
  }

  function cleanAttributes(root) {
    var els = root.querySelectorAll(
      '[aria-label*="inned" i], [title*="inned" i], [aria-label*="pingl" i], [title*="pingl" i]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      ['aria-label', 'title'].forEach(function (attr) {
        var value = el.getAttribute(attr);
        if (!value) return;
        ANY_RE.lastIndex = 0;
        var next = value.replace(ANY_RE, '');
        if (next !== value) el.setAttribute(attr, next);
      });
    }
  }

  function hidePinnedHeader(root) {
    // Header seksi "PINNED" yang berdiri sendiri (bukan subtitle).
    var els = root.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length !== 0 || el.dataset.octaveDepin === '1') continue;
      ONLY_RE.lastIndex = 0;
      if (ONLY_RE.test(el.textContent || '')) {
        el.dataset.octaveDepin = '1';
        el.style.display = 'none';
      }
    }
  }

  function sweep() {
    if (octave.flags.perfMode || !document.body) return;
    var root = scope();
    if (!root) return;

    var t0 = window.performance && performance.now ? performance.now() : Date.now();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) cleanTextNode(node);
    cleanAttributes(root);
    hidePinnedHeader(root);
    var end = window.performance && performance.now ? performance.now() : Date.now();
    octave.metric('depin.sweep', end - t0);
  }

  var timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      sweep();
    }, 120);
  }

  octave.onRoute(function () {
    schedule();
  });

  octave.onMutations(function (batch) {
    var root = scope();
    if (!root) return;
    if (batch.full) {
      schedule();
      return;
    }
    for (var i = 0; i < batch.records.length; i++) {
      var target = batch.records[i].target;
      if (target && (target === root || (root.contains && root.contains(target)))) {
        schedule();
        return;
      }
    }
  });

  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);
  schedule();

  octave.register('depin', function () {
    var root = scope();
    return {
      perfMode: !!octave.flags.perfMode,
      scope: root ? root.tagName.toLowerCase() : null,
    };
  });
})();
