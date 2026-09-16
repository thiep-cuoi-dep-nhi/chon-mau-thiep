#!/usr/bin/env node

/**
 * Tách ảnh cưới và QR cá nhân ra khỏi assets/vendor.
 * Chạy: node scripts/organize-personal-assets.mjs
 */

import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
const vendorDir = resolve(root, 'assets/vendor');
const imagesDir = resolve(root, 'assets/images');
const manifestPath = resolve(vendorDir, 'manifest.json');

// Các ảnh cưới được dùng trong thiệp. Thứ tự tên mới giúp thay ảnh dễ dàng.
const photoSources = [
  '000931e9be58bbb21e93.jpg',
  '0b3e339929825d5b71d8.webp',
  '110a3499000f681bfd4a.jpg',
  '129ec378c6ece82a5097.jpg',
  '1673520a7fc13c70b0ba.jpg',
  '22eb7962783597115ea0.jpg',
  '364b079a0603d07998cb.webp',
  '3725956dc2127c872191.webp',
  '37ba571d671a588ad262.webp',
  '3fd1d533298149fde0cb.jpg',
  '55f4400df6f5d564386c.webp',
  '578d474b3f36c6e80944.jpg',
  '653bbf58e9452e180cda.webp',
  '656aeed946a5c969bc46.webp',
  '8c77334e5aa231d444df.jpg',
  '950e1ec629bc6d21aad3.jpg',
  '9b75b3cf73913ea4a1f9.webp',
  'a527aed7b778c4b932bf.webp',
  'a9b4b115bd5964d164de.webp',
  'acdaf083d1f2217f738a.jpg',
  'c3782f3ba05458d18b55.jpg',
  'c8799c85782fd3414b21.webp',
  'cf2b0a383a7cca87deae.webp',
  'd37c743333e4701dfb4b.webp',
  'd5a8e490caa1eff606f1.jpg',
  'd81c6adca898cb3e14c2.webp',
  'daa9a0d38e9bd5297022.jpg',
  'de0393dd7f39b5563fb6.jpg',
  'e9f355b6b4eea3f8fef6.webp',
  'f16cb5d92e76725d92ee.jpg',
  'fa1b538ba237aba1df20.jpg',
];

const replacements = new Map(
  photoSources.map((source, index) => [
    `assets/vendor/${source}`,
    `assets/images/photo-${String(index + 1).padStart(2, '0')}.jpg`,
  ]),
);

const legacyReplacements = new Map(
  photoSources
    .filter((source) => extname(source).toLowerCase() !== '.jpg')
    .map((source) => [
      `assets/images/photo-${String(photoSources.indexOf(source) + 1).padStart(2, '0')}${extname(source)}`,
      `assets/images/photo-${String(photoSources.indexOf(source) + 1).padStart(2, '0')}.jpg`,
    ]),
);

// Thiệp chỉ có một QR thanh toán. Bản cũ có một ảnh QR trùng lặp ở HTML tĩnh.
const qrSource = 'assets/vendor/c9f67f87f6f43b0e9d8a.jpg';
const duplicateQrSource = 'assets/vendor/1ecd29f15b8b35e4c443.jpg';
const qrTarget = 'assets/images/qr_chure.jpg';
replacements.set(qrSource, qrTarget);
replacements.set(duplicateQrSource, qrTarget);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function convertToJpeg(inputPath, targetPath) {
  const temporaryPath = `${targetPath}.converting.jpg`;
  await execFile('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '100',
    inputPath,
    '--out', temporaryPath,
  ]);
  await rename(temporaryPath, targetPath);
}

await mkdir(imagesDir, { recursive: true });

for (const source of photoSources) {
  const vendorSource = `assets/vendor/${source}`;
  const target = replacements.get(vendorSource);
  const legacyTarget = `assets/images/photo-${String(photoSources.indexOf(source) + 1).padStart(2, '0')}${extname(source)}`;
  const sourcePath = resolve(root, vendorSource);
  const legacyPath = resolve(root, legacyTarget);
  const targetPath = resolve(root, target);
  const inputPath = await exists(sourcePath)
    ? sourcePath
    : await exists(legacyPath)
      ? legacyPath
      : targetPath;

  if (!await exists(inputPath)) throw new Error(`Không tìm thấy ảnh nguồn: ${source}`);
  await convertToJpeg(inputPath, targetPath);
  if (inputPath !== targetPath && await exists(inputPath)) await unlink(inputPath);
}

const qrSourcePath = resolve(root, qrSource);
const qrTargetPath = resolve(root, qrTarget);
const qrInputPath = await exists(qrSourcePath) ? qrSourcePath : qrTargetPath;
if (!await exists(qrInputPath)) throw new Error('Không tìm thấy QR của chú rể.');
await convertToJpeg(qrInputPath, qrTargetPath);
if (qrInputPath !== qrTargetPath && await exists(qrInputPath)) await unlink(qrInputPath);

const duplicateQrPath = resolve(root, duplicateQrSource);
if (await exists(duplicateQrPath)) await unlink(duplicateQrPath);

let html = await readFile(htmlPath, 'utf8');
for (const [source, target] of replacements) html = html.split(source).join(target);
for (const [source, target] of legacyReplacements) html = html.split(source).join(target);
await writeFile(htmlPath, html);

if (await exists(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.assets = manifest.assets.flatMap((asset) => {
    const target = replacements.get(asset.localPath) || legacyReplacements.get(asset.localPath);
    if (!target) return [asset];
    if (asset.localPath === duplicateQrSource) return [];
    return [{ ...asset, localPath: target }];
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const oldReferences = [...replacements.keys(), ...legacyReplacements.keys()].filter((source) => html.includes(source));
const missingTargets = [];
for (const target of new Set(replacements.values())) {
  if (!await exists(resolve(root, target))) missingTargets.push(target);
}
if (oldReferences.length || missingTargets.length) {
  throw new Error('Không thể hoàn tất việc đổi đường dẫn ảnh cá nhân.');
}

console.log(`Đã chuẩn hóa ${photoSources.length} ảnh cưới và 1 QR thành JPG trong thiepcuoi2/assets/images.`);
console.log('Chạy tiếp compact-rendered-photos.mjs để gộp ảnh trùng về tối đa 16 ảnh.');
