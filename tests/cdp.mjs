// 헤드리스 Chrome/Edge + CDP 기반 E2E 헬퍼 (외부 패키지 없음, Node 22+ 내장 WebSocket 사용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

export function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
];

export async function launchBrowser() {
  const exe = process.env.CHROME_PATH || BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome/Edge 실행 파일을 찾을 수 없습니다. CHROME_PATH 지정 필요');
  const tmpBase = process.env.E2E_TMP || path.join(ROOT, 'tests', 'output');
  fs.mkdirSync(tmpBase, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tmpBase, 'profile-'));
  let stderr = '';
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-breakpad', '--disable-crash-reporter', '--disable-crashpad-for-testing', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (d) => { stderr += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
  await sleep(200);
  if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('브라우저 기동 실패:\n' + stderr.slice(0, 2000)); }
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await connect(page.webSocketDebuggerUrl);
  return { cdp, close: async () => { try { cdp.ws.close(); } catch {} proc.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} } };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map(); const listeners = [];
    const logs = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled') logs.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
        if (msg.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text });
        listeners.forEach((l) => l(msg));
      }
    };
    ws.onerror = reject;
    ws.onopen = async () => {
      const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
      await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
      const api = {
        ws, send, logs,
        async goto(u) {
          const loaded = new Promise((r) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
          await send('Page.navigate', { url: u }); await loaded; await sleep(150);
        },
        async eval(expr) {
          const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error('eval 실패: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          return r.result.value;
        },
        async setFiles(selector, files) {
          const { root } = await send('DOM.getDocument', { depth: 0 });
          const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
          await send('DOM.setFileInputFiles', { nodeId, files });
        },
        async screenshot(file) {
          const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          fs.writeFileSync(file, Buffer.from(data, 'base64'));
        },
        async viewport(width, height, mobile = false) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        }
      };
      resolve(api);
    };
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 단색 PNG 생성 (테스트 이미지) */
export function makePng(file, w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export function check(results, name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
