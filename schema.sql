-- Dr.119 (dr119.org) Database Schema & Seed Data
-- PostgreSQL / Supabase / SQLite 호환 DDL
-- 3대 핵심 비즈니스 로직(QR First-touch 귀속, 40만 원 정액제 공임 공식, 총판 월간 정산) 반영

-- 1. 지역 총판 (Master Franchise)
CREATE TABLE IF NOT EXISTS distributors (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  region   TEXT NOT NULL DEFAULT '',
  biz_no   TEXT NOT NULL DEFAULT ''
);

-- 2. 영업사원 / 수리 닥터 QR 코드 (하위 닥터 정산은 총판 자체 처리)
CREATE TABLE IF NOT EXISTS agents (
  agent_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('DISTRIBUTOR', 'DOCTOR')),
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON UPDATE CASCADE
);

-- 3. AS 접수 및 정액제 배분 오더
CREATE TABLE IF NOT EXISTS orders (
  order_id                TEXT PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  customer_phone          TEXT NOT NULL,
  service_type            TEXT NOT NULL CHECK (service_type IN ('DOCTOR_VISIT', 'SELF_PICKUP')),
  fixed_price             INTEGER NOT NULL CHECK (fixed_price IN (0, 400000)),
  freight_payment         TEXT NOT NULL CHECK (freight_payment IN ('INCLUDED', 'COD')),
  -- First-touch Attribution (QR 귀속)
  agent_id                TEXT,
  first_touch_at          TIMESTAMPTZ,
  landing_url             TEXT,
  -- 배정 총판 ('HQ' = 본사 직영) 및 진행 상태
  assigned_distributor_id TEXT NOT NULL DEFAULT 'HQ',
  status                  TEXT NOT NULL DEFAULT 'RECEIVED'
                          CHECK (status IN ('RECEIVED', 'CONFIRMED', 'COMPLETED', 'SHIPPED', 'CANCELLED')),
  -- 40만 원 정액제 배분 (설치 공임비 = 400,000 - 실제 발생 화물비)
  freight_cost            INTEGER,
  labor_fee               INTEGER,
  confirmed_at            TIMESTAMPTZ,
  -- 첨부 미디어 메타/썸네일 및 상태 변경 이력 JSON
  media                   JSONB NOT NULL DEFAULT '[]',
  history                 JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT chk_fixed_400k_settlement CHECK (
    (freight_cost IS NULL AND labor_fee IS NULL) OR
    (
      freight_cost IS NOT NULL AND labor_fee IS NOT NULL AND
      freight_cost BETWEEN 0 AND 400000 AND
      labor_fee = 400000 - freight_cost
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_orders_distributor_status
  ON orders (assigned_distributor_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON orders (customer_phone);

-- 4. 크로스셀링(부가 서비스) 총판 쉐어링 마진율(%)
CREATE TABLE IF NOT EXISTS margins (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  share_pct NUMERIC(5, 2) NOT NULL CHECK (share_pct >= 0 AND share_pct <= 100)
);

-- 5. 식당별 부가 서비스(정기구독·보험·정수기 등) 계약
CREATE TABLE IF NOT EXISTS contracts (
  contract_id    TEXT PRIMARY KEY,
  customer_phone TEXT NOT NULL,
  agent_id       TEXT,
  item_id        TEXT NOT NULL REFERENCES margins(id) ON UPDATE CASCADE,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
  start_month    TEXT NOT NULL,
  end_month      TEXT,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contracts_agent_status
  ON contracts (agent_id, status);

-- 6. 월간 총판 정산 차감액(페널티)
CREATE TABLE IF NOT EXISTS penalties (
  month          TEXT NOT NULL,
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON UPDATE CASCADE,
  amount         INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  memo           TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (month, distributor_id)
);

-- ============================================================================
-- 초기 시드 데이터 (dr119-core.js SEED_PARTNERS / SEED_MARGINS 와 동기화)
-- ============================================================================
INSERT INTO distributors (id, name, region, biz_no) VALUES
  ('DIST_SEOUL', '서울 총판', '서울', ''),
  ('DIST_GYEONGGI', '경기 총판', '경기', ''),
  ('DIST_BUSAN', '부산 총판', '부산', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (agent_id, name, role, distributor_id) VALUES
  ('SEOUL_01', '서울 총판 직영', 'DISTRIBUTOR', 'DIST_SEOUL'),
  ('SEOUL_02', '서울 닥터 A', 'DOCTOR', 'DIST_SEOUL'),
  ('GYEONGGI_01', '경기 총판 직영', 'DISTRIBUTOR', 'DIST_GYEONGGI'),
  ('BUSAN_01', '부산 총판 직영', 'DISTRIBUTOR', 'DIST_BUSAN')
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO margins (id, name, share_pct) VALUES
  ('SUBSCRIPTION', '세척기 정기 구독(케어)', 30),
  ('INSURANCE', '영업배상 보험', 20),
  ('WATER_PURIFIER', '정수기 렌탈', 15)
ON CONFLICT (id) DO NOTHING;
