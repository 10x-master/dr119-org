/*!
 * Dr.119 Core — 공통 비즈니스 로직 + Supabase / Mock API 계층
 * ------------------------------------------------------------------
 * - 순수 함수(계산/귀속/정산/CSV)는 DOM 의존성이 없어 Node에서 단위 테스트 가능.
 * - 배포 환경에서는 Supabase PostgREST API를 사용하고, Node 및 127.0.0.1 E2E
 *   테스트 환경에서는 localStorage Mock을 사용한다. (모든 메서드는 Promise 반환)
 */
(function (root, factory) {
  'use strict';
  var lib = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Dr119 = lib;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* ================================================================
   * 1. 상수
   * ================================================================ */
  var SUPABASE_URL = 'https://acpibgztyugrcdrpiiuk.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjcGliZ3p0eXVncmNkcnBpaXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzQwMTcsImV4cCI6MjExMDI1MDAxN30._CJvLsBUjElopRVhDAKioa8Yj9GAOj1tsAfsvNXdgW4';

  /** 고객 결제 총액 (화물비 + 설치비 정액) — 변경 금지 */
  var FIXED_PRICE = 400000;

  var SERVICE_TYPES = {
    DOCTOR_VISIT: {
      code: 'DOCTOR_VISIT',
      label: '전문 닥터 방문 설치 (정액 40만 원)',
      fixed_price: FIXED_PRICE,
      freight_payment: 'INCLUDED' // 화물비 정액에 포함
    },
    SELF_PICKUP: {
      code: 'SELF_PICKUP',
      label: '직접 수령 (본인 설치 및 폐기, 화물비 착불)',
      fixed_price: 0,
      freight_payment: 'COD' // 화물비 착불 (고객 → 화물사 직접 지불)
    }
  };

  var ORDER_STATUS = {
    RECEIVED: '접수',
    CONFIRMED: '공임 확정·배차',
    COMPLETED: '설치 완료',
    SHIPPED: '발송 완료',
    CANCELLED: '취소'
  };

  /** 본사 직영 (agent_id 없음/미등록) — 총판 정산 대상 아님 */
  var HQ_ID = 'HQ';

  var KEYS = {
    ORDERS: 'dr119_orders',
    PARTNERS: 'dr119_partners',
    MARGINS: 'dr119_margins',
    CONTRACTS: 'dr119_contracts',
    PENALTIES: 'dr119_penalties',
    PRODUCTS: 'dr119_products',
    AFFILIATE_SALES: 'dr119_affiliate_sales',
    AUCTIONS: 'dr119_auctions',
    AUCTION_DEALERS: 'dr119_auction_dealers',
    AUCTION_BIDS: 'dr119_auction_bids',
    ATTRIBUTION: 'dr119_attribution' // 고객 브라우저의 First-touch 귀속 정보
  };

  /* ================================================================
   * 2. QR 파라미터 추적 (First-touch Attribution)
   * ================================================================ */

  /** agent_id 정규화: 영문 대문자/숫자/_/- 2~32자만 허용. 그 외 null */
  function sanitizeAgentId(raw) {
    if (raw === null || raw === undefined) return null;
    var v = String(raw).trim().toUpperCase();
    return /^[A-Z0-9_-]{2,32}$/.test(v) ? v : null;
  }

  /** URL 쿼리스트링에서 agent_id 파싱 */
  function parseAgentId(search) {
    try {
      var params = new URLSearchParams(search || '');
      return sanitizeAgentId(params.get('agent_id'));
    } catch (e) {
      return null;
    }
  }

  /**
   * First-touch 귀속 결정.
   * - 이미 유효한 귀속 정보가 있으면 이후 다른 agent_id로 접속해도 절대 덮어쓰지 않는다(Lock-in).
   * - 귀속 정보가 없고 이번 접속에 유효한 agent_id가 있으면 최초 귀속으로 기록한다.
   * @returns {{agent_id:string|null, first_touch_at:string|null, landing_url:string|null, is_new:boolean}}
   */
  function resolveFirstTouch(stored, incomingAgentId, nowIso, landingUrl) {
    if (stored && sanitizeAgentId(stored.agent_id)) {
      return {
        agent_id: sanitizeAgentId(stored.agent_id),
        first_touch_at: stored.first_touch_at || null,
        landing_url: stored.landing_url || null,
        is_new: false
      };
    }
    var incoming = sanitizeAgentId(incomingAgentId);
    if (incoming) {
      return { agent_id: incoming, first_touch_at: nowIso, landing_url: landingUrl || null, is_new: true };
    }
    return { agent_id: null, first_touch_at: null, landing_url: null, is_new: false };
  }

  /* ================================================================
   * 3. 40만 원 정액제 배분 계산기
   *    설치 공임비 = 400,000 − 실제 발생 화물비
   * ================================================================ */
  function calcLaborFee(freightCost) {
    var f = typeof freightCost === 'string' ? Number(freightCost.replace(/[,\s원]/g, '')) : Number(freightCost);
    if (freightCost === '' || freightCost === null || freightCost === undefined || !Number.isFinite(f)) {
      throw new Error('화물비를 숫자로 입력해 주세요.');
    }
    if (!Number.isInteger(f)) throw new Error('화물비는 원 단위 정수여야 합니다.');
    if (f < 0) throw new Error('화물비는 0원 이상이어야 합니다.');
    if (f > FIXED_PRICE) throw new Error('화물비는 정액 ' + formatKRW(FIXED_PRICE) + '을 초과할 수 없습니다.');
    return {
      fixed_price: FIXED_PRICE,
      freight_cost: f,
      labor_fee: FIXED_PRICE - f
    };
  }

  /* ================================================================
   * 4. 정산 (B2B 총판 Split Settlement)
   * ================================================================ */

  /** ISO 시각 → 한국시간(KST) 기준 'YYYY-MM' */
  function monthKey(iso) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
  }

  function currentMonthKey() {
    return monthKey(new Date().toISOString());
  }

  /** agent_id → 소속 총판 ID (미등록/없음 → HQ) */
  function distributorOfAgent(partners, agentId) {
    if (!agentId || !partners) return HQ_ID;
    var a = (partners.agents || []).find(function (x) { return x.agent_id === agentId; });
    return a ? a.distributor_id : HQ_ID;
  }

  function agentsOfDistributor(partners, distributorId) {
    return (partners.agents || []).filter(function (a) { return a.distributor_id === distributorId; });
  }

  /** 해당 월에 정산 대상인 '확정된 방문설치 오더' 여부 */
  function isBillableOrder(order, month) {
    return !!(order &&
      order.service && order.service.type === 'DOCTOR_VISIT' &&
      order.settlement && (order.status === 'CONFIRMED' || order.status === 'COMPLETED') &&
      monthKey(order.settlement.confirmed_at) === month);
  }

  function isContractActive(c, month) {
    if (!c || c.status === 'CANCELLED') return false;
    if (c.start_month && c.start_month > month) return false;
    if (c.end_month && c.end_month < month) return false;
    return true;
  }

  /**
   * 부가(크로스셀링) 수수료 라인 계산.
   * 계약의 귀속 총판 = 계약 agent_id(식당 최초 유입 QR)의 소속 총판.
   */
  function computeCommissionLines(contracts, margins, partners, month) {
    var byId = {};
    (margins || []).forEach(function (m) { byId[m.id] = m; });
    return (contracts || []).filter(function (c) { return isContractActive(c, month); }).map(function (c) {
      var m = byId[c.item_id];
      var pct = m ? Number(m.share_pct) || 0 : 0;
      var amount = Number(c.monthly_amount) || 0;
      return {
        contract_id: c.contract_id,
        item_id: c.item_id,
        item_name: m ? m.name : c.item_id,
        customer_phone: c.customer_phone,
        agent_id: c.agent_id,
        distributor_id: distributorOfAgent(partners, c.agent_id),
        monthly_amount: amount,
        share_pct: pct,
        commission: Math.floor(amount * pct / 100)
      };
    });
  }

  /**
   * 월간 총판별 정산표.
   * 지급 예정금 = 설치 공임비 합계 + 부가 수수료 합계 − 본사 차감액
   * (하위 닥터 정산은 총판 몫이므로 시스템에서 다루지 않음)
   */
  function computeBilling(input) {
    var orders = input.orders || [];
    var partners = input.partners || { distributors: [], agents: [] };
    var month = input.month;
    var penalties = (input.penalties && input.penalties[month]) || {};
    var commissionLines = computeCommissionLines(input.contracts, input.margins, partners, month);

    return (partners.distributors || []).map(function (d) {
      var myOrders = orders.filter(function (o) {
        return isBillableOrder(o, month) && o.assigned_distributor_id === d.id;
      });
      var myComm = commissionLines.filter(function (l) { return l.distributor_id === d.id; });
      var labor = myOrders.reduce(function (s, o) { return s + o.settlement.labor_fee; }, 0);
      var freight = myOrders.reduce(function (s, o) { return s + o.settlement.freight_cost; }, 0);
      var commission = myComm.reduce(function (s, l) { return s + l.commission; }, 0);
      var pen = penalties[d.id] || {};
      var penaltyAmount = Math.abs(Number(pen.amount) || 0);
      return {
        month: month,
        distributor_id: d.id,
        distributor_name: d.name,
        biz_no: d.biz_no || '',
        region: d.region || '',
        order_count: myOrders.length,
        gross_sales: myOrders.length * FIXED_PRICE,
        freight_total: freight,
        labor_total: labor,
        commission_total: commission,
        penalty: penaltyAmount,
        penalty_memo: pen.memo || '',
        payout: labor + commission - penaltyAmount,
        order_ids: myOrders.map(function (o) { return o.order_id; }),
        commission_lines: myComm
      };
    });
  }

  /* ================================================================
   * 5. CSV (엑셀 호환: UTF-8 BOM, CRLF)
   * ================================================================ */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    // CSV 인젝션 방지 (엑셀 수식 실행 차단)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    var lines = [headers.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return '\uFEFF' + lines.join('\r\n');
  }

  /** 세금계산서용 정산 CSV. 지급예정금은 부가세 포함 금액으로 간주하여 공급가액/세액 분리 */
  function billingToCSV(rows) {
    var headers = ['정산월', '총판ID', '총판명', '사업자등록번호', '지역', '설치건수',
      '고객결제총액', '화물비합계', '설치공임비합계', '부가수수료합계', '차감액', '지급예정금',
      '공급가액', '세액', '차감사유'];
    var data = rows.map(function (r) {
      var supply = Math.round(r.payout / 1.1);
      return [r.month, r.distributor_id, r.distributor_name, r.biz_no, r.region, r.order_count,
        r.gross_sales, r.freight_total, r.labor_total, r.commission_total, -r.penalty, r.payout,
        supply, r.payout - supply, r.penalty_memo];
    });
    return toCSV(headers, data);
  }

  /* ================================================================
   * 6. 유틸
   * ================================================================ */
  function formatKRW(n) {
    var v = Number(n) || 0;
    return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('ko-KR') + '원';
  }

  /** 휴대폰/유선 번호 정규화 → '010-1234-5678' 형태, 유효하지 않으면 null */
  function normalizePhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (/^01[016789]\d{7,8}$/.test(d)) {
      return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    if (/^02\d{7,8}$/.test(d)) {
      return d.length === 9 ? d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3') : d.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    if (/^0[3-6]\d\d{7,8}$/.test(d)) {
      return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    return null;
  }

  function generateOrderId(now) {
    var d = now || new Date();
    var ymd = new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    var rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
    return 'DR-' + ymd + '-' + rnd;
  }

  function escapeHTML(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ================================================================
   * 7. 시드 데이터 (데모용 — 실제 운영 시 백엔드 마스터 데이터로 대체)
   * ================================================================ */
  var SEED_PARTNERS = {
    distributors: [
      { id: 'DIST_SEOUL', name: '서울 총판', region: '서울', biz_no: '' },
      { id: 'DIST_GYEONGGI', name: '경기 총판', region: '경기', biz_no: '' },
      { id: 'DIST_BUSAN', name: '부산 총판', region: '부산', biz_no: '' }
    ],
    agents: [
      { agent_id: 'SEOUL_01', name: '서울 총판 직영', role: 'DISTRIBUTOR', distributor_id: 'DIST_SEOUL' },
      { agent_id: 'SEOUL_02', name: '서울 닥터 A', role: 'DOCTOR', distributor_id: 'DIST_SEOUL' },
      { agent_id: 'GYEONGGI_01', name: '경기 총판 직영', role: 'DISTRIBUTOR', distributor_id: 'DIST_GYEONGGI' },
      { agent_id: 'BUSAN_01', name: '부산 총판 직영', role: 'DISTRIBUTOR', distributor_id: 'DIST_BUSAN' }
    ]
  };

  var SEED_MARGINS = [
    { id: 'SUBSCRIPTION', name: '세척기 정기 구독(케어)', share_pct: 30 },
    { id: 'INSURANCE', name: '영업배상 보험', share_pct: 20 },
    { id: 'WATER_PURIFIER', name: '정수기 렌탈', share_pct: 15 }
  ];

  var SEED_PRODUCTS = [
    {
      id: 'PROD_REBORN_1000',
      vendor_name: '(주)오리온이앤에스 / 리본팩토리',
      name: 'Dr.119 리본 인증중고 초음파 세척기 (1000형 표준)',
      category: 'ULTRASONIC_REBORN',
      price: 1850000,
      supply_price: 1500000,
      partner_share_pct: 10,
      specs: '1000 x 700 x 850mm · 단상 220V 2.5kW · 신품 진동자 교체',
      description: '단종·폐업 기기를 본사 공장에서 정밀 복원한 안심 인증 중고. 1년 무상 AS 보증.',
      image_url: 'icons/dr119-logo.svg',
      status: 'ACTIVE'
    },
    {
      id: 'PROD_DETERGENT_BULK',
      vendor_name: '주식회사 웰글로벌',
      name: 'Dr.119 친환경 초음파 전용 활성세제 (20L 정기배송)',
      category: 'DETERGENT',
      price: 66000,
      supply_price: 45000,
      partner_share_pct: 15,
      specs: '친환경 1종 주방세제 인증 · 침착 유분 10초 분해 활성제 배합',
      description: '세척 효율 40% 증가 및 진동자 수명 연장 특화 전용 세제. 매월 정기 배송.',
      image_url: 'icons/dr119-logo.svg',
      status: 'ACTIVE'
    },
    {
      id: 'PROD_NEW_1200',
      vendor_name: '탑소닉 파트너스',
      name: '신제품 탑소닉 스마트 초음파 세척기 (1200형 대형)',
      category: 'ULTRASONIC_NEW',
      price: 3200000,
      supply_price: 2600000,
      partner_share_pct: 10,
      specs: '1200 x 750 x 850mm · 삼상 380V / 단상 220V 선택 · BLT 진동자',
      description: '최신형 스마트 터치 조작부, 에너지 절약형 초음파 발진기 탑재.',
      image_url: 'icons/dr119-logo.svg',
      status: 'ACTIVE'
    }
  ];

  var SEED_AFFILIATE_SALES = [
    {
      sale_id: 'AFF-202611-001',
      agent_id: 'SEOUL_01',
      customer_phone: '010-3333-4444',
      product_id: 'PROD_DETERGENT_BULK',
      product_name: 'Dr.119 친환경 초음파 전용 활성세제 (20L 정기배송)',
      sale_amount: 66000,
      commission_rate: 15,
      commission_amount: 9900,
      valid_until: '2027-11-01T00:00:00Z',
      status: 'ACCUMULATED',
      created_at: '2026-11-15T10:00:00Z'
    },
    {
      sale_id: 'AFF-202611-002',
      agent_id: 'SEOUL_01',
      customer_phone: '010-3333-4444',
      product_id: 'PROD_REBORN_1000',
      product_name: 'Dr.119 리본 인증중고 초음파 세척기 (1000형 표준)',
      sale_amount: 1850000,
      commission_rate: 10,
      commission_amount: 185000,
      valid_until: '2027-11-01T00:00:00Z',
      status: 'CONFIRMED',
      created_at: '2026-11-18T14:30:00Z'
    }
  ];

  /* ================================================================
   * 7-B. 주방·설비·인테리어 B2B 실전 역경매 시드 데이터 (100건 + 실시간 입찰 270건)
   *      - 지역: 전국 시·군·구 100% 공개
   *      - 사람/고객명: 앞 2자리 + 별표 (예: 김정*, 이태*, 박성*)
   *      - 회사/공급사명: 앞 2자리 + 별표 (예: 동대*****, 탑소****, 에어****)
   *      - 연락처: 안심 번호 마스킹 (예: 010-55**-82**)
   * ================================================================ */
  var SEED_AUCTION_DEALERS = [
    { dealer_id: 'DL_01', company_name: '동대***** (유통사)', dealer_type: 'DISTRIBUTOR', biz_no: '120-81-*****', rep_name: '박동*', phone: '010-33**-55**', region: '전국', rating: 4.9, review_count: 52, status: 'ACTIVE' },
    { dealer_id: 'DL_02', company_name: '탑소**** (제조사)', dealer_type: 'MANUFACTURER', biz_no: '214-86-*****', rep_name: '김정*', phone: '010-44**-11**', region: '수도권·충청', rating: 4.9, review_count: 38, status: 'ACTIVE' },
    { dealer_id: 'DL_03', company_name: '에어**** (설비시공)', dealer_type: 'FACILITY', biz_no: '108-11-*****', rep_name: '최환*', phone: '010-55**-99**', region: '수도권', rating: 5.0, review_count: 27, status: 'ACTIVE' },
    { dealer_id: 'DL_04', company_name: '한일***** (인테리어)', dealer_type: 'INTERIOR', biz_no: '211-09-*****', rep_name: '정공*', phone: '010-77**-33**', region: '전국', rating: 4.9, review_count: 41, status: 'ACTIVE' },
    { dealer_id: 'DL_05', company_name: '신흥**** (유통사)', dealer_type: 'DISTRIBUTOR', biz_no: '134-88-*****', rep_name: '이승*', phone: '010-88**-22**', region: '영남권', rating: 4.8, review_count: 33, status: 'ACTIVE' },
    { dealer_id: 'DL_06', company_name: '대성**** (제조사)', dealer_type: 'MANUFACTURER', biz_no: '305-81-*****', rep_name: '강태*', phone: '010-66**-44**', region: '호남권', rating: 4.9, review_count: 29, status: 'ACTIVE' }
  ];

  var SEED_AUCTIONS = (function () {
    var regions = [
      '서울 강남구 역삼동', '서울 마포구 서교동', '서울 영등포구 여의도동', '서울 종로구 관철동', '서울 송파구 잠실동',
      '서울 서초구 방배동', '서울 광진구 화양동', '서울 중구 을지로', '서울 은평구 불광동', '서울 강동구 천호동',
      '경기 수원시 팔달구', '경기 화성시 반월동', '경기 성남시 분당구', '경기 고양시 일산동구', '경기 부천시 원미구',
      '경기 용인시 수지구', '경기 안양시 동안구', '경기 평택시 비전동', '경기 파주시 야당동', '경기 남양주시 다산동',
      '인천 남동구 구월동', '인천 연수구 송도동', '인천 부평구 부평동', '인천 서구 청라동',
      '부산 해운대구 우동', '부산 부산진구 전포동', '부산 수영구 민락동', '부산 동래구 온천동', '부산 사하구 하단동',
      '대구 수성구 범어동', '대구 중구 삼덕동', '대구 달서구 두류동', '대구 동구 신천동',
      '대전 유성구 봉명동', '대전 서구 둔산동', '대전 중구 은행동',
      '광주 서구 치평동', '광주 북구 용봉동', '광주 동구 불로동',
      '경남 진주시 평거동', '경남 창원시 성산구 상남동', '경남 김해시 내외동', '경남 양산시 물금읍',
      '경북 포항시 남구 이동', '경북 구미시 원평동', '경북 경주시 황남동',
      '충남 천안시 서북구 불당동', '충남 아산시 배방읍', '충북 청주시 흥덕구 복대동',
      '전북 전주시 완산구 효자동', '전남 여수시 학동', '전남 순천시 조례동',
      '강원 원주시 무실동', '강원 춘천시 퇴계동', '강원 강릉시 교동',
      '제주 제주시 연동', '제주 서귀포시 서귀동'
    ];
    var familyNames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍'];
    var secondNames = ['정', '민', '승', '진', '우', '동', '현', '서', '태', '재', '호', '훈', '석', '준', '원', '혁', '수', '광', '용', '성'];
    function maskName(idx) {
      return familyNames[idx % familyNames.length] + secondNames[(idx * 3 + 7) % secondNames.length] + '*';
    }

    var equipmentTemplates = [
      { title: '업소용 초음파 세척기 {size} 구매 및 설치', specs: '{size} · 단상 220V · BLT 진동자 40kHz', price: 1750000 },
      { title: '도어타입 업소용 식기세척기 급배수 배관 세트', specs: '시간당 1500접시 세척 · 린스 펌프 내장 · 세제 자동 투입기', price: 2300000 },
      { title: '올스텐 45박스 업소용 냉장·냉동고 (간랭식)', specs: '1260 x 800 x 1900mm · 디지털 온도 제어 · 인버터 컴프레서', price: 1950000 },
      { title: '대용량 상업용 인덕션 렌지 2구/3구 교체', specs: '구당 3.5kW 고화력 · 자석 감지 과열 차단 · 평면 세라믹 상판', price: 1600000 },
      { title: '업소용 공랭식 제빙기 50kg/100kg 납품', specs: '일일 제빙량 80kg · 노즐 분사식 큐브 얼음 · 저소음 컴프레서', price: 1400000 },
      { title: '전기 튀김기 2구 36L 및 정유기 세트', specs: '각 18L 독립 유조 · 마이콤 온도 조절 · 쿨존 잔류 찌꺼기 분리', price: 1550000 },
      { title: 'SUS304 올스텐 2단 작업대 및 잔반처리대 주문 제작', specs: '1800 x 700 x 800mm · 두께 1.2T · 하부 선반 보강형', price: 850000 },
      { title: '업소용 가스 3구 테이블렌지 (LNG/LPG)', specs: '1200 x 600 x 800mm · 고효율 터보 버너 · 황동 노즐', price: 920000 }
    ];
    var facilityTemplates = [
      { title: '식당 주방 닥트 후드 환기설비 신설 (시로코팬 {hp} 포함)', specs: '후드 길이 {len}mm / 배기 관경 250파이 / 시로코팬 {hp}', price: 2200000 },
      { title: '주방 그리스트랩(유수분리기) 배관 이설 및 트렌치 교체', specs: 'SUS304 4단 유수분리기 100L / 배수관 100A 코어 천공', price: 1850000 },
      { title: '주방 전기 15kW 증설 및 분전함 차단기 교체 공사', specs: '메인 75A / 누전차단기 10회로 분기 / 접지 공사 포함', price: 1900000 },
      { title: '업소용 가스 배관 변경 및 가스 누출 자동차단기 설치', specs: '도시가스 배관 32A 이설 12m / 누출 감지부 및 제어부 신설', price: 1300000 },
      { title: '주방 급수 가압펌프 증설 및 온수기 급배수 배관 공사', specs: '인버터 가압펌프 1마력 / 50L 전기온수기 온냉수 라인 신설', price: 1450000 },
      { title: '주방 후드 옥상 배기 입상 닥트 3층 입상 연장 공사', specs: '스파이럴 300파이 15m / 방진 스프링 행거 / 풍량 3500CMH', price: 2800000 }
    ];
    var interiorTemplates = [
      { title: '주방 바닥 3중 우레탄 도막 방수 및 논슬립 타일 시공', specs: '면적 {area}평 · 프라이머-중도-상도 방수 · 미끄럼방지 타일 200x200', price: 3100000 },
      { title: '오픈형 주방 배식구·퇴식구 가벽 목공 및 SUS 마감', specs: '가벽 길이 5.5m / SUS304 인조대리석 카운터 상판 마감', price: 2400000 },
      { title: '기존 식당 주방 전면 철거 및 폐기물 반출, 바닥 샌딩', specs: '주방 12평 내 조적벽 및 기존 타일 할석 철거 / 폐기물 2.5톤', price: 2100000 },
      { title: '주방 벽면 백색 유광 위생타일 300x600 덧방 시공', specs: '벽면적 45m² · 아덱스 탄성 줄눈 · 곰팡이 방지 바이오 실리콘 마감', price: 1650000 },
      { title: '신규 창업 식당 주방 레이아웃 맞춤 인테리어 일괄 시공', specs: '주방 15평 바닥 방수, 벽체 타일, 천장 SMC 위생 마감 일괄', price: 5800000 }
    ];
    var suppliesTemplates = [
      { title: 'Dr.119 친환경 초음파 세척기 전용 활성세제 (20L x 10통)', specs: '보건복지부 1종 주방세제 인증 · 침착 유분 10초 분해 활성제 배합', price: 420000 },
      { title: '업소용 식기세척기 린스 및 고농축 세척제 6개월 정기배송', specs: '세척제 20L 6통 + 건조 린스 20L 2통 + 정량 자동 투입기 무상 점검', price: 380000 },
      { title: '멜라민 업소용 한식기 및 뚝배기 받침 대량 일괄 납품', specs: '공기 200개, 대접 200개, 반찬찬기 5종 각 100개 올블랙 무광', price: 780000 }
    ];

    var sizes = ['800형 소형', '1000형 표준', '1200형 대형', '1500형 특대형'];
    var hps = ['1.5마력', '2마력', '3마력'];
    var lens = ['2400', '3000', '3600', '4200'];
    var areas = ['8', '10', '12', '15', '20'];

    var res = [];
    for (var i = 1; i <= 100; i++) {
      var aucId = 'AUC-202611-' + ('000' + i).slice(-3);
      var reg = regions[(i * 3 + 5) % regions.length];
      var custName = maskName(i);
      var phone = '010-' + String((i * 137) % 9000 + 1000).slice(0, 2) + '**-' + String((i * 391) % 9000 + 1000).slice(0, 2) + '**';

      var cat = 'EQUIPMENT';
      var tpl;
      if (i <= 42) { cat = 'EQUIPMENT'; tpl = equipmentTemplates[(i - 1) % equipmentTemplates.length]; }
      else if (i <= 72) { cat = 'FACILITY'; tpl = facilityTemplates[(i - 43) % facilityTemplates.length]; }
      else if (i <= 92) { cat = 'INTERIOR'; tpl = interiorTemplates[(i - 73) % interiorTemplates.length]; }
      else { cat = 'SUPPLIES'; tpl = suppliesTemplates[(i - 93) % suppliesTemplates.length]; }

      var size = sizes[i % sizes.length];
      var hp = hps[i % hps.length];
      var len = lens[i % lens.length];
      var area = areas[i % areas.length];

      var title = tpl.title.replace('{size}', size).replace('{hp}', hp).replace('{len}', len).replace('{area}', area);
      var specs = tpl.specs.replace('{size}', size).replace('{hp}', hp).replace('{len}', len).replace('{area}', area);
      var desired = Math.round(tpl.price * (0.9 + ((i % 5) * 0.05)));
      var bidCount = (i % 3) + 2;
      var lowest = Math.round((desired * (0.82 + ((i % 3) * 0.02))) / 10000) * 10000;
      var isAccepted = (i % 7 === 0);

      res.push({
        auction_id: aucId,
        customer_name: custName,
        customer_phone: phone,
        title: title,
        category: cat,
        size_spec: specs,
        desired_price: desired,
        region: reg,
        notes: custName + ' 사장님 현장 요청: 신속한 배송/시공 희망 및 AS 확실한 검증 업체 우선 채택',
        status: isAccepted ? 'ACCEPTED' : 'OPEN',
        selected_bid_id: isAccepted ? ('BID-' + aucId.slice(4) + '-1') : null,
        bid_count: bidCount,
        lowest_bid: lowest,
        deadline: new Date(Date.now() + ((i * 2) % 7 + 3) * 24 * 3600 * 1000).toISOString(),
        created_at: new Date(Date.now() - ((100 - i) * 3600 * 1000)).toISOString()
      });
    }
    return res;
  })();

  var SEED_AUCTION_BIDS = (function () {
    var dealerPrefixes = ['동대', '탑소', '에어', '신흥', '한일', '대성', '한국', '미래', '제일', '삼성', '태양', '동양', '대한', '영남', '현대', '중앙', '삼보', '우성', '고려', '신라'];
    function maskDealerName(idx, type) {
      var p = dealerPrefixes[idx % dealerPrefixes.length];
      var typeStr = type === 'MANUFACTURER' ? '(제조사)' : (type === 'FACILITY' ? '(설비시공)' : (type === 'INTERIOR' ? '(인테리어)' : '(유통사)'));
      return p + '***** ' + typeStr;
    }
    var warranties = [12, 24, 36];
    var deliveryDays = [1, 2, 3, 5, 7];
    var benefitsList = [
      '수도권 무료 배송 및 설치 지원, 소모품 3개월 무상 증정',
      '제조사 본사 직영 2년 무상 보증, 진동자 1:1 즉시 맞교환 보장',
      '저소음 모터 무상 업그레이드 및 야간/주말 무료 시공 연계',
      '친환경 활성세제 20L 2통 증정, 배관 소독 세척 무료 서비스',
      'SUS304 고급 배수 트랩 무료 교체, 3년 하자 책임 보증서 발급'
    ];

    var allBids = [];
    for (var i = 0; i < SEED_AUCTIONS.length; i++) {
      var a = SEED_AUCTIONS[i];
      for (var b = 0; b < a.bid_count; b++) {
        var bidId = 'BID-' + a.auction_id.slice(4) + '-' + (b + 1);
        var dType = a.category === 'FACILITY' ? 'FACILITY' : (a.category === 'INTERIOR' ? 'INTERIOR' : ((b % 2 === 0) ? 'DISTRIBUTOR' : 'MANUFACTURER'));
        var dName = maskDealerName(i * 4 + b, dType);
        var discountFactor = 0.82 + (b * 0.04) + ((i % 3) * 0.02);
        var bidPrice = Math.round((a.desired_price * discountFactor) / 10000) * 10000;
        var isAccepted = (a.status === 'ACCEPTED' && b === 0);

        allBids.push({
          bid_id: bidId,
          auction_id: a.auction_id,
          dealer_id: 'DL_' + ('0' + ((i * 4 + b) % 20 + 1)).slice(-2),
          dealer_name: dName,
          bid_price: bidPrice,
          warranty_months: warranties[(i + b) % warranties.length],
          delivery_days: deliveryDays[(i + b) % deliveryDays.length],
          benefits: benefitsList[(i + b) % benefitsList.length],
          status: isAccepted ? 'ACCEPTED' : 'BIDDING',
          created_at: new Date(Date.now() - ((100 - i) * 3600 * 1000) + (b * 600 * 1000)).toISOString()
        });
      }
    }
    return allBids;
  })();

  /* ================================================================
   * 8. API 계층 (배포: Supabase PostgreSQL REST / 로컬·테스트: localStorage Mock)
   * ================================================================ */
  var storage = (function () {
    try { if (root.localStorage) return root.localStorage; } catch (e) { /* 접근 불가 */ }
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  })();

  function read(key, fallback) {
    try {
      var raw = storage.getItem(key);
      return raw === null ? clone(fallback) : JSON.parse(raw);
    } catch (e) {
      return clone(fallback);
    }
  }
  function write(key, value) { storage.setItem(key, JSON.stringify(value)); return value; }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  /** 저장소용 경량 사본 (원본 미디어 data_url 제거, 썸네일만 유지) */
  function toStoredOrder(payload, partners) {
    var o = clone(payload);
    var now = new Date();
    o.order_id = o.order_id || generateOrderId(now);
    o.created_at = o.created_at || now.toISOString();
    o.media = (o.media || []).map(function (m) {
      return { name: m.name, type: m.type, size: m.size, thumb_url: m.thumb_url || null };
    });
    o.status = 'RECEIVED';
    o.settlement = null;
    o.assigned_distributor_id = distributorOfAgent(partners, o.attribution && o.attribution.agent_id);
    var initialEntry = { at: o.created_at, status: 'RECEIVED', by: 'CUSTOMER' };
    if (o.customer && o.customer.region) initialEntry.region = String(o.customer.region).slice(0, 120);
    if (o.customer && o.customer.note) initialEntry.note = String(o.customer.note).slice(0, 500);
    if (o.customer && o.customer.auth_provider) initialEntry.auth_provider = String(o.customer.auth_provider).slice(0, 40);
    o.history = [initialEntry];
    return o;
  }

  /** 프론트엔드 주문 객체 → public.orders DB 행 변환 */
  function orderToRow(o) {
    var svc = o.service || {};
    var attr = o.attribution || {};
    var set = o.settlement || null;
    return {
      order_id: o.order_id,
      created_at: o.created_at,
      customer_phone: o.customer ? o.customer.phone : '',
      service_type: svc.type,
      fixed_price: Number(svc.fixed_price) || 0,
      freight_payment: svc.freight_payment || (svc.type === 'DOCTOR_VISIT' ? 'INCLUDED' : 'COD'),
      agent_id: sanitizeAgentId(attr.agent_id),
      first_touch_at: attr.first_touch_at || null,
      landing_url: attr.landing_url || null,
      assigned_distributor_id: o.assigned_distributor_id || HQ_ID,
      status: o.status || 'RECEIVED',
      freight_cost: set ? set.freight_cost : null,
      labor_fee: set ? set.labor_fee : null,
      confirmed_at: set ? (set.confirmed_at || null) : null,
      media: o.media || [],
      history: o.history || []
    };
  }

  /** public.orders DB 행 → 프론트엔드 주문 객체 변환 */
  function rowToOrder(r) {
    var svc = SERVICE_TYPES[r.service_type] || {
      code: r.service_type,
      label: r.service_type,
      fixed_price: Number(r.fixed_price) || 0,
      freight_payment: r.freight_payment || 'COD'
    };
    var hasSettlement = r.freight_cost !== null && r.freight_cost !== undefined &&
      r.labor_fee !== null && r.labor_fee !== undefined;
    var hist = Array.isArray(r.history) ? r.history : [];
    var cust = { phone: r.customer_phone };
    if (hist[0] && hist[0].region) cust.region = hist[0].region;
    if (hist[0] && hist[0].note) cust.note = hist[0].note;
    if (hist[0] && hist[0].auth_provider) cust.auth_provider = hist[0].auth_provider;
    return {
      schema_version: 1,
      order_id: r.order_id,
      created_at: r.created_at,
      customer: cust,
      service: {
        type: r.service_type,
        label: svc.label,
        fixed_price: r.fixed_price !== null && r.fixed_price !== undefined ? Number(r.fixed_price) : svc.fixed_price,
        freight_payment: r.freight_payment || svc.freight_payment
      },
      attribution: {
        agent_id: r.agent_id || null,
        model: 'FIRST_TOUCH',
        first_touch_at: r.first_touch_at || null,
        landing_url: r.landing_url || null
      },
      assigned_distributor_id: r.assigned_distributor_id || HQ_ID,
      status: r.status || 'RECEIVED',
      settlement: hasSettlement ? {
        fixed_price: Number(r.fixed_price) || FIXED_PRICE,
        freight_cost: Number(r.freight_cost),
        labor_fee: Number(r.labor_fee),
        confirmed_at: r.confirmed_at || null,
        confirmed_by: 'HQ_ADMIN'
      } : null,
      media: Array.isArray(r.media) ? r.media : [],
      history: hist
    };
  }

  /** 127.0.0.1 로컬 E2E 및 Node 테스트에서는 Mock 사용, 배포 도메인에서는 Supabase 사용 */
  function useRemoteDB() {
    if (root && root.__DR119_USE_SUPABASE__ === true) return true;
    if (root && root.__DR119_USE_SUPABASE__ === false) return false;
    if (typeof window === 'undefined' || !root.location) return false;
    var host = root.location.hostname || '';
    if (!host || host === '127.0.0.1') return false;
    return typeof fetch === 'function';
  }

  function sbFetch(path, options) {
    var opts = options || {};
    var headers = Object.assign({
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    return fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          var msg = txt;
          try { var j = JSON.parse(txt); msg = j.message || j.error || txt; } catch (e) {}
          throw new Error('Supabase API 오류 (' + res.status + '): ' + msg);
        });
      }
      if (res.status === 204) return null;
      return res.text().then(function (txt) { return txt ? JSON.parse(txt) : null; });
    });
  }

  var api = {
    // --- 주문 ---
    submitOrder: function (payload) {
      if (useRemoteDB()) {
        return api.getPartners().then(function (partners) {
          var stored = toStoredOrder(payload, partners);
          return sbFetch('orders', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: orderToRow(stored)
          }).then(function () {
            try { var orders = read(KEYS.ORDERS, []); orders.unshift(stored); write(KEYS.ORDERS, orders); } catch (e) {}
            return { ok: true, order_id: stored.order_id };
          });
        });
      }
      var partners = read(KEYS.PARTNERS, SEED_PARTNERS);
      var orders = read(KEYS.ORDERS, []);
      var stored = toStoredOrder(payload, partners);
      orders.unshift(stored);
      try {
        write(KEYS.ORDERS, orders);
      } catch (e) {
        return Promise.reject(new Error('로컬 저장 공간이 부족합니다. (Mock API 한계)'));
      }
      return Promise.resolve({ ok: true, order_id: stored.order_id });
    },
    listOrders: function () {
      if (useRemoteDB()) {
        return sbFetch('orders?select=*&order=created_at.desc').then(function (rows) {
          return (rows || []).map(rowToOrder);
        });
      }
      return Promise.resolve(read(KEYS.ORDERS, []));
    },
    getOrder: function (id) {
      if (useRemoteDB()) {
        return sbFetch('orders?order_id=eq.' + encodeURIComponent(id) + '&select=*').then(function (rows) {
          return rows && rows[0] ? rowToOrder(rows[0]) : null;
        });
      }
      return Promise.resolve(read(KEYS.ORDERS, []).find(function (o) { return o.order_id === id; }) || null);
    },
    /** 정액제 확정: 서버에서도 동일 공식으로 재계산(클라이언트 값 불신) */
    confirmSettlement: function (orderId, freightCost, distributorId) {
      if (useRemoteDB()) {
        return api.getOrder(orderId).then(function (o) {
          if (!o) throw new Error('주문을 찾을 수 없습니다.');
          if (o.service.type !== 'DOCTOR_VISIT') throw new Error('방문 설치 건만 공임비를 확정할 수 있습니다.');
          if (o.status === 'COMPLETED' || o.status === 'CANCELLED') throw new Error('완료/취소된 주문은 수정할 수 없습니다.');
          var calc = calcLaborFee(freightCost);
          var now = new Date().toISOString();
          var confirmedAt = (o.settlement && o.settlement.confirmed_at) || now;
          var nextHistory = (o.history || []).concat([{ at: now, status: 'CONFIRMED', by: 'HQ_ADMIN', labor_fee: calc.labor_fee }]);
          var patchBody = {
            freight_cost: calc.freight_cost,
            labor_fee: calc.labor_fee,
            confirmed_at: confirmedAt,
            status: 'CONFIRMED',
            history: nextHistory
          };
          if (distributorId) patchBody.assigned_distributor_id = distributorId;
          return sbFetch('orders?order_id=eq.' + encodeURIComponent(orderId), {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: patchBody
          }).then(function (rows) {
            return rows && rows[0] ? rowToOrder(rows[0]) : null;
          });
        });
      }
      var orders = read(KEYS.ORDERS, []);
      var o = orders.find(function (x) { return x.order_id === orderId; });
      if (!o) return Promise.reject(new Error('주문을 찾을 수 없습니다.'));
      if (o.service.type !== 'DOCTOR_VISIT') return Promise.reject(new Error('방문 설치 건만 공임비를 확정할 수 있습니다.'));
      if (o.status === 'COMPLETED' || o.status === 'CANCELLED') return Promise.reject(new Error('완료/취소된 주문은 수정할 수 없습니다.'));
      var calc;
      try { calc = calcLaborFee(freightCost); } catch (e) { return Promise.reject(e); }
      var now = new Date().toISOString();
      o.settlement = {
        fixed_price: calc.fixed_price,
        freight_cost: calc.freight_cost,
        labor_fee: calc.labor_fee,
        confirmed_at: (o.settlement && o.settlement.confirmed_at) || now,
        updated_at: now,
        confirmed_by: 'HQ_ADMIN'
      };
      if (distributorId) o.assigned_distributor_id = distributorId;
      o.status = 'CONFIRMED';
      o.history = (o.history || []).concat([{ at: now, status: 'CONFIRMED', by: 'HQ_ADMIN', labor_fee: calc.labor_fee }]);
      write(KEYS.ORDERS, orders);
      return Promise.resolve(clone(o));
    },
    updateOrderStatus: function (orderId, status, by) {
      if (!ORDER_STATUS[status]) return Promise.reject(new Error('잘못된 상태값'));
      if (useRemoteDB()) {
        return api.getOrder(orderId).then(function (o) {
          if (!o) throw new Error('주문을 찾을 수 없습니다.');
          var now = new Date().toISOString();
          var nextHistory = (o.history || []).concat([{ at: now, status: status, by: by || 'HQ_ADMIN' }]);
          return sbFetch('orders?order_id=eq.' + encodeURIComponent(orderId), {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: { status: status, history: nextHistory }
          }).then(function (rows) {
            return rows && rows[0] ? rowToOrder(rows[0]) : null;
          });
        });
      }
      var orders = read(KEYS.ORDERS, []);
      var o = orders.find(function (x) { return x.order_id === orderId; });
      if (!o) return Promise.reject(new Error('주문을 찾을 수 없습니다.'));
      var now = new Date().toISOString();
      o.status = status;
      o.history = (o.history || []).concat([{ at: now, status: status, by: by || 'HQ_ADMIN' }]);
      write(KEYS.ORDERS, orders);
      return Promise.resolve(clone(o));
    },

    // --- 파트너/마진/계약/차감 ---
    getPartners: function () {
      if (useRemoteDB()) {
        return Promise.all([
          sbFetch('distributors?select=*&order=id.asc'),
          sbFetch('agents?select=*&order=agent_id.asc')
        ]).then(function (res) {
          return { distributors: res[0] || [], agents: res[1] || [] };
        });
      }
      return Promise.resolve(read(KEYS.PARTNERS, SEED_PARTNERS));
    },
    getMargins: function () {
      if (useRemoteDB()) {
        return sbFetch('margins?select=*&order=id.asc').then(function (rows) {
          return (rows || []).map(function (m) {
            return { id: m.id, name: m.name, share_pct: Number(m.share_pct) };
          });
        });
      }
      return Promise.resolve(read(KEYS.MARGINS, SEED_MARGINS));
    },
    saveMargins: function (margins) {
      for (var i = 0; i < margins.length; i++) {
        var p = Number(margins[i].share_pct);
        if (!Number.isFinite(p) || p < 0 || p > 100) return Promise.reject(new Error('마진율은 0~100% 사이여야 합니다.'));
        if (!margins[i].id || !margins[i].name) return Promise.reject(new Error('아이템 ID와 이름은 필수입니다.'));
      }
      if (useRemoteDB()) {
        var rows = margins.map(function (m) {
          return { id: m.id, name: m.name, share_pct: Number(m.share_pct) };
        });
        var upsertPromise = rows.length
          ? sbFetch('margins?on_conflict=id', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
              body: rows
            })
          : Promise.resolve([]);
        return upsertPromise.then(function () {
          return api.getMargins();
        }).then(function (existing) {
          var keep = {};
          rows.forEach(function (r) { keep[r.id] = true; });
          var toDelete = existing.filter(function (e) { return !keep[e.id]; }).map(function (e) { return e.id; });
          if (!toDelete.length) return rows;
          return Promise.all(toDelete.map(function (id) {
            return sbFetch('margins?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
          })).then(function () { return rows; });
        });
      }
      return Promise.resolve(write(KEYS.MARGINS, margins));
    },
    getContracts: function () {
      if (useRemoteDB()) {
        return sbFetch('contracts?select=*&order=created_at.desc').then(function (rows) {
          return (rows || []).map(function (c) {
            return Object.assign({}, c, { monthly_amount: Number(c.monthly_amount) || 0 });
          });
        });
      }
      return Promise.resolve(read(KEYS.CONTRACTS, []));
    },
    addContract: function (c) {
      var rec = {
        contract_id: 'CT-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
        customer_phone: c.customer_phone,
        agent_id: sanitizeAgentId(c.agent_id),
        item_id: c.item_id,
        monthly_amount: Number(c.monthly_amount) || 0,
        start_month: c.start_month,
        end_month: c.end_month || null,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      };
      if (useRemoteDB()) {
        return sbFetch('contracts', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: rec
        }).then(function (rows) {
          var saved = rows && rows[0] ? rows[0] : rec;
          return Object.assign({}, saved, { monthly_amount: Number(saved.monthly_amount) || 0 });
        });
      }
      var list = read(KEYS.CONTRACTS, []);
      list.unshift(rec);
      write(KEYS.CONTRACTS, list);
      return Promise.resolve(rec);
    },
    cancelContract: function (id) {
      if (useRemoteDB()) {
        return sbFetch('contracts?contract_id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: { status: 'CANCELLED' }
        }).then(function (rows) {
          return rows && rows[0] ? rows[0] : null;
        });
      }
      var list = read(KEYS.CONTRACTS, []);
      var c = list.find(function (x) { return x.contract_id === id; });
      if (c) { c.status = 'CANCELLED'; write(KEYS.CONTRACTS, list); }
      return Promise.resolve(c || null);
    },
    getPenalties: function () {
      if (useRemoteDB()) {
        return sbFetch('penalties?select=*').then(function (rows) {
          var map = {};
          (rows || []).forEach(function (r) {
            map[r.month] = map[r.month] || {};
            map[r.month][r.distributor_id] = {
              amount: Number(r.amount) || 0,
              memo: r.memo || '',
              updated_at: r.updated_at || null
            };
          });
          return map;
        });
      }
      return Promise.resolve(read(KEYS.PENALTIES, {}));
    },
    setPenalty: function (month, distributorId, amount, memo) {
      var a = Math.abs(Number(amount) || 0);
      if (!Number.isInteger(a)) return Promise.reject(new Error('차감액은 원 단위 정수여야 합니다.'));
      var now = new Date().toISOString();
      if (useRemoteDB()) {
        var row = { month: month, distributor_id: distributorId, amount: a, memo: memo || '', updated_at: now };
        return sbFetch('penalties?on_conflict=month,distributor_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: row
        }).then(function () {
          return { amount: a, memo: memo || '', updated_at: now };
        });
      }
      var all = read(KEYS.PENALTIES, {});
      all[month] = all[month] || {};
      all[month][distributorId] = { amount: a, memo: memo || '', updated_at: now };
      write(KEYS.PENALTIES, all);
      return Promise.resolve(all[month][distributorId]);
    },

    // --- 고객 측 First-touch 저장 ---
    getAttribution: function () { return read(KEYS.ATTRIBUTION, null); },
    saveAttribution: function (a) { return write(KEYS.ATTRIBUTION, a); },

    // --- 1차 전화 상담 및 정밀 진단 기록 ---
    saveConsultation: function (orderId, data) {
      if (!orderId) return Promise.reject(new Error('주문 ID가 필요합니다.'));
      var orders = read(KEYS.ORDERS, []);
      var o = orders.find(function (x) { return x.order_id === orderId; });
      if (!o) return Promise.reject(new Error('주문을 찾을 수 없습니다.'));
      var now = new Date().toISOString();
      o.consultation = {
        product_size: data.product_size || '',
        manufacturer: data.manufacturer || '',
        years_used: data.years_used || '',
        problem_detail: data.problem_detail || '',
        duration_of_issue: data.duration_of_issue || '',
        diagnostic_solution: data.diagnostic_solution || 'REBORN_400K',
        freight_quote: Number(data.freight_quote) || 0,
        quote_amount: Number(data.quote_amount) || 400000,
        notes: data.notes || '',
        consulted_at: now,
        consulted_by: data.consulted_by || 'HQ_COUNSELOR'
      };
      o.consultation_status = 'COMPLETED';
      o.history = (o.history || []).concat([{ at: now, status: 'CONSULTED', by: data.consulted_by || 'HQ_COUNSELOR', note: '1차 전화 상담 및 견적 안내 완료' }]);
      write(KEYS.ORDERS, orders);
      return Promise.resolve(clone(o));
    },

    // --- 고객 전용 수리·상담 상태 조회 (전화번호 또는 주문번호, 카카오 인증 및 보안 검증) ---
    getCustomerOrders: function (query, secCode) {
      if (!query) return Promise.resolve([]);
      var q = String(query).trim();
      var qDigits = q.replace(/[^0-9]/g, '');

      function checkMatch(o) {
        if (!o) return false;
        // 1. 접수번호 정확 일치
        if (o.order_id && o.order_id.toUpperCase() === q.toUpperCase()) return true;

        // 2. 전화번호 일치
        var pDigits = (o.customer && o.customer.phone ? String(o.customer.phone) : '').replace(/[^0-9]/g, '');
        if (qDigits.length >= 8 && pDigits === qDigits) {
          // 보안 검증 (휴대폰 뒷 4자리 또는 보안코드)
          if (secCode) {
            var pin = String(secCode).replace(/[^0-9]/g, '');
            var last4 = pDigits.slice(-4);
            return pin === last4;
          }
          return true;
        }
        return false;
      }

      if (useRemoteDB()) {
        return api.listOrders().then(function (orders) {
          return (orders || []).filter(checkMatch).map(clone);
        });
      }

      var orders = read(KEYS.ORDERS, []);
      return Promise.resolve(orders.filter(checkMatch).map(clone));
    },

    getCustomerOrder: function (query, secCode) {
      return api.getCustomerOrders(query, secCode).then(function (list) {
        return list && list.length ? list[0] : null;
      });
    },

    // --- 입점/제휴사 등록 상품 관리 ---
    getProducts: function () {
      return Promise.resolve(read(KEYS.PRODUCTS, SEED_PRODUCTS));
    },
    saveProduct: function (prod) {
      if (!prod.name || !prod.vendor_name || !prod.price) {
        return Promise.reject(new Error('상품명, 제휴사명, 가격은 필수입니다.'));
      }
      var list = read(KEYS.PRODUCTS, SEED_PRODUCTS);
      var item = {
        id: prod.id || ('PROD-' + Date.now().toString(36).toUpperCase()),
        vendor_name: String(prod.vendor_name).trim(),
        name: String(prod.name).trim(),
        category: prod.category || 'ULTRASONIC_REBORN',
        price: Number(prod.price) || 0,
        supply_price: Number(prod.supply_price) || 0,
        partner_share_pct: Number(prod.partner_share_pct) || 10,
        specs: String(prod.specs || '').trim(),
        description: String(prod.description || '').trim(),
        image_url: prod.image_url || 'icons/dr119-logo.svg',
        status: prod.status || 'ACTIVE',
        created_at: prod.created_at || new Date().toISOString()
      };
      var idx = list.findIndex(function (x) { return x.id === item.id; });
      if (idx >= 0) list[idx] = item;
      else list.unshift(item);
      write(KEYS.PRODUCTS, list);
      return Promise.resolve(item);
    },

    // --- QR 영업자 1년간 수익 배분 추적 ---
    getAffiliateSales: function (agentId) {
      var all = read(KEYS.AFFILIATE_SALES, SEED_AFFILIATE_SALES);
      if (!agentId) return Promise.resolve(all);
      var aid = sanitizeAgentId(agentId);
      var filtered = all.filter(function (s) { return s.agent_id === aid; });
      return Promise.resolve(filtered);
    },
    recordAffiliateSale: function (sale) {
      if (!sale.agent_id || !sale.customer_phone || !sale.product_name) {
        return Promise.reject(new Error('영업자 ID, 고객 연락처, 상품명은 필수입니다.'));
      }
      var all = read(KEYS.AFFILIATE_SALES, SEED_AFFILIATE_SALES);
      var now = new Date();
      var oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      var amount = Number(sale.sale_amount) || 0;
      var rate = Number(sale.commission_rate) || 10;
      var comm = Math.round(amount * (rate / 100));
      var rec = {
        sale_id: 'AFF-' + Date.now().toString(36).toUpperCase(),
        agent_id: sanitizeAgentId(sale.agent_id),
        customer_phone: normalizePhone(sale.customer_phone) || sale.customer_phone,
        product_id: sale.product_id || null,
        product_name: sale.product_name,
        sale_amount: amount,
        commission_rate: rate,
        commission_amount: comm,
        valid_until: oneYearLater,
        status: 'ACCUMULATED',
        created_at: now.toISOString()
      };
      all.unshift(rec);
      write(KEYS.AFFILIATE_SALES, all);
      return Promise.resolve(rec);
    },

    // --- 주방용품·설비·인테리어 역경매 시스템 (헤이딜러형 실시간 입찰) ---
    getAuctions: function (category) {
      var list = read(KEYS.AUCTIONS, SEED_AUCTIONS);
      if (category && category !== 'ALL') {
        list = list.filter(function (a) { return a.category === category; });
      }
      return Promise.resolve(list);
    },
    createAuction: function (data) {
      if (!data.title || !data.category || !data.customer_phone) {
        return Promise.reject(new Error('품목명, 카테고리, 연락처는 필수입니다.'));
      }
      var list = read(KEYS.AUCTIONS, SEED_AUCTIONS);
      var now = new Date();
      var deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      var item = {
        auction_id: 'AUC-' + Date.now().toString(36).toUpperCase(),
        customer_phone: normalizePhone(data.customer_phone) || data.customer_phone,
        title: String(data.title).trim(),
        category: data.category,
        size_spec: String(data.size_spec || '').trim(),
        desired_price: Number(data.desired_price) || 0,
        region: String(data.region || '전국').trim(),
        notes: String(data.notes || '').trim(),
        status: 'OPEN',
        selected_bid_id: null,
        bid_count: 0,
        lowest_bid: Number(data.desired_price) || 0,
        deadline: data.deadline || deadline,
        created_at: now.toISOString()
      };
      list.unshift(item);
      write(KEYS.AUCTIONS, list);
      return Promise.resolve(item);
    },
    getAuctionBids: function (auctionId) {
      var all = read(KEYS.AUCTION_BIDS, SEED_AUCTION_BIDS);
      if (!auctionId) return Promise.resolve(all);
      var bids = all.filter(function (b) { return b.auction_id === auctionId; });
      bids.sort(function (a, b) { return a.bid_price - b.bid_price; });
      return Promise.resolve(bids);
    },
    submitBid: function (bid) {
      if (!bid.auction_id || !bid.dealer_name || !bid.bid_price) {
        return Promise.reject(new Error('경매 번호, 입찰 업체명, 입찰 금액은 필수입니다.'));
      }
      var allBids = read(KEYS.AUCTION_BIDS, SEED_AUCTION_BIDS);
      var allAuctions = read(KEYS.AUCTIONS, SEED_AUCTIONS);
      var price = Number(bid.bid_price) || 0;
      var newBid = {
        bid_id: 'BID-' + Date.now().toString(36).toUpperCase(),
        auction_id: bid.auction_id,
        dealer_id: bid.dealer_id || ('DL_' + Date.now().toString(36).toUpperCase()),
        dealer_name: String(bid.dealer_name).trim(),
        bid_price: price,
        warranty_months: Number(bid.warranty_months) || 12,
        delivery_days: Number(bid.delivery_days) || 3,
        benefits: String(bid.benefits || '').trim(),
        status: 'BIDDING',
        created_at: new Date().toISOString()
      };
      allBids.unshift(newBid);
      write(KEYS.AUCTION_BIDS, allBids);

      // 경매 최저 입찰가 및 입찰수 자동 업데이트
      var targetAuc = allAuctions.find(function (a) { return a.auction_id === bid.auction_id; });
      if (targetAuc) {
        targetAuc.bid_count = (targetAuc.bid_count || 0) + 1;
        if (!targetAuc.lowest_bid || price < targetAuc.lowest_bid) {
          targetAuc.lowest_bid = price;
        }
        write(KEYS.AUCTIONS, allAuctions);
      }

      return Promise.resolve(newBid);
    },
    acceptBid: function (auctionId, bidId) {
      var allBids = read(KEYS.AUCTION_BIDS, SEED_AUCTION_BIDS);
      var allAuctions = read(KEYS.AUCTIONS, SEED_AUCTIONS);
      var bid = allBids.find(function (b) { return b.bid_id === bidId; });
      var auc = allAuctions.find(function (a) { return a.auction_id === auctionId; });
      if (!bid || !auc) return Promise.reject(new Error('경매 또는 입찰 정보를 찾을 수 없습니다.'));

      bid.status = 'ACCEPTED';
      auc.status = 'ACCEPTED';
      auc.selected_bid_id = bidId;

      write(KEYS.AUCTION_BIDS, allBids);
      write(KEYS.AUCTIONS, allAuctions);
      return Promise.resolve({ ok: true, auction: auc, bid: bid });
    },
    getAuctionDealers: function () {
      return Promise.resolve(read(KEYS.AUCTION_DEALERS, SEED_AUCTION_DEALERS));
    },
    registerAuctionDealer: function (dealer) {
      if (!dealer.company_name || !dealer.biz_no || !dealer.phone) {
        return Promise.reject(new Error('업체명, 사업자번호, 연락처는 필수입니다.'));
      }
      var list = read(KEYS.AUCTION_DEALERS, SEED_AUCTION_DEALERS);
      var item = {
        dealer_id: 'DL_' + Date.now().toString(36).toUpperCase(),
        company_name: String(dealer.company_name).trim(),
        dealer_type: dealer.dealer_type || 'DISTRIBUTOR',
        biz_no: String(dealer.biz_no).trim(),
        rep_name: String(dealer.rep_name || '대표').trim(),
        phone: normalizePhone(dealer.phone) || dealer.phone,
        region: String(dealer.region || '전국').trim(),
        rating: 5.0,
        review_count: 0,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      };
      list.unshift(item);
      write(KEYS.AUCTION_DEALERS, list);
      return Promise.resolve(item);
    },

    // --- 전국 24시콜 기준 실시간 화물 운임 계산 엔진 (1톤 표준) ---
    calcFreightRate: function (origin, destination, customKm) {
      var km = Number(customKm) || 0;
      if (!km) {
        var text = (origin + ' ' + destination);
        if (/진주|부산|창원|울산|김해|통영/i.test(text) && /반월|화성|안산|서울|경기|인천/i.test(text)) km = 330;
        else if (/대구|포항|구미|경주/i.test(text) && /서울|경기|인천|화성/i.test(text)) km = 270;
        else if (/광주|목포|순천|여수/i.test(text) && /서울|경기|인천|화성/i.test(text)) km = 290;
        else if (/전주|익산|군산/i.test(text) && /서울|경기|인천|화성/i.test(text)) km = 200;
        else if (/대전|세종|천안|청주/i.test(text) && /서울|경기|인천|화성/i.test(text)) km = 130;
        else if (/강릉|속초|동해/i.test(text) && /서울|경기|인천|화성/i.test(text)) km = 210;
        else km = 45;
      }

      var charter = 0;
      var consolidated = 0;

      if (km <= 30) {
        charter = 50000; consolidated = 40000;
      } else if (km <= 60) {
        charter = 70000; consolidated = 50000;
      } else if (km <= 100) {
        charter = 95000; consolidated = 65000;
      } else if (km <= 150) {
        charter = 130000; consolidated = 85000;
      } else if (km <= 200) {
        charter = 160000; consolidated = 100000;
      } else if (km <= 260) {
        charter = 190000; consolidated = 120000;
      } else {
        charter = 220000;
        consolidated = 140000; // 반월 ↔ 진주 등 300km 이상 표준 실비
      }

      return Promise.resolve({
        distance_km: km,
        origin: origin || '경기 화성시 반월동 (본사 팩토리)',
        destination: destination || '경남 진주시',
        charter_price: charter,
        consolidated_price: consolidated,
        discount_rate: Math.round((1 - consolidated / charter) * 100) + '% 절감',
        commission_rate_pct: 3.0,
        call24_standard: true
      });
    }
  };

  /* ------------------------------------------------------------
   * 본사 Super Admin 인증 (SHA-256 해시 검증, 평문 비노출)
   * ------------------------------------------------------------ */
  var ADMIN_SESSION_KEY = 'dr119_hq_auth_v1';
  var ADMIN_AUTH_SALT = 'dr119-hq:';
  var ADMIN_AUTH_HASH = '9bed1ddb7c60b865c0006c0ba0bb7422e426caf788fe034e8025fde68e254d6c';

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(str) {
    var bytes = new TextEncoder().encode(String(str == null ? '' : str));
    var bitLen = bytes.length * 8;
    var padLen = ((bytes.length + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Int32Array(64);

    for (var i = 0; i < padLen; i += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getInt32(i + t * 4, false);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (v) {
      return ('00000000' + (v >>> 0).toString(16)).slice(-8);
    }).join('');
  }

  function verifyAdminPassword(password) {
    return typeof password === 'string' && password.length > 0 && sha256Hex(ADMIN_AUTH_SALT + password) === ADMIN_AUTH_HASH;
  }

  function verifyAdminToken(token) {
    return typeof token === 'string' && token === ADMIN_AUTH_HASH;
  }

  return {
    SUPABASE_URL: SUPABASE_URL,
    FIXED_PRICE: FIXED_PRICE,
    SERVICE_TYPES: SERVICE_TYPES,
    ORDER_STATUS: ORDER_STATUS,
    HQ_ID: HQ_ID,
    KEYS: KEYS,
    ADMIN_SESSION_KEY: ADMIN_SESSION_KEY,
    ADMIN_AUTH_HASH: ADMIN_AUTH_HASH,
    sha256Hex: sha256Hex,
    verifyAdminPassword: verifyAdminPassword,
    verifyAdminToken: verifyAdminToken,
    sanitizeAgentId: sanitizeAgentId,
    parseAgentId: parseAgentId,
    resolveFirstTouch: resolveFirstTouch,
    calcLaborFee: calcLaborFee,
    monthKey: monthKey,
    currentMonthKey: currentMonthKey,
    distributorOfAgent: distributorOfAgent,
    agentsOfDistributor: agentsOfDistributor,
    isBillableOrder: isBillableOrder,
    isContractActive: isContractActive,
    computeCommissionLines: computeCommissionLines,
    computeBilling: computeBilling,
    toCSV: toCSV,
    billingToCSV: billingToCSV,
    formatKRW: formatKRW,
    normalizePhone: normalizePhone,
    generateOrderId: generateOrderId,
    escapeHTML: escapeHTML,
    orderToRow: orderToRow,
    rowToOrder: rowToOrder,
    toStoredOrder: toStoredOrder,
    useRemoteDB: useRemoteDB,
    SEED_PARTNERS: SEED_PARTNERS,
    SEED_MARGINS: SEED_MARGINS,
    SEED_PRODUCTS: SEED_PRODUCTS,
    SEED_AFFILIATE_SALES: SEED_AFFILIATE_SALES,
    SEED_AUCTIONS: SEED_AUCTIONS,
    SEED_AUCTION_BIDS: SEED_AUCTION_BIDS,
    SEED_AUCTION_DEALERS: SEED_AUCTION_DEALERS,
    api: api
  };
});
