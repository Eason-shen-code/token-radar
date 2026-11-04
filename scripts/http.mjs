// 通用抓取工具：超时、重试、UA 伪装、耗时统计
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchText(url, { timeout = 25000, retries = 2, headers = {} } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/json,text/markdown,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...headers
        }
      });
      const text = await res.text();
      clearTimeout(timer);
      return { ok: res.ok, status: res.status, text, ms: Date.now() - t0, url: res.url || url, attempts: attempt + 1 };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return { ok: false, status: 0, text: '', ms: 0, error: String(lastErr && lastErr.message || lastErr), attempts: retries + 1 };
}

export function normSpace(s) {
  return String(s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
}

// 把 HTML 压成便于正则的纯文本；保留 "|" 作为单元格分隔标记
export function htmlToFlatText(html) {
  return normSpace(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '|')
  ).replace(/\s+/g, '');
}

// 只取可见文本，供内容指纹使用
export function htmlToReadableText(html) {
  return normSpace(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]{2,}/g, ' ').trim();
}

export function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export const round = (n, d = 2) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
