#!/usr/bin/env node

/**
 * Đồng bộ thiepcuoi3 từ info.json và images-update3.
 *
 * Chạy tại thư mục chứa file này:
 *   node update-thiepcuoi3.mjs
 *   node update-thiepcuoi3.mjs --dry-run
 *   node update-thiepcuoi3.mjs --info /duong-dan/info-khac.json
 *
 * Mẫu 3 dùng 15 ảnh photo và 2 mã QR từ bộ ảnh riêng của mẫu 3.
 */

import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const infoFlagIndex = args.indexOf('--info');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Cách dùng:
  node update-thiepcuoi3.mjs
  node update-thiepcuoi3.mjs --dry-run
  node update-thiepcuoi3.mjs --info /duong-dan/info-khac.json

Tool cập nhật thiepcuoi3/index.html, đồng bộ 15 ảnh photo-01.jpg đến
photo-15.jpg và hai QR qr_chure.jpg, qr_codau.jpg từ images-update3.`);
  process.exit(0);
}

if (infoFlagIndex !== -1 && !args[infoFlagIndex + 1]) {
  throw new Error('Thiếu đường dẫn sau --info.');
}
const unsupportedArgs = args.filter((arg, index) => (
  arg !== '--dry-run' && arg !== '--info' && index !== infoFlagIndex + 1
));
if (unsupportedArgs.length) {
  throw new Error(`Tham số không hỗ trợ: ${unsupportedArgs.join(', ')}.`);
}

const infoPath = infoFlagIndex === -1
  ? resolve(toolDir, 'info.json')
  : resolve(process.cwd(), args[infoFlagIndex + 1]);
const invitationDir = resolve(toolDir, 'thiepcuoi3');
const htmlPath = resolve(invitationDir, 'index.html');
const sourceImagesDir = resolve(toolDir, 'images-update3');
const targetImagesDir = resolve(invitationDir, 'assets/images');
const vendorDir = resolve(invitationDir, 'assets/vendor');
const targetPhotoFiles = [
  'photo-start.jpg', 'photo-re.jpg', 'photo-dau.jpg', 'photo-phong1.jpg', 'photo-ngang1.jpg',
  'photo-phong2.jpg', 'photo-ngang2.jpg', 'photo-phong3.jpg', 'photo-phong4.jpg', 'photo-end.jpg',
  'photo-album-01.jpg', 'photo-album-02.jpg', 'photo-album-03.jpg', 'photo-album-04.jpg', 'photo-album-05.jpg',
];
const photoCount = targetPhotoFiles.length;
const managedImages = [
  ...targetPhotoFiles,
  'qr_chure.jpg',
  'qr_codau.jpg',
];
const imageMappings = managedImages.map((file) => ({ source: file, target: file }));

function requiredString(source, key) {
  const value = source[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`info.json thiếu trường "${key}" hoặc giá trị không hợp lệ.`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`Trường "${key}" không được để trống.`);
  return normalized;
}

function optionalString(source, key) {
  const value = source[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function parseDate(value, key) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Trường "${key}" phải theo định dạng dd/mm/yyyy.`);
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new Error(`Trường "${key}" không phải ngày hợp lệ.`);
  }
  return { day, month, year };
}

function parseTime(value, key) {
  const match = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})$/i.exec(value.replaceAll(' ', ''));
  if (!match) throw new Error(`Trường "${key}" phải có dạng 16h00 hoặc 16:00.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Trường "${key}" không phải giờ hợp lệ.`);
  return { hour, minute };
}

function normalizeMapUrl(value, key) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Trường "${key}" không phải URL hợp lệ.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Trường "${key}" chỉ được dùng URL http hoặc https.`);
  }
  return url.href;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlWithBreaks(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function addressWithBreaks(value) {
  const explicitLines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length > 1) return explicitLines.map(escapeHtml).join('<br>');
  const parts = explicitLines[0].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return escapeHtml(value);
  return `${escapeHtml(`${parts.slice(0, -1).join(', ')},`)}<br>${escapeHtml(parts.at(-1))}`;
}

function eventFromInfo(info, number) {
  const date = parseDate(requiredString(info, `date${number}`), `date${number}`);
  const time = parseTime(requiredString(info, `time${number}`), `time${number}`);
  return {
    ...date,
    ...time,
    date: requiredString(info, `date${number}`),
    time: requiredString(info, `time${number}`),
    dayName: requiredString(info, `day${number}`),
    lunarDate: requiredString(info, `date${number}_am`),
  };
}

function invitationData(info) {
  return {
    groom: requiredString(info, 'chu_re'),
    bride: requiredString(info, 'co_dau'),
    event1: eventFromInfo(info, 1),
    event2: eventFromInfo(info, 2),
    locations: {
      re: {
        title: 'TẠI: TƯ GIA NHÀ TRAI',
        address: requiredString(info, 'diachi_chu_re'),
        map: normalizeMapUrl(requiredString(info, 'map_chu_re'), 'map_chu_re'),
      },
      dau: {
        title: 'TẠI: TƯ GIA NHÀ GÁI',
        address: requiredString(info, 'diachi_co_dau'),
        map: normalizeMapUrl(requiredString(info, 'map_co_dau'), 'map_co_dau'),
      },
    },
    accounts: {
      groom: {
        number: optionalString(info, 'account_number_chu_re'),
        bank: optionalString(info, 'account_bank_chu_re'),
        name: optionalString(info, 'account_name_chu_re'),
      },
      bride: {
        number: optionalString(info, 'account_number_co_dau'),
        bank: optionalString(info, 'account_bank_co_dau'),
        name: optionalString(info, 'account_name_co_dau'),
      },
    },
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceOne(html, pattern, replacement, label) {
  let count = 0;
  const output = html.replace(pattern, (...matches) => {
    count += 1;
    if (typeof replacement === 'function') return replacement(...matches);
    // String.replace chỉ mở rộng $1, $2... khi chuỗi thay thế được truyền trực
    // tiếp. Hàm đếm ở đây cần callback, vì vậy ta mở rộng các capture thủ công.
    return replacement.replace(/\$(\d{1,2})/g, (_token, index) => matches[Number(index)] ?? '');
  });
  if (count !== 1) throw new Error(`Không thể cập nhật ${label}: tìm thấy ${count} vị trí.`);
  return output;
}

function setText(html, id, content) {
  const pattern = new RegExp(
    `(<div\\s+id=["']${escapeRegex(id)}["'][^>]*>\\s*<(h[1-6]|p)\\b[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    'i',
  );
  return replaceOne(
    html,
    pattern,
    (_whole, opening, _tag, closing) => `${opening}${htmlWithBreaks(content)}${closing}`,
    `nội dung ${id}`,
  );
}

function setParagraph(html, id, content) {
  const pattern = new RegExp(
    `(<div\\s+id=["']${escapeRegex(id)}["'][^>]*>\\s*<div\\s+class=["'][^"']*ladi-paragraph[^"']*["'][^>]*>)[\\s\\S]*?(<\\/div>)`,
    'i',
  );
  return replaceOne(
    html,
    pattern,
    (_whole, opening, closing) => `${opening}${htmlWithBreaks(content)}${closing}`,
    `nội dung ${id}`,
  );
}

function setAnchorHref(html, id, href) {
  const pattern = new RegExp(`<a\\b[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*>`, 'i');
  return replaceOne(html, pattern, (tag) => {
    const quotedUrl = `href="${escapeHtml(href)}"`;
    if (/\bhref=["'][^"']*["']/i.test(tag)) {
      return tag.replace(/\bhref=["'][^"']*["']/i, quotedUrl);
    }
    return tag.replace(/>$/, ` ${quotedUrl}>`);
  }, `liên kết ${id}`);
}

function replaceBackground(html, selector, localPath, label) {
  const pattern = new RegExp(
    `(${escapeRegex(selector)}\\s*(?:,[^{]*)?\\{[^}]*?background-image\\s*:\\s*url\\(["']?)[^"')]+(["']?\\))`,
    'i',
  );
  return replaceOne(html, pattern, (_whole, opening, closing) => `${opening}${localPath}${closing}`, label);
}

function setCalendarText(html, id, content) {
  const pattern = new RegExp(
    `(<div\\s+id=["']${id}["'][^>]*>\\s*<h3\\b[^>]*>)[\\s\\S]*?(<\\/h3>)`,
    'i',
  );
  return replaceOne(
    html,
    pattern,
    (_whole, opening, closing) => `${opening}${htmlWithBreaks(content)}${closing}`,
    `ô lịch ${id}`,
  );
}

function calendarCellIds() {
  return [
    [32, 33, 34, 35, 36, 37, 38],
    [45, 44, 43, 42, 41, 40, 39],
    [46, 47, 48, 49, 50, 51, 52],
    [53, 54, 55, 56, 57, 58, 59],
    [60, 61, 62, 63, 64, 65, 66],
    [67, 68, 69, 70, 71, 72, 73],
  ];
}

function updateStaticCalendar(html, event) {
  html = setText(html, 'HEADLINE24', `Tháng ${String(event.month).padStart(2, '0')} - ${event.year}`);
  const ids = calendarCellIds();
  const firstDay = (new Date(Date.UTC(event.year, event.month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(event.year, event.month, 0)).getUTCDate();
  for (let row = 0; row < ids.length; row += 1) {
    for (let column = 0; column < ids[row].length; column += 1) {
      const day = row * 7 + column - firstDay + 1;
      html = setCalendarText(html, `HEADLINE${ids[row][column]}`, day >= 1 && day <= daysInMonth ? String(day) : '');
    }
  }
  const markedPosition = firstDay + event.day - 1;
  const row = Math.floor(markedPosition / 7);
  const column = markedPosition % 7;
  const left = 0.598057 + column * 53.8949 + 6.654;
  const top = 105.264 + row * 26.947 + -5.777;
  const shapePattern = /(#SHAPE1\{[^}]*?top:\s*)[^;]+(;\s*left:\s*)[^;}]+/i;
  html = replaceOne(
    html,
    shapePattern,
    (_whole, topPrefix, between) => `${topPrefix}${top.toFixed(3)}px${between}${left.toFixed(3)}px`,
    'dấu đánh dấu trong lịch',
  );
  return html;
}

function removeRemoteFormScripts(html) {
  html = html.replace(
    /<div id="HTML_CODE2"[\s\S]*?<\/script><\/div><\/div><div id="HTML_CODE3"/i,
    '<div id="HTML_CODE3"',
  );
  html = html.replace(
    /<script>\s*const API_URL\s*=\s*"https:\/\/script\.google\.com[\s\S]*?<\/script>/i,
    `<script>
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('sendWishBtn');
  const list = document.getElementById('wish-list');
  if (!button || !list) return;
  list.innerHTML = '<div id="loading-message">Bạn có thể gửi lời chúc trực tiếp đến cô dâu chú rể ♥</div>';
  button.addEventListener('click', () => {
    const name = document.getElementById('name')?.value.trim();
    const message = document.getElementById('message')?.value.trim();
    if (!name || !message) return;
    const item = document.createElement('div');
    item.className = 'wish-item';
    const strong = document.createElement('strong');
    const span = document.createElement('span');
    strong.textContent = name;
    span.textContent = message;
    item.append(strong, span);
    list.prepend(item);
    document.getElementById('name').value = '';
    document.getElementById('message').value = '';
  });
});
</script>`,
  );
  return html;
}

function removeWishAndRsvpSections(html) {
  // SECTION7 là "Gửi lời chúc"; SECTION8 là form xác nhận tham dự. Dùng các
  // section liền kề làm mốc để không tác động đến album hoặc phần cảm ơn.
  html = html.replace(/<div id="SECTION7"[\s\S]*?(?=<div id="SECTION6")/i, '');
  html = html.replace(/<div id="SECTION8"[\s\S]*?(?=<div id="SECTION9")/i, '');
  // Popup cảm ơn này chỉ thuộc luồng xác nhận tham dự cũ.
  html = html.replace(/<div id="TKS"[\s\S]*?(?=<div id="backdrop-popup")/i, '');
  return html;
}

function insertGiftEntry(html) {
  html = html.replace(/<!-- thiepcuoi3-gift-entry:start -->[\s\S]*?<!-- thiepcuoi3-gift-entry:end -->/g, '');
  const entry = `<!-- thiepcuoi3-gift-entry:start -->
<div id="SECTION_GIFT_ENTRY" class="ladi-section">
  <div class="ladi-container">
    <button id="GIFT_ENTRY_BUTTON" type="button">Gửi mừng cưới</button>
  </div>
</div>
<!-- thiepcuoi3-gift-entry:end -->`;
  return replaceOne(html, /<div id="SECTION9"/i, (sectionStart) => `${entry}${sectionStart}`, 'vị trí nút gửi mừng cưới');
}

function stripMusicAndProtection(html) {
  return html.replace(
    /<meta charset="UTF-8">\s*<title>Play Music<\/title>[\s\S]*?<\/style><\/head>/i,
    '</head>',
  );
}

function insertLocalMusic(html) {
  // Bản Ladipage gốc chèn cả nhạc qua jsDelivr lẫn đoạn mã chặn thao tác.
  // Xoá riêng bản nhạc đã do tool quản lý trước đó rồi thêm lại tệp MP3 cục bộ,
  // để chạy lại tool không tạo nhiều nút nhạc và vẫn dùng được khi offline.
  html = html.replace(/<!-- thiepcuoi3-music:start -->[\s\S]*?<!-- thiepcuoi3-music:end -->/g, '');
  const music = `<!-- thiepcuoi3-music:start -->
<style id="thiepcuoi3-music-style">
  #thiepcuoi3-music-toggle {
    position: fixed; z-index: 1000000001; left: 20px; bottom: 20px;
    width: 50px; height: 50px; border: 0; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: #600202; color: #fff; box-shadow: 0 5px 14px rgba(0, 0, 0, .28);
    cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  #thiepcuoi3-music-toggle .music-icon { font: 28px/1 Arial, sans-serif; transform: translateY(-1px); }
  #thiepcuoi3-music-toggle.is-playing { animation: thiepcuoi3-music-pulse 1.8s ease-in-out infinite; }
  @keyframes thiepcuoi3-music-pulse { 50% { box-shadow: 0 0 0 8px rgba(96, 2, 2, .16), 0 5px 14px rgba(0, 0, 0, .28); } }
</style>
<audio id="thiepcuoi3-background-music" loop preload="metadata">
  <source src="assets/vendor/i-do-911.mp3" type="audio/mpeg">
</audio>
<button id="thiepcuoi3-music-toggle" type="button" title="Bật nhạc" aria-label="Bật nhạc" aria-pressed="false">
  <span class="music-icon" aria-hidden="true">♪</span>
</button>
<script id="thiepcuoi3-music-runtime">
(() => {
  const audio = document.getElementById('thiepcuoi3-background-music');
  const button = document.getElementById('thiepcuoi3-music-toggle');
  if (!audio || !button) return;
  const sync = () => {
    const playing = !audio.paused;
    button.classList.toggle('is-playing', playing);
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Tắt nhạc' : 'Bật nhạc');
    button.title = playing ? 'Tắt nhạc' : 'Bật nhạc';
  };
  const play = async () => {
    try { await audio.play(); } catch { /* Trình duyệt chỉ cho phép phát sau thao tác người dùng. */ }
    sync();
  };
  const startOnFirstInteraction = (event) => {
    if (button.contains(event.target)) return;
    document.removeEventListener('pointerdown', startOnFirstInteraction);
    play();
  };
  document.addEventListener('pointerdown', startOnFirstInteraction, { passive: true });
  button.addEventListener('click', () => { if (audio.paused) play(); else audio.pause(); });
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  sync();
})();
</script>
<!-- thiepcuoi3-music:end -->`;
  return replaceOne(html, /<\/body>/i, (closingTag) => `${music}${closingTag}`, 'vị trí nhạc nền');
}

function removeOldSocialLinks(html) {
  html = html.replace(
    /<a\b[^>]*href=["']https?:\/\/(?:www\.)?(?:tiktok\.com\/@nhacohyonline|facebook\.com\/thiepcuoionlinenhacohy|zalo\.me\/0397336324)[^"']*["'][\s\S]*?<\/a>/gi,
    '',
  );
  return html
    .replaceAll('https://www.tiktok.com/@nhacohyonline', '#')
    .replaceAll('https://www.facebook.com/thiepcuoionlinenhacohy', '#')
    .replaceAll('https://zalo.me/0397336324', '#')
    .replaceAll('www.nhacohy.vn/mau-seal-premium', '')
    .replaceAll('nhacohy.vn', '');
}

function removeOldGuestParamScript(html) {
  return html.replace(
    /<script>\s*document\.addEventListener\("DOMContentLoaded", function \(\) \{\s*const params = new URLSearchParams\(window\.location\.search\);\s*const rawName = params\.get\("name"\);[\s\S]*?<\/script>/i,
    '',
  );
}

function localizeVendorUrls(html) {
  const localAssets = new Map([
    ['https://w.ladicdn.com/v5/source/ladipagev3.min.js?v=1786939486448', 'assets/vendor/ladipagev3.min.js'],
    ['https://w.ladicdn.com/source/ladipage-play.svg?v=1.0', 'assets/vendor/ladipage-play.svg'],
    ['https://w.ladicdn.com/689218c23c46d40012eac1e2/alexbrush-regular-20250925122923--qmyo.ttf', 'assets/vendor/alexbrush-regular.ttf'],
    ['https://w.ladicdn.com/689218c23c46d40012eac1e2/vl-brown-sugar-20250828055605-9uqqi.ttf', 'assets/vendor/brown-sugar.ttf'],
    ['https://w.ladicdn.com/689218c23c46d40012eac1e2/vl_greatvibes-regular-20250808042626-smxug.otf', 'assets/vendor/great-vibes.otf'],
    ['https://w.ladicdn.com/s750x750/689218c23c46d40012eac1e2/3-20260706163654-k05ha.png', 'assets/vendor/cover-seal.png'],
    ['https://w.ladicdn.com/s750x600/689218c23c46d40012eac1e2/2-2-20260706171725-qcndz.png', 'assets/vendor/cover-bottom.png'],
    ['https://w.ladicdn.com/s750x600/689218c23c46d40012eac1e2/1-20260706163654-edxui.png', 'assets/vendor/cover-top.png'],
    ['https://w.ladicdn.com/s450x450/689218c23c46d40012eac1e2/chu-hy-20251011093428-krrsx.png', 'assets/vendor/celebrate.png'],
    ['https://w.ladicdn.com/s400x400/689218c23c46d40012eac1e2/chitay-20251011070200-e9b-l.png', 'assets/vendor/hand.png'],
    ['https://w.ladicdn.com/s700x900/689218c23c46d40012eac1e2/khungthiep-20251011065832-qtytj.png', 'assets/vendor/invitation-frame.png'],
    ['https://w.ladicdn.com/s750x700/689218c23c46d40012eac1e2/thu-20251011065832-kaqdv.png', 'assets/vendor/thank-you.png'],
    ['https://w.ladicdn.com/689218c23c46d40012eac1e2/trai-20260705175210-b5krk.png', 'assets/vendor/door-left.png'],
    ['https://w.ladicdn.com/689218c23c46d40012eac1e2/phai-20260705175210-anyil.png', 'assets/vendor/door-right.png'],
  ]);
  for (const [remote, local] of localAssets) html = html.replaceAll(remote, local);

  html = html
    .replace(/<link\b[^>]*(?:rel=["'](?:preconnect|preload)["']|href=["']https:\/\/fonts\.googleapis\.com[^"']*)[^>]*>/gi, '')
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.googleapis\.com[^"']*[^>]*>/gi, '')
    .replace(/<!--\[if lt IE 9\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replaceAll("window.LadiPageScript.runtime.cdn_url = 'https://w.ladicdn.com/v5/source/';", "window.LadiPageScript.runtime.cdn_url = 'assets/vendor/';")
    .replaceAll('window.LadiPageScript.runtime.formdata = true;', 'window.LadiPageScript.runtime.formdata = false;')
    .replaceAll('window.LadiPageScript.runtime.tracking_button_click = true;', 'window.LadiPageScript.runtime.tracking_button_click = false;')
    .replaceAll('https://w.ladicdn.com/v5/source/', 'assets/vendor/');
  return html;
}

function localizePersonalImages(html) {
  const photo = (index) => `assets/images/${targetPhotoFiles[index]}`;
  const directImages = new Map([
    ['#IMAGE1 > .ladi-image > .ladi-image-background', photo(0)],
    ['#IMAGE9 > .ladi-image > .ladi-image-background', photo(1)],
    ['#IMAGE10 > .ladi-image > .ladi-image-background', photo(2)],
    ['#IMAGE12 > .ladi-image > .ladi-image-background', photo(3)],
    ['#IMAGE13 > .ladi-image > .ladi-image-background', photo(4)],
    ['#IMAGE15 > .ladi-image > .ladi-image-background', photo(5)],
    ['#IMAGE16 > .ladi-image > .ladi-image-background', photo(6)],
    ['#IMAGE17 > .ladi-image > .ladi-image-background', photo(7)],
    ['#IMAGE19 > .ladi-image > .ladi-image-background', photo(8)],
    ['#IMAGE21 > .ladi-image > .ladi-image-background', photo(9)],
  ]);
  if (new Set(directImages.values()).size !== directImages.size) {
    throw new Error('Mapping ảnh trực tiếp của mẫu 3 bị trùng; mỗi vị trí phải dùng một ảnh riêng.');
  }
  for (const [selector, path] of directImages) html = replaceBackground(html, selector, path, selector);
  for (let index = 0; index < targetPhotoFiles.length; index += 1) {
    const path = photo(index);
    html = replaceBackground(html, `#GALLERY1 .ladi-gallery .ladi-gallery-view-item[data-index="${index}"]`, path, `ảnh album ${index + 1}`);
    html = replaceBackground(html, `#GALLERY1 .ladi-gallery .ladi-gallery-control-item[data-index="${index}"]`, path, `ảnh thu nhỏ album ${index + 1}`);
  }
  return html;
}

function disableNativeCountdown(html) {
  // Ladipage tự khởi tạo một countdown khác. Thiệp cần đếm theo ngay=1|2,
  // nên chỉ để runtime của thiệp cập nhật các ô để không bị hai timer ghi đè.
  return html
    .replace(/"COUNTDOWN1":\{"a":"countdown"[^}]*\}/g, '"COUNTDOWN1":{"a":"group"}')
    .replace(/"COUNTDOWN_ITEM([1-4])":\{"a":"countdown_item"[^}]*\}/g, '"COUNTDOWN_ITEM$1":{"a":"group"}');
}

function removePreviousRuntime(html) {
  return html.replace(/<!-- thiepcuoi3-runtime:start -->[\s\S]*?<!-- thiepcuoi3-runtime:end -->/g, '');
}

function clientRuntime(data) {
  const payload = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('</script', '<\\/script');
  return `<!-- thiepcuoi3-runtime:start -->
<style id="thiepcuoi3-runtime-style">
  #HEADLINE6 { width: 370px !important; left: .5px !important; }
  #HEADLINE6 > .ladi-headline { white-space: normal; font-size: 18px !important; line-height: 1.6 !important; text-align: center !important; }
  #HEADLINE21 { display: block !important; width: 370px !important; left: .5px !important; }
  #HEADLINE21 > .ladi-headline { font-family: QWxleEJydXNoLVJlZVsYXIudHRm !important; font-size: 38px !important; font-weight: 400 !important; font-style: normal !important; line-height: 1.25 !important; color: rgb(96, 2, 2) !important; text-decoration: none !important; text-align: center !important; }
  /* Chừa một dòng rõ ràng dưới tên khách; dời phần nội dung phía dưới cùng
     khoảng cách tương ứng để không chồng lên tên cô dâu/chú rể hoặc ngày giờ. */
  #HEADLINE11 { top: 159.424px !important; }
  #HEADLINE8 { top: 205.353px !important; }
  #HEADLINE9 { top: 285.353px !important; }
  #HEADLINE10 { top: 264.353px !important; }
  #HEADLINE12 { top: 365.353px !important; }
  #HEADLINE13, #HEADLINE14 { top: 400.853px !important; }
  #LINE2, #LINE3 { top: 393.853px !important; }
  #HEADLINE15 { top: 378.853px !important; }
  #HEADLINE16 { top: 434.353px !important; }
  #HEADLINE17 { top: 459.424px !important; }
  #HEADLINE18 { top: 488.424px !important; }
  #BUTTON2 { top: 550.353px !important; }
  /* Biểu tượng định vị nằm ở mép trái nút; đẩy riêng nhãn sang phải để không chồng lên biểu tượng. */
  #BUTTON_TEXT2 > .ladi-headline { transform: translateX(11px); }
  /* Ảnh xuất hiện sau khi nhấn mở thiệp: chậm hơn nhẹ để chuyển cảnh dịu hơn. */
  #IMAGE1.ladi-animation > .ladi-image { animation-duration: 2s !important; }
  /* Hai ảnh ngang có cùng tỷ lệ với khung: phủ kín khung, không hở khoảng trắng. */
  #IMAGE13 > .ladi-image > .ladi-image-background,
  #IMAGE16 > .ladi-image > .ladi-image-background {
    width: 200px !important;
    height: 135px !important;
    top: 0 !important;
    left: 0 !important;
    background-size: cover !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
  }
  #HEADLINE18 > .ladi-headline { white-space: pre-line; }
  .calendar-selected > .ladi-headline { color: #fff !important; }
  /* QR phải là hình vuông; không được kéo dọc hoặc cắt mất vùng quiet zone. */
  #IMAGE22, #IMAGE23 { width: 169.879px !important; height: 169.879px !important; }
  #IMAGE22 > .ladi-image > .ladi-image-background, #IMAGE23 > .ladi-image > .ladi-image-background { background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; }
  #IMAGE22 > .ladi-image > .ladi-image-background { background-image: url("assets/images/qr_chure.jpg") !important; }
  #IMAGE23 > .ladi-image > .ladi-image-background { background-image: url("assets/images/qr_codau.jpg") !important; }
  #BUTTON7 > .ladi-button > .ladi-button-background, #BUTTON9 > .ladi-button > .ladi-button-background { background-color: #600202 !important; }
  #BUTTON_TEXT7 > .ladi-headline, #BUTTON_TEXT9 > .ladi-headline { color: #fff !important; }
  /* Bỏ dải thương hiệu/footer vốn đè lên ảnh cảm ơn. */
  #GROUP11 { display: none !important; }
  #SECTION_GIFT_ENTRY { height: 126px; background: #fffaf7; }
  #SECTION_GIFT_ENTRY .ladi-container { width: 420px; height: 126px; display: flex; align-items: center; justify-content: center; }
  #GIFT_ENTRY_BUTTON { border: 0; border-radius: 26px; min-width: 224px; padding: 14px 28px; background: #600202; color: #fff; font: 700 18px "Maven Pro", sans-serif; cursor: pointer; box-shadow: 0 8px 18px rgba(96, 2, 2, .28); }
  #GIFT_ENTRY_BUTTON:active { transform: translateY(2px); }
  #GIFT_POPUP_CLOSE { position: absolute; z-index: 9000000090; top: 8px; right: 8px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: #600202; color: #fff; font-size: 24px; line-height: 26px; cursor: pointer; }
</style>
<script id="thiepcuoi3-runtime">
(() => {
  const data = ${payload};
  const params = new URLSearchParams(window.location.search);
  const guest = (params.get('name') || 'Quý Khách').trim() || 'Quý Khách';
  const event = params.get('ngay') === '1' ? data.event1 : data.event2;
  const location = params.get('addr') === 'dau' ? data.locations.dau : data.locations.re;
  const byId = (id) => document.getElementById(id);
  const textNode = (id) => {
    const el = byId(id);
    return el?.querySelector('h1, h2, h3, h4, h5, h6, p, .ladi-paragraph') || el;
  };
  const setText = (id, value) => { const el = textNode(id); if (el) el.textContent = value; };
  const setHtml = (id, value) => { const el = textNode(id); if (el) el.innerHTML = value; };
  const pad = (value) => String(value).padStart(2, '0');
  const addressLines = (address) => {
    const lines = String(address).split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) return lines.join('\\n');
    const parts = lines[0].split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ',\\n' + parts.at(-1) : String(address);
  };
  const calendarIds = [
    [32, 33, 34, 35, 36, 37, 38], [45, 44, 43, 42, 41, 40, 39],
    [46, 47, 48, 49, 50, 51, 52], [53, 54, 55, 56, 57, 58, 59],
    [60, 61, 62, 63, 64, 65, 66], [67, 68, 69, 70, 71, 72, 73],
  ];
  let countdownTimer;
  const renderCalendar = () => {
    setText('HEADLINE24', 'Tháng ' + pad(event.month) + ' - ' + event.year);
    const firstDay = (new Date(Date.UTC(event.year, event.month - 1, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(event.year, event.month, 0)).getUTCDate();
    calendarIds.flat().forEach((id) => byId('HEADLINE' + id)?.classList.remove('calendar-selected'));
    calendarIds.forEach((row, rowIndex) => row.forEach((id, column) => {
      const day = rowIndex * 7 + column - firstDay + 1;
      setText('HEADLINE' + id, day >= 1 && day <= daysInMonth ? day : '');
      if (day === event.day) byId('HEADLINE' + id)?.classList.add('calendar-selected');
    }));
    const position = firstDay + event.day - 1;
    const row = Math.floor(position / 7);
    const column = position % 7;
    const marker = byId('SHAPE1');
    if (marker) {
      marker.classList.remove('ladi-animation-hidden');
      marker.style.visibility = 'visible';
      marker.style.left = (0.598057 + column * 53.8949 + 6.654).toFixed(3) + 'px';
      marker.style.top = (105.264 + row * 26.947 - 5.777).toFixed(3) + 'px';
    }
  };
  const renderCountdown = () => {
    const target = new Date(event.year, event.month - 1, event.day, event.hour, event.minute, 0).getTime();
    const tick = () => {
      const remaining = Math.max(0, target - Date.now());
      const total = Math.floor(remaining / 1000);
      const values = [Math.floor(total / 86400), Math.floor(total / 3600) % 24, Math.floor(total / 60) % 60, total % 60];
      values.forEach((value, index) => {
        const node = byId('COUNTDOWN_ITEM' + (index + 1))?.querySelector('span');
        if (node) node.textContent = pad(value);
      });
    };
    clearInterval(countdownTimer); tick(); countdownTimer = setInterval(tick, 1000);
  };
  const copyAccount = async (account, textId) => {
    if (!account) return;
    try { await navigator.clipboard.writeText(account); } catch { window.prompt('Sao chép số tài khoản:', account); }
    setText(textId, 'Đã sao chép');
    window.setTimeout(() => setText(textId, 'Sao chép STK'), 1600);
  };
  const downloadQr = (path, filename) => {
    const anchor = document.createElement('a'); anchor.href = path; anchor.download = filename; anchor.click();
  };
  const apply = () => {
    setText('HEADLINE6', 'TRÂN TRỌNG KÍNH MỜI');
    setText('HEADLINE21', guest);
    ['HEADLINE8', 'HEADLINE20', 'HEADLINE356'].forEach((id) => setText(id, data.groom));
    ['HEADLINE9', 'HEADLINE225', 'HEADLINE97'].forEach((id) => setText(id, data.bride));
    setText('HEADLINE12', event.dayName);
    setText('HEADLINE13', event.time);
    setText('HEADLINE14', pad(event.month) + ' - ' + event.year);
    setText('HEADLINE15', event.day);
    setText('HEADLINE16', '(' + event.lunarDate + ')');
    setText('HEADLINE17', location.title);
    setText('HEADLINE18', addressLines(location.address));
    setHtml('HEADLINE98', pad(event.day) + ' . ' + pad(event.month) + '<br>' + event.year);
    setText('BUTTON_TEXT2', 'Xem chỉ đường');
    const mapButton = byId('BUTTON2');
    if (mapButton) {
      mapButton.href = location.map;
      mapButton.addEventListener('click', (click) => {
        click.preventDefault(); click.stopImmediatePropagation(); window.open(location.map, '_blank', 'noopener');
      }, true);
    }
    setText('BUTTON_TEXT6', 'Tải QR'); setText('BUTTON_TEXT7', 'Sao chép STK');
    setText('BUTTON_TEXT8', 'Tải QR'); setText('BUTTON_TEXT9', 'Sao chép STK');
    byId('IMAGE22')?.setAttribute('aria-label', [data.accounts.groom.bank, data.accounts.groom.name].filter(Boolean).join(' - '));
    byId('IMAGE23')?.setAttribute('aria-label', [data.accounts.bride.bank, data.accounts.bride.name].filter(Boolean).join(' - '));
    byId('BUTTON7')?.addEventListener('click', (click) => { click.preventDefault(); click.stopImmediatePropagation(); copyAccount(data.accounts.groom.number, 'BUTTON_TEXT7'); }, true);
    byId('BUTTON9')?.addEventListener('click', (click) => { click.preventDefault(); click.stopImmediatePropagation(); copyAccount(data.accounts.bride.number, 'BUTTON_TEXT9'); }, true);
    byId('BUTTON6')?.addEventListener('click', (click) => { click.preventDefault(); click.stopImmediatePropagation(); downloadQr('assets/images/qr_chure.jpg', 'qr_chure.jpg'); }, true);
    byId('BUTTON8')?.addEventListener('click', (click) => { click.preventDefault(); click.stopImmediatePropagation(); downloadQr('assets/images/qr_codau.jpg', 'qr_codau.jpg'); }, true);
    const giftPopup = byId('HOPMUNGCUOI');
    const giftBackdrop = byId('backdrop-popup');
    const closeGift = () => {
      if (giftPopup) giftPopup.style.display = 'none';
      if (giftBackdrop) giftBackdrop.style.display = 'none';
    };
    if (giftPopup && !byId('GIFT_POPUP_CLOSE')) {
      const closeButton = document.createElement('button');
      closeButton.id = 'GIFT_POPUP_CLOSE'; closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Đóng'); closeButton.textContent = '×';
      closeButton.addEventListener('click', closeGift); giftPopup.append(closeButton);
    }
    byId('GIFT_ENTRY_BUTTON')?.addEventListener('click', () => {
      if (giftPopup) { giftPopup.style.display = 'block'; giftPopup.style.visibility = 'visible'; }
      if (giftBackdrop) giftBackdrop.style.display = 'block';
    });
    giftBackdrop?.addEventListener('click', closeGift);
    renderCalendar(); renderCountdown();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply();
  window.addEventListener('load', apply, { once: true });
})();
</script>
<!-- thiepcuoi3-runtime:end -->`;
}

function updateHtml(source, data) {
  let html = removePreviousRuntime(source);
  html = stripMusicAndProtection(html);
  html = removeRemoteFormScripts(html);
  html = removeWishAndRsvpSections(html);
  html = insertGiftEntry(html);
  html = removeOldSocialLinks(html);
  html = removeOldGuestParamScript(html);
  html = localizeVendorUrls(html);
  html = localizePersonalImages(html);
  html = disableNativeCountdown(html);

  html = html
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["'](?:icon|shortcut icon|apple-touch-icon(?:-precomposed)?)["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']msapplication-TileImage["'][^>]*>/gi, '');
  html = replaceOne(
    html,
    /(<head>[\s\S]*?<title>)[\s\S]*?(<\/title>)/i,
    (_whole, opening, closing) => `${opening}Thiệp cưới ${escapeHtml(data.groom)} &amp; ${escapeHtml(data.bride)}${closing}`,
    'tiêu đề trang',
  );
  html = html
    .replace(/<meta\s+name=["']keywords["'][^>]*>/i, `<meta name="keywords" content="thiệp cưới, thiệp cưới điện tử, ${escapeHtml(data.groom)}, ${escapeHtml(data.bride)}">`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="Thiệp cưới ${escapeHtml(data.groom)} và ${escapeHtml(data.bride)}.">`)
    .replace('<head>', `<head><link rel="icon" href="assets/vendor/cover-seal.png">`);

  html = setText(html, 'HEADLINE8', data.groom);
  html = setText(html, 'HEADLINE9', data.bride);
  html = setText(html, 'HEADLINE20', data.groom);
  html = setText(html, 'HEADLINE225', data.bride);
  html = setText(html, 'HEADLINE356', data.groom);
  html = setText(html, 'HEADLINE97', data.bride);
  html = setText(html, 'HEADLINE6', 'TRÂN TRỌNG KÍNH MỜI');
  html = setText(html, 'HEADLINE21', 'Quý Khách');
  html = setText(html, 'HEADLINE12', data.event2.dayName);
  html = setText(html, 'HEADLINE13', data.event2.time);
  html = setText(html, 'HEADLINE14', `${String(data.event2.month).padStart(2, '0')} - ${data.event2.year}`);
  html = setText(html, 'HEADLINE15', data.event2.day);
  html = setText(html, 'HEADLINE16', `(${data.event2.lunarDate})`);
  html = setText(html, 'HEADLINE17', data.locations.re.title);
  html = replaceOne(
    html,
    /(<div\s+id=["']HEADLINE18["'][^>]*>\s*<h3\b[^>]*>)[\s\S]*?(<\/h3>)/i,
    (_whole, opening, closing) => `${opening}${addressWithBreaks(data.locations.re.address)}${closing}`,
    'địa chỉ mặc định',
  );
  html = setText(html, 'BUTTON_TEXT2', 'Xem chỉ đường');
  html = setText(html, 'HEADLINE84', '');
  html = setText(html, 'BUTTON_TEXT6', 'Tải QR');
  html = setText(html, 'BUTTON_TEXT7', 'Sao chép STK');
  html = setText(html, 'BUTTON_TEXT8', 'Tải QR');
  html = setText(html, 'BUTTON_TEXT9', 'Sao chép STK');
  html = setAnchorHref(html, 'BUTTON2', data.locations.re.map);
  html = html.replaceAll('https://maps.app.goo.gl/qU8MGMhXX64e2Ms16', data.locations.re.map);
  html = setText(html, 'HEADLINE98', `${String(data.event2.day).padStart(2, '0')} . ${String(data.event2.month).padStart(2, '0')}\n${data.event2.year}`);
  html = updateStaticCalendar(html, data.event2);

  html = html.replaceAll('Khánh Ly', data.bride).replaceAll('Văn Bách', data.groom);
  html = html.replaceAll('Thiệp cưới online - Nhà Có Hỷ', `Thiệp cưới của ${data.groom} & ${data.bride}`);
  html = html.replace(/https:\/\/(?:static\.)?ladipage\.net\/[^"'\s)]+/gi, 'assets/vendor/cover-seal.png');
  html = html.replace(/https:\/\/w\.ladicdn\.com\/[^"'\s)]+/gi, '');
  html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/[^"'\s)]+/gi, '');
  html = html.replace(/https:\/\/script\.google\.com\/[^"'\s)]+/gi, '');
  html = insertLocalMusic(html);
  html = replaceOne(html, /<\/body>/i, (closingTag) => `${clientRuntime(data)}${closingTag}`, 'vị trí mã chạy của thiệp');
  return html;
}

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function validateVendor() {
  const requiredVendor = [
    'ladipagev3.min.js', 'ladipage-play.svg', 'alexbrush-regular.ttf', 'brown-sugar.ttf',
    'great-vibes.otf', 'cover-seal.png', 'cover-bottom.png', 'cover-top.png', 'celebrate.png',
    'hand.png', 'invitation-frame.png', 'thank-you.png', 'door-left.png', 'door-right.png',
    'i-do-911.mp3',
  ];
  const missing = [];
  for (const file of requiredVendor) if (!await exists(resolve(vendorDir, file))) missing.push(file);
  if (missing.length) {
    throw new Error(`Thiếu ${missing.length} tài nguyên cục bộ trong thiepcuoi3/assets/vendor: ${missing.join(', ')}.`);
  }
}

async function syncImages() {
  const missing = [];
  for (const { source } of imageMappings) if (!await exists(resolve(sourceImagesDir, source))) missing.push(source);
  if (missing.length) {
    throw new Error(`images-update3 thiếu: ${missing.join(', ')}. Mẫu 3 cần 15 ảnh photo và 2 QR.`);
  }
  const current = await readdir(targetImagesDir, { withFileTypes: true }).catch(() => []);
  const extras = current.filter((entry) => entry.isFile() && !managedImages.includes(entry.name) && entry.name !== '.DS_Store').map((entry) => entry.name);
  const changed = [];
  for (const mapping of imageMappings) {
    const sourcePath = resolve(sourceImagesDir, mapping.source);
    const targetPath = resolve(targetImagesDir, mapping.target);
    if (!await exists(targetPath)) {
      changed.push(mapping);
      continue;
    }
    const [sourceBuffer, targetBuffer] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
    if (!sourceBuffer.equals(targetBuffer)) changed.push(mapping);
  }
  if (dryRun) return { extras, removed: [], copied: changed };

  await mkdir(targetImagesDir, { recursive: true });
  const removed = [];
  for (const entry of current) {
    if (!entry.isFile() || entry.name === '.DS_Store' || managedImages.includes(entry.name)) continue;
    await rm(resolve(targetImagesDir, entry.name));
    removed.push(entry.name);
  }
  for (const { source, target } of changed) await copyFile(resolve(sourceImagesDir, source), resolve(targetImagesDir, target));
  return { extras, removed, copied: changed };
}

async function main() {
  const [infoText, sourceHtml] = await Promise.all([readFile(infoPath, 'utf8'), readFile(htmlPath, 'utf8')]);
  let info;
  try {
    info = JSON.parse(infoText);
  } catch (error) {
    throw new Error(`Không đọc được info.json: ${error.message}`);
  }
  const data = invitationData(info);
  await validateVendor();
  const imageReport = await syncImages();
  const html = updateHtml(sourceHtml, data);
  const oldLinks = /(?:nhacoh|thiepcuoionlinenhacohy|tiktok\.com\/@nhacohyonline|facebook\.com\/thiepcuoionlinenhacohy)/i.test(html);
  if (oldLinks) throw new Error('Vẫn còn liên kết hoặc nhãn hiệu cũ trong index.html; không ghi file.');
  // Nút chỉ đường là liên kết do khách chủ động bấm, không phải tài nguyên trang tải.
  const remoteImports = [...html.matchAll(/(?:src|href)=["']https?:\/\//gi)]
    .filter((match) => !html.slice(match.index, match.index + 100).includes('maps.app.goo.gl'));
  if (remoteImports.length) {
    const positions = remoteImports.map((match) => html.slice(Math.max(0, match.index - 80), match.index + 180)).join(' | ');
    throw new Error(`Vẫn còn ${remoteImports.length} import từ Internet trong index.html: ${positions}`);
  }
  if (!dryRun) await writeFile(htmlPath, html);

  console.log(`${dryRun ? '[dry-run] ' : ''}Đã ${dryRun ? 'kiểm tra' : 'cập nhật'} thiepcuoi3.`);
  console.log(`- Sự kiện mặc định: ngày 2 — ${data.event2.date}, ${data.event2.time}.`);
  console.log('- URL hỗ trợ: ?name=Bạn%20Loan&ngay=1|2&addr=dau|re (mặc định: Quý Khách, ngày 2, nhà trai).');
  console.log(`- Ảnh cá nhân: ${photoCount} ảnh JPEG + 2 QR trong thiepcuoi3/assets/images.`);
  if (imageReport.extras.length) console.log(`- Đã phát hiện ảnh ngoài danh sách quản lý: ${imageReport.extras.join(', ')}.`);
  if (!dryRun && imageReport.removed.length) console.log(`- Đã xóa ${imageReport.removed.length} ảnh thừa trong assets/images.`);
  if (!dryRun && imageReport.copied.length) console.log(`- Đã đồng bộ ${imageReport.copied.length} ảnh thay đổi.`);
  const unavailableFields = [
    'bo_chu_re', 'me_chu_re', 'bo_co_dau', 'me_co_dau',
    'map_embed_chu_re', 'map_embed_co_dau', 'map_mode',
  ].filter((key) => optionalString(info, key));
  if (unavailableFields.length) {
    console.log(`- Lưu ý: mẫu 3 không có vùng hiển thị riêng cho ${unavailableFields.join(', ')}; các trường này không được đưa lên thiệp.`);
  }
}

main().catch((error) => {
  console.error(`Lỗi: ${error.message}`);
  process.exitCode = 1;
});
