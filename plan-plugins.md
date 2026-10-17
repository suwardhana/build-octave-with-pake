# Plan: Plugin Octave Music macOS — Grup "Library & offline"

> **STATUS: DOKUMEN SAJA — kodenya sudah di-rollback (18 Okt 2026).**
> `octave-shared.js`, `octave-save-track.js`, dan folder `tools/` sudah dihapus;
> `app.json`, `readme.md`, dan `octave-cache.js` sudah dikembalikan ke versi git.
> `src/js/` kembali ke 8 modul asli. Plan ini disimpan sebagai catatan desain + hasil
> discovery, bukan deskripsi kode yang aktif.
> Backup lengkap sebelum rollback: `/Users/dhana/app/buildoctave-session-backup-2026-10-18.tar.gz`.
> Kalau mau dilanjutkan, restore dari situ — jangan tulis ulang dari nol.
> Temuan Fase 0 (§1b) tetap valid karena itu hasil pengukuran, bukan asumsi.

> Tujuan: mengubah cache lossless yang sekarang **tak terlihat** jadi fitur yang bisa dilihat,
> diatur, dan diekspor. Dua plugin:
> 1. `octave-offline-panel.js` — panel manajer cache (lihat, pin, hapus, rekonsiliasi, atur budget).
> 2. `octave-save-track.js` — ekspor lagu (lossless/stream) ke disk sebagai file.
>
> Keduanya **Tier 1 (inject-only)**: tambah file di `src/js/` + baris di `app.json`. Tanpa fork Pake.
> Satu-satunya perubahan ke modul lama: patch 3 baris di `octave-cache.js` (dukungan `pinned`).

## 1. Konteks: apa yang sudah ada dan bisa dipakai ulang

`octave-cache.js` sudah menyimpan semua data yang dibutuhkan panel — masalahnya cuma tidak ada UI-nya.

| Simbol di `octave-cache.js` | Nilai / perilaku | Dipakai untuk |
|---|---|---|
| `AUDIO_INDEX_KEY` | `'__octave_audio_index_v1'` | index LRU di localStorage: `[{track, bytes, ts}]` |
| `CACHE_AUDIO` | `'octave-audio-v1'` | Cache Storage blob lossless |
| `CACHE_STATIC` | `'octave-static-v1'` | cover/brand |
| `audioCacheKey(id)` | `https://octave.local/__audio__?track=<id>` | key `cache.match()` |
| `trackIdFromUrl(url)` | baca `?track` lalu `?id` | ekstrak id dari `currentSrc` |
| `isLosslessUrl(url)` | `/audio\/lossless/i` | filter lossless vs stream |
| `AUDIO_MAX_TRACKS` / `AUDIO_MAX_BYTES` | `10` / `800MB` | budget default (akan dijadikan preset) |
| `enforceAudioBudget(bytes)` | evict `ts` tertua sampai masuk budget | titik patch `pinned` |
| `getAudioIndex()` / `setAudioIndex()` | read/write index | sumber data panel |
| `touchAudio(id)` | update `ts` | dipanggil saat replay dari cache |

Titik integrasi lain yang wajib diperhatikan:

- `octave-media.js` — punya `describe(el)`, `findButton(re)`, `NEXT_RE`/`PREV_RE`. Bisa dipakai ulang
  kalau panel butuh tahu lagu mana yang sedang diputar.
- `octave-volume.js` — **mem-patch `HTMLMediaElement.prototype.volume`** dengan `EXPONENT = 3`
  (UI → `v**3`). Kalau panel menyentuh `el.volume` (mis. preview), wajib pakai nilai UI, bukan native.
- `disable-right-click.js` — memasang `user-select: none !important` ke `*` dan memblokir
  `contextmenu` kecuali target cocok `input, textarea, [contenteditable], [role="row"], tr,
  .song, .track, .item, button, a, [data-testid]`.
  → Konsekuensi: **jangan** andalkan contextmenu untuk baris track. Pakai tombol/ikon aksi di baris,
  atau tambah `[data-octave-row]` ke daftar selector kalau memang mau right-click.
- `octave-depin.js` + `octave-native.js` — dua `MutationObserver` global yang jalan tiap ada mutasi DOM
  (debounce 150ms). Panel yang sering re-render akan memicu sweep `TreeWalker` berulang.
  → **Aturan**: bangun DOM panel sekali, update hanya lewat `textContent` pada node tertentu.
  Jangan `innerHTML = ''` lalu render ulang tiap tick.
- `octave-native.js` — menandai `header/nav/aside` (dan fallback `body.firstElementChild`) sebagai
  drag region. → Panel **jangan** di-append ke dalam `header/nav/aside`, cukup ke `document.body`.

## 1b. Hasil Fase 0 (dijalankan 16 Okt 2026, Chrome 155, macOS)

Dijalankan dengan `tools/fase0-discovery.js`. Temuan di bawah ini **mengubah desain**, bukan
sekadar menambahkan konfirmasi. Baca ini sebelum mengerjakan Fase 3.

### a. CORS: AMAN — risiko utama §7 gugur

| | |
|---|---|
| Halaman | `https://music.octavestreaming.com` |
| Audio | `https://api.octavestreaming.com/audio/lossless?...` → **cross-origin** |
| Hasil probe | `fetch()` cross-origin **resolve**, status `206`, `content-range` terbaca |

`content-range` bukan header CORS-safelisted, tapi bisa dibaca → server memang mengirim
`Access-Control-Expose-Headers`. Artinya CORS diizinkan dan **unduhan penuh dari JS jalan**.
Ekspor lagu yang belum di-cache tidak butuh fallback.

> **Catatan metodologi (penting, pernah bikin salah kesimpulan).** Versi pertama probe
> melaporkan `ACAO: (TIDAK ADA)` dan sempat disimpulkan CORS gagal. Itu **false negative**:
> `Access-Control-Allow-Origin` dikonsumsi browser dan **tidak pernah bisa dibaca dari JS**,
> jadi selalu tampak kosong walau server mengirimnya. Patokan yang benar cuma satu — fetch-nya
> resolve atau reject. Probe sudah diperbaiki.

### b. Metadata sudah ada di URL audio — tidak perlu endpoint

URL audio membawa semuanya di query param:

```
https://api.octavestreaming.com/audio/lossless?track=3619063962&t=Upside%20Down&a=Black%20Gryph0n&d=158&x=0&k=octk_...
                                                                       ^id            ^title          ^artist     ^durasi
```

Jadi `octave-shared.js` sekarang punya `parseAudioUrlMeta()` dan **tidak ada endpoint meta yang
dipanggil**. Rencana backfill lewat `/api/tracks/features` di §2.2 dibatalkan.

Tapi metadata ini hanya diketahui **saat URL-nya ada**, dan `octave-cache.js` cuma menyimpan
`{track, bytes, ts}` di index. Jadi tetap perlu `__octave_track_meta_v1` sebagai penyimpanan
persisten — isinya didapat dari parse URL, bukan dari API. Lihat task baru di Fase 3.

### c. Ukuran file bisa didapat tanpa mengunduh

`content-range: bytes 0-1023/18673054` → total ukuran file. Bisa juga lewat `HEAD` (dipakai situs
sendiri: `FETCH HEAD 200 ... audio/lossless`). Berguna untuk menampilkan ukuran di panel sebelum
unduh, dan untuk estimasi budget yang akurat.

### d. Token `k=` punya masa berlaku → JANGAN simpan URL audio

Setiap URL audio membawa token `k=octk_...`. Implikasinya: URL audio bersifat sementara, jadi
yang disimpan hanya `trackId` + metadata. URL diambil ulang dari elemen `<audio>` saat dibutuhkan.
Kalau track sudah di cache, URL **tidak dibutuhkan sama sekali** (blob dari cache langsung dipakai).
Ini sudah diimplementasikan di `octave-save-track.js` (cache-first).

### e. Situs SUDAH punya offline store sendiri — perlu ditelusuri

Service worker situs punya 5 cache, dan ada route `/library/downloaded`:

```
octave-v8-static  86 entri      octave-v8-rsc   265 entri      octave-v8-data  209 entri
octave-v8-pages   26 entri      octave-v8-img   784 entri
```

Route yang ter-cache: `/library/downloaded`, `/library/downloaded/playlists`,
`/library/downloaded/artists`.

Konsekuensi yang harus diputuskan sebelum Fase 3:

1. **Ada fitur "Downloaded" bawaan situs.** Kalau fitur itu sudah menyimpan lossless secara
   offline, `octave-cache.js` bisa jadi sistem paralel yang redundan. Panel kita idealnya jadi
   **lapisan manajemen di atas keduanya**, bukan sistem ketiga.
2. **`octave-static-v1` (cache cover milik kita) redundan** dengan `octave-v8-img` (784 entri).
   Kandidat untuk dihapus dari `octave-cache.js` atau dijadikan opt-in.

### f. `mediaSession.metadata` TERISI

`title`/`artist`/`album` + `artwork` 4 ukuran (56/250/500/1000). Asumsi §2.2 terkonfirmasi —
tapi hanya untuk track yang **sedang diputar**, bukan untuk daftar track lama.

### g. Endpoint yang tersedia (berguna untuk plugin lain nanti)

| Endpoint | Catatan |
|---|---|
| `POST /api/lyrics` | **Plugin lirik jadi gampang** — tidak perlu LRCLIB seperti rencana awal |
| `GET /api/lastfm/status` | **Last.fm sudah terintegrasi di situs** → ide plugin scrobble redundan |
| `GET /api/tracks/features?ids=a,b,c` | batch, id dipisah koma |
| `GET /api/tracks/artists?ids=`, `/api/album/<id>`, `/api/track/<id>/radio` | |
| `POST /api/nowplaying` | cara situs melaporkan now-playing → titik hook untuk webhook/Discord nanti |
| `GET /api/apple/npLook`, `/api/apple/motion` | integrasi Apple Music |
| `GET /api/ios/release` | **ada app iOS resmi** |
| `/api/stem-status`, `/api/podcasts/search`, `/api/suggest`, `/api/sync`, `/api/profile/me` | |

### h. Storage (di Chrome, belum di app Pake)

`usage 69.3 MB`, `quota 10.1 GB`, `persisted: true`. Budget 800 MB ≈ 8% kuota, jadi preset
sampai ~4 GB masih masuk akal. **Perlu diverifikasi ulang di app Pake** — kuota WebView bisa beda.

## 2. Keputusan arsitektur

### 2.1 Kenapa baca index, bukan scan Cache Storage

Bisa saja panel menghitung isi cache dari `cache.keys()`. Tapi index sudah menyimpan `bytes` dan `ts`,
dan yang lebih penting: **`cache.keys()` tidak menyimpan metadata lagu**. Jadi:

- **Sumber kebenaran ukuran + urutan LRU** = `__octave_audio_index_v1` (dibaca read-only).
- **Sumber kebenaran "file benar-benar ada"** = `cache.match(audioCacheKey(id))`.
- Panel membandingkan keduanya → itulah fitur **Rekonsiliasi** (lihat §3.3). Ini yang membuat panel
  berguna, bukan sekadar viewer.

### 2.2 Metadata lagu: parse dari URL audio — SELESAI

**Direvisi setelah Fase 0** (§1b.b). Index cache cuma punya `{track, bytes, ts}`, tapi URL audio
sudah membawa `t` (title), `a` (artist), dan `d` (durasi). Jadi **tidak ada endpoint API yang
dipanggil** — rencana backfill lewat `/api/tracks/features` dibatalkan.

- `octave-shared.js` menyediakan `parseAudioUrlMeta(url)` → `{trackId, title, artist, duration, variant, origin}`.
- Panel tetap menyimpan map persisten di `localStorage['__octave_track_meta_v1']`, karena index
  cache tidak menyimpannya dan URL audio tidak boleh disimpan (token `k=` kadaluarsa, §1b.d).
- Diisi saat lagu diputar: `navigator.mediaSession.metadata` (terbukti terisi, §1b.f) **atau**
  parse URL dari elemen `<audio>` — mana yang lebih dulu tersedia.
- Fallback kalau metadata tetap tak ada: `octave-<id8>` (sudah ada di `buildFilename`).

**Task baru untuk Fase 3** — persist meta saat caching berlangsung, supaya track yang di-cache
sebelum plugin dipasang tidak kehilangan metadata. Ada dua call site di `octave-cache.js` yang
punya URL-nya, jadi tambahannya kecil:

| Call site | Data yang tersedia |
|---|---|
| `fetchLosslessCached(input, init, url)` | `url` lengkap → bisa parse `t`/`a`/`d` |
| `warmAudioFromElement(el)` | `el.currentSrc` → idem |

### 2.3 Pin anti-evict: patch ke modul lama — SELESAI

Implementasi sebenarnya ada di `octave-cache.js` (`enforceAudioBudget`). Bentuk finalnya
**berbeda sedikit** dari sketsa awal di plan, dan versi final lebih aman:

```js
idx.sort(function (a, b) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? 1 : -1; // non-pinned dulu, pinned di belakang
  return a.ts - b.ts;
});
var kept = [];
while (idx.length > 0 && (idx.length + kept.length >= budget.tracks || total >= budget.bytes)) {
  var victim = idx.shift();
  if (victim.pinned) { kept.push(victim); continue; }   // <- bukan `break`
  (function (v) { chain = chain.then(function () { return cache.delete(audioCacheKey(v.track)); }); total -= v.bytes || 0; })(victim);
}
setAudioIndex(kept.concat(idx));
```

Sketsa awal memakai `idx.push(victim); break;`. Dengan sort di atas keduanya setara, tapi
`continue` + `kept` lebih tahan banting: kalau urutannya suatu saat berubah, entri pinned di
tengah tetap tidak akan membuat eviction berhenti sebelum budget tercapai.

`pushAudioIndex()` menyimpan flag `pinned` yang sudah ada sebelum menimpa entri (re-cache lagu
yang di-pin tidak boleh menghapus pin-nya). `touchAudio()` sudah aman karena memutasi in-place.
Ditambah `setPinned(trackId, pinned)` yang dipakai panel.

### 2.4 Budget jadi preset — SELESAI

Implementasi menyimpang dari sketsa: budget **dibaca ulang tiap kali ditegakkan** (`readBudget()`),
bukan sekali saat init. Efeknya lebih baik — ganti preset dari panel langsung berlaku tanpa
restart app. Nilai di luar batas di-clamp:

| Field | Min | Max | Default |
|---|---|---|---|
| `tracks` | 1 | 500 | 10 |
| `bytes` | 100 MB | 50 GB | 800 MB |

Guard sisa kuota (`navigator.storage.estimate()`) **belum** diimplementasikan — itu bagian Fase 3
karena butuh UI untuk menjelaskan penolakannya.

> Jebakan yang sudah kena: karena `minBytes` = 100 MB, nilai byte kecil di test (mis. `bytes: 100`)
> akan di-clamp naik dan membuat test menyesatkan. Sudah ada peringatannya di `tools/check-octave-plugins.js`.

### 2.5 Helper bersama: `octave-shared.js` — SELESAI

Isi finalnya lebih banyak dari rencana awal karena metadata dan nama file juga ditaruh di sini
supaya bisa dites tanpa DOM:

| Kelompok | Fungsi |
|---|---|
| Inti (diduplikasi dari `octave-cache.js`) | `trackIdFromUrl`, `audioCacheKey`, `isLosslessUrl` |
| Metadata | `parseAudioUrlMeta` |
| Nama file | `pickExtension`, `sanitizeFilename`, `buildFilename` |
| Format | `fmtBytes`, `fmtAge`, `shortId` |
| Storage | `readJSON`, `writeJSON` |
| Konstanta | `CACHE_AUDIO`, `CACHE_STATIC`, `INDEX_KEY`, `BUDGET_KEY`, `META_KEY`, `DEFAULT_BUDGET` |

Aturan tetap: 3 fungsi inti **wajib identik** dengan `octave-cache.js`, dijaga oleh
`tools/check-octave-plugins.js` (statik + runtime). Refactor `octave-cache.js` supaya mengonsumsi
`__octave.util` tetap **tidak** dikerjakan (§9).

`octave-cache.js` juga mengekspos `window.__octave.cache` sebagai API surface untuk panel —
ini tambahan di luar rencana awal, tapi membuat panel tidak perlu menebak key localStorage dan
membuat eviction bisa dites.

### 2.6 Ekspor ke disk: blob + `<a download>` — SELESAI

Diimplementasikan di `octave-save-track.js`. Perbedaan dari rencana awal, semuanya akibat Fase 0:

1. URL diambil dari elemen `<audio>` **dengan satu jebakan yang harus ditangani**: kalau track
   sudah di cache, `octave-cache.js` sudah mengganti `src` jadi `blob:` URL. URL aslinya dibaca
   dari `dataset.octaveOrigSrc`. Tanpa ini, `trackIdFromUrl` gagal untuk lagu yang justru paling
   mungkin disimpan user.
2. Cache diperiksa **dulu** (`caches.match`). Hit → blob dari cache, nol request network. Ini
   penting karena token `k=` di URL bisa kadaluarsa (§1b.d) — track yang sudah di cache tetap
   bisa diekspor kapan saja.
3. Miss → `window.fetch(url)`. **Sengaja lewat `window.fetch` yang sudah dipatch
   `octave-cache.js`**, bukan fetch mentah: sekali unduh, hasilnya sekalian masuk cache lossless.
   Progress dibaca dari `res.body.getReader()`.
4. Guard kuota: kalau sisa ruang < 2× ukuran file, batalkan dengan pesan jelas (butuh
   `navigator.storage.estimate()`).
5. Guard data kosong: `blob.size === 0` → batalkan, jangan trigger unduhan file kosong.
6. Ekstensi dari `Content-Type` dengan fallback ke ekstensi di URL, terakhir `.bin`.
7. Nama file dari metadata URL (`artist - title`), disanitasi, karakter non-latin dibiarkan utuh.
8. `revokeObjectURL` ditunda 60 detik — kalau terlalu cepat, WKWebView bisa belum selesai menulis.
9. Toast dibangun **sekali** lalu isinya diganti `textContent`, karena `octave-depin.js` dan
   `octave-native.js` punya `MutationObserver` global.

`app.json` ditambah `"downloadDir": "~/Music/Octave"`. **Masih perlu diverifikasi** apakah
`downloadDir` berlaku untuk blob download dari `<a download>` di WKWebView; kalau tidak, file
jatuh ke `~/Downloads`.

**Batasan yang belum diuji:** `disabledWebShortcuts: true` mungkin membuat Pake menelan
`Cmd+Shift+S` sebelum sampai ke halaman. Kalau shortcut tidak jalan, pakai
`__octave.saveTrack()` atau tombol di panel. Perlu dites di build `--install`.


## 3. Fitur

### 3.1 `octave-offline-panel.js` — ringkasan

- Total track ter-cache, total bytes vs budget (progress bar), `navigator.storage.estimate()`
  (usage/quota), status `navigator.storage.persisted()` + tombol "Minta persistent storage".
- Status "sedang diputar" pada baris yang aktif.

### 3.2 `octave-offline-panel.js` — daftar track

Kolom: cover (kecil, dari `CACHE_STATIC`), title, artist, ukuran, umur cache (`ts`), badge **PIN**.
Aksi per baris: **Pin/Unpin**, **Putar**, **Simpan ke disk** (memanggil `octave-save-track.js`),
**Hapus** (hapus dari cache + index).

### 3.3 `octave-offline-panel.js` — rekonsiliasi & aksi massal

- **Deteksi drift**: entri index yang `cache.match`-nya miss (= "hantu") dan entry cache yang
  tidak ada di index (= "yatim"). Tombol **Perbaiki** menghapus hantu dari index dan menambahkan
  yatim ke index (ukuran diambil dari `res.blob().size`).
- **Bersihkan audio cache**, **Bersihkan static cache** (cover), **Refresh index**.
- Semua aksi destruktif pakai konfirmasi dua langkah di dalam panel (bukan `confirm()` browser).

### 3.4 `octave-offline-panel.js` — akses & layout

- Toggle: shortcut `⌥⌘O` + tombol pill kecil di kanan bawah (bukan di dalam `header/nav/aside`).
- `position: fixed`, `z-index: 2147483000`, tema gelap senada situs, lebar ~380px, bisa ditutup `Esc`.
- State (terbuka/tertutup, posisi) disimpan di `localStorage['__octave_panel_v1']`.
- Guard anti-double-inject: `if (window.__octaveOfflinePanel) return;`

### 3.5 `octave-save-track.js` — trigger

- Shortcut `⌘⇧S` = simpan lagu yang sedang diputar.
- Dipanggil dari panel (tombol per baris).
- Tombol opsional di sebelah kontrol player situs (dipasang lewat `findButton`/heuristik posisi,
  sama seperti pendekatan `octave-media.js`) — tandai sebagai nice-to-have, mudah rapuh.

## 4. Struktur file

Status per 16 Okt 2026:

```
buildoctave/
├── app.json                        # PATCH — downloadDir + 2 entri inject (panel menyusul)
├── plan-plugins.md                 # file ini
├── tools/
│   ├── check-octave-plugins.js     # BARU — 35 pemeriksaan
│   └── fase0-discovery.js          # BARU — snippet console discovery
└── src/js/
    ├── octave-shared.js            # SELESAI — util bersama (load paling awal)
    ├── octave-cache.js             # SELESAI — pinned + budget preset + API surface
    ├── octave-save-track.js        # SELESAI — ekspor ke disk
    ├── octave-offline-panel.js     # BELUM — panel manajer cache (Fase 3)
    └── (8 modul lama, tidak disentuh)
```

Urutan `inject` yang disarankan:

```json
"inject": [
  "./src/css/octave-native.css",
  "./src/js/octave-shared.js",
  "./src/js/octave-volume.js",
  "./src/js/octave-native.js",
  "./src/js/octave-media.js",
  "./src/js/octave-cache.js",
  "./src/js/octave-offline-panel.js",
  "./src/js/octave-save-track.js",
  "./src/js/octave-prefetch.js",
  "./src/js/octave-media-lazy.js",
  "./src/js/octave-depin.js",
  "./src/js/disable-right-click.js"
]
```

Catatan: `octave-offline-panel.js` **harus setelah** `octave-cache.js` (butuh index sudah terisi),
`octave-shared.js` sebelum keduanya, dan `octave-save-track.js` setelah `octave-cache.js` (karena
memakai `window.fetch` yang sudah dipatch). Tiga aturan ini dijaga otomatis oleh
`tools/check-octave-plugins.js`.

## 5. Fase & task

### Fase 0 — Discovery (0.25 hari) — SELESAI 16 Okt 2026
- [x] Rekam URL audio lossless + `Content-Type` → `?track=&t=&a=&d=&x=&k=`, `audio/flac`.
- [x] Cek CORS → **aman**, cross-origin tapi fetch resolve (§1b.a). Metodologi probe awal salah,
      sudah diperbaiki di `tools/fase0-discovery.js`.
- [x] Baca index + `navigator.storage.estimate()` + `persisted()` di browser.
- [x] Temuan tak terduga: situs sudah punya offline store sendiri + route `/library/downloaded` (§1b.e).
- [ ] **MASIH TERBUKA:** verifikasi `downloadDir` untuk blob `<a download>` di app Pake (butuh build).
- [ ] **MASIH TERBUKA:** cek `navigator.storage.estimate()` di app Pake, bukan di Chrome.
- [ ] **MASIH TERBUKA:** telusuri `/library/downloaded` — lihat Fase 3a.

### Fase 1 — `octave-shared.js` (0.25 hari) — SELESAI
- [x] 12 fungsi + 6 konstanta + guard `window.__octave`.
- [x] 3 fungsi inti identik dengan `octave-cache.js`, dijaga test statik + runtime.
- [x] Terdaftar di `app.json` sebelum `octave-cache.js`.

### Fase 2 — Patch `octave-cache.js` (0.25 hari) — SELESAI
- [x] `pinned` di `enforceAudioBudget()` — pakai `continue` + `kept`, bukan `break` (§2.3).
- [x] `pushAudioIndex()` mempertahankan `pinned`; `touchAudio()` sudah aman (in-place).
- [x] `readBudget()` dari `localStorage['__octave_budget_v1']` + clamping, dibaca ulang tiap dipanggil.
- [x] `setPinned()` + `window.__octave.cache` sebagai API surface.
- [x] 12 test eviction/budget/pinned lolos.
- [ ] **BELUM:** guard sisa kuota — pindah ke Fase 3 karena butuh UI penjelasan.
- [ ] **BELUM:** verifikasi regresi playback di app asli (butuh build, lihat Fase 5).

### Fase 3a — Telusuri `/library/downloaded` (0.25 hari) — BARU, blocker untuk Fase 3b
- [ ] Buka `/library/downloaded` di app. Cari tombol download per lagu/album/playlist.
- [ ] Setelah menekan download, cek: datanya masuk ke mana? (`caches.open('octave-v8-*')`,
      IndexedDB, atau `octave-audio-v1` milik kita?)
- [ ] Apakah lossless atau versi lain? Apakah bisa diputar offline?
- [ ] Apakah ada batas jumlah/ukuran?
- [ ] **Keputusan yang harus diambil:** panel kita jadi (a) manajer untuk `octave-audio-v1` saja,
      (b) manajer untuk keduanya, atau (c) dibatalkan karena situs sudah lebih baik.
      Ini menentukan apakah Fase 3b dikerjakan seperti rencana atau didesain ulang.

### Fase 3b — `octave-offline-panel.js` (1 hari) — menunggu Fase 3a
- [ ] Skeleton panel: build DOM **sekali**, `z-index` tinggi, `Esc` untuk tutup, guard double-inject.
- [ ] Ringkasan: hitung dari index + `navigator.storage.estimate()` + tombol minta persistent storage.
- [ ] Daftar track + badge pin + badge "sedang diputar".
- [ ] Aksi baris: Pin/Unpin, Putar, **Simpan ke disk** (panggil `__octave.saveTrack`), Hapus.
- [ ] Rekonsiliasi drift + tombol Perbaiki.
- [ ] Selector budget preset + guard sisa kuota (§2.4).
- [ ] **Persist metadata saat caching**: ~6 baris di `octave-cache.js` pada dua call site yang punya
      URL (`fetchLosslessCached`, `warmAudioFromElement`) → tulis `parseAudioUrlMeta(url)` ke
      `__octave_track_meta_v1`. Ini yang bikin track lama tetap punya judul, bukan `octave-<id8>`.
- [ ] Observer `mediaSession.metadata` untuk track yang sedang diputar.
- [ ] Pastikan DOM panel **tidak** memicu badai mutation (update lewat `textContent` per node saja).
- [ ] Verifikasi: lihat §6 (DoD) poin 1–6.

### Fase 4 — `octave-save-track.js` (0.5 hari) — SELESAI
- [x] Ambil URL dari elemen audio + tangani `dataset.octaveOrigSrc` saat src sudah jadi blob URL.
- [x] Jalur cache-hit (`cache.match` → `blob()`) — tanpa network.
- [x] Jalur cache-miss (`window.fetch` yang dipatch + `getReader()` untuk progress).
- [x] Ekstensi dari `Content-Type` (fallback ke URL, lalu `.bin`) + sanitasi nama file.
- [x] Trigger: `Cmd+Shift+S` + API `__octave.saveTrack({trackId, url})`.
- [x] **Tombol bundar di kanan bawah** — ditambahkan setelah Dhana install build dan tidak
      menemukan apa-apa: tanpa UI, satu-satunya pemicu adalah shortcut/console, dan DevTools
      tidak ada di build release. Tombol ini jalur utama, bukan pelengkap.
- [x] Toast progres + toast hasil/error, dibangun sekali.
- [x] Guard `blob.size === 0`, `!res.ok`, dan sisa kuota < 2× ukuran file.
- [x] 12 test helper (parse URL, ekstensi, nama file, format) lolos.
- [x] **Resolusi URL berlapis** — setelah error "Tidak bisa membaca id track" muncul di build
      pertama. Versi awal menerima URL apa pun dari elemen `<audio>`, termasuk yang tidak punya
      parameter `track`. Sekarang:
      1. elemen `<audio>/<video>` — **hanya** dipakai kalau punya id track
      2. `dataset.octaveOrigSrc` (kalau `octave-cache.js` sudah menukar src jadi blob:)
      3. rekaman URL lossless dari `PerformanceObserver` (`buffered: true`) — ini yang menangani
         kasus situs mengalirkan audio lewat MediaSource sehingga elemen tidak pernah menyentuh
         URL lossless. Dipilih yang `t`-nya cocok dengan `mediaSession.metadata.title`; kalau
         tidak ada yang cocok, pakai yang paling baru.
      Catatan: sengaja **tidak** memakai `performance.getEntriesByType` sebagai sumber utama karena
      buffer resource timing terbatas (default 250 entri) dan situs ini sudah punya 784 entri
      gambar — buffer bisa penuh dan entry baru berhenti tercatat.
- [x] **Pesan error membawa bukti.** Tanpa DevTools, toast adalah satu-satunya kanal diagnostik.
      Pesan gagal sekarang menyertakan tag elemen, potongan src, dan jumlah entry lossless.
- [x] `tools/diag-track-url.js` — snippet Chrome untuk melihat isi DOM + daftar request lossless
      tanpa perlu rebuild.
- [ ] **BELUM:** dites di app asli — khususnya apakah `Cmd+Shift+S` lolos dari `disabledWebShortcuts`
      dan apakah `downloadDir` benar-benar dipakai untuk blob download.
- [ ] **BELUM:** kalau lapis 3 yang menang, perlu dicek apakah track yang dipilih benar (bukan
      track yang cuma di-prefetch). Judul di toast adalah indikatornya.

### Fase 5 — Integrasi & rilis (0.5 hari)
- [ ] `app.json`: tambah `octave-offline-panel.js` setelah Fase 3b.
- [ ] Rebuild: `pake --config app.json --install`.
- [ ] Smoke test penuh di build hasil `--install` (bukan cuma dev), termasuk cold start.
- [ ] Verifikasi `downloadDir` benar-benar dipakai; kalau tidak, perbarui readme + plan.
- [ ] Update `readme.md` (struktur file + cara pakai panel & shortcut).


## 6. Kriteria terima (DoD)

1. [ ] Putar 3 lagu lossless → buka panel (`⌥⌘O`) → muncul 3 baris dengan cover, title, artist,
       ukuran yang cocok dengan Network tab (±2%).
2. [ ] Pin 1 track → putar lagu lossless lain sampai budget lewat → track yang di-pin **tetap ada**,
       yang terbuang adalah yang paling lama tidak diputar.
3. [ ] Hapus 1 track dari panel → jumlah key di `caches.open('octave-audio-v1').keys()` berkurang 1,
       dan replay lagu itu memicu request network baru.
4. [ ] Drift: hapus 1 entry cache manual via DevTools → panel menandainya "hantu" → tombol Perbaiki
       menghapusnya dari index.
5. [ ] Tutup app lalu buka lagi → index, daftar pin, dan preset budget tetap utuh.
6. [ ] Panel dibuka/tutup 10× dan dibiarkan terbuka 5 menit → tidak ada kenaikan CPU yang terlihat di
       Activity Monitor (bukti MutationObserver tidak kebanjiran).
7. [ ] `⌘⇧S` pada lagu **yang sudah di cache** → file muncul di `~/Music/Octave`, **nol request audio**
       di Network tab.
8. [ ] `⌘⇧S` pada lagu **belum di cache** → ada 1 request full, progres naik 0→100%, file tersimpan.
9. [ ] `ffprobe` / `afinfo` pada file hasil ekspor → durasi dan sample rate benar (bukan file rusak).
10. [ ] Judul lagu dengan karakter `/\:*?"<>|`, spasi ganda, dan karakter non-latin → tersimpan tanpa
        error, nama file tersanitasi dan tetap bisa dikenali.
11. [ ] Disk/kuota hampir penuh → muncul toast error, **tidak ada file 0 byte** yang tertinggal.
12. [ ] Semua modul lama (volume eksponensial, prev/next MediaSession, drag window, blokir
        contextmenu, depin) masih berperilaku sama seperti sebelum perubahan.

## 7. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| ~~Audio CDN beda origin **tanpa** header CORS~~ | ~~`fetch()` penuh gagal~~ | **GUGUR di Fase 0** — terbukti fetch cross-origin resolve (§1b.a). Baris ini disimpan sebagai jejak supaya tidak dihidupkan lagi tanpa bukti baru. |
| Menyimpulkan CORS dari header `Access-Control-Allow-Origin` | Salah kesimpulan (sudah pernah terjadi di Fase 0) — header itu tidak pernah terbaca dari JS, selalu tampak kosong | Satu-satunya patokan: fetch-nya resolve atau reject. Jangan pernah percaya nilai header ACAO. |
| Situs punya offline store sendiri (`/library/downloaded`, 5 cache SW) | Panel kita jadi sistem paralel yang redundan → kerja sia-sia | Fase 3a wajib duluan: telusuri dulu sebelum membangun panel (§1b.e). |
| `octave-static-v1` (cache cover kita) redundan dengan `octave-v8-img` (784 entri) | Boros kuota, dua cache menyimpan gambar yang sama | Kandidat dihapus dari `octave-cache.js` atau dijadikan opt-in. Diputuskan setelah Fase 3a. |
| Token `k=` di URL audio punya masa berlaku | Menyimpan URL audio lalu memakainya lagi → 404/403 | Simpan hanya `trackId` + metadata. URL diambil ulang dari elemen audio. Cache-first di `saveTrack` sudah menangani ini (§1b.d). |
| Blob 25–35MB per lagu ditahan di memori | OOM di mesin RAM kecil | Utamakan jalur `cache.match()` (data sudah di disk). Kalau harus `fetch`, cek `navigator.storage.estimate()` dan tolak kalau sisa < 2× ukuran. Sudah diimplementasikan. |
| `revokeObjectURL` terlalu cepat | Unduhan gagal / file 0 byte di WKWebView | Ditunda 60 detik di `octave-save-track.js`. Verifikasi di Fase 5. |
| `disabledWebShortcuts: true` menelan `Cmd+Shift+S` | Shortcut ekspor tidak jalan | Belum diuji. Fallback sudah ada: `__octave.saveTrack()` + tombol di panel. |
| `disable-right-click.js` memblokir `contextmenu` di baris panel | Right-click menu tidak muncul | Jangan pakai contextmenu — pakai tombol aksi per baris. Alternatif: tambah `[data-octave-row]` ke daftar selector di `disable-right-click.js`. |
| `octave-depin.js` + `octave-native.js` `MutationObserver` global | Panel yang re-render sering memicu sweep `TreeWalker` berulang → CPU naik | Build DOM sekali; update hanya `textContent` node tertentu. Jangan render ulang seluruh list tiap tick. |
| Situs ganti skema URL (`?track=` → path) | `trackIdFromUrl` gagal → panel & ekspor mati | Sentralkan di `octave-shared.js`, sediakan fallback regex path (`/track/([^/?]+)`), dan tambah health-check yang menampilkan peringatan di panel kalau id tidak bisa di-resolve. |
| `enforceAudioBudget` diubah, regresi ke playback | Audio rusak / lagu tidak mau diputar | Patch terbatas, plus 12 test otomatis dan langkah verifikasi regresi eksplisit di Fase 5 & DoD poin 12. |
| Panel bertabrakan z-index dengan modal/player situs | Panel tertutup elemen situs | `z-index: 2147483000` + `position: fixed` + uji di 3 halaman berbeda (home, playlist, album). |

## 8. Urutan eksekusi

```
Fase 0 (discovery)                          SELESAI 16 Okt 2026
  → Fase 1 (shared util)                    SELESAI
  → Fase 2 (patch cache: pinned + budget)   SELESAI
  → Fase 4 (save track)                     SELESAI  <- bisa maju duluan, tidak bergantung panel
  → Fase 3a (telusuri /library/downloaded)  <- BLOCKER, kerjakan sebelum 3b
  → Fase 3b (panel offline)
  → Fase 5 (integrasi + rebuild + smoke test)
```

Fase 4 sengaja dimajukan sebelum Fase 3 karena tidak bergantung pada keputusan Fase 3a —
ekspornya bekerja langsung dari elemen `<audio>` dan cache, tanpa perlu panel.

Fase 3a tidak bisa dilewati: kalau ternyata fitur "Downloaded" bawaan situs sudah menyimpan
lossless secara offline, panel yang direncanakan di §3 bisa jadi duplikasi dan harus didesain ulang.

## 9. Yang sengaja TIDAK dikerjakan di plan ini

- Refactor `octave-cache.js` supaya mengonsumsi `octave-shared.js` (risiko regresi audio, nilai kecil).
- Plugin host / registry `{id, init, health()}` — bagus, tapi lakukan **setelah** modul ke-10 ada,
  biar refactor-nya tidak jalan di atas fondasi yang masih bergerak.
- Tier 2 (butuh fork Pake): Discord Rich Presence, media key global saat app tidak fokus,
  tray/Dock menu dinamis dengan Now Playing.

### Ide yang gugur karena temuan Fase 0

- **Plugin lirik dari LRCLIB** → situs sudah punya `POST /api/lyrics`. Pakai itu, jangan API pihak ketiga.
- **Plugin scrobble Last.fm** → situs sudah punya `GET /api/lastfm/status`. Cek dulu apakah scrobble
  sudah jalan; kalau ya, plugin ini tidak perlu ada.

