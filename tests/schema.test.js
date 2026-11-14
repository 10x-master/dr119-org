// schema.sql 실행 및 40만 원 정액제/시드 데이터 SQL 검증 — 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('schema.sql 실행: 시드 데이터 및 40만 원 정액제 CHECK 제약 검증', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
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

  db.close();
});
