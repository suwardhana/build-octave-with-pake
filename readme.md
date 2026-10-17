# Octave Music (Pake wrapper)

```sh
pake --config app.json --install
```

## Struktur

```
.
├── app.json            # config Pake (inject + tray + icon)
├── src/
│   ├── js/
│   │   ├── octave-volume.js        # exponential volume (port reference/volume.ts)
│   │   ├── octave-native.js        # drag window + traffic-lights safe area
│   │   ├── octave-media.js         # MediaSession prev/next (bukan seek ±15s)
│   │   ├── octave-cache.js         # API dedupe + cache lossless/cover
│   │   ├── octave-prefetch.js      # prefetch navigasi SPA
│   │   ├── octave-media-lazy.js    # lazy preload <video> bawah fold
│   │   ├── octave-depin.js         # bersihkan label "Pinned" dekoratif
│   │   └── disable-right-click.js  # blokir contextmenu + seleksi teks
│   └── css/
│       └── octave-native.css       # tweaks macOS native
├── assets/             # music.icns, tray-*.png
├── dist/               # hasil build (.dmg)
└── reference/
    └── volume.ts       # referensi asli (YouTube Music plugin), jangan diinject
```

## Volume

`src/js/octave-volume.js` port dari `reference/volume.ts`:

- Slider linear → telinga logaritmik, jadi 50% terdengar masih kencang.
- Mapping: nilai UI `v` disimpan, yang diteruskan ke `<audio>` adalah `v ** 3`
  (sama kayak PulseAudio). Contoh: 50% → 12.5% aktual, 5% → 0.0125% aktual.
- Getter mengembalikan nilai UI asli (pakai `WeakMap` biar slider tidak
  lompat karena error floating point).
- Tidak ada `playerApi` di Octave, jadi `syncVolume()` diganti resync
  elemen `<audio>/<video>` yang ada + `MutationObserver` untuk elemen baru.
- Tweak: ubah `EXPONENT` di atas file (makin besar = makin pelan).
