#!/usr/bin/env node

/**
 * Gộp ảnh trùng/cùng ảnh ở kích thước khác nhau thành 16 ảnh thiệp thực tế.
 * Chạy sau organize-personal-assets.mjs: node scripts/compact-rendered-photos.mjs
 */

import { access, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = resolve(root, 'assets/images');
const htmlPath = resolve(root, 'index.html');
const manifestPath = resolve(root, 'assets/vendor/manifest.json');
const stagingDir = resolve(imagesDir, '.photo-rebuild');

// Bản gốc chứa nhiều file cùng một ảnh, chỉ khác kích thước/nén.
const photoGroups = [
  [1, 3],
  [2, 18, 19],
  [4, 21],
  [5],
  [6, 25],
  [7, 9],
  [8, 17],
  [10, 16],
  [11, 14],
  [12, 28],
  [13, 24],
  [15, 27],
  [20],
  [22, 26],
  [23, 29],
  [30, 31],
];

const pathFor = (number) => `assets/images/photo-${String(number).padStart(2, '0')}.jpg`;
const replacements = new Map();
for (const [groupIndex, sources] of photoGroups.entries()) {
  const target = pathFor(groupIndex + 1);
  for (const source of sources) replacements.set(pathFor(source), target);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const expectedPhotos = photoGroups.map((_, index) => `photo-${String(index + 1).padStart(2, '0')}.jpg`);
const currentPhotos = (await readdir(imagesDir))
  .filter((name) => /^photo-\d+\.jpg$/i.test(name))
  .sort();
if (currentPhotos.length === expectedPhotos.length
  && currentPhotos.every((name, index) => name === expectedPhotos[index])) {
  console.log(`Đã có sẵn ${photoGroups.length} ảnh cưới thực tế.`);
  process.exit(0);
}

await mkdir(stagingDir, { recursive: true });
for (const [groupIndex, sources] of photoGroups.entries()) {
  const target = pathFor(groupIndex + 1);
  const candidates = [...sources.map((source) => pathFor(source)), target];
  let selected = null;
  for (const candidate of candidates) {
    if (await exists(resolve(root, candidate))) {
      selected = candidate;
      break;
    }
  }
  if (!selected) throw new Error(`Không tìm thấy ảnh nguồn cho ${target}.`);
  await copyFile(resolve(root, selected), resolve(stagingDir, target.split('/').at(-1)));
}

let html = await readFile(htmlPath, 'utf8');
for (const [source, target] of replacements) html = html.split(source).join(target);
await writeFile(htmlPath, html);

if (await exists(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const writtenTargets = new Set();
  manifest.assets = manifest.assets.flatMap((asset) => {
    const target = replacements.get(asset.localPath);
    if (!target) return [asset];
    if (writtenTargets.has(target)) return [];
    writtenTargets.add(target);
    return [{ ...asset, localPath: target }];
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

for (const name of await readdir(imagesDir)) {
  if (/^photo-\d+\.jpg$/i.test(name)) await unlink(resolve(imagesDir, name));
}
for (const name of await readdir(stagingDir)) await rename(resolve(stagingDir, name), resolve(imagesDir, name));

const remaining = (await readdir(imagesDir)).filter((name) => /^photo-\d+\.jpg$/i.test(name));
const missing = [];
for (const target of new Set(replacements.values())) {
  if (!await exists(resolve(root, target))) missing.push(target);
}
if (remaining.length !== photoGroups.length
  || missing.length
  || [...replacements].some(([source, target]) => source !== target && html.includes(source))) {
  throw new Error('Không thể gộp ảnh cưới an toàn.');
}

console.log(`Đã gộp ${replacements.size} file ảnh thành ${photoGroups.length} ảnh cưới thực tế.`);
