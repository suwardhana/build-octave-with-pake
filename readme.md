# Octave Music (Pake wrapper)

Wrapper desktop untuk <https://music.octavestreaming.com/> memakai
[Pake](https://github.com/tw93/Pake). Semua kustomisasi ada di `src/` dan
di-inject lewat `app.json` — tanpa fork Pake.

```sh
pake --config app.json --install
```

## Development

Butuh Node >= 20.9, Rust stable, dan `pake-cli` global.

```sh
# cek app.json + semua modul inject (tanpa build)
npm run check

# build .app cepat + DevTools (macOS)
npm run dev

# build + install ke /Applications (macOS)
npm run build
```

`npm run dev` menjalankan `pake --config app.json --debug --iterative-build`:
DevTools aktif dan DMG dilewati, jadi loop-nya jauh lebih cepat. Jangan pakai
build `--debug` untuk distribusi.

## Struktur

```
.
├── app.json                    # config Pake (inject + tray + icon)
├── package.json                # script check/dev/build
├── scripts/
│   └── check.mjs               # 99 pemeriksaan statis (tanpa dependency)
├── .github/workflows/
│   ├── build-windows.yml       # Windows x64 -> exe + msi + Release
│   └── build-macos.yml         # macOS universal -> dmg + Release
├── src/
│   ├── js/
│   │   ├── octave-core.js      # scheduler DOM + route hook + registry
│   │   ├── octave-native.js    # drag window + traffic-lights (macOS only)
│   │   ├── octave-media.js     # MediaSession prev/next + API playback
│   │   ├── octave-cache.js     # API dedupe + cache lossless (LRU)
│   │   ├── octave-prefetch.js  # prefetch navigasi SPA saat hover/focus
│   │   ├── octave-media-lazy.js# lazy preload <video> (kalau ada)
│   │   ├── octave-depin.js     # bersihkan label "Pinned" di sidebar
│   │   ├── disable-right-click.js # blokir contextmenu + seleksi teks
│   │   └── octave-diag.js      # panel diagnostik (tombol "i" / Cmd+Shift+D)
│   └── css/
│       └── octave-native.css   # tweaks native + anti-flash
├── assets/                     # music.icns, icon.ico, tray-*.png
└── reference/
    └── volume.ts               # arsip port volume lama, TIDAK diinject
```

Urutan `inject` signifikan: CSS dulu, lalu `octave-core.js`, modul lain, dan
`octave-diag.js` paling akhir. `scripts/check.mjs` menjaga urutan ini.

## Octave core

Dulu tiap modul punya `MutationObserver` sendiri (5 observer global, 3 tanpa
debounce). Sekarang `octave-core.js` menyediakan:

- **satu** observer (`childList` + `subtree` + atribut `src`), tanpa
  `characterData` — mengetik di search / timer progres tidak lagi memicu sweep;
- **satu** route hook (`pushState`/`replaceState`/`popstate`);
- batch kerja lewat `requestIdleCallback` (fallback `setTimeout`) dan skip saat
  window di background;
- registry `__octave.register(id, health)` untuk panel diagnostik;
- metrics (`__octave.metric`) dan ring buffer error;
- flag `perfMode` (localStorage) untuk mematikan kerja kosmetik.

Modul baru cukup memakai `__octave.onMutations()` / `__octave.onRoute()`,
jangan bikin observer global baru.

## Diagnostik

`octave-diag.js` menambahkan tombol **i** kecil di kanan bawah. Buka dengan
tombol itu atau `Cmd/Ctrl + Shift + D`, lalu:

- lihat status core, route, storage, index cache audio, modul + health,
  elemen media, `mediaSession`, metrics, dan error terakhir;
- **Copy** untuk menyalin report teks (berguna karena build release tidak
  punya DevTools);
- toggle **perf mode** untuk mematikan rewrite label kosmetik.

Panel dibangun sekali di Shadow DOM supaya CSS situs tidak bocor dan
mutasinya tidak memicu observer.

## Cache audio

Sesuai keputusan produk, setiap lagu lossless yang diputar di-cache penuh
(25–35 MB) supaya replay tidak menyentuh network. Budget default: **10 track /
800 MB**, evict LRU. File di `Cache Storage` (`octave-audio-v1`) dan index-nya
di `localStorage['__octave_audio_index_v1']`.

API GET (`/api/sync`, nowplaying, `meta/batch`, playback-token) memakai
dedupe + stale-while-revalidate dengan batas **60 entri / 8 MB** supaya tidak
tumbuh tanpa batas.

## Prefetch

Hover/focus pada link internal memicu prefetch HTML setelah 120 ms. Maksimal 2
request paralel, dedupe per path, hormati `saveData`, dan tidak menyentuh
`/_next/`, `/api/`, aset statis, atau halaman yang sedang dibuka. `<link
rel=prefetch>` dihapus karena dulu membuat dua request untuk href yang sama.

## MediaSession

`octave-media.js` menegakkan handler `previoustrack`/`nexttrack` saat media
play / metadata baru / route — tidak ada polling 1–2 detik lagi. API playback
tersedia di `__octave.media` (`next`, `prev`, `toggle`, `seek`).

## Catatan

- Plugin `octave-volume.js` sudah dihapus; volume memakai perilaku bawaan
  situs/WebView. `reference/volume.ts` hanya arsip.
- Tidak ada tombol download floating di source ini. Kalau masih terlihat di
  app terpasang, itu build lama (sebelum rollback) — rebuild dengan perintah
  di atas.
- `octave-native.js` sengaja no-op di Windows/Linux; padding traffic lights
  hanya untuk macOS.
- Verifikasi bahwa build benar-benar membawa inject baru (inject di-embed ke
  binary, bukan file terpisah):

  ```sh
  cd "/Applications/Octave Music.app/Contents/MacOS"
  strings -a pake-octavemusic | grep -c -- "octave-diag"
  ```

## CI/CD

### Windows

`.github/workflows/build-windows.yml` — `pake-cli` dari npm, tanpa fork.

- Manual: **Actions** → **Build Windows** → **Run workflow**
- Otomatis: push tag `v*`

Output: `Octave-Music-<versi>-windows-x64-portable.exe`,
`Octave-Music-<versi>-windows-x64.msi`, dan `SHA256SUMS.txt`.

Catatan: Windows wajib ikon `.ico` 256x256 (`assets/icon.ico`); workflow
meng-override `--icon`. Build pertama ~5–7 menit, berikutnya lebih cepat
karena cache `CARGO_TARGET_DIR`.

### macOS

`.github/workflows/build-macos.yml` — build **universal** (Apple Silicon +
Intel) di `macos-14`, lalu publish DMG.

- Manual: **Actions** → **Build macOS** → **Run workflow**
- Otomatis: push tag `v*`

Output: `Octave-Music-<versi>-macos-universal.dmg` + `SHA256SUMS.txt`.

Build belum di-notarize. Kalau Gatekeeper menolak, buka via klik kanan →
**Open** atau jalankan `xattr -cr "/Applications/Octave Music.app"`.

### Versi

`appVersion` di `app.json` dipakai untuk build manual; kalau workflow dipicu
push tag, tag-nya yang menang. `package.json` harus disamakan dengan
`appVersion` — `npm run check` akan gagal kalau beda.
