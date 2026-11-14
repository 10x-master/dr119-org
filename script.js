/* Dr.119 — Phase 1: B2C 간편 접수 스크립트 */
(function () {
  'use strict';
  var D = window.Dr119;
  var MAX_FILES = 5;
  var MAX_VIDEO_BYTES = 30 * 1024 * 1024;
  var IMG_MAX_EDGE = 1280;   // 전송용 이미지 리사이즈
  var THUMB_MAX_EDGE = 320;  // 관리자 목록 썸네일

  var form = document.getElementById('as-form');
  var agentInput = document.getElementById('agent_id');
  var fileInput = document.getElementById('media');
  var preview = document.getElementById('preview');
  var phoneInput = document.getElementById('phone');
  var submitBtn = document.getElementById('submit-btn');
  var doneBox = document.getElementById('done');
  var mediaError = document.getElementById('media-error');
  var phoneError = document.getElementById('phone-error');

  /** 선택된 파일 목록 (File 객체) */
  var files = [];

  /* ------------------------------------------------------------
   * 1) QR agent_id First-touch 귀속
   * ------------------------------------------------------------ */
  var attribution = (function initAttribution() {
    var incoming = D.parseAgentId(window.location.search);
    var stored = D.api.getAttribution();
    var landing = window.location.href;
    var result = D.resolveFirstTouch(stored, incoming, new Date().toISOString(), landing);
    if (result.is_new) {
      D.api.saveAttribution({
        agent_id: result.agent_id,
        first_touch_at: result.first_touch_at,
        landing_url: result.landing_url
      });
    }
    agentInput.value = result.agent_id || '';
    if (incoming && result.agent_id && incoming !== result.agent_id) {
      console.info('[Dr.119] First-touch 유지: 기존 귀속 ' + result.agent_id + ' (이번 접속 ' + incoming + ' 은 무시)');
    }
    return result;
  })();

  /* ------------------------------------------------------------
   * 2) 사진/영상 업로드 + 미리보기
   * ------------------------------------------------------------ */
  fileInput.addEventListener('change', function () {
    mediaError.textContent = '';
    var picked = Array.prototype.slice.call(fileInput.files || []);
    var rejected = [];
    picked.forEach(function (f) {
      var isImg = /^image\//.test(f.type);
      var isVid = /^video\//.test(f.type);
      if (!isImg && !isVid) { rejected.push(f.name + ' (지원하지 않는 형식)'); return; }
      if (isVid && f.size > MAX_VIDEO_BYTES) { rejected.push(f.name + ' (영상 30MB 초과)'); return; }
      if (files.length >= MAX_FILES) { rejected.push(f.name + ' (최대 ' + MAX_FILES + '개)'); return; }
      files.push(f);
    });
    fileInput.value = ''; // 같은 파일 재선택 허용
    if (rejected.length) mediaError.textContent = '제외됨: ' + rejected.join(', ');
    renderPreview();
  });

  function renderPreview() {
    preview.innerHTML = '';
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      var url = URL.createObjectURL(f);
      var el;
      if (/^image\//.test(f.type)) {
        el = document.createElement('img');
        el.alt = '첨부 사진 ' + (i + 1);
      } else {
        el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.preload = 'metadata';
        var badge = document.createElement('span');
        badge.className = 'badge'; badge.textContent = '영상';
        li.appendChild(badge);
      }
      el.src = url;
      el.addEventListener('load', function () { URL.revokeObjectURL(url); });
      li.insertBefore(el, li.firstChild);
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'remove'; rm.setAttribute('aria-label', f.name + ' 삭제'); rm.textContent = '×';
      rm.addEventListener('click', function () { files.splice(i, 1); renderPreview(); });
      li.appendChild(rm);
      preview.appendChild(li);
    });
  }

  /* ------------------------------------------------------------
   * 3) 연락처 자동 하이픈 + 검증
   * ------------------------------------------------------------ */
  phoneInput.addEventListener('input', function () {
    var d = phoneInput.value.replace(/\D/g, '').slice(0, 11);
    var out = d;
    if (/^02/.test(d)) {
      out = d.length > 9 ? d.replace(/(\d{2})(\d{4})(\d{0,4})/, '$1-$2-$3')
        : d.length > 5 ? d.replace(/(\d{2})(\d{3})(\d{0,4})/, '$1-$2-$3')
        : d.length > 2 ? d.replace(/(\d{2})(\d{0,3})/, '$1-$2') : d;
    } else {
      out = d.length > 10 ? d.replace(/(\d{3})(\d{4})(\d{0,4})/, '$1-$2-$3')
        : d.length > 6 ? d.replace(/(\d{3})(\d{3})(\d{0,4})/, '$1-$2-$3')
        : d.length > 3 ? d.replace(/(\d{3})(\d{0,3})/, '$1-$2') : d;
    }
    phoneInput.value = out;
    if (phoneInput.getAttribute('aria-invalid') === 'true' && D.normalizePhone(out)) {
      phoneInput.removeAttribute('aria-invalid');
      phoneError.textContent = '';
    }
  });

  /* ------------------------------------------------------------
   * 4) 파일 → JSON 직렬화 (이미지: 리사이즈 JPEG base64 / 영상: 원본 base64)
   * ------------------------------------------------------------ */
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = src;
    });
  }

  function resizeToDataURL(img, maxEdge, quality) {
    var scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  }

  function serializeFile(file) {
    return readAsDataURL(file).then(function (dataUrl) {
      var base = { name: file.name, type: file.type, size: file.size };
      if (!/^image\//.test(file.type)) {
        base.data_url = dataUrl;
        base.thumb_url = null;
        return base;
      }
      return loadImage(dataUrl).then(function (img) {
        base.type = 'image/jpeg';
        base.original_type = file.type;
        base.width = img.naturalWidth;
        base.height = img.naturalHeight;
        base.data_url = resizeToDataURL(img, IMG_MAX_EDGE, 0.82);
        base.thumb_url = resizeToDataURL(img, THUMB_MAX_EDGE, 0.7);
        return base;
      }).catch(function () {
        // HEIC 등 브라우저 디코딩 불가 형식 → 원본 그대로 전송
        base.data_url = dataUrl;
        base.thumb_url = null;
        return base;
      });
    });
  }

  /* ------------------------------------------------------------
   * 5) Submit → JSON payload 생성 → 콘솔 출력 + Mock API 전송
   * ------------------------------------------------------------ */
  function buildPayload(media) {
    var typeCode = (form.querySelector('input[name="service_type"]:checked') || {}).value;
    var svc = D.SERVICE_TYPES[typeCode];
    var now = new Date();
    return {
      schema_version: 1,
      order_id: D.generateOrderId(now),
      created_at: now.toISOString(),
      customer: { phone: D.normalizePhone(phoneInput.value) },
      service: {
        type: svc.code,
        label: svc.label,
        fixed_price: svc.fixed_price,
        freight_payment: svc.freight_payment
      },
      attribution: {
        agent_id: D.sanitizeAgentId(agentInput.value), // hidden 필드 값
        model: 'FIRST_TOUCH',
        first_touch_at: attribution.first_touch_at,
        landing_url: attribution.landing_url
      },
      media: media,
      client: { user_agent: navigator.userAgent, submitted_url: window.location.href }
    };
  }

  function validate() {
    var ok = true;
    mediaError.textContent = '';
    phoneError.textContent = '';
    phoneInput.removeAttribute('aria-invalid');
    if (!files.length) {
      mediaError.textContent = '고장 부위 사진 또는 영상을 1개 이상 올려주세요.';
      ok = false;
    }
    if (!D.normalizePhone(phoneInput.value)) {
      phoneError.textContent = '연락처를 정확히 입력해 주세요. (예: 010-1234-5678)';
      phoneInput.setAttribute('aria-invalid', 'true');
      if (ok) phoneInput.focus();
      ok = false;
    }
    if (!form.querySelector('input[name="service_type"]:checked')) ok = false;
    return ok;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;
    submitBtn.disabled = true;
    submitBtn.querySelector('.submit-text').textContent = '접수 중…';

    Promise.all(files.map(serializeFile))
      .then(function (media) {
        var payload = buildPayload(media);
        // ▼ API 연동 대기: 백엔드로 전송될 JSON
        console.log('[Dr.119] AS 접수 JSON payload ↓');
        console.log(JSON.stringify(payload, null, 2));
        window.__DR119_LAST_PAYLOAD__ = payload;
        return D.api.submitOrder(payload).then(function (res) { return { payload: payload, res: res }; });
      })
      .then(function (r) {
        document.getElementById('done-order-id').textContent = r.res.order_id;
        form.hidden = true;
        doneBox.hidden = false;
        doneBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.dispatchEvent(new CustomEvent('dr119:submitted', { detail: r.payload }));
      })
      .catch(function (err) {
        console.error('[Dr.119] 접수 실패', err);
        mediaError.textContent = '접수 중 오류가 발생했습니다: ' + err.message;
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.querySelector('.submit-text').textContent = '119 긴급 접수하기';
      });
  });

  document.getElementById('again-btn').addEventListener('click', function () {
    files = [];
    renderPreview();
    form.reset();
    agentInput.value = attribution.agent_id || ''; // reset 후에도 귀속값 유지
    doneBox.hidden = true;
    form.hidden = false;
  });

  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
