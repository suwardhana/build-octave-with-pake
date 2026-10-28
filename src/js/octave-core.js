// Octave Music — octave-core.js
// Fondasi bersama untuk modul inject:
// - SATU MutationObserver untuk semua modul (childList + subtree + src)
// - SATU route hook (pushState/replaceState/popstate/hashchange)
// - batch kerja lewat requestIdleCallback, skip saat window disembunyikan
// - registry health + metrics + ring buffer error untuk octave-diag.js
// - flag perfMode (localStorage) untuk mematikan kerja kosmetik
//
// Kontrak untuk modul lain:
//   __octave.onMutations(function (batch) { batch.records, batch.full });
//   __octave.onRoute(function (url) { ... });
//   __octave.register('nama', function () { return {...}; });
//   __octave.metric('nama.kerja', ms);
//   __octave.flags.perfMode / __octave.setFlag('perfMode', true);
//
// Catatan: observer sengaja TIDAK mengamati characterData. Perubahan teks
// (timer progres, hasil search) dulu memicu sweep penuh di octave-depin.
// Kalau sebuah modul butuh reaksi terhadap teks, cukup andalkan
// childList/route + pembacaan saat batch, jangan menambah observer baru.

(function () {
  'use strict';

  if (window.__octaveCore) return;
  window.__octaveCore = true;

  var VERSION = '2';
  var FLAGS_KEY = '__octave_flags_v1';
  var MAX_RECORDS = 2000;
  var MAX_ERRORS = 20;

  var mutationSubs = new Set();
  var routeSubs = new Set();
  var modules = new Map();
  var metrics = Object.create(null);
  var errors = [];
  var pending = [];
  var pendingOverflow = false;
  var scheduled = false;
  var dirty = false;
  var routeTimer = 0;
  var lastRoute = location.pathname + location.search + location.hash;
  var routeCount = 0;
  var startedAt = Date.now();

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function readFlags() {
    try {
      var raw = localStorage.getItem(FLAGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  var flags = readFlags();
  if (typeof flags.perfMode !== 'boolean') flags.perfMode = false;

  function saveFlags() {
    try {
      localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
    } catch (e) {
      /* storage penuh / private mode */
    }
  }

  function pushError(err) {
    var message = '';
    var stack = '';
    try {
      message = String((err && err.message) || err || 'unknown');
      stack = err && err.stack ? String(err.stack).slice(0, 1200) : '';
    } catch (e) {
      message = 'unknown';
    }
    errors.push({ ts: Date.now(), message: message, stack: stack });
    if (errors.length > MAX_ERRORS) errors.shift();
  }

  window.addEventListener('error', function (e) {
    pushError(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    pushError(e.reason || 'unhandledrejection');
  });

  function metric(name, ms) {
    var value = typeof ms === 'number' && isFinite(ms) ? ms : 0;
    var m = metrics[name];
    if (!m) {
      m = metrics[name] = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
    }
    m.count += 1;
    m.totalMs += value;
    m.lastMs = value;
    if (value > m.maxMs) m.maxMs = value;
  }

  function runGuarded(fn, arg) {
    try {
      return fn(arg);
    } catch (e) {
      pushError(e);
      return undefined;
    }
  }

  function flush() {
    scheduled = false;

    // Jangan kerja kosmetik saat app di background. Tandai dirty supaya
    // satu pass penuh jalan begitu window terlihat lagi.
    if (document.visibilityState === 'hidden') {
      dirty = true;
      return;
    }

    var t0 = now();
    var records = pending;
    var full = pendingOverflow;
    pending = [];
    pendingOverflow = false;

    mutationSubs.forEach(function (fn) {
      runGuarded(fn, { records: records, full: full });
    });

    metric('core.pass', now() - t0);

    if (dirty) {
      dirty = false;
      schedule();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;

    var run = function () {
      if (document.visibilityState === 'hidden') {
        scheduled = false;
        dirty = true;
        return;
      }
      flush();
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 250 });
    } else {
      setTimeout(run, 120);
    }
  }

  var root = document.documentElement || document;
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      if (pending.length >= MAX_RECORDS) {
        pendingOverflow = true;
        break;
      }
      pending.push(records[i]);
    }
    schedule();
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && dirty) {
      dirty = false;
      schedule();
    }
  });

  function currentRoute() {
    return location.pathname + location.search + location.hash;
  }

  function checkRoute() {
    routeTimer = 0;
    var url = currentRoute();
    if (url === lastRoute) return;
    lastRoute = url;
    routeCount += 1;
    routeSubs.forEach(function (fn) {
      runGuarded(fn, url);
    });
    schedule();
  }

  function queueRoute() {
    if (routeTimer) return;
    routeTimer = setTimeout(checkRoute, 30);
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    try {
      history[name] = function () {
        var result = original.apply(this, arguments);
        queueRoute();
        return result;
      };
    } catch (e) {
      /* biarkan route hook lewat popstate */
    }
  });
  window.addEventListener('popstate', queueRoute);
  window.addEventListener('hashchange', queueRoute);

  function register(id, health) {
    if (!id) return;
    modules.set(String(id), {
      id: String(id),
      health: typeof health === 'function' ? health : function () { return {}; },
      at: Date.now(),
    });
  }

  function moduleHealth() {
    var list = [];
    modules.forEach(function (mod) {
      var health;
      try {
        health = mod.health();
      } catch (e) {
        pushError(e);
        health = { error: String((e && e.message) || e) };
      }
      list.push({ id: mod.id, health: health });
    });
    return list;
  }

  window.__octave = window.__octave || {};
  var api = window.__octave;

  api.version = VERSION;
  api.flags = flags;
  api.setFlag = function (key, value) {
    flags[key] = value;
    saveFlags();
    schedule();
    return flags[key];
  };
  api.onMutations = function (fn) {
    if (typeof fn !== 'function') return function () {};
    mutationSubs.add(fn);
    return function () { mutationSubs.delete(fn); };
  };
  api.onRoute = function (fn) {
    if (typeof fn !== 'function') return function () {};
    routeSubs.add(fn);
    return function () { routeSubs.delete(fn); };
  };
  api.schedule = schedule;
  api.metric = metric;
  api.register = register;
  api.modules = moduleHealth;
  api.errors = function () { return errors.slice(); };
  api.metrics = function () { return JSON.parse(JSON.stringify(metrics)); };
  api.stats = function () {
    var pass = metrics['core.pass'];
    return {
      version: VERSION,
      uptimeMs: Date.now() - startedAt,
      routeCount: routeCount,
      passes: pass ? pass.count : 0,
      pending: pending.length,
      scheduled: scheduled,
      perfMode: !!flags.perfMode,
      visibility: document.visibilityState,
    };
  };
  api.ready = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  if (window.console && console.debug) {
    console.debug('[octave-core] aktif (v' + VERSION + ')');
  }
})();
