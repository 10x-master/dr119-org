// schema.sql 실행 및 40만 원 정액제/시드 데이터 SQL 검증 — 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('schema.sql 실행: 시드 데이터 및 40만 원 정액제 CHECK 제약 검증', () => {
  const rawSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const sql = rawSql
    .replace(/::jsonb\b/gi, '')
    .replace(/^\s*(ALTER TABLE\b[^\n;]*ROW LEVEL SECURITY|DROP POLICY\b[^\n;]*|CREATE POLICY\b[^\n;]*|GRANT\b[^\n;]*|NOTIFY\b[^\n;]*);\s*$/gim, '');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql);

  const dists = db.prepare('SELECT id, name, region FROM distributors ORDER BY id').all();
  assert.equal(dists.length, 3);
  assert.deepEqual(dists.map(d => d.id), ['DIST_BUSAN', 'DIST_GYEONGGI', 'DIST_SEOUL']);

  const agents = db.prepare('SELECT agent_id, distributor_id FROM agents ORDER BY agent_id').all();
  assert.equal(agents.length, 4);

  const margins = db.prepare('SELECT id, share_pct FROM margins ORDER BY id').all();
  assert.equal(margins.length, 3);

  // 정상 40만 원 정액제 배분 주문 삽입 (화물비 150,000 + 공임비 250,000 = 400,000)
  db.prepare(`
    INSERT INTO orders (
      order_id, customer_phone, service_type, fixed_price, freight_payment,
      agent_id, assigned_distributor_id, status, freight_cost, labor_fee
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('DR-TEST-001', '010-1234-5678', 'DOCTOR_VISIT', 400000, 'INCLUDED', 'SEOUL_01', 'DIST_SEOUL', 'CONFIRMED', 150000, 250000);

  const row = db.prepare('SELECT order_id, fixed_price, freight_cost, labor_fee FROM orders WHERE order_id = ?').get('DR-TEST-001');
  assert.equal(row.labor_fee, 250000);

  // 공임비 불일치(400,000 - 화물비 != 공임비) 시 CHECK 제약 실패 확인
  assert.throws(() => {
    db.prepare(`
      INSERT INTO orders (
        order_id, customer_phone, service_type, fixed_price, freight_payment,
        assigned_distributor_id, status, freight_cost, labor_fee
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('DR-TEST-BAD', '010-0000-0000', 'DOCTOR_VISIT', 400000, 'INCLUDED', 'DIST_SEOUL', 'CONFIRMED', 150000, 300000);
  });

  // 화물비 40만 원 초과 시 CHECK 제약 실패 확인
  assert.throws(() => {
    db.prepare(`
      INSERT INTO orders (
        order_id, customer_phone, service_type, fixed_price, freight_payment,
        assigned_distributor_id, status, freight_cost, labor_fee
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('DR-TEST-OVER', '010-0000-0000', 'DOCTOR_VISIT', 400000, 'INCLUDED', 'DIST_SEOUL', 'CONFIRMED', 450000, -50000);
  });

  // 역경매 · 공급사 승인제 · 100점 정량 평가 CHECK 제약 검증
  db.prepare(`
    INSERT INTO auction_dealers (dealer_id, company_name, dealer_type, biz_no, rep_name, phone, status, grade)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('DL_TEST_1', '협회인증인테리어', 'INTERIOR', '123-45-67890', '김대표', '010-1111-2222', 'APPROVED', 'S');

  db.prepare(`
    INSERT INTO partner_evaluations (eval_id, dealer_id, evaluator_type, quality_score, schedule_score, pricing_score, service_score, total_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EV_TEST_1', 'DL_TEST_1', 'ASSOCIATION', 28, 24, 19, 24, 95);

  // 총합 불일치 시 CHECK 제약 실패 확인
  assert.throws(() => {
    db.prepare(`
      INSERT INTO partner_evaluations (eval_id, dealer_id, evaluator_type, quality_score, schedule_score, pricing_score, service_score, total_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('EV_TEST_BAD', 'DL_TEST_1', 'HQ_ADMIN', 20, 20, 10, 10, 99);
  });

  db.close();
});
