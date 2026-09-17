#!/usr/bin/env node

/**
 * Đồng bộ thiệp thiepcuoi2 từ info.json và thư mục images-update2.
 *
 * Ví dụ:
 *   node update-thiepcuoi2.mjs
 *   node update-thiepcuoi2.mjs --dry-run
 *   node update-thiepcuoi2.mjs --check
 *   node update-thiepcuoi2.mjs --info /duong-dan/info.json --images /duong-dan/images-update2
 *
 * Template này render đúng 18 ảnh độc lập: ảnh mở đầu, ảnh vai trò và 11 ảnh album.
 * Từng vị trí có tệp riêng; ảnh nguồn photo-19.jpg trở đi sẽ được báo là dư.
 */

import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const toolDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const resolveMapEmbeds = args.includes('--resolve-map-embeds');

if (dryRun && checkOnly) {
  throw new Error('Chỉ dùng một trong hai tham số --dry-run hoặc --check.');
}
if (resolveMapEmbeds && (dryRun || checkOnly)) {
  throw new Error('--resolve-map-embeds không dùng cùng --dry-run hoặc --check vì nó cần ghi map_embed_* vào info.json.');
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Cách dùng:
  node update-thiepcuoi2.mjs
  node update-thiepcuoi2.mjs --dry-run
  node update-thiepcuoi2.mjs --check
  node update-thiepcuoi2.mjs --resolve-map-embeds
  node update-thiepcuoi2.mjs --info /duong-dan/info.json --images /duong-dan/images-update2

Mặc định tool đọc ./info.json, lấy ảnh từ ./images-update2, rồi cập nhật:
  - thiepcuoi2/index.html
  - thiepcuoi2/assets/images/photo-start.jpg, photo-re.jpg, photo-dau.jpg,
    photo-end.jpg, photo-phong1.jpg ... photo-phong3.jpg và photo-album-01.jpg ... photo-album-11.jpg
  - thiepcuoi2/assets/images/qr_chure.jpg và qr_codau.jpg

--dry-run kiểm tra đầu vào và liệt kê thay đổi, không ghi file.
--check kiểm tra thiệp hiện tại đã đồng bộ hay chưa (mã trả về 2 nếu còn khác).
--resolve-map-embeds tự đọc tọa độ từ map_chu_re/map_co_dau, tạo URL OpenStreetMap
nhúng và ghi map_embed_chu_re/map_embed_co_dau vào info.json. Tùy chọn này cần Internet.

Trường bắt buộc trong info.json giống update-thiepcuoi1.mjs.
Có thể thêm map_embed_chu_re và map_embed_co_dau (URL iframe). Để thật sự bật
bản đồ nhúng, thêm "map_mode": "embed" vào info.json. Mặc định map_mode là
"link" để khách không cần VPN hay truy cập dịch vụ bản đồ bên thứ ba.`);
  process.exit(0);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Thiếu đường dẫn sau ${flag}.`);
  }
  return args[index + 1];
}

const infoArgument = valueAfter('--info');
const imagesArgument = valueAfter('--images');
const supported = new Set(['--dry-run', '--check', '--resolve-map-embeds', '--help', '-h', '--info', '--images']);
const unsupported = args.filter((arg, index) => (
  !supported.has(arg) && args[index - 1] !== '--info' && args[index - 1] !== '--images'
));
if (unsupported.length > 0) {
  throw new Error(`Tham số không hỗ trợ: ${unsupported.join(', ')}. Dùng --help để xem cách dùng.`);
}

const infoPath = infoArgument ? resolve(process.cwd(), infoArgument) : resolve(toolDir, 'info.json');
const sourceImagesDir = imagesArgument ? resolve(process.cwd(), imagesArgument) : resolve(toolDir, 'images-update2');
const invitationDir = resolve(toolDir, 'thiepcuoi2');
const htmlPath = resolve(invitationDir, 'index.html');
const targetImagesDir = resolve(invitationDir, 'assets/images');
const photoSlots = [
  '23vr9tl5', '1l1q24xv', '3a2ji50s', 'md62saxz', '5b2aqac5', 'ph8bqgl4',
  'yli1zwyz', 'p9fhi0b8', 'qp5baqwx', 'qeomx49q', 'a95cjgir', '0eoi4uaa',
  'ofobwom7', 'rmcxaon4', '5zo6rch5', 'ouk0buqk', '08b4vozj', '8shwi8nb',
];
const photoNames = [
  'photo-start.jpg', 'photo-phong3.jpg', 'photo-phong1.jpg', 'photo-phong2.jpg', 'photo-re.jpg', 'photo-dau.jpg',
  'photo-album-01.jpg', 'photo-album-02.jpg', 'photo-album-03.jpg', 'photo-album-04.jpg', 'photo-album-05.jpg',
  'photo-album-06.jpg', 'photo-album-07.jpg', 'photo-album-08.jpg', 'photo-album-09.jpg', 'photo-end.jpg',
  'photo-album-10.jpg', 'photo-album-11.jpg',
];
const sourcePhotoNames = [...photoNames];
const imagePairs = [
  ...photoNames.map((targetName, index) => ({ sourceName: sourcePhotoNames[index], targetName })),
  { sourceName: 'qr_chure.jpg', targetName: 'qr_chure.jpg' },
  { sourceName: 'qr_codau.jpg', targetName: 'qr_codau.jpg' },
];
const requiredImageNames = imagePairs.map(({ targetName }) => targetName);
const requiredSourceImageNames = imagePairs.map(({ sourceName }) => sourceName);
const photoCssOverrides = photoSlots.map((id, index) => `  #w-${id} .image-background { background-image: url("assets/images/${photoNames[index]}") !important; }`).join('\n');
const warnings = [];

function requiredString(source, key) {
  const value = source[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`info.json thiếu trường "${key}" hoặc giá trị không hợp lệ.`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`Trường "${key}" không được để trống.`);
  return normalized;
}

function parseDate(value, key) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Trường "${key}" phải theo định dạng dd/mm/yyyy.`);
  const [, dayString, monthString, yearString] = match;
  const day = Number(dayString);
  const month = Number(monthString);
  const year = Number(yearString);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    throw new Error(`Trường "${key}" không phải ngày hợp lệ.`);
  }
  return { day, month, year };
}

function normalizeUrl(value, key) {
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

function optionalUrl(source, key) {
  if (source[key] === undefined || source[key] === null || String(source[key]).trim() === '') return '';
  return normalizeUrl(String(source[key]).trim(), key);
}

function mapMode(source) {
  if (source.map_mode === undefined || source.map_mode === null || String(source.map_mode).trim() === '') return 'link';
  const value = String(source.map_mode).trim().toLowerCase();
  if (!['link', 'embed'].includes(value)) throw new Error('Trường "map_mode" chỉ nhận "link" hoặc "embed".');
  return value;
}

function openStreetMapEmbed(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`Tọa độ không hợp lệ: ${latitude}, ${longitude}.`);
  }
  // Khung rộng khoảng 1,5 km quanh địa điểm, đủ để nhận ra khu vực mà không quá xa.
  const latPadding = 0.0065;
  const lonPadding = 0.0075;
  const bbox = [lon - lonPadding, lat - latPadding, lon + lonPadding, lat + latPadding]
    .map((value) => value.toFixed(7))
    .join(',');
  const marker = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
}

function coordinatesFromGoogleMapUrl(value) {
  const decoded = decodeURIComponent(value);
  // Google Maps đặt tọa độ chính xác của ghim ở !3d<latitude>!4d<longitude>.
  const marker = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(decoded);
  if (marker) return { latitude: Number(marker[1]), longitude: Number(marker[2]) };
  // Fallback cho các link không có ghim, chỉ có tâm khung nhìn @lat,lon,zoom.
  const viewport = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,\d+(?:\.\d+)?z)?/.exec(decoded);
  if (viewport) return { latitude: Number(viewport[1]), longitude: Number(viewport[2]) };
  return null;
}

async function resolveGoogleMapEmbed(mapUrl, key) {
  let response;
  try {
    response = await fetch(mapUrl, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new Error(`Không thể mở ${key} để lấy tọa độ: ${error.message}`);
  }
  if (!response.ok) throw new Error(`${key} trả về HTTP ${response.status}, không thể tạo bản đồ nhúng.`);
  const coordinates = coordinatesFromGoogleMapUrl(response.url);
  if (!coordinates) {
    throw new Error(`${key} không chứa tọa độ có thể chuyển đổi. Hãy điền map_embed_* thủ công từ OpenStreetMap.`);
  }
  return openStreetMapEmbed(coordinates.latitude, coordinates.longitude);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function addressHtml(value) {
  const explicitLines = String(value).trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length > 1) return explicitLines.map(escapeHtml).join('<br>');
  const parts = explicitLines[0].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return escapeHtml(value);
  return `${escapeHtml(`${parts.slice(0, -1).join(', ')},`)}<br>${escapeHtml(parts.at(-1))}`;
}

function dotDate(value) {
  return value.replaceAll('/', '.');
}

function upper(value) {
  return String(value).toLocaleUpperCase('vi-VN');
}

function lunar(value) {
  return `(${value})`;
}

function replaceExactly(html, pattern, replacement, label) {
  let count = 0;
  const updated = html.replace(pattern, (...match) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...match) : replacement;
  });
  if (count !== 1) throw new Error(`Không thể cập nhật ${label}: cần đúng 1 vị trí, tìm thấy ${count}.`);
  return updated;
}

function replaceTextBlock(html, id, innerHtml) {
  const pattern = new RegExp(
    `(<div\\s+id=["']w-${id}["'][\\s\\S]*?<((?:h[1-6])|p)\\b[^>]*\\bclass=["'][^"']*\\btext-block-css\\b[^"']*["'][^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    'i',
  );
  return replaceExactly(html, pattern, (_whole, opening, _tag, closing) => `${opening}${innerHtml}${closing}`, `khối nội dung ${id}`);
}

function replaceAnchorById(html, id, href, title) {
  const pattern = new RegExp(`<a\\b[^>]*\\bid=["']w-${id}["'][^>]*>`, 'i');
  return replaceExactly(html, pattern, (anchor) => {
    const attributes = [
      ['href', href],
      ['title', title],
      ['target', '_blank'],
      ['rel', 'noopener noreferrer'],
    ];
    let updated = anchor;
    for (const [name, value] of attributes) {
      const attribute = new RegExp(`\\s${name}=["'][^"']*["']`, 'i');
      const next = ` ${name}="${escapeHtml(value)}"`;
      updated = attribute.test(updated) ? updated.replace(attribute, next) : updated.replace(/>$/, `${next}>`);
    }
    return updated;
  }, `liên kết ${id}`);
}

function replaceImageBlockSource(html, id, source) {
  const pattern = new RegExp(`(#w-${id} \\.image-background\\{[^}]*?url\\(["']?)[^"')]+(["']?\\))`, 'g');
  let replacements = 0;
  const updated = html.replace(pattern, (_whole, opening, closing) => {
    replacements += 1;
    return `${opening}${source}${closing}`;
  });
  if (replacements !== 2) {
    throw new Error(`Không thể cập nhật ảnh ${id}: cần đúng 2 kiểu hiển thị desktop/mobile, nhưng tìm thấy ${replacements}.`);
  }
  return updated;
}

function eventDataFromHtml(html) {
  const prefix = 'window.event_data=';
  const start = html.indexOf(prefix);
  if (start === -1) throw new Error('Không tìm thấy window.event_data trong index.html.');
  const jsonStart = start + prefix.length;
  const scriptEnd = html.indexOf('</script>', jsonStart);
  if (scriptEnd === -1) throw new Error('window.event_data chưa đóng thẻ script.');
  let json = html.slice(jsonStart, scriptEnd).trim();
  if (json.endsWith(';')) json = json.slice(0, -1);
  try {
    return { start, jsonStart, scriptEnd, data: JSON.parse(json) };
  } catch (error) {
    throw new Error(`Không đọc được window.event_data: ${error.message}`);
  }
}

function stringifyForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function updateEventData(html, info) {
  const parsed = eventDataFromHtml(html);
  const vm = parsed.data?.runtime?.vm;
  if (!vm || typeof vm !== 'object') throw new Error('window.event_data.runtime.vm không hợp lệ.');
  const component = (id) => {
    const item = vm[id];
    if (!item || typeof item !== 'object') throw new Error(`Template thiếu component ${id} trong event_data.`);
    return item;
  };
  const text = (id, value) => {
    const item = component(id);
    item.specials ??= {};
    item.specials.text = value;
  };

  const couple = `${info.chu_re} & ${info.co_dau}`;
  // Trang đầu dùng một dòng ngày đầy đủ, ví dụ 19.09.2026.
  text('mp0qv73g', '');
  text('wld81o8r', `${dotDate(info.date2)}<br>`);
  text('prmec0mx', `${escapeHtml(info.time2)}<br>${escapeHtml(upper(info.day2))}<br>`);
  text('a4yahdeg', `${escapeHtml(lunar(info.date2_am))}<br>`);
  text('38zal5r1', escapeHtml(couple));
  text('8ohgoryu', 'Thư mời Quý Khách<br>');
  text('7bb8npau', `THAM DỰ LỄ CƯỚI CỦA ${escapeHtml(upper(couple))}<br>`);
  text('a75853g7', `Vào Lúc ${escapeHtml(info.time2)} | ${escapeHtml(info.day2)}<br>`);
  text('401v089d', `${escapeHtml(dotDate(info.date2))}<br>`);
  text('4ipoia3c', `${escapeHtml(lunar(info.date2_am))}<br>`);
  text('5ude64d5', 'Tại tư gia nhà trai<br>');
  text('uemt5u4a', `NHÀ TRAI<br>ÔNG: ${escapeHtml(info.bo_chu_re)}<br>BÀ: ${escapeHtml(info.me_chu_re)}<br>`);
  text('1muauw0u', `${addressHtml(info.diachi_chu_re)}<br>`);
  text('dzaip52a', `${escapeHtml(info.chu_re)}<br>`);
  text('mkjphr7o', `NHÀ GÁI<br>ÔNG: ${escapeHtml(info.bo_co_dau)}<br>BÀ: ${escapeHtml(info.me_co_dau)}<br>`);
  text('u1a2mvp7', `${addressHtml(info.diachi_co_dau)}<br>`);
  text('ca35y7bn', `${escapeHtml(info.co_dau)}<br>`);
  text('msqshnjl', `${escapeHtml(upper(info.day2))} | ${escapeHtml(upper(info.time2))}<br>`);
  text('gehalp48', `${escapeHtml(dotDate(info.date2))}<br>`);
  text('22a3k3pm', `${escapeHtml(lunar(info.date2_am))}<br>`);
  text('6ae5a842', `Save The Date<br>Tháng ${String(info.date2Parts.month).padStart(2, '0')} . ${info.date2Parts.year}<br>`);
  text('7b0zbc0a', 'Tại tư gia nhà trai<br>');
  text('zed2wzbl', '');
  text('k0phc799', `${escapeHtml(upper(info.account_bank_chu_re))}<br>${escapeHtml(upper(info.account_name_chu_re))}<br>${escapeHtml(info.account_number_chu_re)}<br>`);
  // Không tái sử dụng ảnh: mỗi image-block cá nhân nhận đúng một photo-XX.jpg.
  photoSlots.forEach((id, index) => {
    component(id).specials.src = `assets/images/${photoNames[index]}`;
  });
  component('nkiv0por').specials.src = 'assets/images/qr_chure.jpg';

  const mapButton = component('bl1nbbr7');
  mapButton.specials ??= {};
  mapButton.specials.text = 'Xem Chỉ Đường';
  mapButton.events = [{
    action: 'open_link', appTarget: '', hoverColor: '', id: 'thiepcuoi2-map-groom', target: info.map_chu_re, type: 'click',
  }];

  const serialized = stringifyForScript(parsed.data);
  return `${html.slice(0, parsed.jsonStart)}${serialized};${html.slice(parsed.scriptEnd)}`;
}

function buildRuntimeBlock(info) {
  const serializedInfo = stringifyForScript(info);
return `<!-- INVITATION_PARAMETERS_RUNTIME_START -->
<style>
${photoCssOverrides}
  @font-face {
    font-family: "WeddingVietnamese";
    src: url("assets/vendor/95d7ae6de47b7556f6e9.ttf") format("truetype");
    font-display: swap;
  }
  /* Pattaya không có bộ dấu tiếng Việt đầy đủ; chỉ thay font ở khối giờ–thứ trang đầu. */
  #w-prmec0mx .text-block-css {
    font-family: "WeddingVietnamese", serif !important;
    font-weight: 700 !important;
    letter-spacing: 0 !important;
    line-height: 1.3 !important;
  }
  #w-7bb8npau { height: 23px !important; overflow: visible !important; }
  #w-7bb8npau .text-block-css { font-family: "Times New Roman", Times, serif !important; font-size: 14px !important; font-weight: 700 !important; line-height: 1.35 !important; white-space: nowrap; }
  #w-de000ha1, #w-msqshnjl, #w-gehalp48, #w-22a3k3pm { display: none !important; }
  /* Hai phong bì mừng cưới đặt cạnh nhau, mỗi bên chiếm một nửa khung. */
  #w-51jlz896, #w-d70k008b { top: 76px !important; width: 140px !important; height: 142px !important; }
  #w-51jlz896 { left: 58px !important; }
  #w-d70k008b { left: 222px !important; }
  #w-51jlz896 .button-css, #w-d70k008b .button-css {
    position: relative !important;
    overflow: hidden !important;
    border: 2px solid rgba(255, 255, 255, .75) !important;
    border-radius: 10px !important;
    box-shadow: 0 7px 12px rgba(25, 42, 64, .22) !important;
    color: #fff !important;
    font-family: "Times New Roman", Times, serif !important;
    font-size: 16px !important;
    font-weight: 700 !important;
    letter-spacing: 0 !important;
  }
  #w-51jlz896 .button-css { background: #7b4ca0 !important; }
  #w-d70k008b .button-css { background: #243b53 !important; }
  #w-51jlz896 .button-css::before, #w-d70k008b .button-css::before {
    position: absolute;
    z-index: 0;
    inset: 0;
    content: "";
    opacity: .78;
    background:
      linear-gradient(36deg, transparent 49%, rgba(255,255,255,.46) 50%, transparent 51%) left bottom / 50% 54% no-repeat,
      linear-gradient(-36deg, transparent 49%, rgba(255,255,255,.46) 50%, transparent 51%) right bottom / 50% 54% no-repeat,
      linear-gradient(145deg, transparent 49%, rgba(255,255,255,.35) 50%, transparent 51%) left top / 50% 47% no-repeat,
      linear-gradient(-145deg, transparent 49%, rgba(255,255,255,.35) 50%, transparent 51%) right top / 50% 47% no-repeat;
    pointer-events: none;
  }
  #w-51jlz896 .button-text, #w-d70k008b .button-text {
    position: relative;
    z-index: 1;
    display: flex !important;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 11px 8px 20px;
    text-align: center !important;
    line-height: 1.18;
  }
  #w-51jlz896 .button-text small, #w-d70k008b .button-text small { display: block; margin-top: 5px; font-size: 13px; font-weight: 600; }
  #w-zed2wzbl { display: none !important; }
  #w-7b0zbc0a { left: 58px !important; width: 304px !important; }
  #w-7b0zbc0a .text-block-css { text-align: center !important; }
  #w-bl1nbbr7 { left: 142px !important; }
  #w-57pjnd1a .frame-html-box iframe { display: block; width: 100%; height: 100%; border: 0; }
  #w-57pjnd1a .offline-map-note { padding: 12px; color: #16477f; font: 16px/1.45 Arial, sans-serif; text-align: center; }
  #w-57pjnd1a .map-link-card { display: flex; width: 100%; height: 100%; padding: 24px; align-items: center; justify-content: center; flex-direction: column; color: #16477f; text-align: center; }
  #w-57pjnd1a .map-link-card strong { font: 700 19px/1.35 Arial, sans-serif; }
  #w-57pjnd1a .map-link-card p { margin-top: 10px; font: 15px/1.45 Arial, sans-serif; }
  /* Trang đầu: gộp ngày, tháng, năm thành 19.09.2026; bỏ ô năm dạng số mũ. */
  #w-mp0qv73g { display: none !important; }
  #w-wld81o8r { left: 150px !important; width: 180px !important; }
  #w-wld81o8r .text-block-css { font-size: 28px !important; white-space: nowrap; }
  /* Lịch được sinh từ date1/date2 để ô ngày luôn đúng với ?ngay=. */
  #w-ydkqr3qa .image-background { display: none !important; }
  #w-ydkqr3qa .save-date-calendar { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: 30px repeat(6, 1fr); padding: 12px 10px 10px; color: #16477f; font-family: "Times New Roman", Times, serif; }
  #w-ydkqr3qa .save-date-calendar .calendar-weekday { display: flex; align-items: center; justify-content: center; font: 700 13px/1 Arial, sans-serif; }
  #w-ydkqr3qa .save-date-calendar .calendar-day { display: flex; align-items: center; justify-content: center; font: 18px/1 "Times New Roman", Times, serif; }
  #w-ydkqr3qa .save-date-calendar .calendar-day > span { display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; }
  #w-8eshr3wu { display: none !important; }
  #w-ydkqr3qa .save-date-calendar .calendar-day.is-selected > span { width: 38px; height: 38px; background: center / contain no-repeat url("assets/vendor/bfd29327c8d70793e751.webp"); color: #16477f; font-weight: 700; }
  #thiepcuoi2-gift-modal { position: fixed; inset: 0; z-index: 1000001; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, .55); }
  #thiepcuoi2-gift-modal.is-open { display: flex; }
  #thiepcuoi2-gift-modal .gift-dialog { position: relative; width: min(330px, 100%); padding: 28px 24px 24px; border-radius: 18px; background: #fff; color: #243b53; text-align: center; box-shadow: 0 12px 30px rgba(0, 0, 0, .35); }
  #thiepcuoi2-gift-modal .gift-close { position: absolute; top: 8px; right: 12px; padding: 4px 9px; color: inherit; background: transparent; cursor: pointer; font: 28px/1 Arial, sans-serif; }
  #thiepcuoi2-gift-modal img { display: block; width: min(220px, 100%); margin: 12px auto 18px; }
  #thiepcuoi2-gift-modal p { margin: 4px 0; font: 600 16px/1.35 Arial, sans-serif; overflow-wrap: anywhere; }
  #thiepcuoi2-gift-modal .gift-copy { width: 100%; margin-top: 16px; padding: 11px 14px; border-radius: 10px; background: #243b53; color: #fff; cursor: pointer; font: 700 15px/1 Arial, sans-serif; }
  #thiepcuoi2-gift-modal .gift-copy-status { min-height: 18px; margin-top: 8px; color: #27734a; font-size: 13px; }
</style>
<script>
  ;(() => {
    const weddingInfo = ${serializedInfo};
    const params = new URLSearchParams(window.location.search);
    const ngay = params.get('ngay') === '1' ? '1' : '2';
    const addr = params.get('addr') === 'dau' ? 'dau' : 're';
    const guestName = (params.get('name') || '').trim();
    const textNode = id => document.querySelector('#w-' + id + ' .text-block-css');
    const setText = (id, value) => { const node = textNode(id); if (node) node.textContent = value; };
    const setHtml = (id, value) => { const node = textNode(id); if (node) node.innerHTML = value; };
    const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    const addressHtml = value => {
      const lines = String(value).trim().split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length > 1) return lines.map(escapeHtml).join('<br>');
      const parts = lines[0].split(',').map(part => part.trim()).filter(Boolean);
      return parts.length < 2 ? escapeHtml(value) : escapeHtml(parts.slice(0, -1).join(', ') + ',') + '<br>' + escapeHtml(parts.at(-1));
    };
    const dotDate = value => value.replaceAll('/', '.');
    const dayEvent = ngay === '1'
      ? { date: weddingInfo.date1, day: weddingInfo.day1, time: weddingInfo.time1, lunar: weddingInfo.date1_am }
      : { date: weddingInfo.date2, day: weddingInfo.day2, time: weddingInfo.time2, lunar: weddingInfo.date2_am };
    const eventDateParts = dayEvent.date.split('/');
    const eventDay = eventDateParts[0].padStart(2, '0');
    const eventMonth = eventDateParts[1].padStart(2, '0');
    const eventYear = eventDateParts[2];
    const venue = addr === 'dau'
      ? { label: 'Tại tư gia nhà gái', address: weddingInfo.diachi_co_dau, map: weddingInfo.map_co_dau, embed: weddingInfo.map_embed_co_dau, title: 'Xem chỉ đường đến nhà gái' }
      : { label: 'Tại tư gia nhà trai', address: weddingInfo.diachi_chu_re, map: weddingInfo.map_chu_re, embed: weddingInfo.map_embed_chu_re, title: 'Xem chỉ đường đến nhà trai' };

    const fitInvitationTitle = () => {
      const box = document.getElementById('w-8ohgoryu');
      const title = textNode('8ohgoryu');
      if (!box || !title) return;
      box.style.left = '20px'; box.style.width = '380px'; box.style.height = '57px';
      title.style.whiteSpace = 'nowrap'; title.style.overflow = 'visible'; title.style.fontSize = '38px';
      if (box.clientWidth && title.scrollWidth > box.clientWidth) title.style.fontSize = Math.max(22, Math.floor(38 * box.clientWidth / title.scrollWidth)) + 'px';
    };

    const ensureGiftModal = () => {
      let modal = document.getElementById('thiepcuoi2-gift-modal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'thiepcuoi2-gift-modal';
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = '<div class="gift-dialog" role="dialog" aria-modal="true" aria-label="Thông tin mừng cưới"><button type="button" class="gift-close" aria-label="Đóng">×</button><p data-gift-title></p><img alt="Mã QR mừng cưới"><p data-gift-bank></p><p data-gift-holder></p><p data-gift-number></p><button type="button" class="gift-copy" data-copy-account>Sao chép số tài khoản</button><p class="gift-copy-status" data-copy-status aria-live="polite"></p></div>';
      modal.addEventListener('click', event => { if (event.target === modal || event.target.closest('.gift-close')) { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); } });
      modal.querySelector('[data-copy-account]').addEventListener('click', async () => {
        const number = modal.dataset.accountNumber;
        const status = modal.querySelector('[data-copy-status]');
        const button = modal.querySelector('[data-copy-account]');
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
      document.addEventListener('keydown', event => { if (event.key === 'Escape') { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); } });
      document.body.append(modal);
      return modal;
    };

    const showGift = person => {
      const gift = person === 'dau'
        ? { title: 'Mừng cưới cho cô dâu', qr: 'assets/images/qr_codau.jpg', bank: weddingInfo.account_bank_co_dau, holder: weddingInfo.account_name_co_dau, number: weddingInfo.account_number_co_dau }
        : { title: 'Mừng cưới cho chú rể', qr: 'assets/images/qr_chure.jpg', bank: weddingInfo.account_bank_chu_re, holder: weddingInfo.account_name_chu_re, number: weddingInfo.account_number_chu_re };
      const modal = ensureGiftModal();
      modal.querySelector('[data-gift-title]').textContent = gift.title;
      modal.querySelector('img').src = gift.qr;
      modal.querySelector('[data-gift-bank]').textContent = gift.bank;
      modal.querySelector('[data-gift-holder]').textContent = gift.holder;
      modal.querySelector('[data-gift-number]').textContent = gift.number;
      modal.dataset.accountNumber = gift.number;
      modal.querySelector('[data-copy-account]').textContent = 'Sao chép số tài khoản';
      modal.querySelector('[data-copy-status]').textContent = '';
      modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false');
    };

    const configureGiftButtons = () => {
      [['w-51jlz896', 'dau', 'Gửi mừng cưới cho cô dâu', 'Gửi mừng cưới<br><small>cho cô dâu</small>'], ['w-d70k008b', 're', 'Gửi mừng cưới cho chú rể', 'Gửi mừng cưới<br><small>cho chú rể</small>']].forEach(([id, person, label, labelHtml]) => {
        let button = document.getElementById(id);
        if (!button) return;
        if (!button.dataset.giftReady) { const replacement = button.cloneNode(true); replacement.dataset.giftReady = 'true'; button.replaceWith(replacement); button = replacement; button.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); showGift(person); }, true); }
        button.setAttribute('aria-label', label);
        const text = button.querySelector('.button-text'); if (text) text.innerHTML = labelHtml;
      });
    };

    const configureVenue = () => {
      setText('7b0zbc0a', venue.label);
      const current = textNode('5ude64d5');
      if (current) {
        let link = current;
        if (current.tagName !== 'A') { link = document.createElement('a'); link.className = current.className; current.replaceWith(link); }
        link.textContent = venue.label; link.href = venue.map; link.title = venue.title; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.style.color = 'inherit'; link.style.cursor = 'pointer'; link.style.display = 'block'; link.style.textDecoration = 'none';
      }
      let button = document.getElementById('w-bl1nbbr7');
      if (button && !button.dataset.mapReady) { const replacement = button.cloneNode(true); replacement.dataset.mapReady = 'true'; button.replaceWith(replacement); button = replacement; }
      if (button) { button.href = venue.map; button.title = venue.title; button.target = '_blank'; button.rel = 'noopener noreferrer'; }
      const mapBox = document.querySelector('#w-57pjnd1a .frame-html-box');
      const useEmbeddedMap = weddingInfo.map_mode === 'embed' && venue.embed;
      const mapSource = useEmbeddedMap ? venue.embed : 'link';
      if (!mapBox || mapBox.dataset.mapSource === mapSource) return;
      mapBox.dataset.mapSource = mapSource;
      if (!useEmbeddedMap) { mapBox.innerHTML = '<div class="map-link-card"><strong>Mở vị trí trong Google Maps</strong><p>' + escapeHtml(venue.address) + '</p></div>'; return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { mapBox.innerHTML = '<p class="offline-map-note">Bản đồ tương tác cần có Internet. Hãy bấm “Xem Chỉ Đường”.</p>'; return; }
      const iframe = document.createElement('iframe');
      iframe.src = venue.embed; iframe.title = venue.title; iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer-when-downgrade'; iframe.allowFullscreen = true;
      mapBox.replaceChildren(iframe);
    };

    const renderSaveDateCalendar = date => {
      const host = document.getElementById('w-ydkqr3qa');
      const surface = host && host.querySelector('.image-block-css');
      if (!surface) return;
      let calendar = surface.querySelector('.save-date-calendar');
      if (!calendar) { calendar = document.createElement('div'); calendar.className = 'save-date-calendar'; surface.append(calendar); }
      const parts = date.split('/');
      const targetDay = Number(parts[0]);
      const month = Number(parts[1]);
      const year = Number(parts[2]);
      const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
      const daysInMonth = new Date(year, month, 0).getDate();
      const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      calendar.replaceChildren();
      labels.forEach(label => { const cell = document.createElement('div'); cell.className = 'calendar-weekday'; cell.textContent = label; calendar.append(cell); });
      for (let cellNumber = 0; cellNumber < 42; cellNumber += 1) {
        const day = cellNumber - firstWeekday + 1;
        const cell = document.createElement('div');
        cell.className = 'calendar-day' + (day === targetDay ? ' is-selected' : '');
        if (day >= 1 && day <= daysInMonth) { const number = document.createElement('span'); number.textContent = String(day); cell.append(number); }
        calendar.append(cell);
      }
    };

    const update = () => {
      const couple = weddingInfo.chu_re + ' & ' + weddingInfo.co_dau;
      document.title = 'Lễ Thành Hôn ' + couple;
      document.documentElement.dataset.ngay = ngay; document.documentElement.dataset.addr = addr;
      window.invitationParameters = { name: guestName, ngay, addr };
      setText('38zal5r1', couple);
      setText('7bb8npau', 'THAM DỰ LỄ CƯỚI CỦA ' + couple.toLocaleUpperCase('vi-VN'));
      setText('8ohgoryu', 'Thư mời ' + (guestName || 'Quý Khách'));
      setText('mp0qv73g', '');
      setText('wld81o8r', dotDate(dayEvent.date)); setHtml('prmec0mx', escapeHtml(dayEvent.time) + '<br>' + escapeHtml(dayEvent.day.toLocaleUpperCase('vi-VN'))); setText('a4yahdeg', '(' + dayEvent.lunar + ')');
      setHtml('a75853g7', 'Vào Lúc ' + escapeHtml(dayEvent.time) + ' | ' + escapeHtml(dayEvent.day)); setText('401v089d', dotDate(dayEvent.date)); setText('4ipoia3c', '(' + dayEvent.lunar + ')');
      setHtml('uemt5u4a', 'NHÀ TRAI<br>ÔNG: ' + escapeHtml(weddingInfo.bo_chu_re) + '<br>BÀ: ' + escapeHtml(weddingInfo.me_chu_re)); setHtml('1muauw0u', addressHtml(weddingInfo.diachi_chu_re)); setText('dzaip52a', weddingInfo.chu_re);
      setHtml('mkjphr7o', 'NHÀ GÁI<br>ÔNG: ' + escapeHtml(weddingInfo.bo_co_dau) + '<br>BÀ: ' + escapeHtml(weddingInfo.me_co_dau)); setHtml('u1a2mvp7', addressHtml(weddingInfo.diachi_co_dau)); setText('ca35y7bn', weddingInfo.co_dau);
      setHtml('6ae5a842', 'Save The Date<br>Tháng ' + eventMonth + ' . ' + eventYear);
      fitInvitationTitle(); configureGiftButtons(); configureVenue(); renderSaveDateCalendar(dayEvent.date);
    };
    update();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(update), { once: true });
    else requestAnimationFrame(update);
    window.addEventListener('load', () => requestAnimationFrame(update), { once: true });
    document.fonts && document.fonts.ready && document.fonts.ready.then(() => requestAnimationFrame(update));
  })();
</script>
<!-- INVITATION_PARAMETERS_RUNTIME_END -->`;
}

function replaceRuntimeBlock(html, block) {
  const pattern = /<!-- INVITATION_PARAMETERS_RUNTIME_START -->[\s\S]*?<!-- INVITATION_PARAMETERS_RUNTIME_END -->/;
  if (!pattern.test(html)) throw new Error('Không tìm thấy khối INVITATION_PARAMETERS_RUNTIME trong index.html.');
  return html.replace(pattern, block);
}

function updateStaticHtml(html, info) {
  const title = `Lễ Thành Hôn ${info.chu_re} & ${info.co_dau}`;
  const couple = `${info.chu_re} & ${info.co_dau}`;
  html = replaceExactly(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`, 'tiêu đề trang');
  html = replaceExactly(html, /<link\b(?=[^>]*\brel=["']icon["'])[^>]*>/i, '<link rel="icon" href="assets/images/photo-start.jpg" sizes="16x16" />', 'favicon');
  html = replaceExactly(html, /<meta\s+property=["']og:title["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta property="og:title" content="${escapeHtml(title)}">`, 'tiêu đề chia sẻ');
  photoSlots.forEach((id, index) => {
    html = replaceImageBlockSource(html, id, `assets/images/${photoNames[index]}`);
  });
  const blocks = {
    mp0qv73g: '',
    wld81o8r: `${dotDate(info.date2)}<br>`,
    prmec0mx: `${escapeHtml(info.time2)}<br>${escapeHtml(upper(info.day2))}<br>`,
    a4yahdeg: `${escapeHtml(lunar(info.date2_am))}<br>`,
    '38zal5r1': escapeHtml(couple),
    '8ohgoryu': 'Thư mời Quý Khách<br>',
    '7bb8npau': `THAM DỰ LỄ CƯỚI CỦA ${escapeHtml(upper(couple))}<br>`,
    a75853g7: `Vào Lúc ${escapeHtml(info.time2)} | ${escapeHtml(info.day2)}<br>`,
    '401v089d': `${escapeHtml(dotDate(info.date2))}<br>`,
    '4ipoia3c': `${escapeHtml(lunar(info.date2_am))}<br>`,
    '5ude64d5': 'Tại tư gia nhà trai<br>',
    uemt5u4a: `NHÀ TRAI<br>ÔNG: ${escapeHtml(info.bo_chu_re)}<br>BÀ: ${escapeHtml(info.me_chu_re)}<br>`,
    '1muauw0u': `${addressHtml(info.diachi_chu_re)}<br>`,
    dzaip52a: `${escapeHtml(info.chu_re)}<br>`,
    mkjphr7o: `NHÀ GÁI<br>ÔNG: ${escapeHtml(info.bo_co_dau)}<br>BÀ: ${escapeHtml(info.me_co_dau)}<br>`,
    u1a2mvp7: `${addressHtml(info.diachi_co_dau)}<br>`,
    ca35y7bn: `${escapeHtml(info.co_dau)}<br>`,
    msqshnjl: `${escapeHtml(upper(info.day2))} | ${escapeHtml(upper(info.time2))}<br>`,
    gehalp48: `${escapeHtml(dotDate(info.date2))}<br>`,
    '22a3k3pm': `${escapeHtml(lunar(info.date2_am))}<br>`,
    '6ae5a842': `Save The Date<br>Tháng ${String(info.date2Parts.month).padStart(2, '0')} . ${info.date2Parts.year}<br>`,
    '7b0zbc0a': 'Tại tư gia nhà trai<br>',
    zed2wzbl: '',
    k0phc799: `${escapeHtml(upper(info.account_bank_chu_re))}<br>${escapeHtml(upper(info.account_name_chu_re))}<br>${escapeHtml(info.account_number_chu_re)}<br>`,
  };
  for (const [id, value] of Object.entries(blocks)) html = replaceTextBlock(html, id, value);
  html = replaceAnchorById(html, 'bl1nbbr7', info.map_chu_re, 'Xem chỉ đường đến nhà trai');
  html = updateEventData(html, info);
  return replaceRuntimeBlock(html, buildRuntimeBlock(info));
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function isJpeg(path) {
  const bytes = await readFile(path);
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function readDirectoryFiles(directory, label) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Không thể đọc ${label} (${directory}): ${error.message}`);
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

async function inspectImages() {
  const sourceFiles = await readDirectoryFiles(sourceImagesDir, 'thư mục images-update2');
  const missing = requiredSourceImageNames.filter((name) => !sourceFiles.includes(name));
  if (missing.length > 0) throw new Error(`images-update2 thiếu ảnh bắt buộc: ${missing.join(', ')}.`);

  const extraPhotos = sourceFiles.filter((name) => /^photo-\d+\.jpg$/i.test(name) && !sourcePhotoNames.includes(name));
  if (extraPhotos.length > 0) warnings.push(`Ảnh nguồn không được template render (đã bỏ qua): ${extraPhotos.join(', ')}.`);
  const otherFiles = sourceFiles.filter((name) => !requiredSourceImageNames.includes(name) && !extraPhotos.includes(name) && !name.startsWith('.'));
  if (otherFiles.length > 0) warnings.push(`Tệp nguồn không dùng để cập nhật thiệp (đã bỏ qua): ${otherFiles.join(', ')}.`);

  for (const { sourceName } of imagePairs) {
    const path = resolve(sourceImagesDir, sourceName);
    const details = await stat(path);
    if (!details.isFile() || details.size === 0 || !(await isJpeg(path))) {
      throw new Error(`Ảnh nguồn ${sourceName} không phải JPEG hợp lệ.`);
    }
  }

  const targetFiles = await readDirectoryFiles(targetImagesDir, 'thư mục thiepcuoi2/assets/images');
  const staleTarget = targetFiles.filter((name) => (/^photo-\d+\.jpg$/i.test(name) || /^qr_(?:chure|codau)\.jpg$/i.test(name)) && !requiredImageNames.includes(name));
  if (staleTarget.length > 0) warnings.push(`Ảnh cũ trong assets/images không thuộc template 18 ảnh: ${staleTarget.join(', ')}. Tool không tự xoá.`);

  const changes = [];
  for (const pair of imagePairs) {
    const source = resolve(sourceImagesDir, pair.sourceName);
    const target = resolve(targetImagesDir, pair.targetName);
    let same = false;
    try { same = (await sha256(source)) === (await sha256(target)); } catch { same = false; }
    if (!same) changes.push(pair);
  }
  return { changes, sourceFiles, targetFiles };
}

async function copyImageAtomically({ sourceName, targetName }) {
  const source = resolve(sourceImagesDir, sourceName);
  const target = resolve(targetImagesDir, targetName);
  const temporary = `${target}.updating-${process.pid}`;
  await copyFile(source, temporary);
  await rename(temporary, target);
  if ((await sha256(source)) !== (await sha256(target))) throw new Error(`Kiểm tra sau khi chép thất bại: ${targetName}.`);
}

function referencedImageNames(html) {
  return new Set([...html.matchAll(/assets\/images\/([A-Za-z0-9_-]+\.jpg)/g)].map((match) => match[1]));
}

async function main() {
  let rawInfo;
  try { rawInfo = JSON.parse(await readFile(infoPath, 'utf8')); } catch (error) { throw new Error(`Không đọc được info.json (${infoPath}): ${error.message}`); }
  if (!rawInfo || Array.isArray(rawInfo) || typeof rawInfo !== 'object') throw new Error('info.json phải là một JSON object.');

  const generatedEmbeds = [];
  if (resolveMapEmbeds) {
    for (const [mapKey, embedKey] of [['map_chu_re', 'map_embed_chu_re'], ['map_co_dau', 'map_embed_co_dau']]) {
      if (optionalUrl(rawInfo, embedKey)) continue;
      const mapUrl = normalizeUrl(requiredString(rawInfo, mapKey), mapKey);
      rawInfo[embedKey] = await resolveGoogleMapEmbed(mapUrl, mapKey);
      generatedEmbeds.push(embedKey);
    }
  }

  const info = {
    chu_re: requiredString(rawInfo, 'chu_re'), co_dau: requiredString(rawInfo, 'co_dau'),
    time1: requiredString(rawInfo, 'time1'), day1: requiredString(rawInfo, 'day1'), date1: requiredString(rawInfo, 'date1'), date1_am: requiredString(rawInfo, 'date1_am'),
    time2: requiredString(rawInfo, 'time2'), day2: requiredString(rawInfo, 'day2'), date2: requiredString(rawInfo, 'date2'), date2_am: requiredString(rawInfo, 'date2_am'),
    bo_chu_re: requiredString(rawInfo, 'bo_chu_re'), me_chu_re: requiredString(rawInfo, 'me_chu_re'),
    bo_co_dau: requiredString(rawInfo, 'bo_co_dau'), me_co_dau: requiredString(rawInfo, 'me_co_dau'),
    diachi_chu_re: requiredString(rawInfo, 'diachi_chu_re'), map_chu_re: normalizeUrl(requiredString(rawInfo, 'map_chu_re'), 'map_chu_re'),
    diachi_co_dau: requiredString(rawInfo, 'diachi_co_dau'), map_co_dau: normalizeUrl(requiredString(rawInfo, 'map_co_dau'), 'map_co_dau'),
    account_name_chu_re: requiredString(rawInfo, 'account_name_chu_re'), account_bank_chu_re: requiredString(rawInfo, 'account_bank_chu_re'), account_number_chu_re: requiredString(rawInfo, 'account_number_chu_re'),
    account_name_co_dau: requiredString(rawInfo, 'account_name_co_dau'), account_bank_co_dau: requiredString(rawInfo, 'account_bank_co_dau'), account_number_co_dau: requiredString(rawInfo, 'account_number_co_dau'),
    map_embed_chu_re: optionalUrl(rawInfo, 'map_embed_chu_re'), map_embed_co_dau: optionalUrl(rawInfo, 'map_embed_co_dau'),
    map_mode: mapMode(rawInfo),
  };
  info.date1Parts = parseDate(info.date1, 'date1');
  info.date2Parts = parseDate(info.date2, 'date2');
  if (info.map_mode === 'embed' && !info.map_embed_chu_re) warnings.push('Thiếu map_embed_chu_re: nhà trai không thể hiện bản đồ nhúng.');
  if (info.map_mode === 'embed' && !info.map_embed_co_dau) warnings.push('Thiếu map_embed_co_dau: nhà gái không thể hiện bản đồ nhúng.');
  if (info.map_mode === 'link' && (info.map_embed_chu_re || info.map_embed_co_dau)) warnings.push('map_embed_* đang có nhưng bị tắt theo map_mode="link" để thiệp không phụ thuộc VPN/dịch vụ bản đồ bên ngoài.');

  const originalHtml = await readFile(htmlPath, 'utf8');
  const updatedHtml = updateStaticHtml(originalHtml, info);
  const imageReport = await inspectImages();
  const referenced = referencedImageNames(updatedHtml);
  const unreferenced = requiredImageNames.filter((name) => !referenced.has(name));
  const unexpectedReferences = [...referenced].filter((name) => !requiredImageNames.includes(name));
  if (unreferenced.length > 0) throw new Error(`index.html không tham chiếu các ảnh bắt buộc: ${unreferenced.join(', ')}.`);
  if (unexpectedReferences.length > 0) warnings.push(`index.html còn tham chiếu ảnh ngoài bộ 18 ảnh: ${unexpectedReferences.join(', ')}.`);

  const htmlChanged = originalHtml !== updatedHtml;
  console.log(`Đã kiểm tra: ${infoPath}`);
  console.log(`- index.html: ${htmlChanged ? 'cần cập nhật' : 'đã khớp'}`);
  console.log(`- ảnh cá nhân: ${imageReport.changes.length ? `cần chép ${imageReport.changes.length}/${requiredImageNames.length} tệp` : 'đã khớp'}`);
  if (generatedEmbeds.length > 0) console.log(`- đã tạo tự động: ${generatedEmbeds.join(', ')}`);
  if (warnings.length > 0) {
    console.log('Cảnh báo cần biết:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (checkOnly) {
    if (htmlChanged || imageReport.changes.length > 0) {
      console.log('Kết quả: CHƯA ĐỒNG BỘ. Chạy không có --check để cập nhật.');
      process.exitCode = 2;
    } else console.log('Kết quả: ĐÃ ĐỒNG BỘ.');
    return;
  }
  if (dryRun) {
    console.log('Dry run: không có file nào được thay đổi.');
    return;
  }

  await mkdir(targetImagesDir, { recursive: true });
  for (const name of imageReport.changes) await copyImageAtomically(name);
  if (htmlChanged) {
    const temporaryHtml = `${htmlPath}.updating-${process.pid}`;
    await writeFile(temporaryHtml, updatedHtml);
    await rename(temporaryHtml, htmlPath);
  }
  if (generatedEmbeds.length > 0) {
    const temporaryInfo = `${infoPath}.updating-${process.pid}`;
    await writeFile(temporaryInfo, `${JSON.stringify(rawInfo, null, 2)}\n`);
    await rename(temporaryInfo, infoPath);
  }
  console.log(`Đã cập nhật thiepcuoi2 cho ${info.chu_re} & ${info.co_dau}.`);
  console.log(`- ${htmlPath}`);
  console.log(`- ${targetImagesDir}`);
}

main().catch((error) => {
  console.error(`Lỗi: ${error.message}`);
  process.exitCode = 1;
});
