/* Dr.119 — Phase 1: B2C 간편 접수 + 카메라 + 음성입력 + 카카오 간편등록 + 파트너 상담 스크립트 */
(function () {
  'use strict';
  var D = window.Dr119;
  var MAX_FILES = 5;
  var MAX_VIDEO_BYTES = 30 * 1024 * 1024;
  var IMG_MAX_EDGE = 1280;   // 전송용 이미지 리사이즈
  var THUMB_MAX_EDGE = 320;  // 관리자 목록 썸네일
  var KAKAO_PHONE_KEY = 'dr119_kakao_phone';
  var PARTNER_LEADS_KEY = 'dr119_partner_leads';

  var form = document.getElementById('as-form');
  var agentInput = document.getElementById('agent_id');
  var fileInput = document.getElementById('media');
  var cameraInput = document.getElementById('camera-media');
  var preview = document.getElementById('preview');
  var phoneInput = document.getElementById('phone');
  var symptomInput = document.getElementById('symptom_note');
  var voiceBtn = document.getElementById('voice-btn');
  var voiceStatus = document.getElementById('voice-status');
  var kakaoSyncBtn = document.getElementById('kakao-sync-btn');
  var kakaoQuickBox = document.getElementById('kakao-quick-box');
  var kakaoPhoneInput = document.getElementById('kakao-phone-input');
  var kakaoConfirmBtn = document.getElementById('kakao-confirm-btn');
  var kakaoBadge = document.getElementById('kakao-badge');
  var submitBtn = document.getElementById('submit-btn');
  var doneBox = document.getElementById('done');
  var mediaError = document.getElementById('media-error');
  var phoneError = document.getElementById('phone-error');

  /** 선택된 파일 목록 (File 객체) & 인증 수단 */
  var files = [];
  var authProvider = null;

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
   * 2) 사진/영상 업로드 (카메라 + 앨범 공용) & 미리보기
   * ------------------------------------------------------------ */
  function handlePickedFiles(input) {
    mediaError.textContent = '';
    var picked = Array.prototype.slice.call(input.files || []);
    var rejected = [];
    picked.forEach(function (f) {
      var isImg = /^image\//.test(f.type);
      var isVid = /^video\//.test(f.type);
      if (!isImg && !isVid) { rejected.push(f.name + ' (지원하지 않는 형식)'); return; }
      if (isVid && f.size > MAX_VIDEO_BYTES) { rejected.push(f.name + ' (영상 30MB 초과)'); return; }
      if (files.length >= MAX_FILES) { rejected.push(f.name + ' (최대 ' + MAX_FILES + '개)'); return; }
      files.push(f);
    });
    input.value = ''; // 같은 파일 재선택 허용
    if (rejected.length) mediaError.textContent = '제외됨: ' + rejected.join(', ');
    renderPreview();
  }

  fileInput.addEventListener('change', function () { handlePickedFiles(fileInput); });
  if (cameraInput) {
    cameraInput.addEventListener('change', function () { handlePickedFiles(cameraInput); });
  }

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
   * 3) 실시간 한국어 음성-텍스트 증상 입력 (Web Speech API)
   * ------------------------------------------------------------ */
  (function initVoiceInput() {
    if (!voiceBtn || !symptomInput) return;
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null;
    var listening = false;
    var committedText = '';

    voiceBtn.addEventListener('click', function () {
      if (!SpeechRecognition) {
        voiceStatus.textContent = '이 브라우저는 음성 인식을 지원하지 않습니다. 키보드로 간단히 적어 주세요.';
        return;
      }
      if (listening && recognition) {
        recognition.stop();
        return;
      }
      committedText = symptomInput.value.trim();
      recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = function () {
        listening = true;
        voiceBtn.classList.add('listening');
        voiceBtn.setAttribute('aria-pressed', 'true');
        voiceBtn.innerHTML = '<span aria-hidden="true">⏹️</span> 음성 입력 멈추기';
        voiceStatus.textContent = '듣고 있습니다… 고장 증상을 말씀해 주세요.';
      };
      recognition.onresult = function (ev) {
        var finalSeg = '';
        var interimSeg = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalSeg += t;
          else interimSeg += t;
        }
        if (finalSeg) committedText = (committedText ? committedText + ' ' : '') + finalSeg.trim();
        symptomInput.value = [committedText, interimSeg.trim()].filter(Boolean).join(' ');
      };
      recognition.onerror = function (ev) {
        voiceStatus.textContent = ev.error === 'not-allowed'
          ? '마이크 권한이 차단되었습니다. 브라우저 설정에서 마이크를 허용해 주세요.'
          : '음성 인식 중 오류가 발생했습니다 (' + ev.error + ').';
      };
      recognition.onend = function () {
        listening = false;
        voiceBtn.classList.remove('listening');
        voiceBtn.setAttribute('aria-pressed', 'false');
        voiceBtn.innerHTML = '<span aria-hidden="true">🎙️</span> 말로 증상 적기';
        if (!voiceStatus.textContent.includes('오류') && !voiceStatus.textContent.includes('권한')) {
          voiceStatus.textContent = committedText ? '음성 입력이 메모에 반영되었습니다.' : '';
        }
      };
      recognition.start();
    });
  })();

  /* ------------------------------------------------------------
   * 4) 연락처 자동 하이픈 + 카카오 1초 간편 등록
   * ------------------------------------------------------------ */
  function formatPhoneValue(raw) {
    var d = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (/^02/.test(d)) {
      return d.length > 9 ? d.replace(/(\d{2})(\d{4})(\d{0,4})/, '$1-$2-$3')
        : d.length > 5 ? d.replace(/(\d{2})(\d{3})(\d{0,4})/, '$1-$2-$3')
        : d.length > 2 ? d.replace(/(\d{2})(\d{0,3})/, '$1-$2') : d;
    }
    return d.length > 10 ? d.replace(/(\d{3})(\d{4})(\d{0,4})/, '$1-$2-$3')
      : d.length > 6 ? d.replace(/(\d{3})(\d{3})(\d{0,4})/, '$1-$2-$3')
      : d.length > 3 ? d.replace(/(\d{3})(\d{0,3})/, '$1-$2') : d;
  }

  function applyKakaoPhone(formatted) {
    var norm = D.normalizePhone(formatted);
    if (!norm) return false;
    phoneInput.value = norm;
    phoneInput.removeAttribute('aria-invalid');
    phoneError.textContent = '';
    authProvider = 'KAKAO';
    try { localStorage.setItem(KAKAO_PHONE_KEY, norm); } catch (e) {}
    if (kakaoBadge) kakaoBadge.hidden = false;
    if (kakaoQuickBox) kakaoQuickBox.hidden = true;
    return true;
  }

  phoneInput.addEventListener('input', function () {
    phoneInput.value = formatPhoneValue(phoneInput.value);
    if (phoneInput.getAttribute('aria-invalid') === 'true' && D.normalizePhone(phoneInput.value)) {
      phoneInput.removeAttribute('aria-invalid');
      phoneError.textContent = '';
    }
  });

  if (kakaoPhoneInput) {
    kakaoPhoneInput.addEventListener('input', function () {
      kakaoPhoneInput.value = formatPhoneValue(kakaoPhoneInput.value);
    });
  }

  if (kakaoSyncBtn) {
    kakaoSyncBtn.addEventListener('click', function () {
      // 공식 Kakao JS SDK + 앱 키가 구성된 경우 OAuth 로그인 우선 시도
      if (window.Kakao && window.__DR119_KAKAO_KEY__) {
        try {
          if (!window.Kakao.isInitialized()) window.Kakao.init(window.__DR119_KAKAO_KEY__);
          if (window.Kakao.Auth && typeof window.Kakao.Auth.login === 'function') {
            window.Kakao.Auth.login({
              success: function () {
                window.Kakao.API.request({
                  url: '/v2/user/me',
                  success: function (res) {
                    var kp = res && res.kakao_account && res.kakao_account.phone_number;
                    if (!kp || !applyKakaoPhone(kp.replace(/^\+82\s?/, '0'))) {
                      if (kakaoQuickBox) kakaoQuickBox.hidden = false;
                    }
                  },
                  fail: function () { if (kakaoQuickBox) kakaoQuickBox.hidden = false; }
                });
              },
              fail: function () { if (kakaoQuickBox) kakaoQuickBox.hidden = false; }
            });
            return;
          }
        } catch (err) {
          console.warn('[Dr.119] Kakao SDK fallback:', err);
        }
      }
      // 이미 저장된 간편 연동 연락처가 있으면 1탭 즉시 자동 입력
      var saved = '';
      try { saved = localStorage.getItem(KAKAO_PHONE_KEY) || ''; } catch (e) {}
      if (saved && applyKakaoPhone(saved)) return;

      // 입력창에 이미 번호를 적은 상태면 즉시 카카오 간편 등록 연동
      if (phoneInput.value && applyKakaoPhone(phoneInput.value)) return;

      if (kakaoQuickBox) {
        kakaoQuickBox.hidden = !kakaoQuickBox.hidden;
        if (!kakaoQuickBox.hidden && kakaoPhoneInput) kakaoPhoneInput.focus();
      }
    });
  }

  if (kakaoConfirmBtn) {
    kakaoConfirmBtn.addEventListener('click', function () {
      var candidate = (kakaoPhoneInput && kakaoPhoneInput.value) || phoneInput.value;
      if (!applyKakaoPhone(candidate)) {
        phoneError.textContent = '연동할 휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)';
        if (kakaoPhoneInput) kakaoPhoneInput.focus();
      }
    });
  }

  /* ------------------------------------------------------------
   * 5) 파일 → JSON 직렬화 (이미지: 리사이즈 JPEG base64 / 영상: 원본 base64)
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
   * 6) Submit → JSON payload 생성 → 콘솔 출력 + API 전송
   * ------------------------------------------------------------ */
  function buildPayload(media) {
    var typeCode = (form.querySelector('input[name="service_type"]:checked') || {}).value;
    var svc = D.SERVICE_TYPES[typeCode];
    var now = new Date();
    var cust = { phone: D.normalizePhone(phoneInput.value) };
    var note = symptomInput ? symptomInput.value.trim() : '';
    if (note) cust.note = note;
    if (authProvider) cust.auth_provider = authProvider;

    return {
      schema_version: 1,
      order_id: D.generateOrderId(now),
      created_at: now.toISOString(),
      customer: cust,
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
    authProvider = null;
    if (kakaoBadge) kakaoBadge.hidden = true;
    if (kakaoQuickBox) kakaoQuickBox.hidden = true;
    if (voiceStatus) voiceStatus.textContent = '';
    renderPreview();
    form.reset();
    agentInput.value = attribution.agent_id || ''; // reset 후에도 귀속값 유지
    doneBox.hidden = true;
    form.hidden = false;
  });

  /* ------------------------------------------------------------
   * 7) B2B 지역 수리 센터 · 수리 닥터 가입 상담 신청
   * ------------------------------------------------------------ */
  (function initPartnerApply() {
    var paForm = document.getElementById('partner-apply-form');
    if (!paForm) return;
    var paPhone = document.getElementById('pa-phone');
    var paMsg = document.getElementById('partner-apply-msg');

    if (paPhone) {
      paPhone.addEventListener('input', function () {
        paPhone.value = formatPhoneValue(paPhone.value);
      });
    }

    paForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var role = document.getElementById('pa-role').value;
      var name = document.getElementById('pa-name').value.trim();
      var region = document.getElementById('pa-region').value.trim();
      var normPhone = D.normalizePhone(paPhone.value);
      if (!name || !region || !normPhone) {
        paMsg.style.color = '#d7141a';
        paMsg.textContent = '성함/상호, 활동 지역, 정확한 연락처를 모두 입력해 주세요.';
        paMsg.hidden = false;
        return;
      }
      var lead = {
        id: 'LEAD-' + Date.now().toString(36).toUpperCase(),
        role: role,
        role_label: role === 'LOCAL_CENTER' ? '지역 오프라인 수리 센터(대리점·총판)' : '수리 닥터(설치점·기술자)',
        name: name,
        region: region,
        phone: normPhone,
        training_status: '교육·품질 심사 대기',
        created_at: new Date().toISOString()
      };
      try {
        var list = JSON.parse(localStorage.getItem(PARTNER_LEADS_KEY) || '[]');
        list.unshift(lead);
        localStorage.setItem(PARTNER_LEADS_KEY, JSON.stringify(list));
      } catch (err) {
        console.warn('[Dr.119] partner lead store fallback', err);
      }
      paMsg.style.color = '#0f766e';
      paMsg.textContent = '✓ 파트너 신청(' + lead.role_label + ')이 접수되었습니다. 본사 교육·관리팀이 곧 연락드립니다.';
      paMsg.hidden = false;
      paForm.reset();
    });
  })();

  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
