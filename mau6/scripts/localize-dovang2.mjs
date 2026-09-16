#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const htmlPath = resolve(root, 'index.html');
const vendorDir = resolve(root, 'assets/vendor');
// The page is now fully self-contained; no template runtime is downloaded.
const runtimeUrl = null;

const html = await readFile(htmlPath, 'utf8');
const records = new Map();

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function isDownloadable(url) {
  const { host, pathname } = new URL(url);
  if (['statics.pancake.vn', 'content.pancake.vn'].includes(host)) return pathname !== '/';
  if (host === 'api.webcake.io') return /\.(?:css|js)$/i.test(pathname);
  if (host === 'fonts.googleapis.com') return pathname !== '/';
  if (host === 'fonts.gstatic.com') return pathname !== '/';
  return runtimeUrl !== null && url === runtimeUrl;
}

function extensionFor(url) {
  const { host, pathname } = new URL(url);
  if (url === runtimeUrl) return '.js';
  if (host === 'fonts.googleapis.com' || /\.css$/i.test(pathname)) return '.css';
  const extension = extname(pathname).toLowerCase();
  return extension || '.bin';
}

function localPathFor(url) {
  return `assets/vendor/${hash(url)}${extensionFor(url)}`;
}

function add(url) {
  const canonical = new URL(url).href;
  if (!isDownloadable(canonical) || records.has(canonical)) return;
  records.set(canonical, {
    url: canonical,
    localPath: localPathFor(canonical),
    absolutePath: resolve(root, localPathFor(canonical)),
    responseUrl: canonical,
    contentType: '',
    css: false,
  });
}

for (const match of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) add(match[0].replace(/[;,]+$/, ''));
if (runtimeUrl) add(runtimeUrl);

async function download(record) {
  const response = await fetch(record.url, { redirect: 'follow', signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(record.absolutePath), { recursive: true });
  await writeFile(record.absolutePath, bytes);
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
      // Ignore CSS values that are not URLs.
    }
  }
  return urls;
}

const pending = [...records.values()];
for (let index = 0; index < pending.length; index += 1) {
  const record = pending[index];
  process.stdout.write(`Downloading ${index + 1}/${pending.length}: ${record.url}\n`);
  await download(record);
  if (!record.css) continue;
  const css = await readFile(record.absolutePath, 'utf8');
  for (const url of cssUrls(css, record.responseUrl)) {
    const before = records.size;
    add(url);
    if (records.size > before) pending.push(records.get(url));
  }
}

function rewriteCss(record) {
  return readFile(record.absolutePath, 'utf8').then(async (css) => {
    const rewritten = css.replace(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/gi, (whole, quote, value) => {
      if (/^(?:data:|#|blob:)/i.test(value)) return whole;
      try {
        const dependency = records.get(new URL(value, record.responseUrl).href);
        if (!dependency) return whole;
        const path = relative(dirname(record.localPath), dependency.localPath).replaceAll('\\', '/');
        return `url(${quote}${path}${quote})`;
      } catch {
        return whole;
      }
    });
    await writeFile(record.absolutePath, rewritten);
  });
}

for (const record of records.values()) {
  if (record.css) await rewriteCss(record);
}

const runtime = runtimeUrl ? records.get(runtimeUrl) : null;
if (runtime) {
  let script = await readFile(runtime.absolutePath, 'utf8');
  script = script.replace(
    /this\.runtime\.host=1!==this\.CONST\.TYPE\?"https:\/\/api\.webcake\.io":window\.location\.href\.includes\("preview\.staging\.webcake\.io"\)\?"https:\/\/api\.staging\.webcake\.io":window\.location\.href\.includes\("www\.webcake\.me"\)\|\|window\.location\.href\.includes\("localhost"\)\?"https:\/\/api\.webcake\.io":"",/,
    'this.runtime.host="",',
  );
  const syncStart = script.indexOf('function y(){var e=this,t="".concat(this.runtime.host,"/sync/")');
  const syncEnd = syncStart === -1 ? -1 : script.indexOf('function w(', syncStart);
  if (syncStart !== -1 && syncEnd !== -1) {
    script = `${script.slice(0, syncStart)}function y(){}${script.slice(syncEnd)}`;
  }
  await writeFile(runtime.absolutePath, script);
}

let localizedHtml = html;
for (const record of [...records.values()].sort((a, b) => b.url.length - a.url.length)) {
  localizedHtml = localizedHtml.split(record.url).join(record.localPath);
}

const weddingPhotoAliases = {
  'assets/vendor/a9eecb4c42639bcdd874.jpg': 'assets/images/photo-01.jpg',
  'assets/vendor/94fe6d7b5ae1a470dad3.jpg': 'assets/images/photo-01.jpg',
  'assets/vendor/0b8690c49f3c39051e00.jpg': 'assets/images/photo-02.jpg',
  'assets/vendor/7bd88fc3ea98a3c7c1c3.jpg': 'assets/images/photo-03.jpg',
  'assets/vendor/b5e25691b34227adfdc6.jpg': 'assets/images/photo-04.jpg',
  'assets/vendor/9ae2f8e0be4edc7dec38.jpg': 'assets/images/photo-05.jpg',
  'assets/vendor/393ca2572fbfae724cbe.jpg': 'assets/images/photo-05.jpg',
  'assets/vendor/56795978b16435408a01.jpg': 'assets/images/photo-06.jpg',
  'assets/vendor/c04e856d2c6b42cdc153.jpg': 'assets/images/photo-06.jpg',
  'assets/vendor/18531562e0202e0cb362.jpg': 'assets/images/photo-07.jpg',
  'assets/vendor/859d586d9165061ab981.jpg': 'assets/images/photo-08.jpg',
  'assets/vendor/6302dcad9c968c8546cf.jpg': 'assets/images/photo-08.jpg',
  'assets/vendor/31c98070cf360433b3e4.jpg': 'assets/images/photo-08.jpg',
};
for (const [from, to] of Object.entries(weddingPhotoAliases)) {
  localizedHtml = localizedHtml.split(from).join(to);
}

localizedHtml = localizedHtml
  .replace(/\s*<link\b[^>]*\brel=["'](?:dns-prefetch|preconnect)["'][^>]*>\s*/gi, '\n')
  .replace(/\s*<img height="1" width="1" alt="" style="display:none" src="\/page_view\.gif\?pid=[^"]+"\s*\/>\s*/gi, '\n')
  .replace(/\s*<script async src="https:\/\/a\.pancake\.vn\/js\/fingerprint\.js"><\/script>\s*/gi, '\n');

await writeFile(htmlPath, localizedHtml);
await writeFile(
  resolve(vendorDir, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), assets: [...records.values()].map(({ url, localPath, contentType }) => ({ url, localPath, contentType })) }, null, 2)}\n`,
);

console.log(`\nLocalized ${records.size} resources into assets/vendor.`);
