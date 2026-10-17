// Octave Music — octave-cache.js
// Cache wrapper sisi Pake (tanpa ubah codebase web):
// - API dedupe + stale-while-revalidate (sync/nowplaying/meta)
// - Cover/brand awet via Cache Storage (30 hari, LRU)
// - LOSSLESS full di-cache sesuai permintaan user (bounded LRU)
//
// Catatan jujur: lossless 1 lagu ~25-35MB. Tanpa batas ini akan
// menendang cache lain. Batas default: 10 track / 800MB.

(function () {
  'use strict';

  var AUDIO_MAX_TRACKS = 10;
  var AUDIO_MAX_BYTES = 800 * 1024 * 1024;
  var API_TTL = {
    sync: 60 * 1000,
    nowplaying: 30 * 1000,
    meta: 120 * 1000,
    'playback-token': 5 * 60 * 1000,
    other: 60 * 1000,
  };

  var CACHE_STATIC = 'octave-static-v1';
  var CACHE_AUDIO = 'octave-audio-v1';
  var AUDIO_INDEX_KEY = '__octave_audio_index_v1';

  // Minta persistent storage supaya tidak di-evict OS/WebView.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }
  } catch (e) { /* abaikan */ }

  function getAudioIndex() {
    try {
      return JSON.parse(localStorage.getItem(AUDIO_INDEX_KEY) || '[]');
    } catch (e) { return []; }
  }
  function setAudioIndex(idx) {
    try { localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(idx)); } catch (e) {}
  }

  function trackIdFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      return u.searchParams.get('track') || u.searchParams.get('id') || null;
    } catch (e) { return null; }
  }

  function audioCacheKey(trackId) {
    return 'https://octave.local/__audio__?track=' + encodeURIComponent(trackId);
  }

  function isLosslessUrl(url) {
    return /audio\/lossless/i.test(url || '');
  }

  function apiBucket(url) {
    if (/\/api\/sync/i.test(url)) return 'sync';
    if (/nowplaying/i.test(url)) return 'nowplaying';
    if (/meta\/batch/i.test(url)) return 'meta';
    if (/playback-token/i.test(url)) return 'playback-token';
    return null;
  }

  // ---- API: dedupe + SWR memory cache ----
  var inflight = new Map();
  var apiMem = new Map(); // url -> { body, status, headers, ts }
  var origFetch = window.fetch.bind(window);

  function ttlFor(bucket) { return API_TTL[bucket] || API_TTL.other; }

  function cachedApiResponse(entry) {
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  }

  function readBody(res) { return res.clone().arrayBuffer(); }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
    var hasRange = false;
    try {
      var h = (init && init.headers) || (typeof input !== 'string' && input.headers);
      if (h) {
        if (typeof h.get === 'function') hasRange = !!h.get('Range');
        else if (typeof h === 'object') hasRange = !!h.Range || !!h.range;
      }
    } catch (e) {}

    // Range request audio: JANGAN disentuh (biar seek tidak rusak).
    if (hasRange) return origFetch(input, init);

    // Lossless full (GET, tanpa Range): cache-first bounded.
    if (method === 'GET' && isLosslessUrl(url)) {
      return fetchLosslessCached(input, init, url);
    }

    // API GET: dedupe + SWR.
    var bucket = method === 'GET' ? apiBucket(url) : null;
    if (bucket) {
      var now = Date.now();
      var mem = apiMem.get(url);
      if (mem && now - mem.ts < ttlFor(bucket)) {
        // Revalidate di background, langsung sajikan cache.
        revalidateApi(input, init, url, bucket);
        return Promise.resolve(cachedApiResponse(mem));
      }
      if (inflight.has(url)) return inflight.get(url);
      var p = origFetch(input, init).then(function (res) {
        if (res.ok) {
          readBody(res).then(function (buf) {
            apiMem.set(url, {
              body: buf, status: res.status,
              headers: [['Content-Type', res.headers.get('Content-Type') || 'application/json']],
              ts: Date.now(),
            });
          }).catch(function () {});
        }
        inflight.delete(url);
        return res;
      }).catch(function (e) { inflight.delete(url); throw e; });
      inflight.set(url, p);
      return p;
    }

    return origFetch(input, init);
  };

  function revalidateApi(input, init, url, bucket) {
    if (inflight.has(url)) return;
    var p = origFetch(input, init).then(function (res) {
      if (res.ok) {
        readBody(res).then(function (buf) {
          apiMem.set(url, {
            body: buf, status: res.status,
            headers: [['Content-Type', res.headers.get('Content-Type') || 'application/json']],
            ts: Date.now(),
          });
        }).catch(function () {});
      }
      inflight.delete(url);
      return res;
    }).catch(function () { inflight.delete(url); });
    inflight.set(url, p);
  }

  // ---- Lossless: cache-first full file ----
  function fetchLosslessCached(input, init, url) {
    var trackId = trackIdFromUrl(url);
    if (!trackId || !('caches' in window)) return origFetch(input, init);
    return caches.open(CACHE_AUDIO).then(function (cache) {
      return cache.match(audioCacheKey(trackId)).then(function (hit) {
        if (hit) {
          touchAudio(trackId);
          return hit;
        }
        return origFetch(input, init).then(function (res) {
          if (res.ok && (res.status === 200)) {
            var copy = res.clone();
            copy.arrayBuffer().then(function (buf) {
              enforceAudioBudget(buf.byteLength).then(function () {
                cache.put(audioCacheKey(trackId), new Response(buf, {
                  status: 200,
                  headers: [['Content-Type', res.headers.get('Content-Type') || 'audio/flac']],
                })).then(function () { pushAudioIndex(trackId, buf.byteLength); })
                  .catch(function () {});
              });
            }).catch(function () {});
          }
          return res;
        });
      });
    }).catch(function () { return origFetch(input, init); });
  }

  function pushAudioIndex(trackId, bytes) {
    var idx = getAudioIndex().filter(function (x) { return x.track !== trackId; });
    idx.push({ track: trackId, bytes: bytes, ts: Date.now() });
    setAudioIndex(idx);
  }

  function touchAudio(trackId) {
    var idx = getAudioIndex();
    var found = false;
    idx.forEach(function (x) { if (x.track === trackId) { x.ts = Date.now(); found = true; } });
    if (found) setAudioIndex(idx);
  }

  function enforceAudioBudget(incomingBytes) {
    var idx = getAudioIndex();
    var total = idx.reduce(function (a, x) { return a + (x.bytes || 0); }, 0) + (incomingBytes || 0);
    if (idx.length < AUDIO_MAX_TRACKS && total < AUDIO_MAX_BYTES) return Promise.resolve();
    // Evict tertua dulu.
    idx.sort(function (a, b) { return a.ts - b.ts; });
    if (!('caches' in window)) return Promise.resolve();
    return caches.open(CACHE_AUDIO).then(function (cache) {
      var chain = Promise.resolve();
      while ((idx.length >= AUDIO_MAX_TRACKS || total >= AUDIO_MAX_BYTES) && idx.length > 0) {
        (function (victim) {
          chain = chain.then(function () { return cache.delete(audioCacheKey(victim.track)).catch(function () {}); });
          total -= victim.bytes || 0;
        })(idx.shift());
      }
      setAudioIndex(idx);
      return chain;
    });
  }

  // Warm audio yang sedang diputar (idle, full download 1x).
  var warmed = {};
  function warmAudioFromElement(el) {
    try {
      var src = el.currentSrc || el.src || '';
      if (!isLosslessUrl(src)) return;
      var trackId = trackIdFromUrl(src);
      if (!trackId || warmed[trackId]) return;
      warmed[trackId] = true;
      var run = function () {
        if (!('caches' in window)) return;
        caches.open(CACHE_AUDIO).then(function (c) { return c.match(audioCacheKey(trackId)); })
          .then(function (hit) {
            if (hit) return;
            origFetch(src).then(function (res) {
              if (res.ok && res.status === 200) {
                res.clone().arrayBuffer().then(function (buf) {
                  enforceAudioBudget(buf.byteLength).then(function () {
                    caches.open(CACHE_AUDIO).then(function (cache) {
                      cache.put(audioCacheKey(trackId), new Response(buf, {
                        status: 200,
                        headers: [['Content-Type', res.headers.get('Content-Type') || 'audio/flac']],
                      })).then(function () { pushAudioIndex(trackId, buf.byteLength); })
                        .catch(function () {});
                    });
                  });
                }).catch(function () {});
              }
            }).catch(function () {});
          }).catch(function () {});
      };
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 8000 });
      else setTimeout(run, 4000);
    } catch (e) {}
  }

  // Replay dari cache: kalau track sudah ada blob-nya, pakai blob URL.
  function maybeServeBlob(el) {
    try {
      var src = el.getAttribute('src') || el.src || '';
      if (!isLosslessUrl(src) || el.dataset.octaveBlob === '1') return;
      var trackId = trackIdFromUrl(src);
      if (!trackId || !('caches' in window)) return;
      caches.open(CACHE_AUDIO).then(function (cache) {
        return cache.match(audioCacheKey(trackId));
      }).then(function (hit) {
        if (!hit) return;
        hit.blob().then(function (blob) {
          var objUrl = URL.createObjectURL(blob);
          el.dataset.octaveOrigSrc = src;
          el.dataset.octaveBlob = '1';
          el.src = objUrl;
          touchAudio(trackId);
        }).catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  }

  document.addEventListener('playing', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) warmAudioFromElement(el);
  }, true);

  // Pantau <audio> baru (ganti lagu) untuk serve blob bila sudah di-cache.
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.tagName === 'AUDIO') maybeServeBlob(n);
        });
        if (m.target && m.target.tagName === 'AUDIO') maybeServeBlob(m.target);
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) {}

  // ---- Static (cover/brand/_next): pre-warm ringan saat idle ----
  function warmStatic() {
    if (!('caches' in window)) return;
    try {
      var urls = [];
      document.querySelectorAll('img[src*="cover"], img[src*="brand"]').forEach(function (img) {
        var s = img.currentSrc || img.src;
        if (s) urls.push(s);
      });
      urls = urls.slice(0, 30);
      if (!urls.length) return;
      caches.open(CACHE_STATIC).then(function (cache) {
        urls.forEach(function (u) {
          cache.match(u).then(function (hit) {
            if (!hit) origFetch(u).then(function (r) {
              if (r.ok) cache.put(u, r).catch(function () {});
            }).catch(function () {});
          }).catch(function () {});
        });
      }).catch(function () {});
    } catch (e) {}
  }
  if ('requestIdleCallback' in window) requestIdleCallback(warmStatic, { timeout: 10000 });
  else window.addEventListener('load', function () { setTimeout(warmStatic, 5000); });

  if (window.console && console.debug) console.debug('[octave-cache] aktif');
})();
