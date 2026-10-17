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

2. **Urutan `inject` di `app.json` itu signifikan.** Modul util/bersama harus paling awal
   (setelah CSS), dan `octave-cache.js` harus sebelum plugin apa pun yang membaca index
   cache-nya.

3. **Tidak ada `export`/`import` di modul inject.** Semua pola IIFE + namespace
   `window.__octave`. Setiap modul wajib punya guard double-inject
   (`if (window.__xxx) return;`) karena Pake bisa inject ulang dan situsnya SPA.

4. **Nama file plugin baru: `octave-<nama>.js`** di `src/js/`, plus 1 baris di
   `app.json` -> `inject`.

5. **Setiap plugin yang punya aksi WAJIB punya entry point yang terlihat.** Jangan pernah
   mengandalkan shortcut atau console sebagai satu-satunya pemicu: DevTools tidak tersedia di
   build release Pake, dan `disabledWebShortcuts` bisa menelan shortcut-nya. Kesalahan ini
   pernah terjadi di `octave-save-track.js` dan bikin Dhana bingung karena tidak menemukan
   fitur yang sudah di-build.

6. **Verifikasi build Pake benar-benar membawa inject baru** — inject di-embed ke dalam binary,
   bukan file terpisah di `Contents/Resources/` (di sana cuma ikon):
   ```sh
   cd "/Applications/Octave Music.app/Contents/MacOS"
   strings -a pake-octavemusic | grep -c -- "octave-<nama-plugin>"
   ```
   Ini satu-satunya cara cek tanpa membuka app.

## Jebakan yang sudah terverifikasi (jangan diulang)

- `disable-right-click.js` memasang `user-select: none !important` ke `*` dan
  memblokir `contextmenu` kecuali target cocok
  `input, textarea, [contenteditable], [role="row"], tr, .song, .track, .item, button, a, [data-testid]`.
  -> UI baru: pakai tombol aksi, jangan andalkan right-click.
- `octave-depin.js` + `octave-native.js` punya `MutationObserver` global (debounce
  150ms) yang menyapu `TreeWalker` tiap mutasi DOM.
  -> UI baru: build DOM sekali, update lewat `textContent` per node.
- `octave-volume.js` mem-patch `HTMLMediaElement.prototype.volume` (`UI ** 3`).
  -> Kalau menyentuh `el.volume`, pakai nilai UI, bukan nilai native.
- `octave-native.js` menandai `header/nav/aside` sebagai drag region.
  -> Jangan append UI baru ke dalam elemen-elemen itu.

## Batasan platform (Pake, terverifikasi dari dokumen resmi)

- **Tier 1 (inject-only):** tambah file + 1 baris di `app.json`. Nol fork.
- **Tier 2:** butuh command native baru -> WAJIB fork Pake (daftar di
  `generate_handler!` + command manifest `src-tauri/build.rs` + permission di
  `capabilities/default.json`). Contoh: Discord RPC, media key global saat app
  tidak fokus, tray/Dock menu dinamis.
- Tersedia tanpa fork: `window.__TAURI__.core.invoke` (command bawaan), Web
  `Notification` API (jadi notif native macOS), `activationShortcut`,
  `multiWindow`, `alwaysOnTop`, `downloadDir`, `enableFind`.
- IPC dibatasi ACL ke origin yang dikonfigurasi.

## Status pekerjaan

- `plan-android.md` — rencana APK Android (belum dikerjakan).
- `plan-plugins.md` — **dokumen saja**. Implementasinya sudah di-rollback 18 Okt 2026
  (lihat di bawah), jadi plan ini adalah catatan desain + hasil discovery, bukan kode aktif.
- **Rollback 18 Okt 2026:** atas permintaan Dhana, seluruh kode dari session 16 Okt dihapus
  (`octave-shared.js`, `octave-save-track.js`, folder `tools/`) dan `app.json` / `readme.md` /
  `octave-cache.js` di-revert ke versi git. `src/js/` kembali ke 8 modul asli.
  Backup lengkap: `/Users/dhana/app/buildoctave-session-backup-2026-10-18.tar.gz`
  (43 KB, berisi kode + plan + memory versi sebelum rollback). Kalau mau lanjut lagi,
  restore dari situ — jangan tulis ulang dari nol.
- Temuan Fase 0 di atas **tetap valid** walaupun kodenya dihapus: fakta soal CORS, struktur URL
  audio, dan `/library/downloaded` itu hasil pengukuran, bukan asumsi.

