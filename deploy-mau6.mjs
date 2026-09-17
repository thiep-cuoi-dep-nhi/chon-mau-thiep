#!/usr/bin/env node

/**
 * Sinh thiệp cưới cho một cặp đôi từ mẫu mau6, info.json và images-update6.
 *
 * Tool này không đụng vào mau6 — nó đọc mau6 làm mẫu và sinh ra một thư mục con
 * mới dưới clients/, đặt tên theo tên chú rể và cô dâu không dấu (ví dụ: dong-loan/).
 *
 * Chạy tại thư mục chứa file này:
 *   node deploy-mau6.mjs
 *
 * Tùy chọn:
 *   node deploy-mau6.mjs --dry-run
 *   node deploy-mau6.mjs --info /duong-dan/info-khac.json
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Cách dùng:
  node deploy-mau6.mjs
  node deploy-mau6.mjs --dry-run
  node deploy-mau6.mjs --info /duong-dan/info.json

Tool đọc info.json và images-update6, dùng mau6 làm mẫu để sinh thiệp
cho một cặp đôi vào thư mục clients/<ten-chu-re>-<ten-co-dau>/
(tên không dấu, ví dụ clients/dong-loan/). Mẫu mau6 không bị thay đổi.
Thư mục đích sẽ bị xóa sạch rồi tạo lại mỗi lần chạy, không giữ lại
file cũ không còn được mẫu sinh ra.
assets/vendor (font, css, js dùng chung) không được sao chép — trang
sinh ra sẽ trỏ thẳng về mau6/assets/vendor để đỡ nặng repo.`);
  process.exit(0);
}

const infoFlagIndex = args.indexOf('--info');
if (infoFlagIndex !== -1 && !args[infoFlagIndex + 1]) {
  throw new Error('Thiếu đường dẫn sau --info.');
}
const unsupportedArgs = args.filter((arg, index) => (
  arg !== '--dry-run' && arg !== '--info' && index !== infoFlagIndex + 1
));
if (unsupportedArgs.length > 0) {
  throw new Error(`Tham số không hỗ trợ: ${unsupportedArgs.join(', ')}. Dùng --help để xem cách dùng.`);
}

const infoPath = infoFlagIndex === -1
  ? resolve(toolDir, 'info.json')
  : resolve(process.cwd(), args[infoFlagIndex + 1]);
const templateDir = resolve(toolDir, 'mau6');
const templateHtmlPath = resolve(templateDir, 'index.html');
const templateVendorDir = resolve(templateDir, 'assets/vendor');
const sourceImagesDir = resolve(toolDir, 'images-update6');
const clientsDir = resolve(toolDir, 'clients');
const managedImages = [
  'photo-start.jpg', 'photo-head.jpg', 'photo-re.jpg', 'photo-dau.jpg', 'photo-end.jpg',
  ...Array.from({ length: 8 }, (_value, index) => `photo-album-${String(index + 1).padStart(2, '0')}.jpg`),
  'qr_chure.jpg', 'qr_codau.jpg',
  'opening-left-gold-red.png', 'opening-right-gold-red.png', 'wedding-gift-icon-red-gold.png',
];

function requiredString(source, key) {
  const value = source[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`info.json thiếu trường \"${key}\" hoặc giá trị không hợp lệ.`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`Trường \"${key}\" không được để trống.`);
  return normalized;
}

function parseDate(value, key) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Trường \"${key}\" phải theo định dạng dd/mm/yyyy.`);

  const [, dayString, monthString, yearString] = match;
  const day = Number(dayString);
  const month = Number(monthString);
  const year = Number(yearString);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new Error(`Trường \"${key}\" không phải ngày hợp lệ.`);
  }
  return { day, month, year };
}

function normalizeMapUrl(value, key) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Trường \"${key}\" không phải URL bản đồ hợp lệ.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Trường \"${key}\" chỉ được dùng URL http hoặc https.`);
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

function dotDate(value) {
  return value.replaceAll('/', '.');
}

function uppercase(value) {
  return value.toLocaleUpperCase('vi-VN');
}

function formatAddress(value) {
  const explicitLines = value.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length > 1) {
    return `${escapeHtml(explicitLines[0])}<br>${escapeHtml(explicitLines.slice(1).join(', '))}`;
  }

  const parts = explicitLines[0].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return escapeHtml(value);

  return `${escapeHtml(`${parts.slice(0, -1).join(', ')},`)}<br>${escapeHtml(parts.at(-1))}`;
}

function stripDiacritics(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D');
}

function slugifyLastWord(fullName, key) {
  const words = fullName.trim().split(/\s+/);
  const lastWord = words.at(-1);
  const slug = stripDiacritics(lastWord).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug) throw new Error(`Không thể tạo tên thư mục từ trường \"${key}\".`);
  return slug;
}

function replaceExactly(html, pattern, replacement, label) {
  let replacements = 0;
  const updated = html.replace(pattern, (...match) => {
    replacements += 1;
    return typeof replacement === 'function' ? replacement(...match) : replacement;
  });
  if (replacements !== 1) {
    throw new Error(`Không thể cập nhật ${label}: cần đúng 1 vị trí, nhưng tìm thấy ${replacements}.`);
  }
  return updated;
}

function replaceTextBlock(html, id, innerHtml) {
  const pattern = new RegExp(
    `(<div\\s+id=["']w-${id}["'][\\s\\S]*?<((?:h[1-6])|p)\\b[^>]*\\bclass=["'][^"']*\\btext-block-css\\b[^"']*["'][^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    'i',
  );
  return replaceExactly(
    html,
    pattern,
    (_whole, openingTag, _tagName, closingTag) => `${openingTag}${innerHtml}${closingTag}`,
    `khối nội dung ${id}`,
  );
}

function replaceCalendarReference(html) {
  const pattern = /url\((['"]?)assets\/(?:calendar-[^)'"\\]+|wedding-calendar)\.svg\1\)/gi;
  return replaceExactly(html, pattern, 'url("assets/wedding-calendar.svg")', 'đường dẫn lịch Save the Date');
}

function replaceGroomMapLink(html, mapUrl) {
  const anchor = /<a\b[^>]*\bid=["']w-200ubu1h["'][^>]*>/i;
  return replaceExactly(
    html,
    anchor,
    (whole) => {
      const href = `href="${escapeHtml(mapUrl)}"`;
      if (/\bhref=["'][^"']*["']/i.test(whole)) {
        return whole.replace(/\bhref=["'][^"']*["']/i, href);
      }
      return whole.replace(/>$/, ` ${href}>`);
    },
    'liên kết bản đồ nhà trai',
  );
}

function calendarSvg({ month, year, markedDays }) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDay = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const marked = new Set(markedDays);
  const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const x = (column) => 33 + column * 45;
  const y = (row) => 76 + row * 35;
  const weekdays = weekdayLabels
    .map((label, column) => `<text x="${x(column)}" y="39">${label}</text>`)
    .join('');
  const days = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const position = firstDay + day - 1;
    const column = position % 7;
    const row = Math.floor(position / 7);
    const dayX = x(column);
    const dayY = y(row);
    if (marked.has(day)) days.push(`<circle class="marked" cx="${dayX}" cy="${dayY}" r="17"/><text class="marked-day" x="${dayX}" y="${dayY}">${day}</text>`);
    else days.push(`<text x="${dayX}" y="${dayY}">${day}</text>`);
  }

  const markerDescription = [...marked].sort((a, b) => a - b).join(' và ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 335 272" role="img" aria-labelledby="title desc">
  <title id="title">Lịch tháng ${month} năm ${year}</title>
  <desc id="desc">Ngày ${markerDescription} tháng ${month} được khoanh tròn.</desc>
  <style>
    .weekday { font: 700 16px Arial, sans-serif; fill: #111; text-anchor: middle; }
    .day { font: 700 16px Arial, sans-serif; fill: #111; text-anchor: middle; dominant-baseline: middle; }
    .marked { fill: none; stroke: #b2151f; stroke-width: 2.5; }
    .marked-day { fill: #b2151f; }
  </style>
  <g class="weekday">${weekdays}</g>
  <g class="day">${days.join('')}</g>
</svg>
`;
}

function buildRuntimeBlock(info) {
  const serializedInfo = JSON.stringify(info)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

  return `<!-- WEDDING_INFO_RUNTIME_START -->
<style>
  /* Nút nhà gái được tạo động; dùng cùng nhịp pulse 4 giây của nút nhà trai gốc. */
  #w-bride-address-card a {
    animation-name: pulse;
    -webkit-animation-name: pulse;
    animation-delay: 0s;
    -webkit-animation-delay: 0s;
    animation-iteration-count: infinite;
    -webkit-animation-iteration-count: infinite;
    animation-duration: 4s;
    -webkit-animation-duration: 4s;
  }
  #w-wedding-gift-modal .wedding-gift-copy {
    width: 100%;
    margin-top: 13px;
    padding: 10px 8px;
    border-radius: 9px;
    background: var(--gift-color, #a1121b);
    color: #fff;
    cursor: pointer;
    font: 700 14px/1 Arial, sans-serif;
  }
  #w-wedding-gift-modal .wedding-gift-copy-status {
    min-height: 17px;
    margin-top: 7px;
    color: #27734a;
    font: 600 12px/1.3 Arial, sans-serif;
  }
  /* Album dùng ảnh riêng, không lặp các ảnh mở đầu hoặc ảnh giới thiệu. */
  #w-ez6ucifn .image-background { background-image: url("assets/images/photo-album-04.jpg") !important; }
  #w-b2mel9a7 .image-background { background-image: url("assets/images/photo-album-05.jpg") !important; }
  #w-r9wp2b2a .image-background { background-image: url("assets/images/photo-album-06.jpg") !important; }
  #w-d07oef6q .image-background { background-image: url("assets/images/photo-album-07.jpg") !important; }
  #w-3ycy2r64 .image-background { background-image: url("assets/images/photo-album-01.jpg") !important; }
  #w-7hz510lt .image-background { background-image: url("assets/images/photo-album-08.jpg") !important; }
  #w-gdyd600l .image-background { background-image: url("assets/images/photo-album-02.jpg") !important; }
  #w-3rmd51dy .image-background { background-image: url("assets/images/photo-album-03.jpg") !important; }
</style>
<script>
  ;(() => {
    const weddingInfo = ${serializedInfo};
    const dotDate = value => value.replaceAll('/', '.');
    const escapeHtml = value => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
    const addressHtml = value => {
      const explicitLines = String(value).trim().split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
      if (explicitLines.length > 1) {
        return escapeHtml(explicitLines[0]) + '<br>' + escapeHtml(explicitLines.slice(1).join(', '));
      }
      const parts = explicitLines[0].split(',').map(part => part.trim()).filter(Boolean);
      if (parts.length < 2) return escapeHtml(value);
      return escapeHtml(parts.slice(0, -1).join(', ') + ',') + '<br>' + escapeHtml(parts.at(-1));
    };
    const textNode = id => document.querySelector('#w-' + id + ' .text-block-css');
    const setText = (id, text) => {
      const element = textNode(id);
      if (element) element.textContent = text;
    };
    const setHtml = (id, html) => {
      const element = textNode(id);
      if (element) element.innerHTML = html;
    };
    const setMeta = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.setAttribute('content', value);
    };
    const applyAlbumPhotos = () => {
      const photos = {
        ez6ucifn: 'photo-album-04.jpg', b2mel9a7: 'photo-album-05.jpg', r9wp2b2a: 'photo-album-06.jpg',
        d07oef6q: 'photo-album-07.jpg', '3ycy2r64': 'photo-album-01.jpg', '7hz510lt': 'photo-album-08.jpg',
        gdyd600l: 'photo-album-02.jpg', '3rmd51dy': 'photo-album-03.jpg',
      };
      Object.entries(photos).forEach(([id, file]) => {
        const image = document.querySelector('#w-' + id + ' .image-background');
        if (image) image.style.setProperty('background-image', 'url("assets/images/' + file + '")', 'important');
      });
    };

    function applyInvitationDetails() {
      const first = weddingInfo.date1;
      const second = weddingInfo.date2;
      const couple = weddingInfo.chu_re + ' & ' + weddingInfo.co_dau;

      document.title = 'Lễ Thành Hôn ' + couple;
      setMeta('meta[property="og:title"]', document.title);
      setHtml('09n4st8z', escapeHtml(weddingInfo.chu_re) + ' &amp; ' + escapeHtml(weddingInfo.co_dau));
      setHtml('1d1q28ai', escapeHtml(weddingInfo.chu_re) + '<br>&amp;<br>' + escapeHtml(weddingInfo.co_dau) + '<br>');
      setHtml('00lwa1ur', '<span style="text-decoration-line: underline;">NHÀ TRAI<br></span>Ông: ' + escapeHtml(weddingInfo.bo_chu_re) + '<br>Bà: ' + escapeHtml(weddingInfo.me_chu_re) + '<br>');
      setHtml('3z6ulhfd', '<span style="text-decoration-line: underline;">NHÀ GÁI<br></span>Ông: ' + escapeHtml(weddingInfo.bo_co_dau) + '<br>Bà: ' + escapeHtml(weddingInfo.me_co_dau) + '<br>');

      // Thiệp không có ?ngay=... mặc định hiển thị lễ thành hôn (ngày 2).
      setText('gm23y5sz', weddingInfo.day2.toLocaleUpperCase('vi-VN') + ' | ' + weddingInfo.time2.toLocaleUpperCase('vi-VN'));
      setText('m7ltj4vm', dotDate(second));
      setText('leshracl', 'Vào Lúc ' + weddingInfo.time1 + ' | ' + weddingInfo.day1);
      setText('91u2ou0z', dotDate(first));
      setText('adx2l8ur', '(' + weddingInfo.date1_am + ')');
      setText('2z7tcz2j', String(weddingInfo.date2Parts.day));
      setText('43f6tjlo', weddingInfo.time2);
      setText('cb49wgb3', weddingInfo.day2);
      setText('83i510i2', 'Tháng ' + String(weddingInfo.date2Parts.month).padStart(2, '0'));
      setText('b1x4e1f3', 'Năm ' + weddingInfo.date2Parts.year);
      setText('u8ko2spd', '(' + weddingInfo.date2_am + ')');
      setHtml('njhlystq', 'Save The Date<br>Tháng ' + String(weddingInfo.date2Parts.month).padStart(2, '0') + ' . ' + weddingInfo.date2Parts.year + '<br>');

      const groomName = textNode('6ivzqt4u');
      const groomAddress = textNode('n4kdatky');
      const groomButton = document.getElementById('w-200ubu1h');
      if (groomName) groomName.innerHTML = 'NHÀ TRAI<br>';
      if (groomAddress) groomAddress.innerHTML = addressHtml(weddingInfo.diachi_chu_re) + '<br>';
      if (groomButton) {
        groomButton.href = weddingInfo.map_chu_re;
        groomButton.title = 'Xem chỉ đường đến nhà trai';
        const buttonText = groomButton.querySelector('.button-text');
        if (buttonText) buttonText.textContent = 'Xem Chỉ đường';
        groomButton.addEventListener('click', event => event.stopImmediatePropagation(), true);
      }

      const venueSection = document.getElementById('w-0dseanb4');
      const venueContainer = venueSection && venueSection.querySelector('.section-container');
      if (!venueContainer) return;

      document.getElementById('w-bride-address-card')?.remove();
      document.getElementById('w-wedding-gift-actions')?.remove();
      document.getElementById('w-wedding-gift-modal')?.remove();

      const brideCard = document.createElement('div');
      brideCard.id = 'w-bride-address-card';
      brideCard.innerHTML = '<h3>NHÀ GÁI</h3><p>' + addressHtml(weddingInfo.diachi_co_dau) + '</p><a title="Xem chỉ đường đến nhà gái">Xem Chỉ đường</a>';
      brideCard.querySelector('a').href = weddingInfo.map_co_dau;
      venueContainer.append(brideCard);

      const giftActions = document.createElement('div');
      giftActions.id = 'w-wedding-gift-actions';
      giftActions.innerHTML = '<button type="button" class="gift-groom" data-gift="groom">Gửi Mừng Cưới cho Chú Rể</button><button type="button" class="gift-bride" data-gift="bride">Gửi Mừng Cưới cho Cô Dâu</button>';
      venueContainer.append(giftActions);

      const giftModal = document.createElement('div');
      giftModal.id = 'w-wedding-gift-modal';
      giftModal.setAttribute('aria-hidden', 'true');
      giftModal.innerHTML = '<div class="wedding-gift-dialog" role="dialog" aria-modal="true" aria-label="Thông tin mừng cưới"><button type="button" class="wedding-gift-close" aria-label="Đóng">&times;</button><img class="wedding-gift-qr" alt="Mã QR mừng cưới"><div class="wedding-gift-info"><p data-bank></p><p data-account-holder></p><p data-account-number></p><button type="button" class="wedding-gift-copy" data-copy-account>Sao chép số tài khoản</button><p class="wedding-gift-copy-status" data-copy-status aria-live="polite"></p></div></div>';
      document.body.append(giftModal);

      giftModal.querySelector('[data-copy-account]').addEventListener('click', async () => {
        const number = giftModal.dataset.accountNumber;
        const status = giftModal.querySelector('[data-copy-status]');
        const button = giftModal.querySelector('[data-copy-account]');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(number);
          else {
            const helper = document.createElement('textarea');
            helper.value = number; helper.setAttribute('readonly', ''); helper.style.position = 'fixed'; helper.style.opacity = '0';
            document.body.append(helper); helper.select();
            const copied = document.execCommand && document.execCommand('copy');
            helper.remove();
            if (!copied) throw new Error('clipboard unavailable');
          }
          status.textContent = 'Đã sao chép số tài khoản';
          button.textContent = 'Đã sao chép';
        } catch {
          status.textContent = 'Không thể tự sao chép. Hãy nhấn giữ số tài khoản để sao chép.';
        }
      });

      const gifts = {
        groom: {
          qr: 'assets/images/qr_chure.jpg',
          bank: weddingInfo.account_bank_chu_re,
          accountHolder: weddingInfo.account_name_chu_re,
          accountNumber: weddingInfo.account_number_chu_re,
          color: '#b0161f'
        },
        bride: {
          qr: 'assets/images/qr_codau.jpg',
          bank: weddingInfo.account_bank_co_dau,
          accountHolder: weddingInfo.account_name_co_dau,
          accountNumber: weddingInfo.account_number_co_dau,
          color: '#c89b31'
        }
      };

      const closeGiftModal = () => {
        giftModal.classList.remove('is-open');
        giftModal.setAttribute('aria-hidden', 'true');
      };
      giftActions.addEventListener('click', event => {
        const button = event.target.closest('button[data-gift]');
        const gift = button && gifts[button.dataset.gift];
        if (!gift) return;
        giftModal.style.setProperty('--gift-color', gift.color);
        giftModal.querySelector('.wedding-gift-qr').src = gift.qr;
        giftModal.querySelector('[data-bank]').textContent = gift.bank;
        giftModal.querySelector('[data-account-holder]').textContent = gift.accountHolder;
        giftModal.querySelector('[data-account-number]').textContent = gift.accountNumber;
        giftModal.dataset.accountNumber = gift.accountNumber;
        giftModal.querySelector('[data-copy-account]').textContent = 'Sao chép số tài khoản';
        giftModal.querySelector('[data-copy-status]').textContent = '';
        giftModal.classList.add('is-open');
        giftModal.setAttribute('aria-hidden', 'false');
      });
      giftModal.addEventListener('click', event => {
        if (event.target === giftModal || event.target.closest('.wedding-gift-close')) closeGiftModal();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeGiftModal();
      });
    }

    function applyInvitationParameters() {
      const params = new URLSearchParams(window.location.search);
      // Chỉ URL có ?ngay=1 mới chọn ngày 1; mọi trường hợp khác là ngày 2.
      const isFirstDay = params.get('ngay') === '1';
      const guestName = (params.get('name') || '').trim();
      if (guestName) setText('vga9jtua', guestName);

      const date = isFirstDay ? weddingInfo.date1 : weddingInfo.date2;
      const day = isFirstDay ? weddingInfo.day1 : weddingInfo.day2;
      const time = isFirstDay ? weddingInfo.time1 : weddingInfo.time2;
      setText('gm23y5sz', day.toLocaleUpperCase('vi-VN') + ' | ' + time.toLocaleUpperCase('vi-VN'));
      setText('m7ltj4vm', dotDate(date));

      if (!isFirstDay) {
        setText('leshracl', weddingInfo.time2 + ' | ' + weddingInfo.day2);
        setText('91u2ou0z', dotDate(weddingInfo.date2));
        setText('adx2l8ur', '(' + weddingInfo.date2_am + ')');
      }
    }

    const update = () => {
      applyAlbumPhotos();
      applyInvitationDetails();
      applyInvitationParameters();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(update));
    else requestAnimationFrame(update);
  })();
</script>
<!-- WEDDING_INFO_RUNTIME_END -->`;
}

function replaceRuntimeBlock(html, block) {
  const managedBlock = /<!-- WEDDING_INFO_RUNTIME_START -->[\s\S]*?<!-- WEDDING_INFO_RUNTIME_END -->/;
  if (managedBlock.test(html)) return html.replace(managedBlock, block);
  if (!/<\/body>/i.test(html)) throw new Error('Không tìm thấy thẻ </body> để chèn cấu hình thiệp.');
  return html.replace(/<\/body>/i, `${block}\n</body>`);
}

async function checkPersonalImagesExist() {
  const missing = [];
  for (const name of managedImages) {
    try {
      await readFile(resolve(sourceImagesDir, name));
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`images-update1 thiếu ảnh bắt buộc: ${missing.join(', ')}.`);
  }
}

async function copyPersonalImages(targetImagesDir) {
  await mkdir(targetImagesDir, { recursive: true });
  await Promise.all(managedImages.map((name) => cp(
    resolve(sourceImagesDir, name),
    resolve(targetImagesDir, name),
  )));
}

const rawInfo = JSON.parse(await readFile(infoPath, 'utf8'));
if (rawInfo === null || Array.isArray(rawInfo) || typeof rawInfo !== 'object') {
  throw new Error('info.json phải là một JSON object.');
}

const info = {
  chu_re: requiredString(rawInfo, 'chu_re'),
  co_dau: requiredString(rawInfo, 'co_dau'),
  time1: requiredString(rawInfo, 'time1'),
  day1: requiredString(rawInfo, 'day1'),
  date1: requiredString(rawInfo, 'date1'),
  date1_am: requiredString(rawInfo, 'date1_am'),
  time2: requiredString(rawInfo, 'time2'),
  day2: requiredString(rawInfo, 'day2'),
  date2: requiredString(rawInfo, 'date2'),
  date2_am: requiredString(rawInfo, 'date2_am'),
  bo_chu_re: requiredString(rawInfo, 'bo_chu_re'),
  me_chu_re: requiredString(rawInfo, 'me_chu_re'),
  bo_co_dau: requiredString(rawInfo, 'bo_co_dau'),
  me_co_dau: requiredString(rawInfo, 'me_co_dau'),
  diachi_chu_re: requiredString(rawInfo, 'diachi_chu_re'),
  map_chu_re: normalizeMapUrl(requiredString(rawInfo, 'map_chu_re'), 'map_chu_re'),
  diachi_co_dau: requiredString(rawInfo, 'diachi_co_dau'),
  map_co_dau: normalizeMapUrl(requiredString(rawInfo, 'map_co_dau'), 'map_co_dau'),
  account_name_chu_re: requiredString(rawInfo, 'account_name_chu_re'),
  account_bank_chu_re: requiredString(rawInfo, 'account_bank_chu_re'),
  account_number_chu_re: requiredString(rawInfo, 'account_number_chu_re'),
  account_name_co_dau: requiredString(rawInfo, 'account_name_co_dau'),
  account_bank_co_dau: requiredString(rawInfo, 'account_bank_co_dau'),
  account_number_co_dau: requiredString(rawInfo, 'account_number_co_dau'),
};

info.date1Parts = parseDate(info.date1, 'date1');
info.date2Parts = parseDate(info.date2, 'date2');
if (info.date1Parts.month !== info.date2Parts.month || info.date1Parts.year !== info.date2Parts.year) {
  throw new Error('date1 và date2 phải cùng tháng, cùng năm vì mẫu mau6 chỉ có một lịch Save The Date.');
}

const folderName = `${slugifyLastWord(info.chu_re, 'chu_re')}-${slugifyLastWord(info.co_dau, 'co_dau')}`;
const outputDir = resolve(clientsDir, folderName);
const outputHtmlPath = resolve(outputDir, 'index.html');
const outputImagesDir = resolve(outputDir, 'assets/images');
const outputCalendarPath = resolve(outputDir, 'assets/wedding-calendar.svg');
const vendorHref = `${relative(outputDir, templateVendorDir).split('\\').join('/')}/`;

const title = `Lễ Thành Hôn ${info.chu_re} & ${info.co_dau}`;
let html = await readFile(templateHtmlPath, 'utf8');
html = replaceExactly(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`, 'tiêu đề trang');
html = replaceExactly(
  html,
  /<meta\s+property=["']og:title["']\s+content=["'][^"']*["']\s*\/?>/i,
  `<meta property="og:title" content="${escapeHtml(title)}">`,
  'tiêu đề chia sẻ',
);
html = replaceTextBlock(html, '09n4st8z', `${escapeHtml(info.chu_re)} &amp; ${escapeHtml(info.co_dau)}`);
html = replaceTextBlock(html, 'gm23y5sz', `${escapeHtml(uppercase(info.day2))} | ${escapeHtml(uppercase(info.time2))}`);
html = replaceTextBlock(html, 'm7ltj4vm', escapeHtml(dotDate(info.date2)));
html = replaceTextBlock(html, '1d1q28ai', `${escapeHtml(info.chu_re)}<br>&amp;<br>${escapeHtml(info.co_dau)}<br>`);
html = replaceTextBlock(html, '00lwa1ur', `<span style="text-decoration-line: underline;">NHÀ TRAI<br></span>Ông: ${escapeHtml(info.bo_chu_re)}<br>Bà: ${escapeHtml(info.me_chu_re)}<br>`);
html = replaceTextBlock(html, '3z6ulhfd', `<span style="text-decoration-line: underline;">NHÀ GÁI<br></span>Ông: ${escapeHtml(info.bo_co_dau)}<br>Bà: ${escapeHtml(info.me_co_dau)}<br>`);
html = replaceTextBlock(html, 'leshracl', `Vào Lúc ${escapeHtml(info.time1)} | ${escapeHtml(info.day1)}<br>`);
html = replaceTextBlock(html, '91u2ou0z', `${escapeHtml(dotDate(info.date1))}<br>`);
html = replaceTextBlock(html, 'adx2l8ur', `(${escapeHtml(info.date1_am)})<br>`);
html = replaceTextBlock(html, '2z7tcz2j', escapeHtml(info.date2Parts.day));
html = replaceTextBlock(html, '43f6tjlo', escapeHtml(info.time2));
html = replaceTextBlock(html, 'cb49wgb3', escapeHtml(info.day2));
html = replaceTextBlock(html, '83i510i2', `Tháng ${String(info.date2Parts.month).padStart(2, '0')}`);
html = replaceTextBlock(html, 'b1x4e1f3', `Năm ${info.date2Parts.year}`);
html = replaceTextBlock(html, 'u8ko2spd', `(${escapeHtml(info.date2_am)})<br>`);
html = replaceTextBlock(html, '6ivzqt4u', 'NHÀ TRAI<br>');
html = replaceTextBlock(html, 'n4kdatky', `${formatAddress(info.diachi_chu_re)}<br>`);
html = replaceTextBlock(html, 'njhlystq', `Save The Date<br>Tháng ${String(info.date2Parts.month).padStart(2, '0')} . ${info.date2Parts.year}<br>`);
html = replaceGroomMapLink(html, info.map_chu_re);
html = replaceCalendarReference(html);
html = replaceRuntimeBlock(html, buildRuntimeBlock(info));
html = html.replaceAll('assets/vendor/', vendorHref);

const calendar = calendarSvg({
  month: info.date2Parts.month,
  year: info.date2Parts.year,
  markedDays: [info.date1Parts.day, info.date2Parts.day],
});
await checkPersonalImagesExist();

if (dryRun) {
  console.log(`Kiểm tra thành công: ${infoPath}`);
  console.log(`Sẽ xóa sạch rồi tạo lại thư mục: ${outputDir}`);
  console.log(`- ${outputHtmlPath}`);
  console.log(`- ${outputCalendarPath}`);
  console.log(`- Trỏ assets/vendor về ${templateVendorDir} (không sao chép)`);
  console.log(`- Sao chép ${managedImages.length} ảnh từ ${sourceImagesDir}`);
} else {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(dirname(outputCalendarPath), { recursive: true });
  await Promise.all([
    writeFile(outputHtmlPath, html),
    writeFile(outputCalendarPath, calendar),
    copyPersonalImages(outputImagesDir),
  ]);
  console.log(`Đã tạo thiệp cho ${info.chu_re} & ${info.co_dau}.`);
  console.log(`- ${outputDir}`);
}
