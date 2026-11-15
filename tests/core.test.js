// Dr.119 core 단위 테스트 — 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dr119-core.js');
const crypto = require('node:crypto');

test('QR agent_id 파싱/정규화', () => {
  assert.equal(D.parseAgentId('?agent_id=SEOUL_01'), 'SEOUL_01');
  assert.equal(D.parseAgentId('?foo=1&agent_id=seoul_01'), 'SEOUL_01');
  assert.equal(D.parseAgentId('?agent_id=%3Cscript%3E'), null);
  assert.equal(D.parseAgentId(''), null);
  assert.equal(D.parseAgentId('?agent_id='), null);
});

test('First-touch: 최초 유입 귀속 후 다른 QR로 재접속해도 Lock-in 유지', () => {
  const t1 = D.resolveFirstTouch(null, 'SEOUL_01', '2026-11-01T00:00:00Z', 'https://dr119.org/?agent_id=SEOUL_01');
  assert.deepEqual(t1, { agent_id: 'SEOUL_01', first_touch_at: '2026-11-01T00:00:00Z', landing_url: 'https://dr119.org/?agent_id=SEOUL_01', is_new: true });
  const t2 = D.resolveFirstTouch(t1, 'BUSAN_01', '2026-11-05T00:00:00Z', 'x');
  assert.equal(t2.agent_id, 'SEOUL_01');
  assert.equal(t2.first_touch_at, '2026-11-01T00:00:00Z');
  assert.equal(t2.is_new, false);
  const t3 = D.resolveFirstTouch(t1, null, 'now', 'x');
  assert.equal(t3.agent_id, 'SEOUL_01');
  const none = D.resolveFirstTouch(null, null, 'now', 'x');
  assert.equal(none.agent_id, null);
});

test('40만 원 정액제: 공임비 = 400,000 − 화물비', () => {
  assert.deepEqual(D.calcLaborFee(150000), { fixed_price: 400000, freight_cost: 150000, labor_fee: 250000 });
  assert.equal(D.calcLaborFee('150,000').labor_fee, 250000);
  assert.equal(D.calcLaborFee(0).labor_fee, 400000);
  assert.equal(D.calcLaborFee(400000).labor_fee, 0);
  assert.throws(() => D.calcLaborFee(400001));
  assert.throws(() => D.calcLaborFee(-1));
  assert.throws(() => D.calcLaborFee(1000.5));
  assert.throws(() => D.calcLaborFee(''));
  assert.throws(() => D.calcLaborFee('abc'));
});

test('KST 월 키', () => {
  assert.equal(D.monthKey('2026-10-31T15:30:00Z'), '2026-11'); // KST 11/1 00:30
  assert.equal(D.monthKey('2026-10-31T14:59:00Z'), '2026-10');
});

test('연락처 정규화', () => {
  assert.equal(D.normalizePhone('01012345678'), '010-1234-5678');
  assert.equal(D.normalizePhone('010-123-4567'), '010-123-4567');
  assert.equal(D.normalizePhone('0212345678'), '02-1234-5678');
  assert.equal(D.normalizePhone('12345'), null);
});

function order(id, dist, freight, confirmedAt, status = 'CONFIRMED', type = 'DOCTOR_VISIT') {
  const calc = D.calcLaborFee(freight);
  return {
    order_id: id, status, assigned_distributor_id: dist,
    service: { type }, settlement: { ...calc, confirmed_at: confirmedAt }
  };
}

test('월간 총판 정산: 공임 합계 + 부가수수료 − 차감 = 지급예정금', () => {
  const orders = [
    order('A', 'DIST_SEOUL', 150000, '2026-11-03T01:00:00Z'),            // 250,000
    order('B', 'DIST_SEOUL', 100000, '2026-11-10T01:00:00Z', 'COMPLETED'), // 300,000
    order('C', 'DIST_SEOUL', 50000, '2026-10-10T01:00:00Z'),             // 다른 달 → 제외
    order('D', 'DIST_BUSAN', 200000, '2026-11-10T01:00:00Z'),            // 200,000
    order('E', 'DIST_SEOUL', 0, '2026-11-10T01:00:00Z', 'RECEIVED'),     // 미확정 → 제외
    { order_id: 'F', status: 'SHIPPED', assigned_distributor_id: 'DIST_SEOUL', service: { type: 'SELF_PICKUP' }, settlement: null }
  ];
  const contracts = [
    { contract_id: 'C1', agent_id: 'SEOUL_02', item_id: 'INSURANCE', monthly_amount: 50000, start_month: '2026-09', status: 'ACTIVE' }, // 20% → 10,000
    { contract_id: 'C2', agent_id: 'SEOUL_01', item_id: 'SUBSCRIPTION', monthly_amount: 33333, start_month: '2026-11', status: 'ACTIVE' }, // 30% → 9,999
    { contract_id: 'C3', agent_id: 'SEOUL_01', item_id: 'WATER_PURIFIER', monthly_amount: 40000, start_month: '2026-12', status: 'ACTIVE' }, // 미래 → 제외
    { contract_id: 'C4', agent_id: 'SEOUL_01', item_id: 'WATER_PURIFIER', monthly_amount: 40000, start_month: '2026-01', status: 'CANCELLED' }, // 해지
    { contract_id: 'C5', agent_id: 'UNKNOWN_9', item_id: 'INSURANCE', monthly_amount: 50000, start_month: '2026-01', status: 'ACTIVE' } // HQ 직영 → 총판 없음
  ];
  const penalties = { '2026-11': { DIST_SEOUL: { amount: 30000, memo: '고객 불만 1건' } } };
  const rows = D.computeBilling({ orders, partners: D.SEED_PARTNERS, contracts, margins: D.SEED_MARGINS, penalties, month: '2026-11' });
  const seoul = rows.find(r => r.distributor_id === 'DIST_SEOUL');
  assert.equal(seoul.order_count, 2);
  assert.equal(seoul.gross_sales, 800000);
  assert.equal(seoul.freight_total, 250000);
  assert.equal(seoul.labor_total, 550000);
  assert.equal(seoul.commission_total, 19999);
  assert.equal(seoul.penalty, 30000);
  assert.equal(seoul.payout, 550000 + 19999 - 30000);
  const busan = rows.find(r => r.distributor_id === 'DIST_BUSAN');
  assert.equal(busan.payout, 200000);
  const gg = rows.find(r => r.distributor_id === 'DIST_GYEONGGI');
  assert.equal(gg.payout, 0);

  const csv = D.billingToCSV(rows);
  assert.ok(csv.startsWith('\uFEFF정산월,총판ID'));
  const seoulLine = csv.split('\r\n').find(l => l.includes('DIST_SEOUL'));
  assert.equal(seoulLine, '2026-11,DIST_SEOUL,서울 총판,,서울,2,800000,250000,550000,19999,-30000,539999,490908,49091,고객 불만 1건');
});

test('CSV 이스케이프 및 수식 인젝션 방지', () => {
  const csv = D.toCSV(['a', 'b'], [['=SUM(A1)', 'x,"y"'], [-500, '-abc']]);
  assert.equal(csv, '\uFEFFa,b\r\n\'=SUM(A1),"x,""y"""\r\n-500,\'-abc');
});

test('Supabase orders 테이블 행 왕복 변환 (orderToRow / rowToOrder)', () => {
  const sample = {
    schema_version: 1,
    order_id: 'DR-20261115-ABC12',
    created_at: '2026-11-14T21:00:00.000Z',
    customer: { phone: '010-1234-5678' },
    service: {
      type: 'DOCTOR_VISIT',
      label: D.SERVICE_TYPES.DOCTOR_VISIT.label,
      fixed_price: 400000,
      freight_payment: 'INCLUDED'
    },
    attribution: {
      agent_id: 'SEOUL_01',
      model: 'FIRST_TOUCH',
      first_touch_at: '2026-11-14T20:59:00.000Z',
      landing_url: 'https://10x-master.github.io/dr119-org/?agent_id=SEOUL_01'
    },
    assigned_distributor_id: 'DIST_SEOUL',
    status: 'CONFIRMED',
    settlement: {
      fixed_price: 400000,
      freight_cost: 150000,
      labor_fee: 250000,
      confirmed_at: '2026-11-14T21:05:00.000Z',
      confirmed_by: 'HQ_ADMIN'
    },
    media: [{ name: 'photo.jpg', type: 'image/jpeg', size: 1024, thumb_url: 'data:image/jpeg;base64,AA==' }],
    history: [{ at: '2026-11-14T21:00:00.000Z', status: 'RECEIVED', by: 'CUSTOMER' }]
  };
  const row = D.orderToRow(sample);
  assert.equal(row.order_id, 'DR-20261115-ABC12');
  assert.equal(row.customer_phone, '010-1234-5678');
  assert.equal(row.freight_cost, 150000);
  assert.equal(row.labor_fee, 250000);
  assert.deepEqual(D.rowToOrder(row), sample);
  const pendingRow = D.orderToRow({ ...sample, status: 'RECEIVED', settlement: null });
  assert.equal(D.rowToOrder(pendingRow).settlement, null);

  // customer.note & auth_provider persisted via history[0] without schema change
  const enriched = D.toStoredOrder({
    ...sample,
    customer: { phone: '010-9999-8888', note: '전원이 안 들어오고 누수 있음', auth_provider: 'KAKAO' }
  }, D.SEED_PARTNERS);
  const enrichedRoundTrip = D.rowToOrder(D.orderToRow(enriched));
  assert.equal(enrichedRoundTrip.customer.note, '전원이 안 들어오고 누수 있음');
  assert.equal(enrichedRoundTrip.customer.auth_provider, 'KAKAO');
});

test('본사 관리자 비밀번호 SHA-256 검증 및 세션 토큰', () => {
  const expected = crypto.createHash('sha256').update('dr119-hq:dnd7377!!@@').digest('hex');
  assert.equal(D.sha256Hex('dr119-hq:dnd7377!!@@'), expected);
  assert.equal(D.verifyAdminPassword('dnd7377!!@@'), true);
  assert.equal(D.verifyAdminPassword('dnd7377!!@'), false);
  assert.equal(D.verifyAdminPassword(' dnd7377!!@@ '), false);
  assert.equal(D.verifyAdminPassword(''), false);
  assert.equal(D.verifyAdminPassword(null), false);
  assert.equal(D.verifyAdminToken(D.ADMIN_AUTH_HASH), true);
  assert.equal(D.verifyAdminToken('1'), false);
});
