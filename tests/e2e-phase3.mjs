// Phase 3 E2E: 파트너 대시보드 — 오더 수신함 / 내 식당 / 패시브 인컴 / 실시간 동기화
// 사전조건: tests/e2e-phase2.mjs 실행으로 생성된 tests/output/phase2-state.json
// 실행: node tests/e2e-phase3.mjs
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchBrowser, check, sleep, ROOT } from './cdp.mjs';

const OUT = path.join(ROOT, 'tests', 'output');
const seed = fs.readFileSync(path.join(OUT, 'phase2-state.json'), 'utf8');

const { srv, base } = await startServer();
const { cdp, close } = await launchBrowser();
const R = [];
const text = (sel) => cdp.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim()`);
const kpi = (id) => cdp.eval(`document.querySelector('#${id} .value').textContent.trim()`);

try {
  await cdp.viewport(1366, 900);
  console.log('▶ Phase 3 — Partner 대시보드');
  await cdp.goto(`${base}/index.html`);
  await cdp.eval(`(() => { localStorage.clear(); const s=${seed}; Object.entries(s).forEach(([k,v]) => localStorage.setItem(k, v)); })()`);

  await cdp.goto(`${base}/partner.html?partner_id=DIST_SEOUL`);
  check(R, '서울 총판 로그인 (?partner_id)', (await text('#partner-title')) === '서울 총판 대시보드');
  check(R, 'KPI 이번 달 확정 수수료 = 550,000 + 22,499 − 30,000 = 542,499원', (await kpi('kpi-payout')) === '542,499원');
  check(R, 'KPI 설치 공임비 550,000 / 부가 마진 22,499', (await kpi('kpi-labor')) === '550,000원' && (await kpi('kpi-commission')) === '22,499원');
  const fees = await cdp.eval(`[...document.querySelectorAll('#inbox .order-card .fee')].map(e => e.textContent)`);
  check(R, '오더 수신함: 본사 확정 공임비 2건 (250,000 / 300,000)', fees.length === 2 && fees.includes('250,000원') && fees.includes('300,000원'), fees.join(', '));
  const accs = await cdp.eval(`[...document.querySelectorAll('#acc-table tbody tr')].map(tr => [...tr.cells].map(c=>c.textContent.trim()))`);
  check(R, '내 식당: 내 QR(SEOUL_01/02) 유입 식당 2곳', accs.length === 2 && accs.some((r) => r[0] === '010-1111-2222' && r[1] === 'SEOUL_02') && accs.some((r) => r[0] === '010-3333-4444' && r[1] === 'SEOUL_01'), JSON.stringify(accs.map((r) => r.slice(0, 2))));
  check(R, '패시브 인컴: 계약 2건 합계 22,499원', (await cdp.eval(`document.querySelectorAll('#pi-table tbody tr').length`)) === 2 && (await text('#pi-total')) === '22,499원');
  await cdp.screenshot(path.join(OUT, 'phase3-partner.png'));

  // 닥터 QR 필터
  await cdp.eval(`(() => { const s=document.getElementById('agent-filter'); s.value='SEOUL_02'; s.dispatchEvent(new Event('change')); })()`);
  check(R, 'QR 필터(SEOUL_02 닥터) → 1곳', (await cdp.eval(`document.querySelectorAll('#acc-table tbody tr').length`)) === 1);

  // 설치 완료 보고
  await cdp.eval(`window.confirm = () => true; document.querySelector('#inbox .btn-done').click()`); await sleep(300);
  const done = await cdp.eval(`JSON.parse(localStorage.getItem('dr119_orders')).filter(o => o.status==='COMPLETED' && o.assigned_distributor_id==='DIST_SEOUL').length`);
  check(R, '설치 완료 보고 → COMPLETED 저장, 수수료 유지', done === 1 && (await kpi('kpi-payout')) === '542,499원' && (await kpi('kpi-pending')) === '1건');

  // 실시간 동기화: 다른 문서(본사)에서 차감액 변경 → storage 이벤트로 즉시 반영
  await cdp.eval(`new Promise(r => { const f=document.createElement('iframe'); f.src='/index.html'; f.style.display='none'; f.onload=()=>{ f.contentWindow.Dr119.api.setPenalty(f.contentWindow.Dr119.currentMonthKey(), 'DIST_SEOUL', 50000, '추가 클레임').then(r); }; document.body.appendChild(f); })`);
  await sleep(400);
  check(R, '실시간: 본사 차감 50,000 변경 → 522,499원 즉시 반영', (await kpi('kpi-payout')) === '522,499원');

  // 총판 전환
  await cdp.eval(`(() => { const s=document.getElementById('partner-select'); s.value='DIST_BUSAN'; s.dispatchEvent(new Event('change')); })()`);
  check(R, '부산 총판 전환: 206,000원 · 식당 1곳 · 서울 데이터 격리', (await kpi('kpi-payout')) === '206,000원' && (await cdp.eval(`document.querySelectorAll('#acc-table tbody tr').length`)) === 1 && !(await text('#acc-table tbody')).includes('010-1111-2222'));

  const errs = cdp.logs.filter((l) => l.type === 'exception' || l.type === 'error');
  check(R, 'JS 런타임 에러 없음', errs.length === 0, errs.map((e) => e.text).join(' | '));
} finally {
  await close(); srv.close();
}
const fail = R.filter((r) => !r.ok).length;
console.log(`\n결과: ${R.length - fail}/${R.length} 통과`);
process.exit(fail ? 1 : 0);
