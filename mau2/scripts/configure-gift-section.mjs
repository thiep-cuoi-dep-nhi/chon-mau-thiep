#!/usr/bin/env node

/**
 * Cấu hình vùng mừng cưới: hai nút cô dâu/chú rể, không còn RSVP.
 * Chạy: node scripts/configure-gift-section.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
const marker = '<script type="text/javascript" id="event_data">window.event_data=';
const html = await readFile(htmlPath, 'utf8');
const valueStart = html.indexOf(marker) + marker.length;
const valueEnd = html.indexOf('</script>', valueStart);

if (valueStart === marker.length || valueEnd === -1) throw new Error('Không tìm thấy event_data.');

const data = JSON.parse(html.slice(valueStart, valueEnd).replace(/;\s*$/, ''));
const brideButton = data.runtime.vm['51jlz896'];
const groomButton = data.runtime.vm.d70k008b;
if (!brideButton || !groomButton) throw new Error('Không tìm thấy hai nút mừng cưới.');

brideButton.specials.text = 'Mừng cưới cho cô dâu';
brideButton.events = [];
groomButton.specials.text = 'Mừng cưới cho chú rể';

const updated = `${html.slice(0, valueStart)}${JSON.stringify(data)}${html.slice(valueEnd)}`;
await writeFile(htmlPath, updated);
console.log('Đã thay nút RSVP bằng nút mừng cưới cô dâu và giữ nút mừng cưới chú rể.');
