// Octave Music — macOS native: drag window + geser logo dari traffic lights.
// Bekerja tanpa bergantung pada class hash Next.js: cari logo via img[src*="logo"].

const TRAFFIC_TOP_PAD = '30px';
const TRAFFIC_LEFT_PAD = '12px';
const INTERACTIVE_SEL = 'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [role="row"], audio, video';

function markDraggable(el) {
  if (!el || el.nodeType !== 1) return;
  el.setAttribute('data-tauri-drag-region', '');
  // Tauri butuh atribut di elemen paling dalam yang diklik,
  // jadi turunkan ke anak non-interaktif juga.
  Array.from(el.querySelectorAll('*')).forEach((child) => {
    if (child.closest(INTERACTIVE_SEL)) return;
    child.setAttribute('data-tauri-drag-region', '');
  });
}

function fixLogoSpacing() {
  // Logo Octave: img /brand/white_logo.png di dalam <a href="/">
  const logos = document.querySelectorAll('img[src*="white_logo"], img[src*="logo"], img[alt*="ctave" i]');
  logos.forEach((img) => {
    // Naik 1-3 level untuk dapat container header/sidebar, bukan img-nya langsung
    // (kalau img-nya yang di-padding, ukurannya ikut berubah).
    const container =
      img.closest('header') ||
      img.closest('nav') ||
      img.closest('aside') ||
      img.parentElement?.parentElement ||
      img.parentElement;
    if (!container || container.dataset.octaveSafe === '1') return;
    container.dataset.octaveSafe = '1';
    container.classList.add('octave-traffic-safe');
    // Inline style sebagai fallback kalau CSS inject telat / kalah specificity
    if (!container.style.paddingTop) container.style.paddingTop = TRAFFIC_TOP_PAD;
    if (!container.style.paddingLeft) container.style.paddingLeft = TRAFFIC_LEFT_PAD;
  });
}

function makeDragRegions() {
  // Kandidat drag: header / nav / aside paling atas. Ambil yang menempel ke atas layar.
  const candidates = Array.from(document.querySelectorAll('header, nav, aside')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= 48 && r.left <= 200 && r.width > 100;
  });
  // Fallback: kalau layout berubah total, pakai elemen paling atas yang lebar
  if (candidates.length === 0) {
    const bodyFirst = document.body?.firstElementChild;
    if (bodyFirst) candidates.push(bodyFirst);
  }
  candidates.slice(0, 3).forEach(markDraggable);
}

function apply() {
  fixLogoSpacing();
  makeDragRegions();
}

let debounce;
function schedule() {
  clearTimeout(debounce);
  debounce = setTimeout(apply, 150);
}

apply();
document.addEventListener('DOMContentLoaded', apply);
window.addEventListener('load', apply);
// Octave adalah SPA (Next.js): amati navigasi client-side lalu apply ulang
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
