// Octave Music — octave-diag.js
// Panel diagnostik kecil untuk build Pake yang tidak punya DevTools.
//
// Isi: status core, storage, index cache audio, cache keys, modul + health,
// elemen media (tanpa URL/token), mediaSession, metrics, error terakhir.
// Tombol "Copy" menghasilkan report teks untuk dikirim ke sini.
//
// UI dibangun sekali di Shadow DOM supaya CSS situs tidak bocor masuk
// (dan mutation di dalam panel tidak memicu observer milik octave-core).
// Entry point: tombol "i" kanan bawah, atau Cmd/Ctrl+Shift+D.

(function () {
  'use strict';

  if (window.__octaveDiag) return;
  window.__octaveDiag = true;

  var octave = window.__octave;
  if (!octave) {
    if (window.console && console.warn) console.warn('[octave-diag] octave-core belum ada');
    return;
  }

  var host = null;
  var shadow = null;
  var button = null;
  var panel = null;
  var report = null;
  var statusLine = null;
  var perfToggle = null;
  var refreshTimer = 0;
  var refreshSeq = 0;

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'text') node.textContent = props[key];
        else if (key === 'class') node.className = props[key];
        else if (key === 'on') {
          Object.keys(props.on).forEach(function (event) {
            node.addEventListener(event, props.on[event]);
          });
        } else if (key === 'checked' || key === 'hidden' || key === 'disabled') {
          node[key] = props[key];
        } else {
          node.setAttribute(key, props[key]);
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function fmtBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i < 0) i = 0;
    if (i >= units.length) i = units.length - 1;
    var value = bytes / Math.pow(1024, i);
    return (value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[i];
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return '"<unserializable>"';
    }
  }

  function build() {
    host = document.createElement('div');
    host.id = 'octave-diag-host';
    host.style.cssText =
      'all: initial; position: fixed; right: 14px; bottom: 14px; z-index: 2147483000; width: 0; height: 0;';

    shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .btn {
        position: fixed; right: 14px; bottom: 14px;
        width: 26px; height: 26px; padding: 0;
        border: 1px solid #3a3a3a; border-radius: 50%;
        background: rgba(18, 18, 18, 0.78); color: #bdbdbd;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
        cursor: pointer; opacity: 0.34;
        transition: opacity 0.15s ease, background 0.15s ease;
      }
      .btn:hover, .btn:focus-visible { opacity: 1; background: #1f1f1f; outline: none; }
      .panel {
        position: fixed; right: 14px; bottom: 50px;
        width: min(380px, calc(100vw - 28px));
        max-height: min(72vh, 640px);
        display: flex; flex-direction: column;
        background: #121212; color: #d8d8d8;
        border: 1px solid #333; border-radius: 10px;
        box-shadow: 0 14px 44px rgba(0, 0, 0, 0.62);
        font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
      }
      .panel[hidden] { display: none; }
      .head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 10px 12px;
        border-bottom: 1px solid #2a2a2a; background: #161616;
      }
      .title { font-weight: 700; font-size: 12px; letter-spacing: 0.02em; }
      .close {
        border: 0; background: transparent; color: #999;
        font: 16px/1 -apple-system, sans-serif; cursor: pointer; padding: 2px 4px;
      }
      .close:hover { color: #fff; }
      .bar {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
      }
      .bar button, .bar label {
        border: 1px solid #3a3a3a; background: #1d1d1d; color: #ccc;
        border-radius: 6px; padding: 4px 8px; cursor: pointer;
        font: 11px/1.2 -apple-system, sans-serif;
      }
      .bar button:hover { background: #2a2a2a; }
      .bar label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
      .bar input { margin: 0; accent-color: #7c5cff; }
      .report {
        margin: 0; padding: 10px 12px; overflow: auto; flex: 1;
        white-space: pre-wrap; word-break: break-word;
        user-select: text; -webkit-user-select: text;
        color: #cfcfcf; background: #121212;
      }
      .status {
        padding: 6px 12px; border-top: 1px solid #2a2a2a;
        color: #8a8a8a; font-size: 11px; min-height: 24px;
      }
    `;
    shadow.appendChild(style);

    button = el('button', {
      class: 'btn',
      type: 'button',
      title: 'Octave diagnostics (Cmd/Ctrl+Shift+D)',
      'aria-label': 'Octave diagnostics',
      text: 'i',
      on: { click: toggle },
    });
    shadow.appendChild(button);

    var close = el('button', {
      class: 'close',
      type: 'button',
      title: 'Tutup',
      'aria-label': 'Tutup diagnostik',
      text: '×',
      on: { click: closePanel },
    });

    var copy = el('button', {
      type: 'button',
      text: 'Copy',
      on: { click: copyReport },
    });

    var refresh = el('button', {
      type: 'button',
      text: 'Refresh',
      on: { click: function () { refresh(); } },
    });

    perfToggle = el('input', { type: 'checkbox' });
    perfToggle.checked = !!octave.flags.perfMode;
    perfToggle.addEventListener('change', function () {
      octave.setFlag('perfMode', !!perfToggle.checked);
      setStatus('perf mode: ' + (perfToggle.checked ? 'ON (kerja kosmetik dimatikan)' : 'OFF'));
      refresh();
    });

    var perfLabel = el('label', {}, [perfToggle, 'perf mode']);

    report = el('pre', { class: 'report', text: 'Memuat…' });
    statusLine = el('div', { class: 'status', text: '' });

    panel = el('section', {
      class: 'panel',
      role: 'dialog',
      'aria-label': 'Octave diagnostics',
      hidden: true,
    }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'title', text: 'Octave Diagnostics' }),
        close,
      ]),
      el('div', { class: 'bar' }, [copy, refresh, perfLabel]),
      report,
      statusLine,
    ]);
    shadow.appendChild(panel);

    document.body.appendChild(host);
  }

  function setStatus(text) {
    if (statusLine) statusLine.textContent = text;
  }

  async function collect() {
    var lines = [];
    var stats = octave.stats();

    lines.push('Octave Music diagnostics');
    lines.push('time: ' + new Date().toString());
    lines.push('url: ' + location.href);
    lines.push('ua: ' + navigator.userAgent);
    lines.push(
      'core: v' + octave.version +
      ' | passes ' + stats.passes +
      ' | routes ' + stats.routeCount +
      ' | uptime ' + Math.round(stats.uptimeMs / 1000) + 's' +
      ' | perfMode ' + stats.perfMode +
      ' | visibility ' + stats.visibility
    );
    lines.push('flags: ' + safeJson(octave.flags));

    // Storage
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var estimate = await navigator.storage.estimate();
        var persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
        lines.push(
          'storage: ' + fmtBytes(estimate.usage) + ' / ' + fmtBytes(estimate.quota) +
          ' (persisted=' + persisted + ')'
        );
      } else {
        lines.push('storage: API tidak tersedia');
      }
    } catch (e) {
      lines.push('storage: error (' + e.message + ')');
    }

    // Cache
    try {
      var index = JSON.parse(localStorage.getItem('__octave_audio_index_v1') || '[]');
      var bytes = index.reduce(function (acc, item) {
        return acc + (item.bytes || 0);
      }, 0);
      lines.push('audio index: ' + index.length + ' track, ' + fmtBytes(bytes));

      if ('caches' in window) {
        var stores = await caches.keys();
        lines.push('cache stores: ' + (stores.length ? stores.join(', ') : '(kosong)'));
        if (stores.indexOf('octave-audio-v1') !== -1) {
          var audioKeys = await caches.open('octave-audio-v1').then(function (cache) {
            return cache.keys();
          });
          lines.push('audio cache keys: ' + audioKeys.length);
        }
      }
    } catch (e) {
      lines.push('cache: error (' + e.message + ')');
    }

    // Modules
    lines.push('');
    lines.push('modules:');
    octave.modules().forEach(function (mod) {
      lines.push('  ' + mod.id + ': ' + safeJson(mod.health));
    });

    // Media
    lines.push('');
    lines.push('media:');
    var media = document.querySelectorAll('audio, video');
    lines.push('  elements: ' + media.length);
    for (var i = 0; i < media.length && i < 4; i++) {
      var m = media[i];
      var src = m.currentSrc || m.src || '';
      var kind = 'none';
      if (src) {
        if (src.indexOf('blob:') === 0) kind = 'blob';
        else if (/audio\/lossless/i.test(src)) kind = 'lossless-url';
        else kind = 'other';
      }
      lines.push(
        '  [' + i + '] ' + m.tagName.toLowerCase() +
        ' src=' + kind +
        ' paused=' + m.paused +
        ' duration=' + (isFinite(m.duration) ? m.duration.toFixed(1) : '?') +
        ' t=' + (isFinite(m.currentTime) ? m.currentTime.toFixed(1) : '?')
      );
    }
    try {
      var meta = navigator.mediaSession && navigator.mediaSession.metadata;
      lines.push('  mediaSession: ' + (meta ? meta.title + ' — ' + meta.artist : 'no metadata'));
    } catch (e) {
      lines.push('  mediaSession: error');
    }

    // Metrics
    lines.push('');
    lines.push('metrics:');
    var metrics = octave.metrics();
    Object.keys(metrics).sort().forEach(function (name) {
      var item = metrics[name];
      lines.push(
        '  ' + name + ': n=' + item.count +
        ' last=' + item.lastMs.toFixed(2) + 'ms' +
        ' max=' + item.maxMs.toFixed(2) + 'ms'
      );
    });

    // Errors
    var errors = octave.errors();
    lines.push('');
    lines.push('errors: ' + errors.length);
    errors.slice(-10).forEach(function (item) {
      lines.push('  [' + new Date(item.ts).toLocaleTimeString() + '] ' + item.message);
    });

    return lines.join('\n');
  }

  async function refresh() {
    if (!panel || panel.hidden) return;
    var seq = ++refreshSeq;
    try {
      var text = await collect();
      if (seq !== refreshSeq || panel.hidden) return;
      report.textContent = text;
    } catch (e) {
      if (seq !== refreshSeq) return;
      report.textContent = 'Gagal mengumpulkan data: ' + (e && e.message ? e.message : e);
    }
  }

  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    refresh();
    if (!refreshTimer) refreshTimer = setInterval(refresh, 3000);
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = 0;
    }
  }

  function toggle() {
    if (!panel) return;
    if (panel.hidden) openPanel();
    else closePanel();
  }

  async function copyReport() {
    try {
      var text = await collect();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setStatus('Report disalin ke clipboard.');
    } catch (e) {
      setStatus('Gagal menyalin: ' + (e && e.message ? e.message : e));
    }
  }

  function boot() {
    if (document.body) {
      build();
    } else {
      document.addEventListener('DOMContentLoaded', build, { once: true });
    }

    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'D' || event.key === 'd')) {
        event.preventDefault();
        toggle();
      } else if (event.key === 'Escape' && panel && !panel.hidden) {
        event.preventDefault();
        closePanel();
      }
    }, true);
  }

  boot();

  octave.diag = {
    open: openPanel,
    close: closePanel,
    toggle: toggle,
    report: collect,
    hide: function () {
      if (button) button.style.display = 'none';
      closePanel();
    },
  };

  if (window.console && console.debug) console.debug('[octave-diag] aktif');
})();
