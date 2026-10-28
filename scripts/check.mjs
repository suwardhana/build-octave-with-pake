#!/usr/bin/env node
// Pemeriksaan statis untuk wrapper Pake Octave Music.
// Tidak butuh dependency: cukup Node >= 20.9.
// Jalankan: node scripts/check.mjs  (atau: npm run check)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passed = [];
const failed = [];

function check(condition, message) {
  if (condition) passed.push(message);
  else failed.push(message);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return existsSync(join(root, relativePath));
}

let app;
try {
  app = JSON.parse(read('app.json'));
  check(true, 'app.json valid JSON');
} catch (error) {
  console.error('FAIL app.json tidak bisa dibaca: ' + error.message);
  process.exit(1);
}

const inject = Array.isArray(app.inject) ? app.inject : [];
const modulePaths = inject.filter((path) => path.endsWith('.js'));
const jsFiles = readdirSync(join(root, 'src/js'))
  .filter((file) => file.endsWith('.js'))
  .sort();

check(typeof app.url === 'string' && app.url.startsWith('https://'), 'app.url valid');
check(typeof app.name === 'string' && app.name.length > 0, 'app.name ada');
check(typeof app.identifier === 'string' && app.identifier.length > 0, 'app.identifier ada');
check(/^\d+\.\d+\.\d+/.test(String(app.appVersion || '')), 'appVersion semver');
check(inject.length > 0, 'inject tidak kosong');
check(new Set(inject).size === inject.length, 'inject tidak duplikat');
check(inject[0] && inject[0].endsWith('.css'), 'CSS berada di urutan pertama inject');
check(modulePaths.length >= 8, 'jumlah modul JS minimal 8');

for (const path of inject) {
  check(exists(path), 'file inject ada: ' + path);
}

const coreIndex = modulePaths.findIndex((path) => path.endsWith('/octave-core.js'));
const cacheIndex = modulePaths.findIndex((path) => path.endsWith('/octave-cache.js'));
const diagIndex = modulePaths.findIndex((path) => path.endsWith('/octave-diag.js'));

check(coreIndex === 0, 'octave-core.js adalah modul JS pertama');
check(cacheIndex > coreIndex && cacheIndex < diagIndex, 'octave-cache.js sebelum octave-diag.js');
check(diagIndex === modulePaths.length - 1, 'octave-diag.js adalah modul terakhir');

check(jsFiles.length === modulePaths.length, `semua file src/js terdaftar (${jsFiles.length}/${modulePaths.length})`);
for (const file of jsFiles) {
  check(
    modulePaths.some((path) => path.endsWith('/' + file)),
    'terdaftar di inject: ' + file
  );
}

check(!exists('src/js/octave-volume.js'), 'octave-volume.js sudah dihapus');
check(
  !inject.some((path) => path.includes('octave-volume')),
  'tidak ada referensi octave-volume di inject'
);
check(!exists('src/js/octave-save-track.js'), 'octave-save-track.js tidak ada (tombol download)');

for (const file of jsFiles) {
  const relative = 'src/js/' + file;
  const source = read(relative);

  try {
    execFileSync(process.execPath, ['--check', join(root, relative)], { stdio: 'pipe' });
    check(true, 'syntax: ' + file);
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString().trim() : error.message;
    check(false, 'syntax: ' + file + ' -> ' + detail);
  }

  check(
    /if \(window\.__[A-Za-z0-9_]+\) return;/.test(source),
    'double-inject guard: ' + file
  );
  check(source.includes('(function () {'), 'dibungkus IIFE: ' + file);

  const topLevelBindings = source
    .split('\n')
    .filter((line) => /^(const|let) /.test(line));
  check(topLevelBindings.length === 0, 'tidak ada const/let top-level: ' + file);

  check(!source.includes('innerHTML'), 'tanpa innerHTML: ' + file);
}

const pkg = JSON.parse(read('package.json'));
check(app.appVersion === pkg.version, 'appVersion sama dengan package.json version');
check(pkg.scripts && pkg.scripts.check === 'node scripts/check.mjs', 'package.json punya script check');

for (const message of passed) console.log('ok   ' + message);
if (failed.length > 0) {
  console.error('');
  for (const message of failed) console.error('FAIL ' + message);
  process.exit(1);
}
console.log(`\n${passed.length} pemeriksaan lolos.`);
