#!/usr/bin/env node
/**
 * 愈心小筑 · 腾讯文档代理 + 静态文件一体化（Node.js 版 · Railway 适配）
 *
 * 单端口同时提供：
 *   - 静态文件服务（index.html / assets / data）[可选，/web 子路径]
 *   - /api/*      腾讯文档 MCP 代理（通过 tencentdocs.py）
 *   - /kv/*       云端 KV 持久化（落盘到 /data/kv_store.json）
 *   - /ai/*       AI 转发（OpenAI 兼容协议：DeepSeek / 通义 / 混元 / 智谱等）
 *
 * 部署到 Railway：
 *   1) 把代码推到 GitHub 仓库
 *   2) Railway → New Project → Deploy from GitHub
 *   3) 添加 Volume，Mount Path: /data
 *   4) 设置环境变量（AI_API_KEY / AI_MODEL / FILE_ID / TDOC_CLI / TDOC_PY / WEB_ROOT）
 *   5) Start Command: node server/proxy-node.js
 *
 * 环境变量：
 *   PORT=3000                    监听端口（Railway 自动注入）
 *   HOST=0.0.0.0                 监听地址
 *   KV_DIR=/data                 KV 持久化目录（挂载 Volume）
 *   FILE_ID=DYUdtRWlQTmxheW11   腾讯文档 ID
 *   TDOC_CLI=tencentdocs.py      文档 MCP CLI 路径
 *   TDOC_PY=python               解释器
 *   AI_API_KEY=sk-...            AI 服务 Key
 *   AI_MODEL=deepseek-chat       AI 模型
 *   AI_BASE_URL=https://api.deepseek.com  兼容 OpenAI 协议的 Base URL
 *   WEB_ROOT=                    留空则不服务静态文件（前后端分离时使用）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const KV_DIR = process.env.KV_DIR || path.join(__dirname, '..', 'server');
const KV_FILE = path.join(KV_DIR, 'kv_store.json');
const WEB_ROOT = process.env.WEB_ROOT ? path.resolve(process.env.WEB_ROOT) : '';
const FILE_ID = process.env.FILE_ID || 'DYUdtRWlQTmxheW11';
const TDOC_CLI = process.env.TDOC_CLI || path.join(__dirname, '..', 'tools', 'tencentdocs.py');
const TDOC_PY = process.env.TDOC_PY || 'python';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// ---------- KV ----------
function kvRead() {
  try { return JSON.parse(fs.readFileSync(KV_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function kvWrite(data) {
  try { fs.mkdirSync(KV_DIR, { recursive: true }); } catch (e) {}
  fs.writeFileSync(KV_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function kvSet(key, value) {
  const data = kvRead(); data[key] = value; kvWrite(data);
  return true;
}

// ---------- 腾讯文档 MCP 代理 ----------
async function tdocCall(method, payload) {
  const args = [TDOC_CLI, 'tdoc_call', 'sheet-mcp', method, JSON.stringify(payload)];
  const { stdout, stderr } = await execFileAsync(TDOC_PY, args, { timeout: 90000 });
  const out = (stdout || '').trim();
  if (!out) throw new Error(stderr || 'empty tdoc output');
  try {
    const env = JSON.parse(out);
    if (env.result && Array.isArray(env.result.content) && env.result.content[0]) {
      const text = env.result.content[0].text || '';
      try { return JSON.parse(text); } catch (e) { return { text }; }
    }
    return env.result || env;
  } catch (e) { return { raw: out }; }
}

function unwrapSheets(info) {
  const sheets = info && info.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.map(s => ({ sheet_id: s.sheet_id || s.id, name: s.sheet_name || s.name }));
}

async function resolveSheetId(fileId, name) {
  const info = await tdocCall('get_sheet_info', { file_id: fileId });
  const s = unwrapSheets(info).find(x => x.name === name);
  return s && s.sheet_id;
}

function csvToGrid(csv) {
  return csv.split('\n').filter(Boolean).map(line => {
    const row = []; let cell = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i+1] === '"') { cell += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === ',' && !inQ) { row.push(cell.replace(/^"|"$/g, '')); cell = ''; }
      else { cell += ch; }
    }
    row.push(cell.replace(/^"|"$/g, ''));
    return row;
  });
}

// ---------- HTTP 工具 ----------
function send(res, code, obj, cors = true) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (!WEB_ROOT) { send(res, 404, { error: 'static disabled' }); return; }
  const safe = pathname.replace(/\?.*$/, '').replace(/\.\.+/g, '.');
  let file = path.join(WEB_ROOT, safe === '/' ? 'index.html' : safe);
  if (!file.startsWith(WEB_ROOT)) { send(res, 403, { error: 'forbidden' }); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { send(res, 404, { error: 'not found' }); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- AI 代理（OpenAI 兼容）----------
function aiProxy(res, payload) {
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const base = process.env.AI_BASE_URL || 'https://api.openai.com';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  if (!key) return send(res, 200, {
    text: '【未配置 AI】请在 Railway 环境变量中设置 AI_API_KEY（DeepSeek/通义/混元/智谱等均可）。',
    src: 'local', model: null
  });
  const post = JSON.stringify({ ...payload, model: payload.model || model });
  let uri;
  try { uri = new URL('/v1/chat/completions', base); }
  catch (e) { return send(res, 500, { error: 'AI_BASE_URL 格式错误' }); }
  const opts = {
    hostname: uri.hostname, port: uri.port || 443, path: uri.pathname + uri.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'Content-Length': Buffer.byteLength(post) }
  };
  const r = https.request(opts, (resp) => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try {
        const j = JSON.parse(data);
        const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        send(res, 200, { text: text || data, src: 'ai', model: j.model || model, usage: j.usage });
      } catch (e) { send(res, 500, { error: e.message, raw: data.slice(0, 500) }); }
    });
  });
  r.on('error', e => send(res, 502, { error: e.message }));
  r.setTimeout(60000, () => { r.destroy(); send(res, 504, { error: 'AI upstream timeout' }); });
  r.write(post); r.end();
}

function buildPrompt(type, body) {
  if (type === 'summarize') {
    return {
      messages: [
        { role: 'system', content: '你是阅读助手，为民宿主理人生成书籍核心摘要，控制在 220 字内，分①背景②核心概念③实践方法④行动清单。' },
        { role: 'user', content: `书名：${body.title}\n作者：${body.author || '未知'}\n当前进度：${body.progress || 0}%\n标签：${(body.tags || []).join('、')}` }
      ], temperature: 0.6
    };
  }
  if (type === 'recommend') {
    return {
      messages: [
        { role: 'system', content: '你是阅读推荐助手，根据用户当前书籍推荐 3-5 本同类优质书籍，每本说明推荐理由，控制在 180 字内。' },
        { role: 'user', content: `书名：${body.title}\n作者：${body.author || '未知'}\n标签：${(body.tags || []).join('、')}` }
      ], temperature: 0.7
    };
  }
  if (type === 'generate') {
    // 自媒体文案生成（小红书 / 抖音）
    const plat = body.plat === 'dy' ? '抖音' : '小红书';
    const sysMap = {
      xhs: `你是小红书民宿运营文案专家。根据用户给的选题，写一篇 200-350 字的小红书爆款笔记。要求：
1) 开头抓眼球，2-3 个 emoji
2) 分点列出 4-6 条亮点（住宿特色/就医便利/生活配套）
3) 末尾 3-5 个相关话题标签
4) 严格规避：医疗效果承诺、最佳/最好等绝对化用语、未证实疗效
5) 风格：温暖、真诚、有生活感`,
      dy: `你是抖音民宿口播脚本专家。根据用户给的选题，写一段 25-35 秒的口播脚本。要求：
1) 开头用 1 句反问/悬念钩子
2) 3-5 个分镜说明（标注秒数 + 镜头内容）
3) 结尾引导点赞收藏
4) 严格规避：医疗效果承诺、绝对化用语
5) 风格：真诚、有故事感、节奏明快`
    };
    return {
      messages: [
        { role: 'system', content: sysMap[body.plat === 'dy' ? 'dy' : 'xhs'] },
        { role: 'user', content: `选题：${body.topic}\n民宿定位：天坛医院附近·就医旅居·陪诊便利·安静舒适\n请直接输出最终文案，不要加解释。` }
      ], temperature: 0.8
    };
  }
  if (type === 'morning_report' || type === 'weekly_report' || type === 'monthly_report') {
    const labels = { morning_report: '晨间', weekly_report: '周度', monthly_report: '月报' };
    return {
      messages: [{
        role: 'system',
        content: `你是民宿运营助手，根据用户给的数据生成一份 ${labels[type]}汇报，要求：① 数据点准确② 简洁有力（200 字内）③ 包含亮点+风险+建议三段。`
      }, { role: 'user', content: body.data || JSON.stringify(body) }], temperature: 0.5
    };
  }
  return { messages: [{ role: 'user', content: JSON.stringify(body) }], temperature: 0.5 };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') return send(res, 204, {});

  // 健康检查（Railway 用 /health 即可）
  if (u.pathname === '/health' || u.pathname === '/api/health') {
    return send(res, 200, {
      ok: true, mode: 'railway', file_id: FILE_ID,
      ai_configured: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY),
      kv_size: Object.keys(kvRead()).length,
      static_enabled: !!WEB_ROOT
    });
  }

  // ---- 腾讯文档代理 ----
  if (u.pathname.startsWith('/api/')) {
    const p = u.pathname.slice(5); // 跳过 '/api/' 5 个字符
    try {
      if (p === '/sheet/info') {
        const info = await tdocCall('get_sheet_info', { file_id: FILE_ID });
        return send(res, 200, { sheets: unwrapSheets(info) });
      }
      if (p === '/sheet/range' && req.method === 'GET') {
        const data = await tdocCall('get_cell_data', { file_id: FILE_ID, sheet_id: u.query.sheet_id, return_csv: true });
        const csv = (data && data.csv_data) || (data && data.csv) || '';
        return send(res, 200, { range: u.query.range, values: csvToGrid(csv) });
      }
      if (p === '/sheet/append' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        let sid = await resolveSheetId(FILE_ID, body.sheet_name);
        if (!sid) {
          const add = await tdocCall('add_sheet', { file_id: FILE_ID, name: body.sheet_name, append_index: true });
          sid = add.sheet_id || add.id || await resolveSheetId(FILE_ID, body.sheet_name);
        }
        const data = await tdocCall('get_cell_data', { file_id: FILE_ID, sheet_id: sid, return_csv: true });
        const grid = csvToGrid((data && data.csv_data) || (data && data.csv) || '');
        const nextRow = grid.length + 1;
        const cells = (body.row || []).map((v, i) => ({ row: nextRow - 1, col: i, value_type: 'STRING', string_value: String(v) }));
        const writeResult = await tdocCall('set_range_value', { file_id: FILE_ID, sheet_id: sid, values: cells });
        return send(res, 200, { ok: true, sheet_id: sid, row: nextRow, writeResult, note: '若 writeResult 标记已成功但读回为空，属 MCP 平台限制，数据已落 KV' });
      }
      return send(res, 404, { error: 'api not found' });
    } catch (e) {
      console.error('[api error]', e);
      return send(res, 500, { error: e.message });
    }
  }

  // ---- KV ----
  if (u.pathname.startsWith('/kv/')) {
    const p = u.pathname.slice(4); // 跳过 '/kv/' 4 个字符
    try {
      if (p === '/get') return send(res, 200, { key: u.query.key, value: kvRead()[u.query.key] ?? null });
      if (p === '/keys') return send(res, 200, { keys: Object.keys(kvRead()).filter(k => k.startsWith(u.query.prefix || '')) });
      if (p === '/set' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        kvSet(body.key, body.value);
        return send(res, 200, { ok: true });
      }
      if (p === '/all' && req.method === 'GET') return send(res, 200, kvRead());
      return send(res, 404, { error: 'kv not found' });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  // ---- AI ----
  if (u.pathname.startsWith('/ai/')) {
    const p = u.pathname.slice(4); // 跳过 '/ai/' 4 个字符
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const body = await readBody(req).then(s => { try { return JSON.parse(s); } catch (e) { return {}; } });
    const typeMap = { summarize: 'summarize', recommend: 'recommend', generate: 'generate',
      morning_report: 'morning_report', weekly_report: 'weekly_report', monthly_report: 'monthly_report' };
    const t = typeMap[p];
    if (!t) return send(res, 404, { error: 'ai endpoint not found' });
    return aiProxy(res, buildPrompt(t, body));
  }

  // ---- 静态文件 ----
  serveStatic(req, res, u.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy-node] listening on http://${HOST}:${PORT}`);
  console.log(`[proxy-node] KV file: ${KV_FILE}`);
  console.log(`[proxy-node] FILE_ID: ${FILE_ID}`);
  console.log(`[proxy-node] AI: ${process.env.AI_API_KEY ? 'configured (' + (process.env.AI_MODEL || 'gpt-4o-mini') + ')' : 'NOT configured'}`);
  console.log(`[proxy-node] Static: ${WEB_ROOT || 'disabled'}`);
});
