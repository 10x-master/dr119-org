/* Dr.119 — Phase 3: 지역 총판·닥터 파트너 대시보드 */
(function () {
  'use strict';
  var D = window.Dr119;
  var api = D.api;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = D.escapeHTML;
  var won = D.formatKRW;
  var SESSION_KEY = 'dr119_partner_session';

  var state = { orders: [], partners: D.SEED_PARTNERS, margins: [], contracts: [], penalties: {}, me: null };

  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast'; }, 2400);
  }
  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
  }
  function thumb(m) {
    if (m && m.thumb_url) return '<img class="thumb" src="' + esc(m.thumb_url) + '" alt="' + esc(m.name) + '">';
    return '<span class="thumb">' + (m && /^video\//.test(m.type) ? '🎬' : '📄') + '</span>';
  }

  /* ------------------------------------------------------------
   * 데모 로그인 (실서비스: 인증 토큰의 distributor_id 사용)
   * 우선순위: ?partner_id= → 세션 → 첫 번째 총판
   * ------------------------------------------------------------ */
  function resolveMe() {
    var ids = state.partners.distributors.map(function (d) { return d.id; });
    var q = new URLSearchParams(location.search).get('partner_id');
    var s = sessionStorage.getItem(SESSION_KEY);
    var pick = [q, s, ids[0]].find(function (x) { return x && ids.indexOf(x) !== -1; });
    sessionStorage.setItem(SESSION_KEY, pick);
    return pick;
  }

  $('#partner-select').addEventListener('change', function () {
    state.me = this.value;
    sessionStorage.setItem(SESSION_KEY, state.me);
    $('#agent-filter').value = '';
    render();
  });
  $('#inbox-filter').addEventListener('change', renderInbox);
  $('#agent-filter').addEventListener('change', renderAccounts);

  function load() {
    return Promise.all([api.listOrders(), api.getPartners(), api.getMargins(), api.getContracts(), api.getPenalties()])
      .then(function (r) {
        state.orders = r[0]; state.partners = r[1]; state.margins = r[2]; state.contracts = r[3]; state.penalties = r[4];
        if (!state.me) state.me = resolveMe();
      });
  }

  function myDist() { return state.partners.distributors.find(function (d) { return d.id === state.me; }); }
  function myAgents() { return D.agentsOfDistributor(state.partners, state.me); }

  /** 이번 달 내 정산 행 (본사 정산과 동일한 공식 → 금액 불일치 원천 차단) */
  function myBilling(month) {
    var rows = D.computeBilling({
      orders: state.orders, partners: state.partners, contracts: state.contracts,
      margins: state.margins, penalties: state.penalties, month: month
    });
    return rows.find(function (r) { return r.distributor_id === state.me; });
  }

  function render() {
    var d = myDist();
    $('#partner-select').innerHTML = state.partners.distributors.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === state.me ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    $('#partner-title').textContent = (d ? d.name : '') + ' 대시보드';
    var agents = myAgents();
    var cur = $('#agent-filter').value;
    $('#agent-filter').innerHTML = '<option value="">전체 QR</option>' + agents.map(function (a) {
      return '<option value="' + esc(a.agent_id) + '"' + (a.agent_id === cur ? ' selected' : '') + '>' + esc(a.agent_id + ' · ' + a.name) + '</option>';
    }).join('');
    renderKPIs(); renderInbox(); renderAccounts(); renderPassive(); renderQR();
  }

  /* ---------- 패시브 인컴 모니터링 KPI ---------- */
  function renderKPIs() {
    var month = D.currentMonthKey();
    $('#month-label').textContent = month.replace('-', '년 ') + '월';
    var b = myBilling(month);
    var pending = state.orders.filter(function (o) {
      return o.assigned_distributor_id === state.me && o.status === 'CONFIRMED' && o.service.type === 'DOCTOR_VISIT';
    }).length;
    var card = function (label, value, sub, accent, id) {
      return '<div class="kpi' + (accent ? ' accent' : '') + '"' + (id ? ' id="' + id + '"' : '') + '><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
    };
    $('#kpis').innerHTML =
      card('이번 달 확정 수수료', won(b.payout), '공임 + 부가수수료 − 차감', true, 'kpi-payout') +
      card('설치 공임비', won(b.labor_total), b.order_count + '건 확정', false, 'kpi-labor') +
      card('부가 마진 (패시브 인컴)', won(b.commission_total), b.commission_lines.length + '개 활성 계약', false, 'kpi-commission') +
      card('본사 차감', b.penalty ? '−' + won(b.penalty) : '0원', b.penalty_memo || '', false, 'kpi-penalty') +
      card('설치 대기 오더', pending + '건', '', false, 'kpi-pending');
  }

  /* ---------- 1. 오더 수신함 ---------- */
  function renderInbox() {
    var f = $('#inbox-filter').value;
    var list = state.orders.filter(function (o) {
      if (o.assigned_distributor_id !== state.me || o.service.type !== 'DOCTOR_VISIT' || !o.settlement) return false;
      if (o.status !== 'CONFIRMED' && o.status !== 'COMPLETED') return false;
      return !f || o.status === f;
    }).sort(function (a, b) { return a.settlement.confirmed_at < b.settlement.confirmed_at ? 1 : -1; });

    $('#inbox').innerHTML = list.map(function (o) {
      var done = o.status === 'COMPLETED';
      return '<article class="order-card' + (done ? ' done' : '') + '" data-id="' + esc(o.order_id) + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mono">' + esc(o.order_id) + '</span><span class="chip ' + esc(o.status) + '">' + esc(D.ORDER_STATUS[o.status]) + '</span></div>' +
        '<div><div class="meta">설치 공임비 (본사 확정)</div><div class="fee">' + won(o.settlement.labor_fee) + '</div>' +
        '<div class="meta">정액 400,000 − 화물비 ' + o.settlement.freight_cost.toLocaleString('ko-KR') + ' (본사 부담)</div></div>' +
        '<div class="thumbs">' + (o.media || []).map(thumb).join('') + '</div>' +
        '<div>📞 <a href="tel:' + esc(o.customer.phone) + '"><b>' + esc(o.customer.phone) + '</b></a>' +
          (o.customer.auth_provider === 'KAKAO' ? ' <span class="chip kakao-chip">카카오</span>' : '') + '</div>' +
        (o.customer.note ? '<div class="meta">증상: ' + esc(o.customer.note) + '</div>' : '') +
        '<div class="meta">유입 QR: ' + esc((o.attribution && o.attribution.agent_id) || '직접 유입') + ' · 배차 ' + fmtDate(o.settlement.confirmed_at) + '</div>' +
        (done ? '' : '<button class="btn primary btn-done" type="button">설치 완료 보고</button>') +
        '</article>';
    }).join('');
    $('#inbox-empty').hidden = list.length > 0;
  }

  $('#inbox').addEventListener('click', function (e) {
    var b = e.target.closest('.btn-done');
    if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id');
    if (!window.confirm('설치 완료로 보고할까요?')) return;
    api.updateOrderStatus(id, 'COMPLETED', 'PARTNER:' + state.me)
      .then(function () { toast('설치 완료 보고됨'); return refresh(); })
      .catch(function (err) { toast(err.message, true); });
  });

  /* ---------- 2. 내 식당 (My Accounts) ---------- */
  /** 식당(연락처)별로 묶고, 가장 오래된 접수의 agent_id를 귀속 QR로 본다 (First-touch) */
  function myAccounts() {
    var mine = {};
    myAgents().forEach(function (a) { mine[a.agent_id] = true; });
    var byPhone = {};
    state.orders.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (o) {
      var p = o.customer.phone;
      if (!byPhone[p]) byPhone[p] = { phone: p, agent_id: null, first_at: null, orders: [] };
      var acc = byPhone[p];
      if (!acc.agent_id && o.attribution && o.attribution.agent_id) {
        acc.agent_id = o.attribution.agent_id;
        acc.first_at = o.attribution.first_touch_at || o.created_at;
      }
      acc.orders.push(o);
    });
    return Object.keys(byPhone).map(function (k) { return byPhone[k]; })
      .filter(function (a) { return a.agent_id && mine[a.agent_id]; });
  }

  function renderAccounts() {
    var filter = $('#agent-filter').value;
    var lines = myBilling(D.currentMonthKey()).commission_lines;
    var list = myAccounts().filter(function (a) { return !filter || a.agent_id === filter; });
    $('#acc-table tbody').innerHTML = list.length ? list.map(function (a) {
      var last = a.orders[a.orders.length - 1];
      var my = lines.filter(function (l) { return l.customer_phone === a.phone; });
      var comm = my.reduce(function (s, l) { return s + l.commission; }, 0);
      return '<tr><td><b>' + esc(a.phone) + '</b></td><td class="mono">' + esc(a.agent_id) + '</td><td>' + fmtDate(a.first_at) + '</td>' +
        '<td class="num">' + a.orders.length + '</td><td><span class="chip ' + esc(last.status) + '">' + esc(D.ORDER_STATUS[last.status]) + '</span></td>' +
        '<td class="num">' + my.length + '</td><td class="num ' + (comm ? 'pos strong' : '') + '">' + won(comm) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">아직 내 QR로 유입된 식당이 없습니다.</td></tr>';
  }

  /* ---------- 3. 패시브 인컴 ---------- */
  function renderPassive() {
    var lines = myBilling(D.currentMonthKey()).commission_lines;
    $('#pi-table tbody').innerHTML = lines.length ? lines.map(function (l) {
      return '<tr><td class="mono">' + esc(l.contract_id) + '</td><td>' + esc(l.customer_phone) + '</td><td class="mono">' + esc(l.agent_id) + '</td>' +
        '<td>' + esc(l.item_name) + '</td><td class="num">' + won(l.monthly_amount) + '</td><td class="num">' + l.share_pct + '%</td>' +
        '<td class="num pos strong">' + won(l.commission) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">이번 달 활성 부가 계약이 없습니다.</td></tr>';
    var total = lines.reduce(function (s, l) { return s + l.commission; }, 0);
    $('#pi-table tfoot').innerHTML = '<tr><td colspan="6">이번 달 부가 마진 합계</td><td class="num" id="pi-total">' + won(total) + '</td></tr>';
  }

  function renderQR() {
    $('#qr-table tbody').innerHTML = myAgents().map(function (a) {
      return '<tr><td class="mono">' + esc(a.agent_id) + '</td><td>' + esc(a.name) + '</td><td>' + (a.role === 'DOCTOR' ? '닥터' : '총판') + '</td>' +
        '<td><span class="qr-link">https://dr119.org/?agent_id=' + esc(a.agent_id) + '</span></td></tr>';
    }).join('');
  }

  function refresh() { return load().then(render); }

  // 실시간: 본사/고객 탭 또는 다른 기기 변경 시 즉시 갱신
  window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf('dr119_') === 0) refresh(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  setInterval(refresh, 15000);

  refresh();
  window.__DR119_PARTNER__ = { state: state, refresh: refresh };
})();
