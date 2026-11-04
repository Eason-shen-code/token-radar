// 主流程：抓取 → 解析 → 计算 → 比对 → 落盘
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, htmlToReadableText, shortHash, round } from './http.mjs';
import { parseZhipuApiPricing, parseZhipuPlan, parseDeepseekPricing, parseOpenrouter, extractPriceSignals } from './parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);

const readJson = async (p, fb = null) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } };
const writeJson = async (p, o) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(o, null, 2), 'utf8'); };

const cfg = await readJson(P('config/sources.json'));
const baseline = await readJson(P('data/baseline.json'));
const prevWatch = await readJson(P('data/watch-state.json'), { sources: {} });
const prevLatest = await readJson(P('data/latest.json'), null);

const now = new Date();
const asOfDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replace(/\//g, '-');
const stamp = `${asOfDate} ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}`;

const health = { aOk: 0, aFail: 0, bOk: 0, bFail: 0, bChanged: 0 };
const sources = [];
const diffs = [];

/* ---------- A 级：确定性抓取 ---------- */
const autoById = Object.fromEntries(cfg.autoSources.map(s => [s.id, s]));
const autoResults = {};

await Promise.all(cfg.autoSources.map(async (src) => {
  const r = await fetchText(src.url);
  const rec = { id: src.id, name: src.name, url: src.url, tier: 'A', status: 'fail', ms: r.ms, parsed: false };
  if (!r.ok || !r.text) {
    rec.error = r.error || `HTTP ${r.status}`;
    health.aFail++; sources.push(rec); return;
  }
  try {
    if (src.id === 'zhipu-api') {
      const rows = parseZhipuApiPricing(r.text);
      autoResults.zhipuApi = rows;
      rec.parsed = rows.length > 0;
      rec.items = rows.length;
    } else if (src.id === 'zhipu-plan') {
      const plans = parseZhipuPlan(r.text);
      autoResults.zhipuPlan = plans;
      rec.parsed = plans.length > 0;
      rec.items = plans.length;
    } else if (src.id === 'deepseek-api') {
      const ds = parseDeepseekPricing(r.text);
      autoResults.deepseek = ds;
      rec.parsed = ds.ok;
      rec.items = Object.keys(ds.models).length;
      rec.columns = ds.columns;
    } else if (src.id === 'openrouter') {
      const or = parseOpenrouter(r.text, cfg.fx.usdCny);
      autoResults.openrouter = or;
      rec.parsed = or.ok;
      rec.items = or.list.length;
    }
    rec.status = rec.parsed ? 'ok' : 'parse-fail';
    rec.parsed ? health.aOk++ : health.aFail++;
  } catch (e) {
    rec.error = String(e.message || e);
    health.aFail++;
  }
  sources.push(rec);
}));

/* ---------- 实时官方报价 ---------- */
const liveQuotes = [];

// 智谱 GLM-5.3 官方按量
if (autoResults.zhipuApi) {
  for (const m of autoResults.zhipuApi.filter(x => /^GLM-5\.3/i.test(x.model) && !/Legal/i.test(x.model))) {
    liveQuotes.push({
      key: `zhipu:${m.model}`,
      label: `${m.model} · 智谱官方 API`,
      source: 'docs.bigmodel.cn/cn/guide/start/pricing',
      billing: '按量计费',
      input: m.input,
      inputCacheHit: m.cacheHit,
      output: m.output,
      blended: round((2 * m.input + m.output) / 3),
      unit: '元/百万Token',
      note: `${m.context || ''} 上下文；官方综合口径 (2×输入+输出)/3`
    });
  }
}

// DeepSeek 官方按量（峰谷/扁平自适应）
const dsOverride = {};
if (autoResults.deepseek && autoResults.deepseek.ok) {
  const map = { 'deepseek-flash': 'deepseek-v41-flash', 'deepseek-v4-flash': 'deepseek-v41-flash', 'deepseek-v4-pro': 'deepseek-v4-pro' };
  for (const [col, v] of Object.entries(autoResults.deepseek.models)) {
    const modelKey = map[col];
    if (!modelKey) continue;
    dsOverride[modelKey] = v;
    const label = modelKey === 'deepseek-v4-pro' ? 'DeepSeek V4 Pro' : 'DeepSeek V4.1 Flash';
    if (v.pricingMode === 'peak-valley') {
      liveQuotes.push({
        key: `deepseek:${modelKey}:off`,
        label: `${label} · 官方 API（空闲时段）`,
        source: 'api-docs.deepseek.com/zh-cn/quick_start/pricing',
        billing: '按量计费 · 峰谷分时',
        input: v.input.offPeak, inputCacheHit: v.inputCacheHit.offPeak, output: v.output.offPeak,
        blended: v.blended.offPeak, unit: '元/百万Token',
        note: '空闲时段价；综合口径 (2×输入+输出)/3'
      });
      liveQuotes.push({
        key: `deepseek:${modelKey}:peak`,
        label: `${label} · 官方 API（高峰时段）`,
        source: 'api-docs.deepseek.com/zh-cn/quick_start/pricing',
        billing: '按量计费 · 峰谷分时',
        input: v.input.peak, inputCacheHit: v.inputCacheHit.peak, output: v.output.peak,
        blended: v.blended.peak, unit: '元/百万Token',
        note: '高峰时段价；综合口径 (2×输入+输出)/3'
      });
    } else {
      liveQuotes.push({
        key: `deepseek:${modelKey}:flat`,
        label: `${label} · 官方 API`,
        source: 'api-docs.deepseek.com/zh-cn/quick_start/pricing',
        billing: '按量计费（扁平）',
        input: v.input.flat, inputCacheHit: v.inputCacheHit.flat, output: v.output.flat,
        blended: v.blended.flat, unit: '元/百万Token',
        note: '缓存命中/未命中扁平计价；综合口径 (2×输入+输出)/3'
      });
    }
  }
}

/* ---------- 与报告基线比对（DeepSeek 官方按量行） ---------- */
function pct(from, to) {
  if (!from || !to) return null;
  return Math.round((to - from) / from * 1000) / 10;
}

for (const model of baseline.models) {
  for (const row of model.rows) {
    const live = dsOverride[model.id];
    if (!live) continue;
    if (!/DeepSeek 官方/.test(row.platform)) continue;

    const liveIn = live.pricingMode === 'peak-valley' ? live.input.offPeak : live.input.flat;
    const liveOut = live.pricingMode === 'peak-valley' ? live.output.offPeak : live.output.flat;
    const liveBlend = live.pricingMode === 'peak-valley' ? live.blended.offPeak : live.blended.flat;
    const liveBlendPeak = live.pricingMode === 'peak-valley' ? live.blended.peak : null;

    row.live = {
      mode: live.pricingMode,
      input: liveIn, output: liveOut, inputCacheHit: live.pricingMode === 'peak-valley' ? live.inputCacheHit.offPeak : live.inputCacheHit.flat,
      inputPeak: live.pricingMode === 'peak-valley' ? live.input.peak : null,
      outputPeak: live.pricingMode === 'peak-valley' ? live.output.peak : null,
      blended: liveBlend, blendedPeak: liveBlendPeak
    };
    row.unitPriceLive = liveBlend;
    row.unitPriceLivePeak = liveBlendPeak;

    // 输入价变化
    if (row.priceIn != null && liveIn != null && row.priceIn !== liveIn) {
      const d = pct(row.priceIn, liveIn);
      diffs.push({
        level: Math.abs(d) >= 20 ? 'high' : 'low',
        scope: model.name,
        title: `${model.name} 官方输入价（缓存未命中）变动`,
        from: `¥${row.priceIn}`, to: `¥${liveIn}（空闲）${live.pricingMode === 'peak-valley' ? ` / ¥${live.input.peak}（高峰）` : ''}`,
        pct: d, kind: d > 0 ? 'up' : 'down'
      });
    }
    if (row.priceOut != null && liveOut != null && row.priceOut !== liveOut) {
      const d = pct(row.priceOut, liveOut);
      diffs.push({
        level: Math.abs(d) >= 20 ? 'high' : 'low',
        scope: model.name,
        title: `${model.name} 官方输出价变动`,
        from: `¥${row.priceOut}`, to: `¥${liveOut}（空闲）${live.pricingMode === 'peak-valley' ? ` / ¥${live.output.peak}（高峰）` : ''}`,
        pct: d, kind: d > 0 ? 'up' : 'down'
      });
    }
    if (row.unitPrice != null && liveBlend != null && Math.abs(row.unitPrice - liveBlend) > 0.05) {
      const d = pct(row.unitPrice, liveBlend);
      diffs.push({
        level: 'high',
        scope: model.name,
        title: `${model.name} 官方综合单价变动`,
        from: `¥${row.unitPrice}/百万`, to: `¥${liveBlend}/百万（空闲）${liveBlendPeak ? ` / ¥${liveBlendPeak}/百万（高峰）` : ''}`,
        pct: d, kind: d > 0 ? 'up' : 'down'
      });
    }
  }
}

/* ---------- B 级：变更监控 ---------- */
const watchState = { updatedAt: stamp, sources: {} };
const watch = [];

await Promise.all(cfg.watchSources.map(async (src) => {
  const r = await fetchText(src.url, { timeout: 30000, retries: 1 });
  const item = { id: src.id, name: src.name, url: src.url, tier: 'B', status: 'fail', hint: src.hint, changed: false, samples: [] };
  if (!r.ok || !r.text) {
    item.error = r.error || `HTTP ${r.status}`;
    health.bFail++;
    watch.push(item);
    watchState.sources[src.id] = prevWatch.sources?.[src.id] || null;
    return;
  }
  const text = htmlToReadableText(r.text);
  const signals = extractPriceSignals(text);
  const fp = shortHash(signals.join('|'));
  const prev = prevWatch.sources?.[src.id];
  item.status = signals.length >= 3 ? 'ok' : 'dynamic';
  if (item.status === 'dynamic') item.note = '页面正文由前端渲染，抓不到价格文本，仅能监控 HTTP 可达性';
  item.ms = r.ms;
  item.signals = signals.length;
  item.fingerprint = fp;
  item.checkedAt = stamp;
  health.bOk++;

  if (prev && prev.fingerprint && prev.fingerprint !== fp && signals.length >= 3) {
    const prevSet = new Set(prev.signalsSample || []);
    const fresh = signals.filter(s => !prevSet.has(s)).slice(0, 3);
    item.changed = true;
    item.samples = fresh;
    health.bChanged++;
    diffs.push({
      level: 'med',
      scope: src.name,
      title: `${src.name} 页面价格内容出现变化`,
      from: '上次快照', to: `新增 ${fresh.length} 处价格表述`,
      pct: null, kind: 'watch', samples: fresh
    });
  }
  watchState.sources[src.id] = { fingerprint: fp, signalsSample: signals.slice(0, 300), checkedAt: stamp, name: src.name };
  watch.push(item);
}));

/* ---------- OpenRouter 参考价（可自动验证的第三方口径） ---------- */
let orRef = [];
if (autoResults.openrouter && autoResults.openrouter.ok) {
  const clean = autoResults.openrouter.list.filter(m =>
    !m.id.startsWith('~') && !/:/.test(m.id) && !/free/i.test(m.id) &&
    /^(deepseek|z-ai|qwen|moonshotai)\//i.test(m.id) || /^bytedance\/.*seed/i.test(m.id)
  );
  // 每个模型族取一个代表，避免同名变体刷屏
  const fam = new Map();
  for (const m of clean) {
    const key = m.id.split('/')[0] + ':' + m.id.split('/')[1].replace(/-\d{4}$/, '').replace(/-(latest|preview|turbo|pro|max|flash|flashx|mini|air|plus)$/i, '');
    if (!fam.has(key)) fam.set(key, m);
  }
  orRef = [...fam.values()].sort((a, b) => a.blendedCny - b.blendedCny).slice(0, 14);
}

/* ---------- 汇总 ---------- */
const orderedSources = [...sources].sort((a, b) => a.id.localeCompare(b.id));
const latest = {
  generatedAt: now.toISOString(),
  stamp,
  asOfDate,
  baselineVersion: baseline.version,
  baselineOrigin: baseline.origin,
  fx: cfg.fx,
  health,
  liveQuotes: liveQuotes.sort((a, b) => (a.blended ?? 999) - (b.blended ?? 999)),
  models: baseline.models,
  diffs,
  watch: watch.sort((a, b) => (b.changed - a.changed) || a.name.localeCompare(b.name)),
  sources: orderedSources,
  openrouterRef: orRef,
  method: {
    unitFromPlan: '折算单价 = 月单价 ÷ (单账号月额度Token数 ÷ 100万)',
    blended: '官方综合单价 = (2×输入单价 + 1×输出单价) ÷ 3，输入:输出=2:1 混合、不含缓存命中假设',
    measured: '实测单价 = 实际费用 ÷ 实际消耗Token，含缓存命中与时段折扣',
    freshness: 'A级源每次运行自动更新；B级源监控页面变更、数值需人工复核；C级为无公开价格的政企报价基线'
  }
};

await writeJson(P('data/latest.json'), latest);
await writeJson(P(`data/snapshots/${asOfDate}.json`), latest);
await writeJson(P('data/watch-state.json'), watchState);

// 变更日志（只追加有内容的条目）
if (diffs.length) {
  const log = await readJson(P('data/changelog.json'), []);
  log.push({ stamp, asOfDate, count: diffs.length, diffs });
  await writeJson(P('data/changelog.json'), log.slice(-180));
}

// 控制台摘要
const line = (s) => process.stdout.write(s + '\n');
line(`[${stamp}] 抓取完成  A级 ${health.aOk}成功/${health.aFail}失败  B级 ${health.bOk}成功/${health.bFail}失败，变更 ${health.bChanged}`);
line(`实时官方报价 ${liveQuotes.length} 条 | 变动事件 ${diffs.length} 条 | OpenRouter 参考 ${orRef.length} 条`);
for (const d of diffs.filter(x => x.pct != null)) line(`  · ${d.title}: ${d.from} → ${d.to} (${d.pct > 0 ? '+' : ''}${d.pct}%)`);
for (const w of watch.filter(x => x.changed)) line(`  · 变更监控: ${w.name} 新增价格表述 ${w.samples.length} 处`);
