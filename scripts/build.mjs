// 把 latest.json 内联进页面，产出单文件可分享 HTML
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);

const latest = JSON.parse(await fs.readFile(P('data/latest.json'), 'utf8'));
const tpl = await fs.readFile(P('public/template.html'), 'utf8');

// 云 SDK 内联：分享站点对静态资源有 sharecode 门禁，外链请求会被拦，内联最稳
let sdk = '';
try {
  sdk = await fs.readFile(P('public/vendor/workbuddy-cloud-sdk.js'), 'utf8');
} catch {
  process.stdout.write('警告：未找到 public/vendor/workbuddy-cloud-sdk.js，页面将退化为纯静态（无云端历史）\n');
}
sdk = sdk.replace(/<\/script/gi, '<\\/script');

const payload = JSON.stringify(latest).replace(/</g, '\\u003c');
const html = tpl.replace('/*__SDK__*/', sdk).replace('__PAYLOAD__', payload);

await fs.writeFile(P('public/index.html'), html, 'utf8');
await fs.writeFile(P('public/data.json'), JSON.stringify(latest, null, 2), 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
process.stdout.write(`页面已生成：public/index.html (${kb} KB) · 抓取时间 ${latest.stamp}\n`);
