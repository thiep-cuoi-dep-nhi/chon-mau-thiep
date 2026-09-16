#!/usr/bin/env node

/**
 * Tải toàn bộ tài nguyên cần để thiệp chạy không cần Internet.
 * Chạy: node scripts/localize-offline.mjs
 * Sau đó: node scripts/organize-personal-assets.mjs && node scripts/compact-rendered-photos.mjs
 * Gỡ riêng liên kết thương hiệu: node scripts/localize-offline.mjs --strip-external-brand-links
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
const vendorDir = resolve(root, 'assets/vendor');
const html = await readFile(htmlPath, 'utf8');
const records = new Map();
const aliases = new Map();
const canonicalMatch = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i);
const sourcePageUrl = canonicalMatch ? new URL(canonicalMatch[1]).href : 'https://api.webcake.io/';
const sourcePageHost = new URL(sourcePageUrl).host;

function removeExternalBrandLinks(markup) {
  return markup
    .replace(
      /,"events":\[\{"action":"open_link","appTarget":"","hoverColor":"","id":"[^"]+","target":"https:\/\/(?:www\.)?(?:thiepcuoikimngoc\.[^"]+|facebook\.com\/thiepcuoi[^"]*)","type":"click"\}\]/gi,
      '',
    )
    .replace(
      /<a\s+href="https:\/\/(?:www\.)?(?:thiepcuoikimngoc\.[^"]+|facebook\.com\/thiepcuoi[^"]*)"\s+title="[^"]*"\s+([^>]*)>([\s\S]*?)<\/a>/gi,
      '<div $1>$2</div>',
    );
}

if (process.argv.includes('--strip-external-brand-links')) {
  const cleanedHtml = removeExternalBrandLinks(html);
  await writeFile(htmlPath, cleanedHtml);
  console.log(cleanedHtml === html ? 'Không tìm thấy liên kết thương hiệu ngoài để gỡ.' : 'Đã gỡ các liên kết thương hiệu ngoài.');
  process.exit(0);
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function extensionFor(url) {
  const parsed = new URL(url);
  if (parsed.host === 'fonts.googleapis.com') return '.css';
  if (parsed.pathname.startsWith('/webcake/v4/')) return '.js';
  if (/\.css$/i.test(parsed.pathname)) return '.css';
  const extension = extname(parsed.pathname).toLowerCase();
  return extension || '.bin';
}

function localPathFor(url) {
  return `assets/vendor/${shortHash(url)}${extensionFor(url)}`;
}

function isDownloadable(url) {
  const parsed = new URL(url);
  if (['statics.pancake.vn', 'content.pancake.vn', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(parsed.host)) return parsed.pathname !== '/';
  if (parsed.host === sourcePageHost && parsed.pathname.startsWith('/webcake/v4/')) return true;
  if (parsed.host === 'api.webcake.io') return /\.(?:css|js)(?:$|\?)/i.test(parsed.pathname);
  return false;
}

function add(url, alias = null) {
  const canonical = new URL(url).href;
  if (!isDownloadable(canonical)) return;
  if (!records.has(canonical)) {
    records.set(canonical, {
      url: canonical,
      localPath: localPathFor(canonical),
      absolutePath: resolve(root, localPathFor(canonical)),
      responseUrl: canonical,
      contentType: '',
      css: false,
    });
  }
  if (alias) aliases.set(alias, canonical);
}

function extractUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)]
    .map((match) => match[0].replace(/[;,]+$/, ''));
}

for (const url of extractUrls(html)) add(url);

// Runtime Webcake là URL tương đối; khi mở file offline nó sẽ không tự tìm được.
for (const match of html.matchAll(/\b(?:src|href)=["'](\/webcake\/v4\/[^"']+)["']/gi)) {
  const relativeUrl = match[1];
  add(new URL(relativeUrl, sourcePageUrl).href, relativeUrl);
}

async function download(record) {
  const response = await fetch(record.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    // Một số ảnh Open Graph cũ đã bị xóa ở nguồn. Bỏ tham chiếu đó để
    // trang offline không còn cố gọi mạng, nhưng vẫn tiếp tục tải tài nguyên khác.
    if ([404, 410].includes(response.status)) {
      record.skipped = true;
      record.error = `${response.status} ${response.statusText}`;
      return;
    }
    throw new Error(`${response.status} ${response.statusText} — ${record.url}`);
  }

  await mkdir(dirname(record.absolutePath), { recursive: true });
  await writeFile(record.absolutePath, new Uint8Array(await response.arrayBuffer()));
  record.responseUrl = response.url;
  record.contentType = response.headers.get('content-type') || '';
  record.css = /\.css(?:$|\?)/i.test(record.url) || /text\/css/i.test(record.contentType);
}

function cssUrls(text, baseUrl) {
  const urls = [];
  const matcher = /url\(\s*(['"]?)([^'"\s)]+)\1\s*\)|@import\s+(?:url\(\s*)?(['"])([^'"]+)\3\s*\)?/gi;
  for (const match of text.matchAll(matcher)) {
    const value = match[2] || match[4];
    if (!value || /^(?:data:|#|blob:)/i.test(value)) continue;
    try {
      urls.push(new URL(value, baseUrl).href);
    } catch {
      // Giá trị CSS không phải URL có thể được bỏ qua.
    }
  }
  return urls;
}

const pending = [...records.values()];
for (let index = 0; index < pending.length; index += 1) {
  const record = pending[index];
  if (index === 0 || (index + 1) % 10 === 0 || index + 1 === pending.length) {
    process.stdout.write(`Tải ${index + 1}/${pending.length}\n`);
  }
  await download(record);
  if (record.skipped || !record.css) continue;
  const css = await readFile(record.absolutePath, 'utf8');
  for (const url of cssUrls(css, record.responseUrl)) {
    const before = records.size;
    add(url);
    if (records.size > before) pending.push(records.get(new URL(url).href));
  }
}
process.stdout.write(`Tải ${pending.length}/${pending.length} hoàn tất.\n`);

for (const record of records.values()) {
  if (record.skipped || !record.css) continue;
  const css = await readFile(record.absolutePath, 'utf8');
  const rewritten = css.replace(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/gi, (whole, quote, value) => {
    if (/^(?:data:|#|blob:)/i.test(value)) return whole;
    try {
      const dependency = records.get(new URL(value, record.responseUrl).href);
      if (!dependency) return whole;
      if (dependency.skipped) return 'none';
      const localPath = relative(dirname(record.localPath), dependency.localPath).replaceAll('\\', '/');
      return `url(${quote}${localPath}${quote})`;
    } catch {
      return whole;
    }
  });
  await writeFile(record.absolutePath, rewritten);
}

let localizedHtml = html;
for (const record of [...records.values()].sort((left, right) => right.url.length - left.url.length)) {
  localizedHtml = localizedHtml.split(record.url).join(record.skipped ? '' : record.localPath);
}
for (const [alias, canonical] of aliases) {
  const record = records.get(canonical);
  localizedHtml = localizedHtml.split(alias).join(record.skipped ? '' : record.localPath);
}

// Bản đồ nhúng cần tải tile từ Google nên không thể hữu ích khi không có mạng.
// Nút “Xem Chỉ Đường” vẫn giữ nguyên để dùng khi thiết bị có Internet.
localizedHtml = removeExternalBrandLinks(localizedHtml)
  .replace(/\s*<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>\s*/gi, '\n')
  .replace(/\s*<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>\s*/gi, '\n')
  .replace(/<iframe\b[^>]*\bsrc=["']https:\/\/www\.google\.com\/maps\/embed[^>]*>[\s\S]*?<\/iframe>/gi, '<p class="offline-map-note">Bản đồ trực tuyến sẽ hiển thị khi có Internet.</p>')
  .replace(/&lt;iframe\b[\s\S]*?https:\/\/www\.google\.com\/maps\/embed[\s\S]*?&lt;\/iframe&gt;/gi, '&lt;p class=&quot;offline-map-note&quot;&gt;Bản đồ trực tuyến sẽ hiển thị khi có Internet.&lt;/p&gt;')
  .replace(/\s*<link\b[^>]*\brel=["'](?:dns-prefetch|preconnect)["'][^>]*>\s*/gi, '\n')
  .replace(/\s*<script\s+async\s+src=["']https:\/\/a\.pancake\.vn\/js\/fingerprint\.js["']><\/script>\s*/gi, '\n');

// Webcake đã có event_data trong HTML; tắt các đồng bộ nền để không gọi mạng.
for (const record of records.values()) {
  if (!/\/webcake\/v4\//.test(new URL(record.url).pathname)) continue;
  let runtime = await readFile(record.absolutePath, 'utf8');
  runtime = runtime.replace(
    /this\.runtime\.host=1!==this\.CONST\.TYPE\?"https:\/\/api\.webcake\.io":window\.location\.href\.includes\("preview\.staging\.webcake\.io"\)\?"https:\/\/api\.staging\.webcake\.io":window\.location\.href\.includes\("www\.webcake\.me"\)\|\|window\.location\.href\.includes\("localhost"\)\?"https:\/\/api\.webcake\.io":"",/,
    'this.runtime.host="",',
  );
  const syncStart = runtime.indexOf('function y(){var e=this,t="".concat(this.runtime.host,"/sync/")');
  const syncEnd = syncStart === -1 ? -1 : runtime.indexOf('function w(', syncStart);
  if (syncStart !== -1 && syncEnd !== -1) runtime = `${runtime.slice(0, syncStart)}function y(){}${runtime.slice(syncEnd)}`;
  await writeFile(record.absolutePath, runtime);
}

const remoteImport = /<script\b[^>]*\bsrc=["']https?:\/\/|<link\b(?=[^>]*\brel=["'](?:stylesheet|preload|icon)["'])[^>]*\bhref=["']https?:\/\/|url\(\s*["']?https?:\/\/|@import\s+(?:url\(\s*)?["']?https?:\/\//i;
if (remoteImport.test(localizedHtml)) {
  throw new Error('Còn import từ Internet trong index.html; không ghi file để tránh bản offline không hoàn chỉnh.');
}

await mkdir(vendorDir, { recursive: true });
await Promise.all([
  writeFile(htmlPath, localizedHtml),
  writeFile(
    resolve(vendorDir, 'manifest.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), assets: [...records.values()].map(({ localPath, contentType, skipped, error }) => ({ localPath, contentType, skipped: Boolean(skipped), error: error || null })) }, null, 2)}\n`,
  ),
]);

const skipped = [...records.values()].filter((record) => record.skipped);
console.log(`Đã nội địa hóa ${records.size - skipped.length}/${records.size} tài nguyên vào thiepcuoi2/assets/vendor.`);
if (skipped.length) console.log(`Đã bỏ ${skipped.length} URL nguồn không còn tồn tại để tránh yêu cầu mạng.`);
