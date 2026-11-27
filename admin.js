/* Dr.119 — Phase 2: 본사 Super Admin */
(function () {
  'use strict';
  var D = window.Dr119;
  var api = D.api;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = D.escapeHTML;
  var won = D.formatKRW;

  var state = { orders: [], partners: D.SEED_PARTNERS, margins: [], contracts: [], penalties: {}, billingRows: [] };

  /* ------------------------------------------------------------ 공통 */
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 2400);
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function distName(id) {
    if (id === D.HQ_ID) return '본사 직영';
    var d = state.partners.distributors.find(function (x) { return x.id === id; });
    return d ? d.name : id;
  }
  function agentLabel(agentId) {
    if (!agentId) return '<span class="chip">직접 유입</span>';
    var a = state.partners.agents.find(function (x) { return x.agent_id === agentId; });
    return '<span class="mono">' + esc(agentId) + '</span>' + (a ? '' : ' <span class="chip">미등록</span>');
  }
  function thumbHTML(m) {
    if (m && m.thumb_url) return '<img class="thumb" src="' + esc(m.thumb_url) + '" alt="">';
    if (m && /^video\//.test(m.type)) return '<span class="thumb" title="' + esc(m.name) + '">영상</span>';
    return '<span class="thumb">파일</span>';
  }

  function loadAll() {
    return Promise.all([
      api.listOrders(),
      api.getPartners(),
      api.getMargins(),
      api.getContracts(),
      api.getPenalties(),
      api.getProducts ? api.getProducts() : Promise.resolve([]),
      api.getAffiliateSales ? api.getAffiliateSales() : Promise.resolve([]),
      api.getAuctions ? api.getAuctions() : Promise.resolve([]),
      api.getAuctionDealers ? api.getAuctionDealers() : Promise.resolve([])
    ]).then(function (r) {
      state.orders = r[0]; state.partners = r[1]; state.margins = r[2]; state.contracts = r[3]; state.penalties = r[4];
      state.products = r[5] || []; state.affiliateSales = r[6] || [];
      state.auctions = r[7] || []; state.auctionDealers = r[8] || [];
    });
  }
  function renderAll() { renderOrders(); renderBilling(); renderMargins(); renderContracts(); renderPartners(); renderNetwork(); renderAuctionsAdmin(); renderProducts(); renderAffiliateSales(); }

  /* ------------------------------------------------------------ 탭 */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    history.replaceState(null, '', '#' + tab.getAttribute('aria-controls').replace('tab-', ''));
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { selectTab(t); }); });

  /* ============================================================
   * 1. 주문 접수함
   * ============================================================ */
  ['#f-status', '#f-type'].forEach(function (s) { $(s).addEventListener('change', renderOrders); });
  $('#f-q').addEventListener('input', renderOrders);

  function renderOrdersKpis() {
    var box = $('#orders-kpis');
    if (!box) return;
    var received = 0, confirmed = 0, done = 0, kakao = 0, stale = 0;
    var nowMs = Date.now();
    state.orders.forEach(function (o) {
      if (o.status === 'RECEIVED') {
        received++;
        if (o.created_at && (nowMs - new Date(o.created_at).getTime()) > 24 * 3600 * 1000) stale++;
      } else if (o.status === 'CONFIRMED') confirmed++;
      else if (o.status === 'COMPLETED' || o.status === 'SHIPPED') done++;
      if (o.customer && o.customer.auth_provider === 'KAKAO') kakao++;
    });
    box.innerHTML =
      '<div class="kpi accent"><div class="label">신규 접수 (배차 대기)</div><div class="value">' + received + '건</div><div class="sub">' + (stale ? '24시간+ 지연 ' + stale + '건' : '지연 없음') + '</div></div>' +
      '<div class="kpi"><div class="label">공임 확정·수리중</div><div class="value">' + confirmed + '건</div><div class="sub">지역 센터·닥터 진행</div></div>' +
      '<div class="kpi"><div class="label">완료·발송</div><div class="value">' + done + '건</div><div class="sub">누적 ' + state.orders.length + '건 중</div></div>' +
      '<div class="kpi"><div class="label">카카오 간편 접수</div><div class="value">' + kakao + '건</div><div class="sub">1초 간편 등록 고객</div></div>';
  }

  function renderOrders() {
    renderOrdersKpis();
    var st = $('#f-status').value, ty = $('#f-type').value, q = $('#f-q').value.trim().toUpperCase().replace(/-/g, '');
    var list = state.orders.filter(function (o) {
      if (st && o.status !== st) return false;
      if (ty && o.service.type !== ty) return false;
      if (q) {
        var hay = [o.order_id, o.customer.phone, o.customer.region, o.customer.note, o.attribution && o.attribution.agent_id].join(' ').toUpperCase().replace(/-/g, '');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var received = state.orders.filter(function (o) { return o.status === 'RECEIVED'; }).length;
    var badge = $('#badge-received');
    badge.textContent = String(received);
    if (received) badge.removeAttribute('data-zero'); else badge.setAttribute('data-zero', '');

    $('#orders-table tbody').innerHTML = list.map(function (o) {
      var m = o.media || [];
      var fee = o.settlement ? won(o.settlement.labor_fee) : (o.service.type === 'SELF_PICKUP' ? '<span class="chip">해당 없음</span>' : '<span class="neg">미확정</span>');
      var authTag = o.customer && o.customer.auth_provider === 'KAKAO' ? '<span class="chip kakao-chip">카카오</span>' : '';
      var regionTag = o.customer && o.customer.region ? ' <span class="chip">' + esc(o.customer.region) + '</span>' : '';
      var noteSnippet = o.customer && o.customer.note ? '<br><span class="hint">' + esc(String(o.customer.note).slice(0, 36)) + '</span>' : '';
      return '<tr class="clickable" data-id="' + esc(o.order_id) + '" tabindex="0">' +
        '<td>' + fmtDate(o.created_at) + '</td>' +
        '<td class="mono">' + esc(o.order_id) + '</td>' +
        '<td>' + thumbHTML(m[0]) + (m.length > 1 ? '<span class="thumb-more">+' + (m.length - 1) + '</span>' : '') + '</td>' +
        '<td>' + esc(o.customer.phone) + authTag + regionTag + noteSnippet + '</td>' +
        '<td><span class="chip type-' + esc(o.service.type) + '">' + (o.service.type === 'DOCTOR_VISIT' ? '방문 설치' : '직접 수령') + '</span></td>' +
        '<td>' + agentLabel(o.attribution && o.attribution.agent_id) + '</td>' +
        '<td>' + esc(distName(o.assigned_distributor_id)) + '</td>' +
        '<td class="num">' + fee + '</td>' +
        '<td><span class="chip ' + esc(o.status) + '">' + esc(D.ORDER_STATUS[o.status] || o.status) + '</span></td>' +
        '</tr>';
    }).join('');
    $('#orders-empty').hidden = list.length > 0;
  }

  $('#orders-table tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) openOrder(tr.getAttribute('data-id'));
  });
  $('#orders-table tbody').addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openOrder(tr.getAttribute('data-id')); }
  });

  /* ---------- 주문 상세 + 40만 원 정액제 계산기 ---------- */
  var dlg = $('#order-dialog');

  function openOrder(id) {
    var o = state.orders.find(function (x) { return x.order_id === id; });
    if (!o) return;
    var a = o.attribution || {};
    var media = (o.media || []).map(function (m) {
      return '<figure>' + (m.thumb_url ? '<img src="' + esc(m.thumb_url) + '" alt="' + esc(m.name) + '">'
        : '<span style="font-size:28px">' + (/^video\//.test(m.type) ? '🎬' : '📄') + '</span>' + esc(m.name)) + '</figure>';
    }).join('');
    var html =
      '<div class="media-grid">' + (media || '<p class="hint">첨부 없음</p>') + '</div>' +
      '<dl class="kv">' +
      '<dt>접수번호</dt><dd class="mono">' + esc(o.order_id) + '</dd>' +
      '<dt>접수일시</dt><dd>' + fmtDate(o.created_at) + '</dd>' +
      '<dt>연락처</dt><dd><a href="tel:' + esc(o.customer.phone) + '">' + esc(o.customer.phone) + '</a>' +
        (o.customer.auth_provider === 'KAKAO' ? ' <span class="chip kakao-chip">카카오 간편등록</span>' : '') + '</dd>' +
      (o.customer.region ? '<dt>지역</dt><dd>' + esc(o.customer.region) + '</dd>' : '') +
      (o.customer.note ? '<dt>고장 증상</dt><dd>' + esc(o.customer.note) + '</dd>' : '') +
      '<dt>선택 옵션</dt><dd>' + esc(o.service.label) + '</dd>' +
      '<dt>유입 QR</dt><dd>' + agentLabel(a.agent_id) + ' → ' + esc(distName(D.distributorOfAgent(state.partners, a.agent_id))) +
        (a.first_touch_at ? '<br><span class="hint">최초 유입 ' + fmtDate(a.first_touch_at) + '</span>' : '') + '</dd>' +
      '<dt>상태</dt><dd><span class="chip ' + esc(o.status) + '">' + esc(D.ORDER_STATUS[o.status]) + '</span></dd>' +
      '</dl>';

    var cs = o.consultation || {};
    html +=
      '<section class="consult-box" style="margin:14px 0;padding:14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;">' +
      '<h3 style="margin:0 0 10px;font-size:0.95rem;color:#0f172a;display:flex;align-items:center;gap:6px;">' +
      '<span>📞</span> 1차 전화 상담 및 정밀 진단 기록부' +
      (o.consultation_status === 'COMPLETED' ? ' <span class="chip" style="background:#0f766e;color:#fff;">상담 완료</span>' : ' <span class="chip" style="background:#e2e8f0;color:#475569;">미상담</span>') +
      '</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;">' +
      '<div><label>기기 규격(사이즈)</label>' +
      '<select id="cs-size">' +
      ['선택 안 함', '800형 (소형)', '900형', '1000형 (표준)', '1200형 (대형)', '1500형 (특대형)', '기타 규격'].map(function(s){ return '<option value="' + esc(s) + '"' + (cs.product_size === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>제조사 브랜드</label>' +
      '<select id="cs-mfg">' +
      ['선택 안 함', '클린조이', '초음파119', '탑소닉', '세이버', '에코', '세척천사', '기타 폐업/단종사'].map(function(m){ return '<option value="' + esc(m) + '"' + (cs.manufacturer === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>사용 연수</label>' +
      '<select id="cs-years">' +
      ['선택 안 함', '1년 미만', '1~3년', '3~5년', '5년 이상 (노후)'].map(function(y){ return '<option value="' + esc(y) + '"' + (cs.years_used === y ? ' selected' : '') + '>' + esc(y) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>고장 문제 부위</label>' +
      '<select id="cs-problem">' +
      ['선택 안 함', '진동자 파손/출력 저하', '발진기 보드 소손', '히터 단선/온수 불가', '수조 누수/크랙', '조작부 전원 불량', '복합 고장'].map(function(p){ return '<option value="' + esc(p) + '"' + (cs.problem_detail === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>고장 지속 기간</label>' +
      '<select id="cs-duration">' +
      ['선택 안 함', '3일 이내', '1~2주일', '1개월 이상', '수개월 방치'].map(function(d){ return '<option value="' + esc(d) + '"' + (cs.duration_of_issue === d ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>1차 진단 및 추천 솔루션</label>' +
      '<select id="cs-solution">' +
      '<option value="REBORN_400K"' + (cs.diagnostic_solution === 'REBORN_400K' ? ' selected' : '') + '>공장 입고 40만 전면 재생 (권장, 화물비 별도)</option>' +
      '<option value="TRADE_IN"' + (cs.diagnostic_solution === 'TRADE_IN' ? ' selected' : '') + '>리본 인증중고 보상판매 맞교환</option>' +
      '<option value="NEW_REPLACE"' + (cs.diagnostic_solution === 'NEW_REPLACE' ? ' selected' : '') + '>신품 교체 연계</option>' +
      '</select></div>' +
      '<div><label>예상 화물비 (고객 별도 부담)</label>' +
      '<input type="number" id="cs-freight" value="' + (cs.freight_quote || 100000) + '" placeholder="예: 100,000"></div>' +
      '<div><label>총 견적 안내 금액 (원)</label>' +
      '<input type="number" id="cs-quote" value="' + (cs.quote_amount || 400000) + '" placeholder="400,000"></div>' +
      '<div style="grid-column:1/-1;"><label>상담 메모</label>' +
      '<textarea id="cs-notes" rows="2" placeholder="고객 통화 내용 기록">' + esc(cs.notes || '') + '</textarea></div>' +
      '</div>' +
      '<div style="margin-top:10px;text-align:right;">' +
      '<button type="button" class="btn primary small" id="btn-save-consult">상담 기록 저장 및 고객 전용 QR 상태창 반영</button>' +
      '</div>' +
      '</section>' +
      '<div class="parts-audit">' +
      '<strong>공임나라형 투명 정산 · 품질검수 체크</strong><br>' +
      '• 부품 조달: 본사 리본 표준 부품 실비 공개 (고객 직접 구입 시 공임만 정산 가능)<br>' +
      '• 물류·검수: 왕복 합포장 화물 실비 산정 · 입고/출고 다각도 사진 검수 (' + (o.media ? o.media.length : 0) + '장 등록)' +
      '</div>';

    var locked = o.status === 'COMPLETED' || o.status === 'CANCELLED';
    if (o.service.type === 'DOCTOR_VISIT') {
      var s = o.settlement;
      var distOpts = state.partners.distributors.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === o.assigned_distributor_id ? ' selected' : '') + '>' + esc(d.name) + '</option>';
      }).join('');
      html +=
        '<section class="calc" aria-labelledby="calc-title">' +
        '<h3 id="calc-title">🧮 40만 원 정액제 배분 계산기</h3>' +
        '<div class="calc-row"><label>고객 결제 총액 (고정)</label><output id="calc-total">' + won(D.FIXED_PRICE) + '</output></div>' +
        '<div class="calc-row"><label for="calc-freight">실제 발생 화물비 (−)</label>' +
          '<input id="calc-freight" inputmode="numeric" autocomplete="off" placeholder="예: 150,000" value="' + (s ? s.freight_cost.toLocaleString('ko-KR') : '') + '"' + (locked ? ' disabled' : '') + '></div>' +
        '<div class="calc-row total"><label>총판/닥터 설치 공임비</label><output id="calc-labor" aria-live="polite">' + (s ? won(s.labor_fee) : '-') + '</output></div>' +
        '<p class="calc-formula" id="calc-formula">400,000 − 화물비 = 설치 공임비</p>' +
        '<p class="calc-error" id="calc-error" role="alert"></p>' +
        '<div class="calc-row"><label for="calc-dist">배정 총판 (정산 대상)</label><select id="calc-dist"' + (locked ? ' disabled' : '') + '>' + distOpts +
          (o.assigned_distributor_id === D.HQ_ID ? '<option value="" selected disabled>— 총판 선택 —</option>' : '') + '</select></div>' +
        '</section>' +
        '<div class="drawer-actions">' +
        (locked ? '' : '<button class="btn primary" id="btn-confirm" type="button"' + (s ? '' : ' disabled') + '>' + (s ? '공임비 수정 확정' : '공임비 확정 → 총판 배차') + '</button>') +
        (o.status === 'CONFIRMED' ? '<button class="btn" id="btn-complete" type="button">설치 완료 처리</button>' : '') +
        (locked ? '' : '<button class="btn danger" id="btn-cancel" type="button">주문 취소</button>') +
        '</div>';
    } else {
      html += '<div class="notice"><b>직접 수령 (화물비 착불)</b><br>본인 설치·폐기 건으로 설치 공임비가 발생하지 않으며 총판 정산 대상이 아닙니다.</div>' +
        '<div class="drawer-actions">' +
        (locked || o.status === 'SHIPPED' ? '' : '<button class="btn primary" id="btn-ship" type="button">발송 완료 처리</button>') +
        (locked ? '' : '<button class="btn danger" id="btn-cancel" type="button">주문 취소</button>') +
        '</div>';
    }
    html += '<ul class="history">' + (o.history || []).map(function (h) {
      return '<li>' + fmtDate(h.at) + ' · ' + esc(D.ORDER_STATUS[h.status] || h.status) + ' · ' + esc(h.by) + (h.labor_fee !== undefined ? ' · 공임 ' + won(h.labor_fee) : '') + '</li>';
    }).join('') + '</ul>';

    $('#od-body').innerHTML = html;
    $('#od-title').textContent = '주문 상세 · ' + o.order_id;
    bindDrawer(o);
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    var f = $('#calc-freight');
    if (f && !f.disabled) f.focus();
  }

  function bindDrawer(o) {
    var freight = $('#calc-freight');
    var lastCalc = null;
    if (freight) {
      var recalc = function () {
        var err = $('#calc-error'), out = $('#calc-labor'), btn = $('#btn-confirm'), formula = $('#calc-formula');
        var raw = freight.value;
        // 입력 중 천 단위 콤마 자동 포맷
        var digits = raw.replace(/[^\d]/g, '');
        if (digits !== '') freight.value = Number(digits).toLocaleString('ko-KR');
        try {
          lastCalc = D.calcLaborFee(digits === '' ? '' : Number(digits));
          out.textContent = won(lastCalc.labor_fee);
          formula.textContent = D.FIXED_PRICE.toLocaleString('ko-KR') + ' − ' + lastCalc.freight_cost.toLocaleString('ko-KR') + ' = ' + lastCalc.labor_fee.toLocaleString('ko-KR') + '원';
          err.textContent = '';
          if (btn) btn.disabled = false;
        } catch (e) {
          lastCalc = null;
          out.textContent = '-';
          formula.textContent = '400,000 − 화물비 = 설치 공임비';
          err.textContent = digits === '' ? '' : e.message;
          if (btn) btn.disabled = true;
        }
      };
      freight.addEventListener('input', recalc);
      if (freight.value) recalc();
    }
    var bsc = $('#btn-save-consult');
    if (bsc) {
      bsc.addEventListener('click', function () {
        var data = {
          product_size: $('#cs-size').value,
          manufacturer: $('#cs-mfg').value,
          years_used: $('#cs-years').value,
          problem_detail: $('#cs-problem').value,
          duration_of_issue: $('#cs-duration').value,
          diagnostic_solution: $('#cs-solution').value,
          freight_quote: Number($('#cs-freight').value) || 0,
          quote_amount: Number($('#cs-quote').value) || 400000,
          notes: $('#cs-notes').value
        };
        api.saveConsultation(o.order_id, data).then(function () {
          toast('상담 기록이 저장되었습니다. (고객 전용 QR 페이지 자동 연동)');
          refresh().then(function () { openOrder(o.order_id); });
        }).catch(function (e) { toast(e.message, true); });
      });
    }

    var bc = $('#btn-confirm');
    if (bc) bc.addEventListener('click', function () {
      if (!lastCalc) return;
      var dist = $('#calc-dist').value;
      if (!dist) { $('#calc-error').textContent = '배정 총판을 선택해 주세요.'; return; }
      api.confirmSettlement(o.order_id, lastCalc.freight_cost, dist).then(function (saved) {
        console.log('[Dr.119] 공임비 확정 JSON ↓');
        console.log(JSON.stringify({ order_id: saved.order_id, assigned_distributor_id: saved.assigned_distributor_id, settlement: saved.settlement }, null, 2));
        toast('공임비 ' + won(saved.settlement.labor_fee) + ' 확정 · ' + distName(saved.assigned_distributor_id) + ' 배차');
        refresh().then(function () { openOrder(o.order_id); });
      }).catch(function (e) { $('#calc-error').textContent = e.message; });
    });
    bindStatus('#btn-complete', o, 'COMPLETED', '설치 완료 처리했습니다.');
    bindStatus('#btn-ship', o, 'SHIPPED', '발송 완료 처리했습니다.');
    bindStatus('#btn-cancel', o, 'CANCELLED', '주문을 취소했습니다.', '이 주문을 취소할까요?');
  }

  function bindStatus(sel, o, status, msg, confirmMsg) {
    var b = $(sel);
    if (!b) return;
    b.addEventListener('click', function () {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      api.updateOrderStatus(o.order_id, status, 'HQ_ADMIN').then(function () {
        toast(msg);
        refresh().then(function () { openOrder(o.order_id); });
      }).catch(function (e) { toast(e.message, true); });
    });
  }

  /* ============================================================
   * 2. 월간 총판 정산
   * ============================================================ */
  var monthInput = $('#bill-month');
  monthInput.value = D.currentMonthKey();
  monthInput.addEventListener('change', renderBilling);

  function renderBilling() {
    var month = monthInput.value || D.currentMonthKey();
    var rows = D.computeBilling({
      orders: state.orders, partners: state.partners, contracts: state.contracts,
      margins: state.margins, penalties: state.penalties, month: month
    });
    state.billingRows = rows;
    var sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };

    $('#bill-kpis').innerHTML =
      kpi('고객 결제 총액', won(sum('gross_sales')), sum('order_count') + '건 × 40만 원') +
      kpi('본사 화물비 지출', won(sum('freight_total'))) +
      kpi('부가 수수료 합계', won(sum('commission_total'))) +
      kpi('총판 지급 예정금 합계', won(sum('payout')), month, true);

    $('#billing-table tbody').innerHTML = rows.map(function (r) {
      return '<tr data-dist="' + esc(r.distributor_id) + '">' +
        '<td><b>' + esc(r.distributor_name) + '</b><br><span class="mono hint">' + esc(r.distributor_id) + '</span></td>' +
        '<td class="num">' + r.order_count + '</td>' +
        '<td class="num">' + won(r.gross_sales) + '</td>' +
        '<td class="num">' + won(r.freight_total) + '</td>' +
        '<td class="num">' + won(r.labor_total) + '</td>' +
        '<td class="num">' + won(r.commission_total) + '</td>' +
        '<td class="num"><input class="money pen-amount" inputmode="numeric" value="' + (r.penalty ? r.penalty.toLocaleString('ko-KR') : '') + '" placeholder="0" aria-label="' + esc(r.distributor_name) + ' 차감액"></td>' +
        '<td><input class="pen-memo" value="' + esc(r.penalty_memo) + '" placeholder="사유" aria-label="' + esc(r.distributor_name) + ' 차감 사유"></td>' +
        '<td class="num strong ' + (r.payout < 0 ? 'neg' : '') + '">' + won(r.payout) + '</td>' +
        '</tr>';
    }).join('');
    $('#billing-table tfoot').innerHTML = '<tr><td>합계</td><td class="num">' + sum('order_count') + '</td><td class="num">' + won(sum('gross_sales')) +
      '</td><td class="num">' + won(sum('freight_total')) + '</td><td class="num">' + won(sum('labor_total')) + '</td><td class="num">' + won(sum('commission_total')) +
      '</td><td class="num neg">' + (sum('penalty') ? '−' + won(sum('penalty')) : '0원') + '</td><td></td><td class="num">' + won(sum('payout')) + '</td></tr>';
  }

  function kpi(label, value, sub, accent) {
    return '<div class="kpi' + (accent ? ' accent' : '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  // 차감액 입력 → 저장 (change 시점)
  $('#billing-table tbody').addEventListener('input', function (e) {
    if (e.target.classList.contains('pen-amount')) {
      var d = e.target.value.replace(/[^\d]/g, '');
      e.target.value = d ? Number(d).toLocaleString('ko-KR') : '';
    }
  });
  $('#billing-table tbody').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-dist]');
    if (!tr) return;
    var amount = Number(($('.pen-amount', tr).value || '0').replace(/[^\d]/g, ''));
    var memo = $('.pen-memo', tr).value.trim();
    api.setPenalty(monthInput.value, tr.getAttribute('data-dist'), amount, memo).then(function () {
      return refresh();
    }).then(function () { toast('차감액 반영 완료'); })
      .catch(function (err) { toast(err.message, true); });
  });

  $('#btn-csv').addEventListener('click', function () {
    var month = monthInput.value;
    var csv = D.billingToCSV(state.billingRows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dr119_settlement_' + month + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    window.__DR119_LAST_CSV__ = csv;
    toast('CSV 다운로드: ' + a.download);
  });

  /* ============================================================
   * 3. 마진 세팅 + 부가 계약
   * ============================================================ */
  function renderMargins() {
    $('#margin-table tbody').innerHTML = state.margins.map(function (m, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input class="m-id mono" value="' + esc(m.id) + '" size="14" aria-label="아이템 ID"></td>' +
        '<td><input class="m-name" value="' + esc(m.name) + '" aria-label="아이템명"></td>' +
        '<td class="num"><input class="pct m-pct" type="number" min="0" max="100" step="0.1" value="' + esc(m.share_pct) + '" aria-label="마진율"></td>' +
        '<td><button type="button" class="btn small danger m-del">삭제</button></td></tr>';
    }).join('');
    $('#c-item').innerHTML = state.margins.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.share_pct) + '%)</option>';
    }).join('');
  }

  function readMarginRows() {
    return Array.prototype.map.call(document.querySelectorAll('#margin-table tbody tr'), function (tr) {
      return {
        id: $('.m-id', tr).value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        name: $('.m-name', tr).value.trim(),
        share_pct: Number($('.m-pct', tr).value)
      };
    });
  }

  $('#btn-add-item').addEventListener('click', function () {
    state.margins = readMarginRows().concat([{ id: '', name: '', share_pct: 0 }]);
    renderMargins();
    var rows = document.querySelectorAll('#margin-table tbody tr');
    $('.m-id', rows[rows.length - 1]).focus();
  });
  $('#margin-table tbody').addEventListener('click', function (e) {
    if (!e.target.classList.contains('m-del')) return;
    var i = Number(e.target.closest('tr').getAttribute('data-i'));
    var rows = readMarginRows();
    var used = state.contracts.some(function (c) { return c.item_id === rows[i].id && c.status !== 'CANCELLED'; });
    if (used && !window.confirm('활성 계약이 있는 아이템입니다. 삭제하면 해당 계약 수수료가 0원 처리됩니다. 계속할까요?')) return;
    rows.splice(i, 1);
    state.margins = rows;
    renderMargins();
  });
  $('#margin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var rows = readMarginRows();
    var ids = rows.map(function (r) { return r.id; });
    var msg = $('#margin-msg');
    if (new Set(ids).size !== ids.length) { msg.className = 'form-msg err'; msg.textContent = '아이템 ID가 중복되었습니다.'; return; }
    api.saveMargins(rows).then(function () {
      msg.className = 'form-msg ok'; msg.textContent = '저장되었습니다. 정산·파트너 수수료에 즉시 반영됩니다.';
      return refresh();
    }).catch(function (err) { msg.className = 'form-msg err'; msg.textContent = err.message; });
  });

  /** 연락처 → 해당 식당의 최초 유입 agent_id (가장 오래된 접수 기준, First-touch) */
  function customerAgent(phone) {
    var mine = state.orders.filter(function (o) { return o.customer.phone === phone; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
    for (var i = 0; i < mine.length; i++) {
      if (mine[i].attribution && mine[i].attribution.agent_id) return mine[i].attribution.agent_id;
    }
    return mine.length ? '' : null;
  }

  function renderContracts() {
    var phones = Array.from(new Set(state.orders.map(function (o) { return o.customer.phone; })));
    $('#customer-list').innerHTML = phones.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    var lines = {};
    D.computeCommissionLines(state.contracts, state.margins, state.partners, D.currentMonthKey())
      .forEach(function (l) { lines[l.contract_id] = l; });
    var mById = {};
    state.margins.forEach(function (m) { mById[m.id] = m; });
    $('#contract-table tbody').innerHTML = state.contracts.length ? state.contracts.map(function (c) {
      var m = mById[c.item_id];
      var pct = m ? Number(m.share_pct) : 0;
      return '<tr><td class="mono">' + esc(c.contract_id) + '</td><td>' + esc(c.customer_phone) + '</td>' +
        '<td>' + agentLabel(c.agent_id) + ' → ' + esc(distName(D.distributorOfAgent(state.partners, c.agent_id))) + '</td>' +
        '<td>' + esc(m ? m.name : c.item_id + ' (삭제됨)') + '</td>' +
        '<td class="num">' + won(c.monthly_amount) + '</td><td class="num">' + pct + '%</td>' +
        '<td class="num">' + won(Math.floor(c.monthly_amount * pct / 100)) + '</td>' +
        '<td>' + esc(c.start_month) + '</td>' +
        '<td><span class="chip ' + esc(c.status) + '">' + (c.status === 'ACTIVE' ? (lines[c.contract_id] ? '활성' : '대기') : '해지') + '</span></td>' +
        '<td>' + (c.status === 'ACTIVE' ? '<button class="btn small danger c-cancel" data-id="' + esc(c.contract_id) + '">해지</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="empty">등록된 부가 계약이 없습니다.</td></tr>';
  }

  $('#c-start').value = D.currentMonthKey();
  $('#c-phone').addEventListener('input', function () {
    var p = D.normalizePhone(this.value);
    var ag = p ? customerAgent(p) : null;
    $('#c-agent').value = ag === null ? '' : (ag || '(직접 유입 · 본사 직영)');
  });
  $('#contract-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#contract-msg');
    var phone = D.normalizePhone($('#c-phone').value);
    if (!phone) { msg.className = 'form-msg err'; msg.textContent = '연락처를 정확히 입력하세요.'; return; }
    var agent = customerAgent(phone);
    if (agent === null) { msg.className = 'form-msg err'; msg.textContent = '접수 이력이 없는 식당입니다. (QR 귀속 불가)'; return; }
    var amount = Number($('#c-amount').value);
    if (!Number.isInteger(amount) || amount <= 0) { msg.className = 'form-msg err'; msg.textContent = '월 금액을 정수로 입력하세요.'; return; }
    api.addContract({ customer_phone: phone, agent_id: agent || null, item_id: $('#c-item').value, monthly_amount: amount, start_month: $('#c-start').value })
      .then(function (c) {
        console.log('[Dr.119] 부가 계약 등록 JSON ↓\n' + JSON.stringify(c, null, 2));
        msg.className = 'form-msg ok'; msg.textContent = '등록 완료: ' + c.contract_id;
        e.target.reset(); $('#c-start').value = D.currentMonthKey(); $('#c-agent').value = '';
        return refresh();
      });
  });
  $('#contract-table tbody').addEventListener('click', function (e) {
    var b = e.target.closest('.c-cancel');
    if (!b || !window.confirm('이 계약을 해지할까요?')) return;
    api.cancelContract(b.getAttribute('data-id')).then(refresh).then(function () { toast('계약 해지 완료'); });
  });

  function renderPartners() {
    var origin = 'https://dr119.org/';
    $('#partner-table tbody').innerHTML = state.partners.agents.map(function (a) {
      return '<tr><td class="mono">' + esc(a.agent_id) + '</td><td>' + esc(a.name) + '</td><td>' + (a.role === 'DOCTOR' ? '닥터' : '총판') + '</td>' +
        '<td>' + esc(distName(a.distributor_id)) + '</td><td><span class="qr-link">' + esc(origin + '?agent_id=' + a.agent_id) + '</span></td></tr>';
    }).join('');
  }

  function renderNetwork() {
    var ct = $('#network-centers-table tbody');
    if (ct) {
      var origin = 'https://dr119.org/';
      ct.innerHTML = state.partners.agents.map(function (a) {
        return '<tr>' +
          '<td class="mono">' + esc(a.agent_id) + '</td>' +
          '<td>' + (a.role === 'DOCTOR' ? '<span class="chip CONFIRMED">수리 닥터</span>' : '<span class="chip ACTIVE">지역 수리 센터</span>') + '</td>' +
          '<td>' + esc(a.name) + '</td>' +
          '<td>' + esc(distName(a.distributor_id)) + '</td>' +
          '<td><span class="pos">본사 기술·품질 교육 수료</span></td>' +
          '<td><span class="qr-link">' + esc(origin + '?agent_id=' + a.agent_id) + '</span></td>' +
          '</tr>';
      }).join('');
    }
    var lt = $('#leads-table tbody');
    if (lt) {
      var leads = [];
      try { leads = JSON.parse(localStorage.getItem('dr119_partner_leads') || '[]'); } catch (e) {}
      lt.innerHTML = leads.length ? leads.map(function (l) {
        var done = l.training_status === '교육·인증 완료';
        return '<tr>' +
          '<td>' + fmtDate(l.created_at) + '</td>' +
          '<td>' + esc(l.role_label || l.role) + '</td>' +
          '<td>' + esc(l.name) + '</td>' +
          '<td>' + esc(l.region) + '</td>' +
          '<td>' + esc(l.phone) + '</td>' +
          '<td><span class="chip ' + (done ? 'COMPLETED' : 'RECEIVED') + '">' + esc(l.training_status || '교육·심사 대기') + '</span></td>' +
          '<td>' + (done ? '' : '<button type="button" class="btn small approve-lead" data-id="' + esc(l.id) + '">교육·인증 완료</button>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="7" class="empty">접수된 신규 파트너 신청이 없습니다.</td></tr>';
    }
  }

  var leadsTable = $('#leads-table tbody');
  if (leadsTable) {
    leadsTable.addEventListener('click', function (e) {
      var btn = e.target.closest('.approve-lead');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      try {
        var leads = JSON.parse(localStorage.getItem('dr119_partner_leads') || '[]');
        leads.forEach(function (l) { if (l.id === id) l.training_status = '교육·인증 완료'; });
        localStorage.setItem('dr119_partner_leads', JSON.stringify(leads));
        renderNetwork();
        toast('본사 교육·품질 인증 완료로 처리되었습니다.');
      } catch (err) {}
    });
  }

  /* ============================================================
   * 5. 제휴사 상품 등록 및 1년 수익 배분
   * ============================================================ */
  function renderProducts() {
    var tb = $('#admin-products-table tbody');
    if (!tb) return;
    var list = state.products || [];
    tb.innerHTML = list.length ? list.map(function (p) {
      return '<tr>' +
        '<td class="mono">' + esc(p.id) + '</td>' +
        '<td><b>' + esc(p.vendor_name) + '</b></td>' +
        '<td>' + esc(p.name) + (p.specs ? '<br><span class="hint">' + esc(p.specs) + '</span>' : '') + '</td>' +
        '<td class="num"><b>' + won(p.price) + '</b></td>' +
        '<td class="num">' + won(p.supply_price) + '</td>' +
        '<td class="num"><span class="chip" style="background:#fee500;color:#191919;font-weight:700;">' + p.partner_share_pct + '% (' + won(Math.round(p.price * p.partner_share_pct / 100)) + ')</span></td>' +
        '<td><span class="chip COMPLETED">' + esc(p.status) + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" class="empty">등록된 제휴 상품이 없습니다.</td></tr>';
  }

  function renderAffiliateSales() {
    var tb = $('#admin-affiliate-table tbody');
    if (!tb) return;
    var list = state.affiliateSales || [];
    tb.innerHTML = list.length ? list.map(function (s) {
      return '<tr>' +
        '<td>' + fmtDate(s.created_at) + '</td>' +
        '<td><span class="mono">' + esc(s.agent_id) + '</span></td>' +
        '<td>' + esc(s.customer_phone) + '</td>' +
        '<td><b>' + esc(s.product_name) + '</b></td>' +
        '<td class="num">' + won(s.sale_amount) + '</td>' +
        '<td class="num">' + s.commission_rate + '%</td>' +
        '<td class="num" style="color:#a50034;font-weight:700;">+' + won(s.commission_amount) + '</td>' +
        '<td class="hint">' + fmtDate(s.valid_until) + '</td>' +
        '<td><span class="chip COMPLETED">' + esc(s.status) + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="9" class="empty">1년 수익 배분 실적이 없습니다.</td></tr>';
  }

  var prodForm = $('#product-reg-form');
  if (prodForm) {
    prodForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var prod = {
        vendor_name: $('#prod-vendor').value,
        category: $('#prod-category').value,
        name: $('#prod-name').value,
        price: Number($('#prod-price').value),
        supply_price: Number($('#prod-supply').value),
        partner_share_pct: Number($('#prod-share').value),
        specs: $('#prod-specs').value,
        description: $('#prod-desc').value
      };
      api.saveProduct(prod).then(function (saved) {
        toast('제휴 상품이 등록되었습니다. (QR 영업자 1년 배분율 ' + saved.partner_share_pct + '%)');
        prodForm.reset();
        refresh();
      }).catch(function (err) { toast(err.message, true); });
    });
  }

  /* ------------------------------------------------------------ 인증 & 부트 */
  var unlocked = false;
  var pollTimer = null;
  var authGate = $('#admin-auth-gate');
  var adminNav = $('#admin-nav');
  var adminMain = $('#admin-main');
  var lockBtn = $('#btn-admin-lock');
  var authForm = $('#admin-auth-form');
  var pwInput = $('#admin-pw');
  var pwToggleBtn = $('#btn-toggle-pw');
  var authErr = $('#admin-auth-error');

  function setAuthView(ok) {
    unlocked = !!ok;
    if (authGate) authGate.hidden = unlocked;
    if (adminNav) adminNav.hidden = !unlocked;
    if (adminMain) adminMain.hidden = !unlocked;
    if (lockBtn) lockBtn.hidden = !unlocked;
  }

  function refresh() {
    if (!unlocked) return Promise.resolve();
    return loadAll().then(renderAll);
  }

  function safeRefresh() {
    if (!unlocked) return;
    if (dlg.open || dlg.hasAttribute('open')) return;
    var active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    refresh();
  }

  function unlockAndBoot() {
    setAuthView(true);
    if (!pollTimer) pollTimer = setInterval(safeRefresh, 15000);
    return refresh().then(function () {
      var h = location.hash.replace('#', '');
      var t = tabs.find(function (x) { return x.getAttribute('aria-controls') === 'tab-' + h; });
      if (t) selectTab(t);
    });
  }

  function lockAdmin() {
    try { sessionStorage.removeItem(D.ADMIN_SESSION_KEY); } catch (e) {}
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (dlg && (dlg.open || dlg.hasAttribute('open'))) dlg.close();
    state.orders = [];
    state.contracts = [];
    ['#orders-table tbody', '#billing-table tbody', '#billing-table tfoot', '#contract-table tbody', '#leads-table tbody'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.innerHTML = '';
    });
    setAuthView(false);
    if (pwInput) { pwInput.value = ''; pwInput.type = 'password'; pwInput.focus(); }
    if (pwToggleBtn) { pwToggleBtn.textContent = '표시'; pwToggleBtn.setAttribute('aria-pressed', 'false'); }
    if (authErr) authErr.textContent = '';
  }

  if (pwInput) {
    pwInput.addEventListener('input', function () {
      if (authErr) authErr.textContent = '';
    });
  }
  if (pwToggleBtn && pwInput) {
    pwToggleBtn.addEventListener('click', function () {
      var show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      pwToggleBtn.textContent = show ? '숨김' : '표시';
      pwToggleBtn.setAttribute('aria-pressed', String(show));
    });
  }
  if (authForm && pwInput) {
    authForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var val = pwInput.value || '';
      if (D.verifyAdminPassword(val)) {
        try { sessionStorage.setItem(D.ADMIN_SESSION_KEY, D.ADMIN_AUTH_HASH); } catch (err) {}
        pwInput.value = '';
        if (authErr) authErr.textContent = '';
        unlockAndBoot();
      } else {
        if (authErr) authErr.textContent = '비밀번호가 일치하지 않습니다. 다시 확인해 주세요.';
        pwInput.focus();
        pwInput.select();
      }
    });
  }
  if (lockBtn) {
    lockBtn.addEventListener('click', function () {
      lockAdmin();
      toast('본사 관리자 모드가 잠금 처리되었습니다.');
    });
  }

  // 다른 탭(고객 접수/파트너) 또는 다른 기기에서 데이터 변경 시 실시간 반영
  window.addEventListener('storage', function (e) {
    if (unlocked && e.key && e.key.indexOf('dr119_') === 0) refresh();
  });
  document.addEventListener('visibilitychange', function () {
    if (unlocked && !document.hidden) safeRefresh();
  });

  var savedAuth = null;
  try { savedAuth = sessionStorage.getItem(D.ADMIN_SESSION_KEY); } catch (e) {}
  if (D.verifyAdminToken(savedAuth)) {
    unlockAndBoot();
  } else {
    setAuthView(false);
  }

  /* ============================================================
   * 4-2. 역경매 · 인테리어 · 파트너 100점 평가 관제
   * ============================================================ */
  function renderAuctionsAdmin() {
    var kpiBox = $('#auctions-kpis');
    var dealersTbody = $('#admin-dealers-table tbody');
    var auctionsTbody = $('#admin-auctions-table tbody');
    var evDealerSel = $('#ev-dealer');
    if (!kpiBox || !dealersTbody || !auctionsTbody) return;

    var dealers = state.auctionDealers || [];
    var auctions = state.auctions || [];
    var pendingDealers = dealers.filter(function (d) { return d.status === 'PENDING'; }).length;
    var approvedDealers = dealers.filter(function (d) { return d.status === 'APPROVED' || d.status === 'ACTIVE'; }).length;
    var openAuctions = auctions.filter(function (a) { return a.status === 'OPEN' || a.status === 'SURVEYING'; }).length;
    var acceptedAuctions = auctions.filter(function (a) { return a.status === 'ACCEPTED' || a.status === 'COMPLETED'; });
    var estComm = acceptedAuctions.reduce(function (s, a) { return s + Math.round((Number(a.lowest_bid) || 0) * 0.03); }, 0);

    var badge = $('#badge-pending-dealers');
    if (badge) {
      badge.textContent = String(pendingDealers);
      if (pendingDealers) badge.removeAttribute('data-zero'); else badge.setAttribute('data-zero', '');
    }

    kpiBox.innerHTML =
      '<div class="kpi accent"><div class="label">승인 대기 공급사</div><div class="value">' + pendingDealers + '곳</div><div class="sub">활성 공급사 ' + approvedDealers + '곳</div></div>' +
      '<div class="kpi"><div class="label">진행중 역경매·인테리어</div><div class="value">' + openAuctions + '건</div><div class="sub">누적 ' + auctions.length + '건</div></div>' +
      '<div class="kpi"><div class="label">낙찰 완료</div><div class="value">' + acceptedAuctions.length + '건</div><div class="sub">실측·계약 진행 포함</div></div>' +
      '<div class="kpi"><div class="label">예상 3% 중개 수수료</div><div class="value">' + won(estComm) + '</div><div class="sub">낙찰가 3% 기준</div></div>';

    if (evDealerSel) {
      var prev = evDealerSel.value;
      evDealerSel.innerHTML = dealers.map(function (d) {
        return '<option value="' + esc(d.dealer_id) + '">' + esc(d.company_name) + ' (' + esc(d.grade || 'A') + '등급 · ' + (d.eval_total_score || 0) + '점)</option>';
      }).join('');
      if (prev) evDealerSel.value = prev;
    }

    var gradeColor = { S: '#0f766e', A: '#1d4ed8', B: '#b45309', C: '#b91c1c' };
    dealersTbody.innerHTML = dealers.slice(0, 30).map(function (d) {
      var cats = Array.isArray(d.allowed_categories) ? d.allowed_categories.join(', ') : '-';
      var g = d.grade || 'A';
      var stLabel = d.status === 'PENDING' ? '승인대기' : (d.status === 'APPROVED' || d.status === 'ACTIVE' ? '승인완료' : (d.status === 'SUSPENDED' ? '자동정지' : d.status));
      return '<tr>' +
        '<td><strong>' + esc(d.company_name) + '</strong><br><span class="hint">' + esc(d.dealer_type) + ' · ' + esc(d.region || '전국') + '</span></td>' +
        '<td>' + esc(d.biz_no) + '<br><span class="hint">' + esc(d.phone) + '</span></td>' +
        '<td><span class="chip">' + esc(cats) + '</span></td>' +
        '<td>' + (d.education_status === 'COMPLETED' ? '<span class="chip COMPLETED">교육이수</span>' : '<span class="chip">미이수</span>') +
          (d.assoc_certified ? ' <span class="chip" style="background:#0f766e;color:#fff;">협회인증</span>' : '') + '</td>' +
        '<td><strong style="color:' + (gradeColor[g] || '#111') + ';">' + esc(g) + '등급</strong> (' + (d.eval_total_score || 0) + '점)' +
          (d.penalty_strikes ? '<br><span class="neg">적발 ' + d.penalty_strikes + '회</span>' : '') + '</td>' +
        '<td><span class="chip ' + esc(d.status) + '">' + esc(stLabel) + '</span></td>' +
        '<td style="white-space:nowrap;">' +
          '<button type="button" class="btn small primary" data-dlr-act="approve" data-id="' + esc(d.dealer_id) + '">승인</button> ' +
          '<button type="button" class="btn small" data-dlr-act="assoc" data-id="' + esc(d.dealer_id) + '">협회인증</button> ' +
          '<button type="button" class="btn small" data-dlr-act="suspend" data-id="' + esc(d.dealer_id) + '">정지</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    auctionsTbody.innerHTML = auctions.slice(0, 30).map(function (a) {
      var intMeta = a.area_pyeong ? (' · ' + a.area_pyeong + '평 ' + esc(a.work_scope || '')) : '';
      var pkgTag = a.project_group_id ? ' <span class="chip" style="background:#0f766e;color:#fff;">패키지</span>' : '';
      return '<tr>' +
        '<td class="mono">' + esc(a.auction_id) + '<br><span class="chip">' + esc(a.category) + '</span>' + pkgTag + '</td>' +
        '<td><strong>' + esc(a.title) + '</strong><br><span class="hint">' + esc(a.region) + intMeta + '</span></td>' +
        '<td>' + esc(a.customer_name || '사장님*') + '<br><span class="hint">' + esc(a.customer_phone_mask || D.maskPhoneNumber(a.customer_phone)) + '</span></td>' +
        '<td class="num">' + (a.bid_count || 0) + '건<br><strong>' + (a.lowest_bid ? won(a.lowest_bid) : '대기') + '</strong></td>' +
        '<td>' + fmtDate(a.deadline) + '</td>' +
        '<td><span class="chip ' + esc(a.status) + '">' + esc(a.status) + '</span></td>' +
        '<td style="white-space:nowrap;">' +
          '<button type="button" class="btn small" data-auc-act="extend" data-id="' + esc(a.auction_id) + '">+48h 연장</button> ' +
          '<button type="button" class="btn small" data-auc-act="copy" data-id="' + esc(a.auction_id) + '">안내복사</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  var dealersTableEl = $('#admin-dealers-table tbody');
  if (dealersTableEl) {
    dealersTableEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-dlr-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-dlr-act');
      var d = (state.auctionDealers || []).find(function (x) { return x.dealer_id === id; });
      if (!d) return;
      var patch = {};
      if (act === 'approve') patch = { status: 'APPROVED', education_status: 'COMPLETED' };
      else if (act === 'suspend') patch = { status: 'SUSPENDED' };
      else if (act === 'assoc') patch = { assoc_certified: !d.assoc_certified, education_status: 'COMPLETED' };
      api.updateDealerApproval(id, patch).then(function () {
        toast(d.company_name + ' 상태가 업데이트되었습니다.');
        return refresh();
      }).catch(function (err) { toast(err.message, true); });
    });
  }

  var auctionsTableEl = $('#admin-auctions-table tbody');
  if (auctionsTableEl) {
    auctionsTableEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-auc-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-auc-act');
      if (act === 'extend') {
        api.extendAuctionDeadline(id, 48).then(function () {
          toast('입찰 마감 기한을 48시간 연장했습니다.');
          return refresh();
        }).catch(function (err) { toast(err.message, true); });
      } else if (act === 'copy') {
        var a = (state.auctions || []).find(function (x) { return x.auction_id === id; });
        var msg = '[Dr.119 역경매 알림] ' + (a ? a.title : id) + ' (' + (a ? a.region : '') + ') 현재 ' + (a ? a.bid_count : 0) + '건 입찰 접수 / 최저가 ' + (a && a.lowest_bid ? won(a.lowest_bid) : '견적 대기') + ' — https://dr119.org/auction.html';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(msg).then(function () { toast('카톡/문자 안내 문구가 복사되었습니다.'); });
        } else {
          toast('안내 문구 준비 완료: ' + id);
        }
      }
    });
  }

  var evalFormEl = $('#partner-eval-form');
  if (evalFormEl) {
    evalFormEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = {
        dealer_id: $('#ev-dealer').value,
        evaluator_type: $('#ev-type').value,
        quality_score: Number($('#ev-quality').value),
        schedule_score: Number($('#ev-schedule').value),
        pricing_score: Number($('#ev-pricing').value),
        service_score: Number($('#ev-service').value),
        dumping_violation: $('#ev-dumping').checked,
        memo: $('#ev-memo').value
      };
      api.evaluatePartner(payload).then(function (res) {
        toast('평가 반영 완료: ' + res.dealer.company_name + ' → ' + res.gradeInfo.label + ' (' + res.dealer.eval_total_score + '점)');
        evalFormEl.reset();
        return refresh();
      }).catch(function (err) { toast(err.message, true); });
    });
  }

  // 테스트/디버그용 노출
  window.__DR119_ADMIN__ = { state: state, refresh: refresh, openOrder: openOrder, lock: lockAdmin };
})();
