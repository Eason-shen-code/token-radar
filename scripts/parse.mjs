// 各数据源解析器：从页面原始内容里抠出「价格数字」，不做任何估算
import { htmlToFlatText, normSpace, round } from './http.mjs';

/** 智谱 · API 定价（markdown 表格）
 *  | 模型名称 | 上下文 | 输入单价 | 输出单价 | 缓存存储 | 缓存命中 | 输入模态 |
 */
export function parseZhipuApiPricing(md) {
  const out = [];
  const lines = String(md).split('\n');
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    const nameCell = cells[1] || '';
    if (!/^GLM-/i.test(nameCell)) continue;
    // 跳过非价格表（列数不符）
    if (cells.length < 6) continue;
    const input = toNum(cells[3]);
    const output = toNum(cells[4]);
    if (input == null || output == null) continue;
    out.push({
      model: nameCell,
      context: cells[2],
      input, output,
      cacheStore: cells[5],
      cacheHit: toNum(cells[6]),
      modality: cells[7]
    });
  }
  // 去重（同一模型可能出现在多个表中）
  const seen = new Set();
  return out.filter(r => (seen.has(r.model) ? false : seen.add(r.model)));
}

/** 智谱 · GLM Coding Plan 套餐积分额度
 *  | Max 套餐 | 28,000 | 140,000 |
 */
export function parseZhipuPlan(md) {
  const plans = [];
  const re = /^\|\s*(Lite|Pro|Max)\s*套餐\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/gim;
  let m;
  while ((m = re.exec(String(md)))) {
    plans.push({ plan: m[1], credits5h: toNum(m[2]), creditsWeek: toNum(m[3]) });
  }
  return plans;
}

/** DeepSeek · 官方 API 定价（Docusaurus HTML 表格）
 * 兼容「峰谷分时」与「扁平计价」两种版式
 */
export function parseDeepseekPricing(html) {
  const t = htmlToFlatText(html);

  // 列顺序：从表头提取模型列
  const headSeg = t.slice(Math.max(0, t.indexOf('模型')), t.indexOf('模型') + 600);
  const colModels = [];
  for (const id of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4.1-flash']) {
    if (headSeg.includes(id)) colModels.push(id);
  }
  // 去重保序，且 v4-flash 视为 flash 的别名
  const cols = [...new Set(colModels)];

  const grab = (re) => { const m = t.match(re); return m ? m.slice(1).map(toNum) : null; };

  // 峰谷分时版式
  const hitPeak = grab(/百万tokens输入\W*（缓存命中）\W*空闲时段\W*([\d.]+)元\W*([\d.]+)元\W*高峰时段\W*([\d.]+)元\W*([\d.]+)元/);
  const missPeak = grab(/百万tokens输入\W*（缓存未命中）\W*空闲时段\W*([\d.]+)元\W*([\d.]+)元\W*高峰时段\W*([\d.]+)元\W*([\d.]+)元/);
  const outPeak = grab(/百万tokens输出\W*空闲时段\W*([\d.]+)元\W*([\d.]+)元\W*高峰时段\W*([\d.]+)元\W*([\d.]+)元/);

  // 扁平计价版式（旧版：仅缓存命中/未命中）
  const hitFlat = grab(/百万tokens输入\W*（缓存命中）\W*([\d.]+)元\W*([\d.]+)元/);
  const missFlat = grab(/百万tokens输入\W*（缓存未命中）\W*([\d.]+)元\W*([\d.]+)元/);
  const outFlat = grab(/百万tokens输出\W*([\d.]+)元\W*([\d.]+)元/);

  const models = {};
  const useCols = cols.length ? cols : ['deepseek-flash', 'deepseek-v4-pro'];

  if (missPeak && outPeak) {
    useCols.forEach((id, i) => {
      const inOff = missPeak[i], inPeak = missPeak[i + 2];
      const outOff = outPeak[i], outPeakV = outPeak[i + 2];
      models[id] = {
        pricingMode: 'peak-valley',
        inputCacheHit: { offPeak: hitPeak ? hitPeak[i] : null, peak: hitPeak ? hitPeak[i + 2] : null },
        input: { offPeak: inOff, peak: inPeak },
        output: { offPeak: outOff, peak: outPeakV },
        blended: {
          offPeak: round((2 * inOff + outOff) / 3),
          peak: round((2 * inPeak + outPeakV) / 3)
        }
      };
    });
  } else if (missFlat && outFlat) {
    useCols.forEach((id, i) => {
      const inV = missFlat[i], outV = outFlat[i];
      models[id] = {
        pricingMode: 'flat',
        inputCacheHit: { flat: hitFlat ? hitFlat[i] : null },
        input: { flat: inV },
        output: { flat: outV },
        blended: { flat: round((2 * inV + outV) / 3) }
      };
    });
  }

  return { models, columns: useCols, ok: Object.keys(models).length > 0, flatText: t.slice(0, 20000) };
}

/** OpenRouter · 聚合参考价（USD/token）→ 元/百万 Token */
export function parseOpenrouter(json, fxUsdCny) {
  let data;
  try { data = JSON.parse(json); } catch { return { list: [], ok: false }; }
  const rows = (data && data.data) || [];
  const pick = rows.filter(m => /deepseek|glm|z-ai|kimi|moonshot|qwen|doubao|bytedance/i.test(m.id));
  const list = pick.map(m => {
    const inUsd = Number(m.pricing && m.pricing.prompt);
    const outUsd = Number(m.pricing && m.pricing.completion);
    const inCny = Number.isFinite(inUsd) ? round(inUsd * 1e6 * fxUsdCny, 3) : null;
    const outCny = Number.isFinite(outUsd) ? round(outUsd * 1e6 * fxUsdCny, 3) : null;
    return {
      id: m.id,
      name: m.name || m.id,
      context: m.context_length || null,
      inputCny: inCny,
      outputCny: outCny,
      blendedCny: inCny != null && outCny != null ? round((2 * inCny + outCny) / 3, 3) : null
    };
  }).filter(r => r.blendedCny != null);
  list.sort((a, b) => a.blendedCny - b.blendedCny);
  return { list, ok: list.length > 0, total: rows.length };
}

/** 内容指纹：抽出所有「数字＋元」数值片段，用于 B 级源的变更监控 */
export function extractPriceSignals(text) {
  const clean = normSpace(text).replace(/\s+/g, ' ');
  const signals = [];
  const re = /[^。；;\n]{0,40}?\d+(?:\.\d+)?\s*(?:元|万元)\s*(?:\/\s*(?:百万|万|千|次|月|小时|分钟)[^\s。；;]{0,8})?[^。；;\n]{0,30}/g;
  let m;
  while ((m = re.exec(clean))) {
    const s = m[0].replace(/\s+/g, ' ').trim();
    if (s.length < 4) continue;
    signals.push(s);
    if (signals.length > 400) break;
  }
  return [...new Set(signals)];
}

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,，\s]/g, '').replace(/元.*$/, '').replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
