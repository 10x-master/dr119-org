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
  -- 1차 전화 상담 및 정밀 진단 기록 (사이즈, 제조사, 사용연수, 고장부위, 지속기간, 솔루션, 견적)
  consultation            JSONB NOT NULL DEFAULT '{}',
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

-- 6. 입점/제휴사 등록 상품 (리본 인증중고, 신품 세척기, 친환경 전용 세제, 대여 기기 등)
CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  vendor_name       TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  price             INTEGER NOT NULL,
  supply_price      INTEGER NOT NULL,
  partner_share_pct NUMERIC(5, 2) NOT NULL DEFAULT 10.0,
  specs             TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  image_url         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. QR 영업자 1년간 수익 배분 실적
CREATE TABLE IF NOT EXISTS affiliate_sales (
  sale_id           TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(agent_id) ON UPDATE CASCADE,
  customer_phone    TEXT NOT NULL,
  product_id        TEXT,
  product_name      TEXT NOT NULL,
  sale_amount       INTEGER NOT NULL,
  commission_rate   NUMERIC(5, 2) NOT NULL,
  commission_amount INTEGER NOT NULL,
  valid_until       TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACCUMULATED',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. 주방기기·설비·인테리어 역경매 (식당/가정 고객 견적 요청 + 6자리 PIN 해시 + 인테리어/패키지 연계)
CREATE TABLE IF NOT EXISTS auctions (
  auction_id           TEXT PRIMARY KEY,
  project_group_id     TEXT,                                -- 기기+인테리어 원스톱 패키지 묶음 ID
  customer_name        TEXT NOT NULL DEFAULT '',
  customer_phone       TEXT NOT NULL,                       -- 실제 연락처 (낙찰 확정 업체에만 공개)
  customer_phone_mask  TEXT NOT NULL DEFAULT '',            -- 마스킹 연락처 (010-****-5678, 공개용)
  access_pin_hash      TEXT,                                -- 고객 조회·낙찰용 6자리 간편 비밀번호 SHA-256 해시
  agent_id             TEXT,                                -- QR 최초 유입 영업자 귀속 (수수료 연계)
  title                TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN ('EQUIPMENT', 'FACILITY', 'INTERIOR', 'SUPPLIES')),
  size_spec            TEXT NOT NULL DEFAULT '',
  desired_price        INTEGER NOT NULL DEFAULT 0 CHECK (desired_price >= 0),
  region               TEXT NOT NULL,
  -- 인테리어·설비 전용 상세 필드
  area_pyeong          NUMERIC(6, 1),                       -- 현장 평수 (평)
  biz_type             TEXT NOT NULL DEFAULT '',            -- 업종 (한식/카페/고기집/아파트 가정 등)
  work_scope           TEXT NOT NULL DEFAULT '',            -- 공사 범위 (방수/타일/닥트/철거/전면시공 등)
  desired_start_date   TEXT NOT NULL DEFAULT '',            -- 희망 시공·납품일
  apt_complex_name     TEXT NOT NULL DEFAULT '',            -- 아파트 단지명 (가정용·평면도 라이브러리 연계)
  apt_type_spec        TEXT NOT NULL DEFAULT '',            -- 평형·타입 (예: 84A㎡)
  floor_plan_id        TEXT,                                -- 연결된 평면도 라이브러리 ID
  site_photos          JSONB NOT NULL DEFAULT '[]',         -- 현장 사진 썸네일/도면 메타
  notes                TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN', 'SURVEYING', 'ACCEPTED', 'CONTRACTED', 'COMPLETED', 'CLOSED', 'EXPIRED')),
  selected_bid_id      TEXT,
  bid_count            INTEGER NOT NULL DEFAULT 0,
  lowest_bid           INTEGER NOT NULL DEFAULT 0,
  commission_rate_pct  NUMERIC(5, 2) NOT NULL DEFAULT 3.0 CHECK (commission_rate_pct >= 0 AND commission_rate_pct <= 30),
  deadline             TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auctions_category_status ON auctions (category, status);
CREATE INDEX IF NOT EXISTS idx_auctions_project_group ON auctions (project_group_id);

-- 9. 역경매 공급사 · 인테리어 시공사 (본사 관리자 승인제 + 협회 교육·평가 100점 등급제)
CREATE TABLE IF NOT EXISTS auction_dealers (
  dealer_id            TEXT PRIMARY KEY,
  company_name         TEXT NOT NULL,
  dealer_type          TEXT NOT NULL DEFAULT 'DISTRIBUTOR'
                       CHECK (dealer_type IN ('MANUFACTURER', 'DISTRIBUTOR', 'FACILITY', 'INTERIOR', 'WHOLESALE')),
  allowed_categories   JSONB NOT NULL DEFAULT '["EQUIPMENT"]', -- 승인된 입찰 가능 분야 목록
  biz_no               TEXT NOT NULL,
  rep_name             TEXT NOT NULL,
  phone                TEXT NOT NULL,
  pin_hash             TEXT,                                -- 공급사 입찰 인증용 6자리 비밀번호 SHA-256 해시
  region               TEXT NOT NULL DEFAULT '전국',         -- '전국' 또는 활동 시·도
  -- 관리자 승인 상태 (PENDING → APPROVED 승인 시에만 입찰 가능 / SUSPENDED 정지 시 입찰 차단)
  status               TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ACTIVE')),
  -- 한국AI인테리어공간협회 교육 이수 및 인증 여부
  assoc_certified      BOOLEAN NOT NULL DEFAULT FALSE,
  education_status     TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (education_status IN ('PENDING', 'COMPLETED', 'EXEMPT')),
  education_completed_at TIMESTAMPTZ,
  -- 100점 만점 파트너 평가 누적 점수 및 등급 (S:90+, A:75~89, B:60~74, C:<60 자동 정지)
  eval_quality_score   NUMERIC(5, 2) NOT NULL DEFAULT 27.0 CHECK (eval_quality_score BETWEEN 0 AND 30),
  eval_schedule_score  NUMERIC(5, 2) NOT NULL DEFAULT 22.5 CHECK (eval_schedule_score BETWEEN 0 AND 25),
  eval_pricing_score   NUMERIC(5, 2) NOT NULL DEFAULT 18.0 CHECK (eval_pricing_score BETWEEN 0 AND 20),
  eval_service_score   NUMERIC(5, 2) NOT NULL DEFAULT 22.5 CHECK (eval_service_score BETWEEN 0 AND 25),
  eval_total_score     NUMERIC(5, 2) NOT NULL DEFAULT 90.0 CHECK (eval_total_score BETWEEN 0 AND 100),
  grade                TEXT NOT NULL DEFAULT 'A' CHECK (grade IN ('S', 'A', 'B', 'C')),
  penalty_strikes      INTEGER NOT NULL DEFAULT 0 CHECK (penalty_strikes >= 0),
  rating               NUMERIC(3, 2) NOT NULL DEFAULT 5.0,
  review_count         INTEGER NOT NULL DEFAULT 0,
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auction_dealers_status_grade ON auction_dealers (status, grade);

-- 10. 역경매 실시간 블라인드 입찰 (승인 공급사 전용 + 인테리어 2단계 실측/확정 지원)
CREATE TABLE IF NOT EXISTS auction_bids (
  bid_id               TEXT PRIMARY KEY,
  auction_id           TEXT NOT NULL REFERENCES auctions(auction_id) ON UPDATE CASCADE,
  dealer_id            TEXT NOT NULL,
  dealer_name          TEXT NOT NULL,
  dealer_grade         TEXT NOT NULL DEFAULT 'A' CHECK (dealer_grade IN ('S', 'A', 'B', 'C')),
  assoc_certified      BOOLEAN NOT NULL DEFAULT FALSE,
  bid_price            INTEGER NOT NULL CHECK (bid_price > 0),
  final_price          INTEGER,                             -- 인테리어 현장 실측 후 최종 확정가
  warranty_months      INTEGER NOT NULL DEFAULT 12 CHECK (warranty_months >= 0),
  delivery_days        INTEGER NOT NULL DEFAULT 3 CHECK (delivery_days >= 0),
  work_scope_detail    TEXT NOT NULL DEFAULT '',            -- 인테리어 자재 등급·시공 범위 명세
  benefits             TEXT NOT NULL DEFAULT '',            -- 추가 혜택 (무료 배송/설치, 하자보증서 등)
  status               TEXT NOT NULL DEFAULT 'BIDDING'
                       CHECK (status IN ('BIDDING', 'SURVEY_SELECTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_price ON auction_bids (auction_id, bid_price);

-- 11. 파트너 100점 정량 평가 이력 (시공 품질 30 + 납기 25 + 견적 투명성 20 + 고객만족·AS 25)
CREATE TABLE IF NOT EXISTS partner_evaluations (
  eval_id              TEXT PRIMARY KEY,
  dealer_id            TEXT NOT NULL REFERENCES auction_dealers(dealer_id) ON UPDATE CASCADE,
  auction_id           TEXT REFERENCES auctions(auction_id) ON UPDATE CASCADE,
  evaluator_type       TEXT NOT NULL CHECK (evaluator_type IN ('CUSTOMER', 'HQ_ADMIN', 'ASSOCIATION')),
  quality_score        INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 30),
  schedule_score       INTEGER NOT NULL CHECK (schedule_score BETWEEN 0 AND 25),
  pricing_score        INTEGER NOT NULL CHECK (pricing_score BETWEEN 0 AND 20),
  service_score        INTEGER NOT NULL CHECK (service_score BETWEEN 0 AND 25),
  total_score          INTEGER NOT NULL CHECK (total_score = quality_score + schedule_score + pricing_score + service_score),
  dumping_violation    BOOLEAN NOT NULL DEFAULT FALSE,      -- 허위 저가·부당 추가금 적발 여부
  memo                 TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. 아파트·매장 공용 평면도 라이브러리 (개인정보 제거 후 단지명+평형 기준 자동 축적)
CREATE TABLE IF NOT EXISTS floor_plans (
  floor_plan_id        TEXT PRIMARY KEY,
  region               TEXT NOT NULL DEFAULT '',
  complex_name         TEXT NOT NULL,                       -- 단지명 (예: 래미안 대치팰리스)
  type_spec            TEXT NOT NULL,                       -- 평형/타입 (예: 84A㎡)
  area_pyeong          NUMERIC(6, 1),
  image_data_url       TEXT NOT NULL,                       -- 리사이즈 JPEG/WebP 데이터 또는 스토리지 URL
  usage_count          INTEGER NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_floor_plans_lookup ON floor_plans (complex_name, type_spec);

-- ============================================================================
-- Supabase RLS (Row Level Security) 및 PostgREST anon/authenticated 권한
-- ============================================================================
ALTER TABLE distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE margins ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_dealers ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_distributors" ON distributors;
CREATE POLICY "allow_all_distributors" ON distributors FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_agents" ON agents;
CREATE POLICY "allow_all_agents" ON agents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_orders" ON orders;
CREATE POLICY "allow_all_orders" ON orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_margins" ON margins;
CREATE POLICY "allow_all_margins" ON margins FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_contracts" ON contracts;
CREATE POLICY "allow_all_contracts" ON contracts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_penalties" ON penalties;
CREATE POLICY "allow_all_penalties" ON penalties FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_auctions" ON auctions;
CREATE POLICY "allow_all_auctions" ON auctions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_auction_dealers" ON auction_dealers;
CREATE POLICY "allow_all_auction_dealers" ON auction_dealers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_auction_bids" ON auction_bids;
CREATE POLICY "allow_all_auction_bids" ON auction_bids FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_partner_evaluations" ON partner_evaluations;
CREATE POLICY "allow_all_partner_evaluations" ON partner_evaluations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_floor_plans" ON floor_plans;
CREATE POLICY "allow_all_floor_plans" ON floor_plans FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON distributors, agents, orders, margins, contracts, penalties, auctions, auction_dealers, auction_bids, partner_evaluations, floor_plans TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
