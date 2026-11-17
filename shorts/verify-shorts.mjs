// Dr.119 YouTube Shorts MP4 & 프리뷰 페이지 무결성 검증 스크립트
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from '../tests/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MP4 = path.join(HERE, 'dr119-youtube-shorts.mp4');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
};

function startRangeServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      let p = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/shorts/index.html' : u.pathname));
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) {
        res.writeHead(404);
        return res.end('404');
      }
      const stat = fs.statSync(p);
      const ext = path.extname(p).toLowerCase();
      const ct = MIME[ext] || 'application/octet-stream';
      const range = req.headers.range;
      if (range && ext === '.mp4') {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          const start = m[1] ? Number(m[1]) : 0;
          const end = m[2] ? Math.min(stat.size - 1, Number(m[2])) : stat.size - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': ct,
          });
          return fs.createReadStream(p, { start, end }).pipe(res);
        }
      }
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// 1) 바이너리 MP4 박스 구조 검사
if (!fs.existsSync(MP4)) throw new Error('MP4 파일이 없습니다: ' + MP4);
const buf = fs.readFileSync(MP4);
const headType = buf.toString('ascii', 4, 8);
const moovIdx = buf.indexOf(Buffer.from('moov'));
const mdatIdx = buf.indexOf(Buffer.from('mdat'));
const hasAvc1 = buf.includes(Buffer.from('avc1'));
const hasAvcC = buf.includes(Buffer.from('avcC'));
const hasMp4a = buf.includes(Buffer.from('mp4a'));
const hasEsds = buf.includes(Buffer.from('esds'));

console.log('1) MP4 바이너리 점검:', {
  sizeMB: (buf.length / (1024 * 1024)).toFixed(2),
  headType,
  faststart: moovIdx > 0 && mdatIdx > moovIdx,
  hasAvc1, hasAvcC, hasMp4a, hasEsds,
});
if (headType !== 'ftyp' || !(moovIdx > 0 && mdatIdx > moovIdx) || !hasAvc1 || !hasMp4a) {
  throw new Error('MP4 구조 검증 실패');
}

// 2) 브라우저 실제 재생 & 디코딩 검증
const { srv, base } = await startRangeServer();
const browser = await launchBrowser();
try {
  const { cdp } = browser;
  await cdp.viewport(1280, 920, false);
  await cdp.goto(base + '/shorts/index.html');
  await cdp.eval(`new Promise((resolve, reject) => {
    const v = document.getElementById('shorts-video');
    if (v.readyState >= 1) return resolve();
    v.addEventListener('loadedmetadata', () => resolve(), { once: true });
    v.addEventListener('error', () => reject(new Error('video load error: ' + (v.error?.message || v.error?.code))), { once: true });
    setTimeout(() => reject(new Error('video metadata timeout')), 10000);
  })`);

  const seekChecks = [];
  for (const t of [1.0, 13.0, 22.0, 31.0, 37.5]) {
    await cdp.eval(`new Promise((resolve, reject) => {
      const v = document.getElementById('shorts-video');
      v.currentTime = ${t};
      v.addEventListener('seeked', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error('seek error')), { once: true });
      setTimeout(() => reject(new Error('seek timeout at ${t}')), 6000);
    })`);
    const st = await cdp.eval(`(() => {
      const v = document.getElementById('shorts-video');
      return {
        t: v.currentTime,
        w: v.videoWidth,
        h: v.videoHeight,
        dur: Number(v.duration.toFixed(2)),
        readyState: v.readyState,
        err: v.error ? v.error.code : null,
      };
    })()`);
    seekChecks.push(st);
  }
  await cdp.eval(`document.getElementById('shorts-video').currentTime = 29.0`);
  await sleep(250);
  await cdp.screenshot(path.join(HERE, 'assets', 'preview-page-verify.png'));

  console.log('2) 브라우저 디코딩 & 시크 검증:', seekChecks);
  console.log('3) 콘솔 에러 수:', cdp.logs.filter((l) => l.type === 'error' || l.type === 'exception').length);

  for (const s of seekChecks) {
    if (s.err !== null || s.w !== 1080 || s.h !== 1920 || s.dur < 38 || s.readyState < 2) {
      throw new Error('브라우저 비디오 재생 스펙 검증 실패: ' + JSON.stringify(s));
    }
  }
  console.log('✅ 모든 MP4·웹 프리뷰 검증 통과!');
} finally {
  await browser.close();
  srv.close();
}
