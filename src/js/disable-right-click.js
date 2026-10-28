// Matikan seleksi teks agar tidak memicu menu Look Up / Share macOS,
// tapi tetap izinkan contextmenu di baris lagu / tombol / link.
// Versi ini dibungkus IIFE + guard supaya aman kalau Pake inject ulang.

(function () {
  'use strict';

  if (window.__octaveNoContextMenu) return;
  window.__octaveNoContextMenu = true;

  var octave = window.__octave;
  if (!octave) return;

  var style = document.createElement('style');
  style.id = 'octave-no-context-menu';
  style.textContent = `
    * {
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    input, textarea, [contenteditable="true"] {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // Kontrol contextmenu: blokir menu bawaan browser/OS kecuali elemen musik/input.
  document.addEventListener('contextmenu', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var isInput = target.closest('input, textarea, [contenteditable="true"]');
    var isCustomTarget = target.closest(
      '[role="row"], tr, .song, .track, .item, button, a, [data-testid]'
    );

    if (!isCustomTarget && !isInput) event.preventDefault();
  }, false);

  octave.register('no-context-menu', function () {
    return { active: true };
  });
})();
