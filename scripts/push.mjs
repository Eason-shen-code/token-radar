// 把 data/latest.json 推送到云端（可在任意环境运行：本机 / GitHub Actions / 云函数 / 容器）
// 用法：INGEST_TOKEN=xxx node scripts/push.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);

// endpoint 与 publishableKey 是公开配置（仅标识应用，无写权限），可安全内置于脚本
const PUBLIC = {
  endpoint: 'https://ai-token-price-radar.app.workbuddy.host',
  publishableKey: 'wbpk_WrIQWYOUJjbr1mwyDHziWZ_hFp2n35XQIMB21DcqEcxNfy1Aatjgmeo'
};

let local = {};
try { local = JSON.parse(await fs.readFile(P('config/ingest.json'), 'utf8')); } catch { /* CI 环境没有该文件，正常 */ }

const endpoint = process.env.CLOUD_ENDPOINT || local.endpoint || PUBLIC.endpoint;
const accessKey = process.env.CLOUD_ACCESS_KEY || local.publishableKey || PUBLIC.publishableKey;
const token = process.env.INGEST_TOKEN || local.ingestToken;

if (!token) {
  process.stderr.write('缺少写入令牌：请设置环境变量 INGEST_TOKEN（或在本机 config/ingest.json 里配置 ingestToken）\n');
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(P('data/latest.json'), 'utf8'));

const res = await fetch(`${endpoint}/.cloud/database/rest/rpc/ingest_snapshot`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-wb-webapp-access-key': accessKey,
    Origin: endpoint
  },
  body: JSON.stringify({ p_token: token, p_payload: payload })
});

const text = await res.text();
if (!res.ok) {
  process.stderr.write(`推送失败 HTTP ${res.status}: ${text.slice(0, 400)}\n`);
  process.exit(1);
}

let out;
try { out = JSON.parse(text); } catch { out = text; }
process.stdout.write(`推送成功：${JSON.stringify(out)}\n`);
