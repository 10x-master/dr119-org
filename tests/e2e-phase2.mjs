// Phase 2 E2E: 고객 접수 → Admin 정액제 계산기(400,000 − 화물비) → 월간 정산/차감/CSV → 마진/부가계약
// 실행: node tests/e2e-phase2.mjs
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchBrowser, makePng, check, sleep, ROOT } from './cdp.mjs';

const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const img = path.join(OUT, 'broken-part.png');
makePng(img, 800, 600, [30, 30, 200]);

const { srv, base } = await startServer();
const { cdp, close } = await launchBrowser();
const R = [];

async function customerSubmit(agentId, phone, type = 'DOCTOR_VISIT') {
  await cdp.eval(`localStorage.removeItem('dr119_attribution')`); // 다른 고객 브라우저 시뮬레이션
  await cdp.goto(`${base}/index.html${agentId ? '?agent_id=' + agentId : ''}`);
  await cdp.setFiles('#media', [img]);
  return cdp.eval(`(() => { const p=document.getElementById('phone'); p.value=${JSON.stringify(phone)}; p.dispatchEvent(new Event('input'));
    document.querySelector('input[value=${type}]').checked = true;
    return new Promise(r => { addEventListener('dr119:submitted', e => r(e.detail), { once: true }); document.getElementById('submit-btn').click(); }); })()`);
}
const typeInto = (sel, v) => cdp.eval(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.value=${JSON.stringify(v)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
const text = (sel) => cdp.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim()`);

try {
  await cdp.viewport(1366, 900);
  console.log('▶ Phase 2 — Super Admin');
  await cdp.goto(`${base}/index.html`);
  await cdp.eval(`localStorage.clear()`);

  const o1 = await customerSubmit('SEOUL_02', '010-1111-2222');           // 서울 닥터 QR
  const o2 = await customerSubmit('SEOUL_01', '010-3333-4444');           // 서울 총판 QR
  const o3 = await customerSubmit('BUSAN_01', '010-5555-6666');           // 부산
  const o4 = await customerSubmit('GYEONGGI_01', '010-7777-8888', 'SELF_PICKUP'); // 직접 수령
  const o5 = await customerSubmit(null, '010-9999-0000');                  // 직접 유입(HQ)

  await cdp.goto(`${base}/admin.html`);
  check(R, '주문 접수함: 5건 리스트 + 사진 썸네일', (await cdp.eval(`document.querySelectorAll('#orders-table tbody tr').length`)) === 5 && (await cdp.eval(`document.querySelectorAll('#orders-table tbody img.thumb').length`)) === 5);
  check(R, '신규 접수 배지 = 5', (await text('#badge-received')) === '5');
  await cdp.screenshot(path.join(OUT, 'phase2-orders.png'));

  // --- 정액제 계산기 ---
  await cdp.eval(`window.__DR119_ADMIN__.openOrder(${JSON.stringify(o1.order_id)})`);
  check(R, '계산기: 고객 결제 총액 400,000원 고정 표기', (await text('#calc-total')) === '400,000원');
  await typeInto('#calc-freight', '150000');
  check(R, '화물비 150,000 입력 → 공임비 250,000원 자동 계산', (await text('#calc-labor')) === '250,000원', await text('#calc-formula'));
  check(R, '화물비 입력 콤마 자동 포맷', (await cdp.eval(`document.getElementById('calc-freight').value`)) === '150,000');
  await cdp.screenshot(path.join(OUT, 'phase2-calculator.png'));
  await typeInto('#calc-freight', '450000');
  check(R, '화물비 > 400,000 → 에러 + 확정 버튼 비활성', (await cdp.eval(`document.getElementById('btn-confirm').disabled`)) && (await text('#calc-error')).includes('초과'));
  await typeInto('#calc-freight', '150000');
  await cdp.eval(`document.getElementById('btn-confirm').click()`); await sleep(300);
  let st = await cdp.eval(`JSON.parse(localStorage.getItem('dr119_orders')).find(o => o.order_id === ${JSON.stringify(o1.order_id)})`);
  check(R, '확정 저장: settlement {400000, 150000, 250000} / CONFIRMED / DIST_SEOUL', st.settlement.fixed_price === 400000 && st.settlement.freight_cost === 150000 && st.settlement.labor_fee === 250000 && st.status === 'CONFIRMED' && st.assigned_distributor_id === 'DIST_SEOUL');
  check(R, '확정 JSON 콘솔 출력', cdp.logs.some((l) => l.text.includes('"labor_fee": 250000')));

  // 나머지 건 확정
  for (const [o, f] of [[o2, 100000], [o3, 200000]]) {
    await cdp.eval(`window.__DR119_ADMIN__.openOrder(${JSON.stringify(o.order_id)})`);
    await typeInto('#calc-freight', String(f));
    await cdp.eval(`document.getElementById('btn-confirm').click()`); await sleep(300);
  }
  // HQ 직영 건 → 총판 미선택 시 차단, 경기 총판 배정
  await cdp.eval(`window.__DR119_ADMIN__.openOrder(${JSON.stringify(o5.order_id)})`);
  await typeInto('#calc-freight', '120000');
  await cdp.eval(`document.getElementById('btn-confirm').click()`); await sleep(200);
  check(R, 'HQ 직영 건: 배정 총판 미선택 시 확정 차단', (await text('#calc-error')).includes('총판'));
  await cdp.eval(`document.getElementById('calc-dist').value='DIST_GYEONGGI'`);
  await cdp.eval(`document.getElementById('btn-confirm').click()`); await sleep(300);
  // 직접 수령 건
  await cdp.eval(`window.__DR119_ADMIN__.openOrder(${JSON.stringify(o4.order_id)})`);
  check(R, '직접 수령 건: 계산기 미표시(정산 제외 안내)', (await cdp.eval(`!document.getElementById('calc-freight') && !!document.getElementById('btn-ship')`)));
  await cdp.eval(`document.getElementById('btn-ship').click()`); await sleep(300);
  await cdp.eval(`document.getElementById('order-dialog').close()`);

  // --- 마진 / 부가 계약 ---
  await cdp.eval(`document.getElementById('t-margins').click()`);
  for (const [phone, item, amt] of [['010-1111-2222', 'INSURANCE', '50000'], ['010-3333-4444', 'SUBSCRIPTION', '33333'], ['010-5555-6666', 'WATER_PURIFIER', '40000']]) {
    await typeInto('#c-phone', phone);
    await cdp.eval(`document.getElementById('c-item').value=${JSON.stringify(item)}`);
    await typeInto('#c-amount', amt);
    await cdp.eval(`document.querySelector('#contract-form button[type=submit]').click()`); await sleep(250);
  }
  const contracts = await cdp.eval(`JSON.parse(localStorage.getItem('dr119_contracts'))`);
  check(R, '부가 계약 3건 + 식당 최초 유입 agent 자동 귀속', contracts.length === 3 && contracts.find((c) => c.customer_phone === '010-1111-2222').agent_id === 'SEOUL_02');
  // 마진율 변경: 보험 20 → 25%
  await cdp.eval(`(() => { const tr=[...document.querySelectorAll('#margin-table tbody tr')].find(t=>t.querySelector('.m-id').value==='INSURANCE'); tr.querySelector('.m-pct').value='25'; document.querySelector('#margin-form button[type=submit]').click(); })()`); await sleep(300);
  check(R, '마진율 저장 (보험 25%)', (await cdp.eval(`JSON.parse(localStorage.getItem('dr119_margins')).find(m=>m.id==='INSURANCE').share_pct`)) === 25);
  await cdp.screenshot(path.join(OUT, 'phase2-margins.png'));

  // --- 월간 정산 ---
  await cdp.eval(`document.getElementById('t-billing').click()`);
  const row = (id) => cdp.eval(`[...document.querySelector('#billing-table tbody tr[data-dist=${id}]').cells].map(c => c.querySelector('input') ? c.querySelector('input').value : c.textContent.trim())`);
  let seoul = await row('DIST_SEOUL');
  // 서울: 공임 250,000 + 300,000 = 550,000 / 수수료 50,000×25% + 33,333×30% = 12,500 + 9,999 = 22,499
  check(R, '서울 총판 합산: 2건 · 매출 800,000 · 공임 550,000 · 수수료 22,499', seoul[1] === '2' && seoul[2] === '800,000원' && seoul[4] === '550,000원' && seoul[5] === '22,499원' && seoul[8] === '572,499원', seoul.join(' | '));
  await cdp.eval(`(() => { const tr=document.querySelector('#billing-table tbody tr[data-dist=DIST_SEOUL]'); tr.querySelector('.pen-memo').value='설치 지연 클레임'; const a=tr.querySelector('.pen-amount'); a.value='30000'; a.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(300);
  seoul = await row('DIST_SEOUL');
  check(R, '차감액 30,000 입력 → 지급예정금 542,499원', seoul[6] === '30,000' && seoul[8] === '542,499원', seoul.join(' | '));
  const busan = await row('DIST_BUSAN');
  check(R, '부산 총판: 공임 200,000 + 수수료 6,000 = 206,000원', busan[8] === '206,000원', busan.join(' | '));
  const gg = await row('DIST_GYEONGGI');
  check(R, '경기 총판: HQ 직영건 배정 280,000원 (직접수령 건 제외)', gg[1] === '1' && gg[8] === '280,000원', gg.join(' | '));
  await cdp.screenshot(path.join(OUT, 'phase2-billing.png'));

  await cdp.eval(`document.getElementById('btn-csv').click()`); await sleep(200);
  const csv = await cdp.eval(`window.__DR119_LAST_CSV__`);
  fs.writeFileSync(path.join(OUT, 'phase2-settlement.csv'), csv);
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  check(R, 'CSV: BOM + 헤더 + 총판 3행', csv.startsWith('\uFEFF') && lines[0].startsWith('정산월,총판ID') && lines.length === 4);
  const sl = lines.find((l) => l.includes('DIST_SEOUL')).split(',');
  check(R, 'CSV 서울 행: 차감 -30000 · 지급 542499 · 사유', sl[10] === '-30000' && sl[11] === '542499' && sl[14] === '설치 지연 클레임', sl.join(','));

  const errs = cdp.logs.filter((l) => l.type === 'exception' || l.type === 'error');
  check(R, 'JS 런타임 에러 없음', errs.length === 0, errs.map((e) => e.text).join(' | '));

  // Phase 3 테스트용 상태 저장
  fs.writeFileSync(path.join(OUT, 'phase2-state.json'), await cdp.eval(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('dr119_')).map(k=>[k, localStorage.getItem(k)])))`));
} finally {
  await close(); srv.close();
}
const fail = R.filter((r) => !r.ok).length;
console.log(`\n결과: ${R.length - fail}/${R.length} 통과`);
process.exit(fail ? 1 : 0);
