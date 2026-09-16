#!/usr/bin/env node
// Claude Code API 日志代理（学习用）+ Web 查看面板
// 用法：./start.sh 或 node proxy.mjs
//  - 代理端口 8899：ANTHROPIC_BASE_URL 指到 http://127.0.0.1:8899/api/anthropic
//  - 面板端口 8898：浏览器打开 http://127.0.0.1:8898 查看抓到的请求/响应
//  注意：只有通过 start.sh 启动的 Claude Code（base URL 指向本代理）才会被抓包；
//        ccr code 会直连 ccr（3457），不经过本代理。

// 上游可切换：改下面 UPSTREAM_MODE 一个词即可
//   'ccr'      → 本地 ccr 路由（当前使用）链路：CC → 本代理(抓包) → ccr(3457) → wanqing
//   'bigmodel' → 智谱 GLM 直连（0915 旧链路，保留备用）

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

// ---------- 上游配置（想切上游只改 UPSTREAM_MODE）----------
const UPSTREAM_MODE = 'ccr';

const PATH_PREFIX = '/api/anthropic'; // 本代理对外暴露的路径前缀
const UPSTREAMS = {
  // 本地 ccr：HTTP，转发时剥掉 /api/anthropic 前缀（ccr 只认 /v1/messages 等真实路径）
  ccr: { lib: 'http', host: '127.0.0.1', port: 3457, stripPrefix: true },
  // 智谱 GLM：HTTPS，路径原样转发
  bigmodel: { lib: 'https', host: 'open.bigmodel.cn', port: 443, stripPrefix: false },
};
const UPSTREAM = UPSTREAMS[UPSTREAM_MODE];
const upstreamLib = UPSTREAM.lib === 'https' ? https : http;
const mapPath = (p) => (UPSTREAM.stripPrefix ? (p.startsWith(PATH_PREFIX) ? p.slice(PATH_PREFIX.length) || '/' : p) : p);
const upstreamHeaders = (h) => ({ ...h, host: `${UPSTREAM.host}:${UPSTREAM.port}` });

const PORT = 8899; // 避开 8080（本机已被 Chrome 远程调试占用）
const DASH_PORT = 8898; // Web 面板端口
const LOG_DIR = path.join(import.meta.dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// 序号续接：重启进程后从已有文件的最大编号继续，避免覆盖旧抓包记录
const existingSeqs = fs
  .readdirSync(LOG_DIR)
  .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
  .filter(Boolean)
  .map(Number);
let seq = existingSeqs.length ? Math.max(...existingSeqs) : 0;

// ---------- 工具函数 ----------
const redact = (h) => ({ ...h, authorization: h.authorization?.slice(0, 20) + '...（已脱敏）' });
const tryParseJson = (buf) => {
  try { return JSON.parse(buf.toString()); } catch { return buf.toString(); }
};
// 每次调用写一个 NNN.json，面板和文件都能看
const saveCapture = (data) =>
  fs.writeFileSync(path.join(LOG_DIR, `${data.id}.json`), JSON.stringify(data, null, 2));
// 尽力提取 token 用量：非流式直接取 usage 字段；SSE 从事件文本里正则捞
// （message_start 带输入 tokens，message_delta 带累计输出 tokens）
const extractUsage = (headers, body) => {
  try {
    const ct = headers['content-type'] || '';
    if (ct.includes('event-stream')) {
      const text = body.toString();
      const input = /"input_tokens":\s*(\d+)/.exec(text)?.[1] ?? null;
      const outputs = [...text.matchAll(/"output_tokens":\s*(\d+)/g)];
      const output = outputs.length ? +outputs[outputs.length - 1][1] : null;
      return { input_tokens: input, output_tokens: output };
    }
    const u = JSON.parse(body.toString()).usage;
    return u ? { input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null } : null;
  } catch {
    return null;
  }
};

// ---------- 代理主逻辑 ----------
// 只抓带 /api/anthropic 前缀的请求（Claude Code → 本代理 → ccr），其它杂散请求静默转发
const server = http.createServer((clientReq, clientRes) => {
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!clientReq.url.startsWith(PATH_PREFIX)) {
      const pass = upstreamLib.request(
        { hostname: UPSTREAM.host, port: UPSTREAM.port, path: mapPath(clientReq.url), method: clientReq.method, headers: upstreamHeaders(clientReq.headers) },
        (upRes) => { clientRes.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(clientRes); }
      );
      pass.on('error', () => clientRes.writeHead(502).end());
      pass.end(body);
      return;
    }

    const id = String(++seq).padStart(3, '0');
    const startedAt = Date.now();
    const reqParsed = tryParseJson(body);
    console.log(`[${id}] → ${clientReq.method} ${clientReq.url} (${body.length} bytes)`);

    const upstream = upstreamLib.request(
      { hostname: UPSTREAM.host, port: UPSTREAM.port, path: mapPath(clientReq.url), method: clientReq.method, headers: upstreamHeaders(clientReq.headers) },
      (upRes) => {
        const respChunks = [];
        upRes.on('data', (c) => respChunks.push(c)); // 顺手攒一份完整响应
        upRes.on('end', () => {
          const respBody = Buffer.concat(respChunks);
          const duration = Date.now() - startedAt;
          console.log(`[${id}] ← ${upRes.statusCode} (${respBody.length} bytes, ${duration}ms)`);
          saveCapture({
            id,
            time: new Date().toLocaleTimeString('sv-SE'),
            method: clientReq.method,
            path: clientReq.url,
            model: reqParsed?.model ?? null,
            stream: reqParsed?.stream ?? false,
            status: upRes.statusCode,
            duration,
            usage: extractUsage(upRes.headers, respBody),
            requestHeaders: redact(clientReq.headers),
            requestBody: reqParsed,
            responseHeaders: upRes.headers,
            responseBody: respBody.toString(), // SSE 流则是一整个原始事件文本
          });
        });
        // 关键：边收边转发（pipe），保证 SSE 流式输出不被阻塞
        clientRes.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(clientRes);
      }
    );
    upstream.on('error', (err) => {
      console.error(`[${id}] 上游错误:`, err.message);
      clientRes.writeHead(502).end('proxy error: ' + err.message);
    });
    upstream.end(body);
  });
});

// ---------- Web 查看面板 ----------
const HTML = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>API 抓包面板 · Claude Code</title>
<style>
:root {
  --bg: #0b0f14; --panel: #10161d; --panel2: #161f29; --border: #1f2a37;
  --text: #d5dde5; --dim: #7d8894; --accent: #4c9ffe; --green: #3fb950;
  --red: #f85149; --purple: #bc8cff; --amber: #e3b341;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: 13px/1.6 -apple-system, "PingFang SC", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--border); flex-shrink: 0; }
header .logo { font-weight: 700; font-size: 14px; margin-right: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 20px; background: var(--panel2); border: 1px solid var(--border); font-size: 12px; color: var(--dim); white-space: nowrap; }
.chip b { color: var(--text); font-family: ui-monospace, Menlo, monospace; }
.chip.err b { color: var(--red); } .chip.ok b { color: var(--green); } .chip.tok b { color: var(--amber); }
.spacer { flex: 1; }
button.btn { background: var(--panel2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }
button.btn:hover { border-color: var(--accent); color: var(--accent); }
button.btn.on { border-color: var(--accent); color: var(--accent); background: rgba(76,159,254,.08); }
button.btn.danger:hover { border-color: var(--red); color: var(--red); }
main { flex: 1; display: flex; min-height: 0; }
#side { width: 350px; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--panel); flex-shrink: 0; }
.filters { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
.filters input, .filters select { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 6px 10px; font-size: 12px; outline: none; width: 100%; }
.filters input:focus, .filters select:focus { border-color: var(--accent); }
.filters .row { display: flex; gap: 8px; }
#list { flex: 1; overflow-y: auto; }
.item { padding: 9px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.item:hover { background: var(--panel2); }
.item.active { background: rgba(76,159,254,.10); box-shadow: inset 3px 0 0 var(--accent); }
.item .top { display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.ok { background: var(--green); } .dot.err { background: var(--red); }
.item .status { font-family: ui-monospace, Menlo, monospace; font-size: 12px; width: 26px; }
.item .status.ok { color: var(--green); } .item .status.err { color: var(--red); }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 4px; background: var(--panel2); border: 1px solid var(--border); color: var(--purple); font-family: ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .sub { font-size: 11px; color: var(--dim); font-family: ui-monospace, Menlo, monospace; margin-top: 2px; display: flex; gap: 10px; }
#detail { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#detail .head { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
#detail .head .title { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.meta-chip { font-size: 12px; color: var(--dim); white-space: nowrap; }
.meta-chip b { color: var(--text); font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
#copybar { margin-left: auto; display: flex; gap: 6px; }
.tabs { display: flex; gap: 2px; padding: 6px 16px 0; background: var(--panel); border-bottom: 1px solid var(--border); }
.tabs button { background: none; border: none; color: var(--dim); padding: 8px 14px; cursor: pointer; font-size: 12.5px; border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
#content { flex: 1; overflow: auto; padding: 14px 16px; }
pre { font: 12px/1.55 ui-monospace, Menlo, monospace; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; white-space: pre-wrap; word-break: break-all; }
.k { color: #79c0ff; } .s { color: #a5d6ff; } .n { color: #f2cc60; } .b { color: #ff7b72; } .jp { color: #8b949e; }
.jwrap { font: 12px/1.7 ui-monospace, Menlo, monospace; }
.jline { white-space: pre-wrap; word-break: break-all; }
.jkids { margin-left: 10px; padding-left: 12px; border-left: 1px dotted #2a3644; }
.jclose { display: block; }
.caret { cursor: pointer; color: var(--dim); user-select: none; display: inline-block; width: 16px; }
.jline > .caret::before { content: '▼'; }
.jline.collapsed > .caret::before { content: '▶'; }
.jline.collapsed > .jkids, .jline.collapsed > .jclose { display: none; }
.jsummary { color: var(--dim); font-style: italic; display: none; }
.jline.collapsed > .jsummary { display: inline; }
.toolbar { display: flex; gap: 6px; margin-bottom: 10px; }
.sse-item { margin-bottom: 12px; }
.sse-tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 4px; margin-bottom: 4px; font-family: ui-monospace, Menlo, monospace; background: rgba(76,159,254,.12); color: var(--accent); }
.sse-tag.quiet { background: rgba(125,136,148,.10); color: var(--dim); }
.trunc { color: var(--amber); font-size: 12px; padding: 6px 0; }
.empty { color: var(--dim); text-align: center; margin-top: 60px; line-height: 2.2; }
::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: #2a3644; border-radius: 4px; }
</style></head>
<body>
<header>
  <span class="logo">🛰 API 抓包面板</span>
  <span class="chip">总请求 <b id="stTotal">0</b></span>
  <span class="chip ok">成功 <b id="stOk">0</b></span>
  <span class="chip err">错误 <b id="stErr">0</b></span>
  <span class="chip tok">Tokens ↓<b id="stIn">0</b> ↑<b id="stOut">0</b></span>
  <span class="spacer"></span>
  <button class="btn on" id="autoBtn" onclick="toggleAuto()">自动刷新:开</button>
  <button class="btn" onclick="refreshList()">刷新</button>
  <button class="btn danger" onclick="clearAll()">清空记录</button>
</header>
<main>
  <div id="side">
    <div class="filters">
      <input id="q" placeholder="搜索 路径 / 模型 / 状态码 / #编号…" oninput="renderList()">
      <div class="row">
        <select id="fStatus" onchange="renderList()">
          <option value="">全部状态</option>
          <option value="ok">仅成功 2xx</option>
          <option value="err">仅失败 4xx/5xx</option>
        </select>
        <select id="fModel" onchange="renderList()"><option value="">全部模型</option></select>
      </div>
    </div>
    <div id="list"></div>
  </div>
  <div id="detail"><div class="empty">← 点击左侧任意一条记录查看详情<br>支持 ↑ ↓ 键快速切换 · 面板每 2 秒自动刷新</div></div>
</main>
<script>
var all = [], selected = null, auto = true, tab = 'reqBody', cur = null;
var RAW = {};
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
function trunc(s) {
  if (s.length > 300000) return s.slice(0, 300000) + '\\n\\n…（超长已截断显示，完整内容请点「下载」）';
  return s;
}
function hl(v) {
  var s = esc(trunc(typeof v === 'string' ? v : JSON.stringify(v, null, 2)));
  s = s.replace(/"([^"]*)"(?=\\s*:)/g, '"<span class="k">$1</span>"');
  s = s.replace(/:(\\s*)"([^"]*)"/g, ':$1"<span class="s">$2</span>"');
  s = s.replace(/:(\\s*)(-?\\d+(?:\\.\\d+)?)(?=[,\\s}\\]]|$)/g, ':$1<span class="n">$2</span>');
  s = s.replace(/:(\\s*)(true|false|null)(?=[,\\s}\\]]|$)/g, ':$1<span class="b">$2</span>');
  return s;
}
function fmtTok(n) { return n == null ? '-' : (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n); }
// ---------- 可折叠 JSON 树 ----------
function prim(v) {
  if (v === null) return '<span class="b">null</span>';
  if (typeof v === 'number') return '<span class="n">' + v + '</span>';
  if (typeof v === 'boolean') return '<span class="b">' + v + '</span>';
  return '<span class="s">"' + esc(String(v)) + '"</span>';
}
function jval(v, depth, key, comma) {
  var k = key != null ? '<span class="k">"' + esc(key) + '"</span><span class="jp">: </span>' : '';
  var cm = comma ? '<span class="jp">,</span>' : '';
  if (v === null || typeof v !== 'object') return '<div class="jline">' + k + prim(v) + cm + '</div>';
  var isArr = Array.isArray(v);
  var entries = isArr ? v.map(function(x, i) { return [i, x]; }) : Object.keys(v).map(function(kk) { return [kk, v[kk]]; });
  var open = isArr ? '[' : '{', close = isArr ? ']' : '}';
  if (!entries.length) return '<div class="jline">' + k + '<span class="jp">' + open + close + '</span>' + cm + '</div>';
  // 第 3 层起默认折叠，避免大 JSON 一屏刷不开
  var collapse = depth >= 2;
  var kids = entries.map(function(e, i) { return jval(e[1], depth + 1, isArr ? null : e[0], i < entries.length - 1); }).join('');
  return '<div class="jline' + (collapse ? ' collapsed' : '') + '">'
    + '<span class="caret" onclick="tg(this)"></span>' + k + '<span class="jp">' + open + '</span>'
    + '<span class="jsummary"> ' + open + '… ' + entries.length + (isArr ? ' 项' : ' 个键') + ' ' + close + cm + '</span>'
    + '<div class="jkids">' + kids + '</div>'
    + '<div class="jclose"><span class="jp">' + close + '</span></div>'
    + '</div>';
}
function treeOf(v, withToolbar) {
  return (withToolbar ? '<div class="toolbar"><button class="btn" onclick="allTree(false)">展开全部</button><button class="btn" onclick="allTree(true)">折叠全部</button></div>' : '')
    + '<div class="jwrap">' + jval(v, 0, null, false) + '</div>';
}
function tg(el) { el.parentNode.classList.toggle('collapsed'); }
function allTree(collapse) {
  document.querySelectorAll('#content .jline').forEach(function(el) {
    if (el.querySelector('.jkids')) el.classList.toggle('collapsed', collapse);
  });
}
function sseView(body) {
  var blocks = body.split(/\\n\\n/).filter(function(b) { return b.trim(); });
  if (!blocks.length) return '<pre>' + esc(trunc(body)) + '</pre>';
  var out = '';
  blocks.forEach(function(b, i) {
    var ev = '', data = [];
    b.split('\\n').forEach(function(l) {
      if (l.indexOf('event:') === 0) ev = l.slice(6).trim();
      else if (l.indexOf('data:') === 0) data.push(l.slice(5).trim());
    });
    var prettyRaw = data.join('\\n');
    var pj = null;
    try { pj = JSON.parse(prettyRaw); } catch (e) {}
    var cls = (ev === 'ping' || ev === 'pong') ? ' quiet' : '';
    out += '<div class="sse-item"><span class="sse-tag' + cls + '">#' + (i + 1) + ' · ' + esc(ev || 'data') + '</span>' + (pj ? treeOf(pj, false) : '<pre>' + hl(prettyRaw) + '</pre>') + '</div>';
  });
  return out;
}
function updateStats() {
  var ok = 0, err = 0, tin = 0, tout = 0, hasTok = false;
  all.forEach(function(c) {
    if (c.status < 300) ok++; else err++;
    if (c.usage) {
      if (c.usage.input_tokens != null) { tin += c.usage.input_tokens; hasTok = true; }
      if (c.usage.output_tokens != null) { tout += c.usage.output_tokens; hasTok = true; }
    }
  });
  $('stTotal').textContent = all.length;
  $('stOk').textContent = ok;
  $('stErr').textContent = err;
  $('stIn').textContent = hasTok ? fmtTok(tin) : '-';
  $('stOut').textContent = hasTok ? fmtTok(tout) : '-';
}
function renderList() {
  var q = $('q').value.toLowerCase();
  var fs = $('fStatus').value;
  var fm = $('fModel').value;
  var rows = all.filter(function(c) {
    if (fs === 'ok' && c.status >= 300) return false;
    if (fs === 'err' && c.status < 300) return false;
    if (fm && c.model !== fm) return false;
    if (q && (('#' + c.id) + ' ' + c.path + ' ' + (c.model || '') + ' ' + c.status).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).reverse();
  var el = $('list');
  if (!rows.length) { el.innerHTML = '<div class="empty">没有匹配的记录</div>'; return; }
  el.innerHTML = rows.map(function(c) {
    var cls = c.id === selected ? ' active' : '';
    return '<div class="item' + cls + '" onclick="pick(\\'' + c.id + '\\')">'
      + '<div class="top"><span class="dot ' + (c.status < 300 ? 'ok' : 'err') + '"></span>'
      + '<span class="status ' + (c.status < 300 ? 'ok' : 'err') + '">' + c.status + '</span>'
      + '<span class="badge">' + esc(c.model || '(未知模型)') + '</span></div>'
      + '<div class="sub"><span>#' + c.id + ' ' + esc(c.path.replace('/api/anthropic', '')) + '</span>'
      + '<span>' + esc(c.time) + '</span>'
      + (c.duration != null ? '<span>' + c.duration + 'ms</span>' : '')
      + (c.usage && c.usage.output_tokens != null ? '<span>↑' + fmtTok(c.usage.input_tokens) + ' ↓' + fmtTok(c.usage.output_tokens) + '</span>' : '')
      + '</div></div>';
  }).join('');
}
function refreshModels() {
  var models = {};
  all.forEach(function(c) { if (c.model) models[c.model] = 1; });
  var sel = $('fModel');
  var cur = sel.value;
  var names = Object.keys(models).sort();
  sel.innerHTML = '<option value="">全部模型 (' + names.length + ')</option>'
    + names.map(function(m) { return '<option>' + esc(m) + '</option>'; }).join('');
  sel.value = names.indexOf(cur) >= 0 ? cur : '';
}
function refreshList() {
  return fetch('/api/list').then(function(r) { return r.json(); }).then(function(list) {
    all = list;
    refreshModels(); updateStats(); renderList();
    if (selected && !all.some(function(c) { return c.id === selected; })) {
      selected = null; cur = null;
      $('detail').innerHTML = '<div class="empty">记录已被清空</div>';
    }
  }).catch(function() {});
}
function pick(id) {
  selected = id; renderList();
  fetch('/api/capture/' + id).then(function(r) { return r.json(); }).then(function(c) {
    cur = c;
    RAW.reqBody = typeof c.requestBody === 'string' ? c.requestBody : JSON.stringify(c.requestBody, null, 2);
    RAW.reqHead = JSON.stringify(c.requestHeaders, null, 2);
    RAW.respBody = c.responseBody;
    RAW.respHead = JSON.stringify(c.responseHeaders, null, 2);
    window._reqTree = (c.requestBody && typeof c.requestBody === 'object') ? c.requestBody : null;
    window._reqHeadTree = c.requestHeaders;
    window._respHeadTree = c.responseHeaders;
    window._respTree = null;
    try { var pj = JSON.parse(c.responseBody); if (pj && typeof pj === 'object') window._respTree = pj; } catch (e) {}
    var isSSE = (c.responseHeaders['content-type'] || '').indexOf('event-stream') >= 0;
    var u = c.usage || {};
    var head = '<div class="head"><span class="title">#' + c.id + ' ' + esc(c.method) + ' ' + esc(c.path) + '</span>'
      + '<span class="meta-chip">模型 <b>' + esc(c.model || '-') + '</b></span>'
      + '<span class="meta-chip">耗时 <b>' + (c.duration != null ? c.duration + 'ms' : '-') + '</b></span>'
      + (u.input_tokens != null ? '<span class="meta-chip">in <b>' + u.input_tokens + '</b> tok</span>' : '')
      + (u.output_tokens != null ? '<span class="meta-chip">out <b>' + u.output_tokens + '</b> tok</span>' : '')
      + '<span id="copybar"><button class="btn" onclick="copyCur()">复制当前</button>'
      + '<button class="btn" onclick="downloadCur()">下载 JSON</button></span></div>'
      + '<div class="tabs">'
      + '<button id="t-reqBody" onclick="setTab(\\'reqBody\\')">请求体</button>'
      + '<button id="t-reqHead" onclick="setTab(\\'reqHead\\')">请求头</button>'
      + '<button id="t-respBody" onclick="setTab(\\'respBody\\')">响应体' + (isSSE ? ' (SSE)' : '') + '</button>'
      + '<button id="t-respHead" onclick="setTab(\\'respHead\\')">响应头</button></div>'
      + '<div id="content"></div>';
    $('detail').innerHTML = head;
    window._isSSE = isSSE;
    setTab('reqBody');
  });
}
function setTab(t) {
  tab = t;
  ['reqBody', 'reqHead', 'respBody', 'respHead'].forEach(function(k) {
    var b = $('t-' + k); if (b) b.className = (k === t ? 'active' : '');
  });
  var el = $('content');
  if (t === 'reqBody') el.innerHTML = window._reqTree ? treeOf(window._reqTree, true) : '<pre>' + hl(RAW.reqBody) + '</pre>';
  else if (t === 'reqHead') el.innerHTML = treeOf(window._reqHeadTree, true);
  else if (t === 'respHead') el.innerHTML = treeOf(window._respHeadTree, true);
  else el.innerHTML = window._isSSE ? sseView(RAW.respBody) : (window._respTree ? treeOf(window._respTree, true) : '<pre>' + hl(RAW.respBody) + '</pre>');
}
function copyCur() {
  var map = { reqBody: RAW.reqBody, reqHead: RAW.reqHead, respBody: RAW.respBody, respHead: RAW.respHead };
  navigator.clipboard.writeText(map[tab] || '').then(function() {
    var b = document.querySelector('#copybar .btn'); if (!b) return;
    var old = b.textContent; b.textContent = '已复制 ✓'; setTimeout(function() { b.textContent = old; }, 1200);
  });
}
function downloadCur() {
  if (!cur) return;
  var blob = new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'capture-' + cur.id + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}
function toggleAuto() {
  auto = !auto;
  $('autoBtn').textContent = '自动刷新:' + (auto ? '开' : '关');
  $('autoBtn').className = 'btn' + (auto ? ' on' : '');
}
function clearAll() {
  if (!confirm('确定清空全部抓包记录？此操作不可恢复。')) return;
  fetch('/api/clear', { method: 'POST' }).then(function() {
    all = []; selected = null; cur = null;
    refreshModels(); updateStats(); renderList();
    $('detail').innerHTML = '<div class="empty">已清空</div>';
  });
}
document.onkeydown = function(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  var rows = all.slice().reverse();
  if (!rows.length) return;
  var idx = rows.findIndex(function(c) { return c.id === selected; });
  idx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(rows.length - 1, idx + 1);
  if (idx >= 0) pick(rows[idx].id);
  e.preventDefault();
};
setInterval(function() { if (auto) refreshList(); }, 2000);
refreshList();
</script></body></html>`;

const dash = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML);
  } else if (url.pathname === '/api/list') {
    const list = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.json')).sort()
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8')); } catch { return null; }
      })
      .filter(Boolean)
      .map(({ id, time, method, path: p, status, model, duration, usage }) => ({ id, time, method, path: p, status, model, duration, usage }));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
  } else if (url.pathname === '/api/clear') {
    for (const f of fs.readdirSync(LOG_DIR)) fs.unlinkSync(path.join(LOG_DIR, f));
    seq = 0;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  } else if (url.pathname.match(/^\/api\/capture\/\d+$/)) {
    const file = path.join(LOG_DIR, url.pathname.split('/').pop() + '.json');
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}');
  } else {
    res.writeHead(404).end();
  }
});

// 进程级兜底，保证常驻不退
process.on('uncaughtException', (err) => console.error('未捕获异常（已忽略）:', err.message));
process.on('unhandledRejection', (err) => console.error('未处理的 Promise 拒绝（已忽略）:', err));

server.listen(PORT, '127.0.0.1', () => {
  dash.listen(DASH_PORT, '127.0.0.1', () => {
    console.log(`抓包:   http://127.0.0.1:${PORT}  ← claude 的 ANTHROPIC_BASE_URL 指向这里（仅 start.sh 启动的会话）`);
    console.log(`上游:   ${UPSTREAM.lib}://${UPSTREAM.host}:${UPSTREAM.port} (mode=${UPSTREAM_MODE})`);
    console.log(`面板:   http://127.0.0.1:${DASH_PORT}  ← 浏览器打开这个`);
    console.log(`落盘:   ${LOG_DIR}`);
  });
});
