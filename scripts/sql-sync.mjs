// 把 data/latest.json 转成可逐条执行的 SQL 文件（云数据库写入走管理端，页面只读）
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const OUT = P('.cache');

const d = JSON.parse(await fs.readFile(P('data/latest.json'), 'utf8'));
const date = d.asOfDate;
const h = d.health || {};

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null || Number.isNaN(Number(v)) ? 'NULL' : Number(v));

const stmts = [];

stmts.push(`INSERT INTO price_snapshots (as_of_date, stamp, baseline_version, a_ok, a_fail, b_ok, b_fail, quote_count, diff_count)
VALUES ('${date}', ${q(d.stamp)}, ${q(d.baselineVersion)}, ${h.aOk || 0}, ${h.aFail || 0}, ${h.bOk || 0}, ${h.bFail || 0}, ${(d.liveQuotes || []).length}, ${(d.diffs || []).length})
ON CONFLICT (as_of_date) DO UPDATE SET stamp = EXCLUDED.stamp, baseline_version = EXCLUDED.baseline_version,
  a_ok = EXCLUDED.a_ok, a_fail = EXCLUDED.a_fail, b_ok = EXCLUDED.b_ok, b_fail = EXCLUDED.b_fail,
  quote_count = EXCLUDED.quote_count, diff_count = EXCLUDED.diff_count`);

stmts.push(`DELETE FROM price_diffs WHERE as_of_date = '${date}'`);

if ((d.diffs || []).length) {
  const vals = d.diffs.map(x =>
    `('${date}', ${q(x.scope)}, ${q(x.title)}, ${q(x.from)}, ${q(x.to)}, ${n(x.pct)}, ${q(x.kind)})`
  );
  stmts.push(`INSERT INTO price_diffs (as_of_date, scope, title, from_value, to_value, pct, kind) VALUES\n${vals.join(',\n')}`);
}

stmts.push(`DELETE FROM price_quotes WHERE as_of_date = '${date}'`);

if ((d.liveQuotes || []).length) {
  const vals = d.liveQuotes.map(x =>
    `('${date}', ${q(x.key)}, ${q(x.label)}, ${q(x.source)}, ${q(x.billing)}, ${n(x.input)}, ${n(x.inputCacheHit)}, ${n(x.output)}, ${n(x.blended)}, ${q(x.unit || '元/百万Token')})`
  );
  stmts.push(`INSERT INTO price_quotes (as_of_date, quote_key, label, source, billing, input_price, cache_hit_price, output_price, blended, unit) VALUES\n${vals.join(',\n')}`);
}

await fs.mkdir(OUT, { recursive: true });
for (let i = 0; i < stmts.length; i++) {
  await fs.writeFile(path.join(OUT, `sync-${i + 1}.sql`), stmts[i] + '\n', 'utf8');
}
// 清掉上一轮多余的编号文件
for (let i = stmts.length + 1; i <= 8; i++) {
  await fs.rm(path.join(OUT, `sync-${i}.sql`), { force: true });
}

process.stdout.write(`已生成 ${stmts.length} 条同步 SQL（.cache/sync-*.sql），日期 ${date}，报价 ${(d.liveQuotes || []).length} 条，变动 ${(d.diffs || []).length} 条\n`);
