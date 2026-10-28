# Octave Music (Pake wrapper)

```sh
pake --config app.json --install
```

## CI/CD — Windows build (GitHub Actions)

Build Windows jalan di `.github/workflows/build-windows.yml`, pakai `pake-cli`
dari npm. **Tidak perlu fork tw93/Pake** — CLI-nya sudah membawa template
Tauri sendiri, jadi cukup repo ini.

Cara jalanin:

- Manual: tab **Actions** → **Build Windows** → **Run workflow**
- Otomatis: push tag `v*` (contoh `git tag v1.1.1 && git push origin v1.1.1`)

Hasil build (kalau `publish` aktif) masuk ke **Releases** dengan tag `v<versi>`:

| File | Isi |
| --- | --- |
| `Octave-Music-<versi>-windows-x64-portable.exe` | raw binary, tanpa installer |
| `Octave-Music-<versi>-windows-x64.msi` | installer (WiX) |
| `SHA256SUMS.txt` | checksum kedua file di atas |

Catatan penting:

- Versi diambil dari `appVersion` di `app.json`; kalau dipicu push tag, tag-nya
  yang menang.
- Windows wajib ikon `.ico` 256x256 (`assets/icon.ico`). Kalau `--icon` tidak
  di-override ke `.ico`, Pake diam-diam jatuh ke ikon default — `app.json`
  sendiri masih menunjuk `music.icns` karena itu yang dipakai di macOS.
- Build pertama ~10-15 menit (kompilasi Rust), berikutnya lebih cepat karena
  cache `CARGO_TARGET_DIR`.

## Struktur

```
.
├── app.json            # config Pake (inject + tray + icon)
├── .github/
│   └── workflows/
│       └── build-windows.yml       # CI build Windows -> Releases
├── src/
│   ├── js/
│   │   ├── octave-native.js        # drag window + traffic-lights safe area
│   │   ├── octave-media.js         # MediaSession prev/next (bukan seek ±15s)
│   │   ├── octave-cache.js         # API dedupe + cache lossless/cover
│   │   ├── octave-prefetch.js      # prefetch navigasi SPA
│   │   ├── octave-media-lazy.js    # lazy preload <video> bawah fold
│   │   ├── octave-depin.js         # bersihkan label "Pinned" dekoratif
│   │   └── disable-right-click.js  # blokir contextmenu + seleksi teks
│   └── css/
│       └── octave-native.css       # tweaks macOS native
├── assets/             # music.icns (macOS), icon.ico (Windows), tray-*.png
├── dist/               # hasil build (.dmg)
├── reference/
│   └── volume.ts       # arsip port volume lama, TIDAK diinject
```

## Catatan plugin volume

Plugin `octave-volume.js` (port `reference/volume.ts`) sudah **dihapus**.
Volume sekarang memakai perilaku bawaan situs / WebView. File di `reference/`
hanya arsip, bukan bagian dari build.
