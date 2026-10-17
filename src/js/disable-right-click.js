// Matikan seleksi teks agar tidak memicu menu Look Up / Share macOS
const style = document.createElement('style');
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
document.head.appendChild(style);

// Kontrol contextmenu: blokir menu bawaan browser/OS kecuali elemen musik/input
document.addEventListener('contextmenu', (e) => {
  const isInput = e.target.closest('input, textarea, [contenteditable="true"]');
  const isCustomTarget = e.target.closest('[role="row"], tr, .song, .track, .item, button, a, [data-testid]');

  if (!isCustomTarget && !isInput) {
    e.preventDefault();
  }
}, false);