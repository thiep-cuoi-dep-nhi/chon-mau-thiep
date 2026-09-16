#!/usr/bin/env node

/**
 * Đưa phần Thư Mời và Bữa Cơm Thân Mật lên trước câu trích mở đầu.
 * Chạy: node scripts/reorder-invitation-sections.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
const sectionToMove = ['w-f87zzpka', 'w-s9lg37rj'];
const quoteSection = 'w-pvge5jg4';

function sectionBlocks(html) {
  const starts = [...html.matchAll(/<div\s+id="(w-[^"]+)"\s+class="com-section[^>]*>/g)]
    .map((match) => ({ id: match[1], start: match.index }));

  return starts.map((section) => {
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = section.start;
    let depth = 0;
    let end = -1;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = tags.lastIndex;
        break;
      }
    }
    if (end === -1) throw new Error(`Không thể xác định phần cuối của ${section.id}.`);
    return { ...section, end };
  });
}

function moveStaticSections(html) {
  const blocks = sectionBlocks(html);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const moveStart = byId.get(sectionToMove[0]);
  const moveEnd = byId.get(sectionToMove.at(-1));
  const quote = byId.get(quoteSection);

  if (!moveStart || !moveEnd || !quote) throw new Error('Không tìm thấy các phần cần đổi thứ tự.');
  if (moveEnd.end < quote.start) return html;

  const moved = html.slice(moveStart.start, moveEnd.end);
  const withoutMoved = `${html.slice(0, moveStart.start)}${html.slice(moveEnd.end)}`;
  const quoteAt = withoutMoved.indexOf(`id="${quoteSection}"`);
  const insertionAt = withoutMoved.lastIndexOf('<div', quoteAt);
  if (insertionAt === -1) throw new Error('Không tìm thấy vị trí để chèn phần Thư Mời.');
  return `${withoutMoved.slice(0, insertionAt)}${moved}${withoutMoved.slice(insertionAt)}`;
}

function reorderEventData(html, originalSections, orderedSections) {
  const marker = '<script type="text/javascript" id="event_data">window.event_data=';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('Không tìm thấy event_data của thiệp.');
  const valueStart = start + marker.length;
  const valueEnd = html.indexOf('</script>', valueStart);
  const data = JSON.parse(html.slice(valueStart, valueEnd).replace(/;\s*$/, ''));
  const entries = Object.entries(data.runtime.vm);
  const positions = new Map(entries.map(([id], index) => [id, index]));

  const groups = new Map();
  for (let index = 0; index < originalSections.length; index += 1) {
    const id = originalSections[index];
    const vmId = id.replace(/^w-/, '');
    const nextVmId = index + 1 < originalSections.length
      ? originalSections[index + 1].replace(/^w-/, '')
      : null;
    const groupStart = positions.get(vmId);
    const groupEnd = index + 1 < originalSections.length
      ? positions.get(nextVmId)
      : entries.length;
    if (groupStart === undefined || groupEnd === undefined) throw new Error(`Không tìm thấy dữ liệu cho ${id}.`);
    groups.set(id, entries.slice(groupStart, groupEnd));
  }
  data.runtime.vm = Object.fromEntries(orderedSections.flatMap((id) => groups.get(id)));
  return `${html.slice(0, valueStart)}${JSON.stringify(data)}${html.slice(valueEnd)}`;
}

let html = await readFile(htmlPath, 'utf8');
const originalOrder = sectionBlocks(html).map((block) => block.id);
const reorderedSections = originalOrder.filter((id) => !sectionToMove.includes(id));
const quoteIndex = reorderedSections.indexOf(quoteSection);
reorderedSections.splice(quoteIndex, 0, ...sectionToMove);

html = moveStaticSections(html);
html = reorderEventData(html, originalOrder, reorderedSections);
await writeFile(htmlPath, html);

const finalOrder = sectionBlocks(html).map((block) => block.id);
if (finalOrder.indexOf(sectionToMove[0]) > finalOrder.indexOf(quoteSection)
  || finalOrder.indexOf(sectionToMove[1]) > finalOrder.indexOf(quoteSection)) {
  throw new Error('Đổi thứ tự phần hiển thị không thành công.');
}

console.log('Đã đưa Thư Mời và Bữa Cơm Thân Mật lên trước câu trích “Hôn nhân là chuyện cả đời…”.');
