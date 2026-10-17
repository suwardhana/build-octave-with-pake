// Octave Music — octave-depin.js
// Hilangkan kata "Pinned" dekoratif di sidebar:
// "Pinned · 40 songs" -> "40 songs", "Pinned · Playlist" -> "Playlist".
// Tanpa class hash Next.js: murni berbasis teks + MutationObserver
// karena situs ini SPA yang me-render ulang saat navigasi.

(function () {
  'use strict';

  // Awalan "Pinned · " / "Épinglé · " (EN + FR) di node teks.
  var ANY_RE = /(pinned|épingl[ée]e?s?)\s*[·•∙|]\s*/gi;
  var ONLY_RE = /^\s*(pinned|épingl[ée]e?s?)\s*$/i;

  function cleanTextNode(node) {
    var v = node.nodeValue;
    if (!v || v.indexOf('inn') === -1 && v.indexOf('INN') === -1) return;
    var next = v.replace(ANY_RE, '');
    if (next !== v) node.nodeValue = next;
  }

  function cleanAttributes(root) {
    try {
      var els = root.querySelectorAll
        ? root.querySelectorAll('[aria-label*="inned"], [title*="inned"]')
        : [];
      Array.prototype.forEach.call(els, function (el) {
        ['aria-label', 'title'].forEach(function (attr) {
          var v = el.getAttribute(attr);
          if (v && ANY_RE.test(v)) {
            ANY_RE.lastIndex = 0;
            el.setAttribute(attr, v.replace(ANY_RE, ''));
          }
          ANY_RE.lastIndex = 0;
        });
      });
    } catch (e) {}
  }

  function hidePinnedHeader() {
    // Header seksi "PINNED" yang berdiri sendiri (bukan subtitle).
    try {
      var walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null
      );
      var el;
      while ((el = walker.nextNode())) {
        if (
          el.children.length === 0 &&
          ONLY_RE.test(el.textContent || '') &&
          !el.dataset.octaveDepin &&
          (el.tagName === 'P' || el.tagName === 'SPAN' || el.tagName === 'DIV' || /^H\d$/.test(el.tagName))
        ) {
          el.dataset.octaveDepin = '1';
          el.style.display = 'none';
        }
      }
    } catch (e) {}
  }

  function sweep() {
    if (!document.body) return;
    try {
      var walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      var node;
      while ((node = walker.nextNode())) cleanTextNode(node);
    } catch (e) {}
    cleanAttributes(document);
    hidePinnedHeader();
  }

  var debounce;
  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(sweep, 150);
  }

  sweep();
  document.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load', sweep);
  try {
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  } catch (e) {}
})();
