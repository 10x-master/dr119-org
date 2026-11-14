/*!
 * Dr.119 Core — 공통 비즈니스 로직 + Mock API 계층
 * ------------------------------------------------------------------
 * - 순수 함수(계산/귀속/정산/CSV)는 DOM 의존성이 없어 Node에서 단위 테스트 가능.
 * - Mock API는 localStorage에 JSON으로 저장한다. 백엔드 연동 시 Dr119.api.* 내부만
 *   fetch()로 교체하면 각 페이지 코드는 수정할 필요가 없다. (모든 메서드는 Promise 반환)
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

  /* ================================================================
   * 8. Mock API (localStorage JSON). 백엔드 연동 시 이 블록만 교체.
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
    o.media = (o.media || []).map(function (m) {
      return { name: m.name, type: m.type, size: m.size, thumb_url: m.thumb_url || null };
    });
    o.status = 'RECEIVED';
    o.settlement = null;
    o.assigned_distributor_id = distributorOfAgent(partners, o.attribution && o.attribution.agent_id);
    o.history = [{ at: o.created_at, status: 'RECEIVED', by: 'CUSTOMER' }];
    return o;
  }

  var api = {
    // --- 주문 ---
    submitOrder: function (payload) {
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
    listOrders: function () { return Promise.resolve(read(KEYS.ORDERS, [])); },
    getOrder: function (id) {
      return Promise.resolve(read(KEYS.ORDERS, []).find(function (o) { return o.order_id === id; }) || null);
    },
    /** 정액제 확정: 서버에서도 동일 공식으로 재계산(클라이언트 값 불신) */
    confirmSettlement: function (orderId, freightCost, distributorId) {
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
      var orders = read(KEYS.ORDERS, []);
      var o = orders.find(function (x) { return x.order_id === orderId; });
      if (!o) return Promise.reject(new Error('주문을 찾을 수 없습니다.'));
      if (!ORDER_STATUS[status]) return Promise.reject(new Error('잘못된 상태값'));
      var now = new Date().toISOString();
      o.status = status;
      o.history = (o.history || []).concat([{ at: now, status: status, by: by || 'HQ_ADMIN' }]);
      write(KEYS.ORDERS, orders);
      return Promise.resolve(clone(o));
    },

    // --- 파트너/마진/계약/차감 ---
    getPartners: function () { return Promise.resolve(read(KEYS.PARTNERS, SEED_PARTNERS)); },
    getMargins: function () { return Promise.resolve(read(KEYS.MARGINS, SEED_MARGINS)); },
    saveMargins: function (margins) {
      for (var i = 0; i < margins.length; i++) {
        var p = Number(margins[i].share_pct);
        if (!Number.isFinite(p) || p < 0 || p > 100) return Promise.reject(new Error('마진율은 0~100% 사이여야 합니다.'));
        if (!margins[i].id || !margins[i].name) return Promise.reject(new Error('아이템 ID와 이름은 필수입니다.'));
      }
      return Promise.resolve(write(KEYS.MARGINS, margins));
    },
    getContracts: function () { return Promise.resolve(read(KEYS.CONTRACTS, [])); },
    addContract: function (c) {
      var list = read(KEYS.CONTRACTS, []);
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
      list.unshift(rec);
      write(KEYS.CONTRACTS, list);
      return Promise.resolve(rec);
    },
    cancelContract: function (id) {
      var list = read(KEYS.CONTRACTS, []);
      var c = list.find(function (x) { return x.contract_id === id; });
      if (c) { c.status = 'CANCELLED'; write(KEYS.CONTRACTS, list); }
      return Promise.resolve(c || null);
    },
    getPenalties: function () { return Promise.resolve(read(KEYS.PENALTIES, {})); },
    setPenalty: function (month, distributorId, amount, memo) {
      var a = Math.abs(Number(amount) || 0);
      if (!Number.isInteger(a)) return Promise.reject(new Error('차감액은 원 단위 정수여야 합니다.'));
      var all = read(KEYS.PENALTIES, {});
      all[month] = all[month] || {};
      all[month][distributorId] = { amount: a, memo: memo || '', updated_at: new Date().toISOString() };
      write(KEYS.PENALTIES, all);
      return Promise.resolve(all[month][distributorId]);
    },

    // --- 고객 측 First-touch 저장 ---
    getAttribution: function () { return read(KEYS.ATTRIBUTION, null); },
    saveAttribution: function (a) { return write(KEYS.ATTRIBUTION, a); }
  };

  return {
    FIXED_PRICE: FIXED_PRICE,
    SERVICE_TYPES: SERVICE_TYPES,
    ORDER_STATUS: ORDER_STATUS,
    HQ_ID: HQ_ID,
    KEYS: KEYS,
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
    SEED_PARTNERS: SEED_PARTNERS,
    SEED_MARGINS: SEED_MARGINS,
    api: api
  };
});
