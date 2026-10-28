// Octave Music — octave-cache.js
// Cache wrapper sisi Pake (tanpa ubah codebase web):
// - API dedupe + stale-while-revalidate (sync/nowplaying/meta)
// - LOSSLESS full di-cache sesuai permintaan user (bounded LRU)
//
// Catatan: lossless 1 lagu ~25-35MB. Tanpa batas ini akan menendang cache
// lain. Batas default: 10 track / 800MB.
//
// Perubahan performa:
// - observer global diganti langganan batch dari octave-core
// - API memory cache dibatasi (60 entri / 8MB) supaya tidak tumbuh tanpa batas
// - blob URL dari cache di-revoke saat track berganti (dulu bocor)
// - cache cover/static yang redundan dengan service worker situs dihapus

(function () {
  'use strict';

  if (window.__octaveCache) return;
  window.__octaveCache = true;

  var octave = window.__octave;
  if (!octave) {
    if (window.console && console.warn) console.warn('[octave-cache] octave-core belum ada');
    return;
  }

  var AUDIO_MAX_TRACKS = 10;
  var AUDIO_MAX_BYTES = 800 * 1024 * 1024;
  var API_MAX_BODY = 512 * 1024;
  var API_MAX_ENTRIES = 60;
  var API_MAX_BYTES = 8 * 1024 * 1024;
  var BLOB_URL_BUDGET = 6;
  var API_TTL = {
    sync: 60 * 1000,
    nowplaying: 30 * 1000,
    meta: 120 * 1000,
    'playback-token': 5 * 60 * 1000,
    other: 60 * 1000,
  };

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
    } catch (e) {
      return [];
    }
  }

  function setAudioIndex(idx) {
    try {
      localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(idx));
    } catch (e) { /* abaikan */ }
  }

  function trackIdFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      return u.searchParams.get('track') || u.searchParams.get('id') || null;
    } catch (e) {
      return null;
    }
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

  function ttlFor(bucket) {
    return API_TTL[bucket] || API_TTL.other;
  }

  // ---- API: dedupe + SWR memory cache (bounded) ----
  var inflight = new Map();
  var apiMem = new Map(); // url -> { body, status, headers, ts }
  var apiMemBytes = 0;
  var origFetch = window.fetch.bind(window);

  function bodyBytes(entry) {
    return entry && entry.body ? entry.body.byteLength : 0;
  }

  function setApiMem(url, entry) {
    var old = apiMem.get(url);
    if (old) {
      apiMem.delete(url);
      apiMemBytes -= bodyBytes(old);
    }
    apiMem.set(url, entry);
    apiMemBytes += bodyBytes(entry);

    while (apiMem.size > API_MAX_ENTRIES || apiMemBytes > API_MAX_BYTES) {
      var oldestKey = apiMem.keys().next().value;
      if (!oldestKey) break;
      var oldest = apiMem.get(oldestKey);
      apiMem.delete(oldestKey);
      apiMemBytes -= bodyBytes(oldest);
    }
  }

  function readBody(res) {
    return res.clone().arrayBuffer();
  }

  function cachedApiResponse(entry) {
    if (entry.status === 204 || entry.status === 205) {
      return new Response(null, { status: entry.status, headers: entry.headers });
    }
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  }

  function rememberApi(url, res) {
    if (res.status === 204 || res.status === 205 || res.status === 304) return;

    var length = 0;
    try {
      length = Number(res.headers.get('Content-Length') || 0);
    } catch (e) {
      length = 0;
    }
    if (length > API_MAX_BODY) return;

    readBody(res).then(function (buf) {
      if (buf.byteLength > API_MAX_BODY) return;
      setApiMem(url, {
        body: buf,
        status: res.status,
        headers: [['Content-Type', res.headers.get('Content-Type') || 'application/json']],
        ts: Date.now(),
      });
    }).catch(function () {});
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';

    var hasRange = false;
    try {
      var headers = (init && init.headers) || (typeof input !== 'string' && input.headers);
      if (headers) {
        if (typeof headers.get === 'function') hasRange = !!headers.get('Range');
        else if (typeof headers === 'object') hasRange = !!headers.Range || !!headers.range;
      }
    } catch (e) { /* abaikan */ }

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

      var pending = origFetch(input, init).then(function (res) {
        if (res.ok) rememberApi(url, res);
        inflight.delete(url);
        return res;
      }).catch(function (e) {
        inflight.delete(url);
        throw e;
      });
      inflight.set(url, pending);
      return pending;
    }

    return origFetch(input, init);
  };

  function revalidateApi(input, init, url, bucket) {
    if (inflight.has(url)) return;

    var pending = origFetch(input, init).then(function (res) {
      if (res.ok) rememberApi(url, res);
      inflight.delete(url);
      return res;
    }).catch(function () {
      inflight.delete(url);
    });
    inflight.set(url, pending);
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
          if (res.ok && res.status === 200) {
            var copy = res.clone();
            copy.arrayBuffer().then(function (buf) {
              enforceAudioBudget(buf.byteLength).then(function () {
                cache.put(audioCacheKey(trackId), new Response(buf, {
                  status: 200,
                  headers: [
                    ['Content-Type', res.headers.get('Content-Type') || 'audio/flac'],
                    ['Content-Length', String(buf.byteLength)],
                  ],
                })).then(function () {
                  pushAudioIndex(trackId, buf.byteLength);
                }).catch(function () {});
              });
            }).catch(function () {});
          }
          return res;
        });
      });
    }).catch(function () {
      return origFetch(input, init);
    });
  }

  function pushAudioIndex(trackId, bytes) {
    var idx = getAudioIndex().filter(function (x) {
      return x.track !== trackId;
    });
    idx.push({ track: trackId, bytes: bytes, ts: Date.now() });
    setAudioIndex(idx);
  }

  function touchAudio(trackId) {
    var idx = getAudioIndex();
    var found = false;
    idx.forEach(function (x) {
      if (x.track === trackId) {
        x.ts = Date.now();
        found = true;
      }
    });
    if (found) setAudioIndex(idx);
  }

  function enforceAudioBudget(incomingBytes) {
    var idx = getAudioIndex();
    var total = idx.reduce(function (acc, x) {
      return acc + (x.bytes || 0);
    }, 0) + (incomingBytes || 0);

    if (idx.length < AUDIO_MAX_TRACKS && total < AUDIO_MAX_BYTES) return Promise.resolve();
    if (!('caches' in window)) return Promise.resolve();

    // Evict tertua dulu.
    idx.sort(function (a, b) { return a.ts - b.ts; });

    return caches.open(CACHE_AUDIO).then(function (cache) {
      var chain = Promise.resolve();
      while ((idx.length >= AUDIO_MAX_TRACKS || total >= AUDIO_MAX_BYTES) && idx.length > 0) {
        (function (victim) {
          chain = chain.then(function () {
            return cache.delete(audioCacheKey(victim.track)).catch(function () {});
          });
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
        caches.open(CACHE_AUDIO).then(function (cache) {
          return cache.match(audioCacheKey(trackId));
        }).then(function (hit) {
          if (hit) return;
          origFetch(src).then(function (res) {
            if (!res.ok || res.status !== 200) return;
            res.clone().arrayBuffer().then(function (buf) {
              enforceAudioBudget(buf.byteLength).then(function () {
                caches.open(CACHE_AUDIO).then(function (cache) {
                  cache.put(audioCacheKey(trackId), new Response(buf, {
                    status: 200,
                    headers: [
                      ['Content-Type', res.headers.get('Content-Type') || 'audio/flac'],
                      ['Content-Length', String(buf.byteLength)],
                    ],
                  })).then(function () {
                    pushAudioIndex(trackId, buf.byteLength);
                  }).catch(function () {});
                });
              });
            }).catch(function () {});
          }).catch(function () {});
        }).catch(function () {});
      };

      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 8000 });
      else setTimeout(run, 4000);
    } catch (e) { /* abaikan */ }
  }

  // Replay dari cache: kalau track sudah ada blob-nya, pakai blob URL.
  var blobUrls = new Set();

  function trackBlobUrl(url) {
    blobUrls.add(url);
    while (blobUrls.size > BLOB_URL_BUDGET) {
      var oldest = blobUrls.values().next().value;
      blobUrls.delete(oldest);
      setTimeout(function () {
        try { URL.revokeObjectURL(oldest); } catch (e) { /* abaikan */ }
      }, 60000);
    }
  }

  function maybeServeBlob(el) {
    try {
      var src = el.getAttribute('src') || el.src || '';
      if (!isLosslessUrl(src)) return;

      var trackId = trackIdFromUrl(src);
      if (!trackId || !('caches' in window)) return;

      // Blob URL kita masih dipakai untuk track yang sama.
      if (el.dataset.octaveBlobTrack === trackId && el.dataset.octaveBlobUrl === el.src) return;

      caches.open(CACHE_AUDIO).then(function (cache) {
        return cache.match(audioCacheKey(trackId));
      }).then(function (hit) {
        if (!hit) return;
        return hit.blob().then(function (blob) {
          var objUrl = URL.createObjectURL(blob);
          var oldUrl = el.dataset.octaveBlobUrl;

          el.dataset.octaveBlobTrack = trackId;
          el.dataset.octaveBlobUrl = objUrl;
          el.src = objUrl;
          trackBlobUrl(objUrl);

          if (oldUrl && oldUrl !== objUrl) {
            setTimeout(function () {
              try { URL.revokeObjectURL(oldUrl); } catch (e) { /* abaikan */ }
              blobUrls.delete(oldUrl);
            }, 60000);
          }

          touchAudio(trackId);
        });
      }).catch(function () {});
    } catch (e) { /* abaikan */ }
  }

  function scanForAudio(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'AUDIO') {
      maybeServeBlob(node);
      return;
    }
    if (!node.querySelectorAll) return;
    var audios = node.querySelectorAll('audio');
    for (var i = 0; i < audios.length; i++) maybeServeBlob(audios[i]);
  }

  octave.onMutations(function (batch) {
    if (batch.full) {
      var all = document.querySelectorAll('audio');
      for (var i = 0; i < all.length; i++) maybeServeBlob(all[i]);
      return;
    }

    for (var j = 0; j < batch.records.length; j++) {
      var mutation = batch.records[j];
      if (mutation.type === 'attributes') {
        if (mutation.target && mutation.target.tagName === 'AUDIO') {
          maybeServeBlob(mutation.target);
        }
        continue;
      }
      if (!mutation.addedNodes) continue;
      for (var k = 0; k < mutation.addedNodes.length; k++) {
        scanForAudio(mutation.addedNodes[k]);
      }
    }
  });

  document.addEventListener('play', function (event) {
    var el = event.target;
    if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) maybeServeBlob(el);
  }, true);

  document.addEventListener('playing', function (event) {
    var el = event.target;
    if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) warmAudioFromElement(el);
  }, true);

  window.addEventListener('pagehide', function () {
    blobUrls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (e) { /* abaikan */ }
    });
    blobUrls.clear();
  });

  octave.register('cache', function () {
    var idx = getAudioIndex();
    var bytes = idx.reduce(function (acc, x) {
      return acc + (x.bytes || 0);
    }, 0);
    return {
      tracks: idx.length,
      bytes: bytes,
      apiEntries: apiMem.size,
      apiBytes: apiMemBytes,
      blobUrls: blobUrls.size,
    };
  });

  if (window.console && console.debug) console.debug('[octave-cache] aktif');
})();
