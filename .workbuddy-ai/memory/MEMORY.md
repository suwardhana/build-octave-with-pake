# MEMORY.md — konvensi project buildoctave

Catatan lintas-sesi untuk project ini. Preferensi umum Dhana ada di memory level user.

## Fakta platform Octave (terverifikasi Fase 0, 16 Okt 2026)

Jangan tebak-tebak lagi, ini hasil pengukuran langsung:

- **Halaman** `music.octavestreaming.com`, **audio + API** `api.octavestreaming.com` (cross-origin).
- **CORS aman.** `fetch()` cross-origin resolve (206). Server mengirim
  `Access-Control-Expose-Headers` (terbukti karena `content-range` terbaca).
- **JANGAN PERNAH menyimpulkan CORS dari header `Access-Control-Allow-Origin`.** Header itu
  dikonsumsi browser dan tidak pernah bisa dibaca dari JS — selalu tampak kosong walau ada.
  Patokan satu-satunya: `fetch()`-nya resolve atau reject. Kesimpulan salah pernah terjadi karena ini.
- **URL audio**: `/audio/lossless?track=<id>&t=<title>&a=<artist>&d=<durasi detik>&x=<0|1>&k=<token>`.
  Metadata lagu ada di situ → tidak perlu endpoint meta.
- **Token `k=` punya masa berlaku** → jangan simpan URL audio, simpan `trackId` + metadata.
- **`mediaSession.metadata` terisi** (title/artist/album + artwork 56/250/500/1000).
- **Situs sudah punya offline sendiri**: cache SW `octave-v8-static/pages/rsc/img/data`
  + route `/library/downloaded`. Cek ini dulu sebelum bikin sistem cache baru.
- **Endpoint yang bikin ide plugin gugur**: `POST /api/lyrics` (lirik sudah ada di situs),
  `GET /api/lastfm/status` (Last.fm sudah terintegrasi). Ada juga `/api/ios/release` (app iOS resmi),
  `/api/apple/npLook`, `/api/apple/motion`, `/api/tracks/features?ids=a,b,c` (batch),
  `POST /api/nowplaying`.

## Aturan yang wajib dipatuhi

1. **`octave-cache.js` ada di jalur playback.** Jangan refactor file ini untuk "merapikan"
   apa pun. Risiko regresi audio lebih mahal daripada kode yang sedikit berulang.
   Auto-warm lossless (25–35 MB per lagu) adalah keputusan produk Dhana (28 Okt 2026) —
   **jangan dimatikan** tanpa izin baru.

2. **Urutan `inject` di `app.json` itu signifikan.** CSS → `octave-core.js` → modul lain →
   `octave-diag.js` paling akhir. `octave-cache.js` harus sebelum plugin yang membaca index-nya.
   `scripts/check.mjs` menjaga urutan ini.

3. **Tidak ada `export`/`import` di modul inject.** Semua pola IIFE + namespace
   `window.__octave`. Setiap modul wajib punya guard double-inject
   (`if (window.__xxx) return;`). Jangan pakai `const`/`let` di top-level script (bisa
   `SyntaxError` kalau Pake inject ulang) — semua binding di dalam IIFE.

4. **Nama file plugin baru: `octave-<nama>.js`** di `src/js/`, plus 1 baris di
   `app.json` → `inject`. Modul baru **wajib** memakai `__octave.onMutations()` /
   `__octave.onRoute()`; jangan bikin `MutationObserver` global baru.

5. **Setiap plugin yang punya aksi WAJIB punya entry point yang terlihat.** Jangan pernah
   mengandalkan shortcut atau console sebagai satu-satunya pemicu: DevTools tidak tersedia di
   build release Pake, dan `disabledWebShortcuts` bisa menelan shortcut-nya. Kesalahan ini
   pernah terjadi di `octave-save-track.js` dan bikin Dhana bingung karena tidak menemukan
   fitur yang sudah di-build. `octave-diag.js` memakai tombol "i" kanan bawah + `Cmd+Shift+D`.

6. **Verifikasi build Pake benar-benar membawa inject baru** — inject di-embed ke dalam binary,
   bukan file terpisah di `Contents/Resources/` (di sana cuma ikon):
   ```sh
   cd "/Applications/Octave Music.app/Contents/MacOS"
   strings -a pake-octavemusic | grep -c -- "octave-diag"
   ```
   Ini satu-satunya cara cek tanpa membuka app.

7. **Jalankan `npm run check` sebelum commit.** 99 pemeriksaan: file inject ada, urutan benar,
   guard/IIFE, tidak ada `const` top-level, `node --check`, `appVersion` = `package.json`.

## Jebakan yang sudah terverifikasi (jangan diulang)

- **`octave-core.js` tidak mengamati `characterData`.** Kalau butuh reaksi terhadap teks,
  andalkan `childList`/route + baca saat batch. Menambah observer `characterData` global akan
  mengembalikan masalah lama: ngetik di search / timer progres memicu sweep O(N).
- **`octave-depin.js` hanya menyapu sidebar** (`aside`/`nav`/`[class*=sidebar]`), bukan body,
  dan hanya kalau batch menyentuh sidebar. `perfMode` mematikan rewrite kosmetik ini.
- **`octave-native.js` hanya aktif di macOS.** Padding traffic-light 28 px akan merusak header
  Windows kalau dipaksa. Drag region memakai `WeakSet`, jadi node yang sudah ditandai tidak
  ditulis ulang.
- **`octave-diag.js` memakai Shadow DOM.** Jangan append UI baru ke `header`/`nav`/`aside`
  (itu drag region). Panel sengaja tidak memicu observer core.
- **`octave-cache.js` mengganti `src` audio jadi blob URL.** `dataset.octaveBlobTrack` +
  `dataset.octaveBlobUrl` dipakai untuk cek reuse; blob lama di-revoke setelah 60 dtk.
  Jangan menambah flag `octaveBlob` yang permanen — itu membuat cache-first cuma jalan sekali.
- **`octave-media.js` tidak polling lagi.** Handler ditegakkan dari event `play` /
  `loadedmetadata` / route. API playback ada di `__octave.media`.
- **`octave-prefetch.js` memakai fetch manual, bukan `<link rel=prefetch>`.** Dulu keduanya
  jalan dan membuat dua request untuk href yang sama. Prefetch sekarang dwell 120 ms,
  maksimal 2 paralel. Fitur ini **dipertahankan** atas permintaan Dhana.
- **`disable-right-click.js` memasang `user-select: none !important` ke `*`** dan memblokir
  `contextmenu` kecuali target cocok
  `input, textarea, [contenteditable], [role="row"], tr, .song, .track, .item, button, a, [data-testid]`.
  → UI baru: pakai tombol aksi, jangan andalkan right-click.
- **Plugin volume sudah dihapus (28 Okt 2026).** Jangan menambah kembali patch
  `HTMLMediaElement.prototype.volume`; `reference/volume.ts` hanya arsip.
- **Tombol download floating tidak ada di source.** `octave-save-track.js` sudah dihapus saat
  rollback 18 Okt. Kalau masih terlihat di app terpasang, itu build lama — rebuild.

## Batasan platform (Pake, terverifikasi dari dokumen resmi)

- **Tier 1 (inject-only):** tambah file + 1 baris di `app.json`. Nol fork.
- **Tier 2:** butuh command native baru → WAJIB fork Pake (daftar di
  `generate_handler!` + command manifest `src-tauri/build.rs` + permission di
  `capabilities/default.json`). Contoh: Discord RPC, media key global saat app
  tidak fokus, tray/Dock menu dinamis.
- Tersedia tanpa fork: `window.__TAURI__.core.invoke` (command bawaan), Web
  `Notification` API (jadi notif native macOS), `activationShortcut`,
  `multiWindow`, `alwaysOnTop`, `downloadDir`, `enableFind`, `restoreLastUrl`
  (default `true`).
- IPC dibatasi ACL ke origin yang dikonfigurasi.

## Status pekerjaan

- **28 Okt 2026 — refactor performa + diag (versi 1.2.0).** `octave-core.js` (satu observer,
  route hook, registry, metrics, `perfMode`), `octave-diag.js` (panel diagnostik), observer
  global dikonsolidasikan, polling media dihapus, cache API dibatasi, blob URL di-revoke,
  `octave-media-lazy` jadi kondisional, `octave-prefetch` dioptimalkan, guard/IIFE dirapikan.
  `octave-volume.js` dihapus. `scripts/check.mjs` + `package.json` + workflow macOS universal
  ditambahkan. 9 modul aktif.
- **Keputusan Dhana 28 Okt:** auto-download lossless **dipertahankan**; hover prefetch
  **dipertahankan**; ide plugin yang dikerjakan **sampai `octave-diag` saja**. Sleep timer,
  shortcuts, mini player, EQ, dan Tier 2 ditunda.
- `plan-android.md` — rencana APK Android (belum dikerjakan).
- `plan-plugins.md` — **dokumen saja**. Implementasi lama sudah di-rollback 18 Okt 2026,
  jadi plan ini catatan desain + hasil discovery, bukan kode aktif.
- **Rollback 18 Okt 2026:** `octave-shared.js`, `octave-save-track.js`, folder `tools/` dihapus;
  `app.json` / `readme.md` / `octave-cache.js` di-revert. Backup lengkap:
  `/Users/dhana/app/buildoctave-session-backup-2026-10-18.tar.gz` (43 KB).
- Temuan Fase 0 di atas **tetap valid** walaupun kodenya dihapus: fakta soal CORS, struktur URL
  audio, dan `/library/downloaded` itu hasil pengukuran, bukan asumsi.
