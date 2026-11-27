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
  var intakePinInput = document.getElementById('intake-pin');
  var regionInput = document.getElementById('region');
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
  var pinError = document.getElementById('pin-error');
  var regionError = document.getElementById('region-error');

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

  // 모바일/PC 사진 촬영 및 앨범 선택 보증 이벤트
  var takePhotoBtn = document.getElementById('btn-take-photo');
  var pickAlbumBtn = document.getElementById('btn-pick-album');
  var gateBtn = document.getElementById('gate-btn');

  if (takePhotoBtn && cameraInput) {
    takePhotoBtn.addEventListener('click', function (e) {
      e.preventDefault();
      cameraInput.click();
    });
  }
  if (pickAlbumBtn && fileInput) {
    pickAlbumBtn.addEventListener('click', function (e) {
      e.preventDefault();
      fileInput.click();
    });
  }

  if (gateBtn) {
    gateBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (cameraInput) {
        cameraInput.click();
      } else if (fileInput) {
        fileInput.click();
      }
    });
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
   * 3) 빠른 증상 칩 선택 + 실시간 한국어 음성 입력 (Web Speech API)
   * ------------------------------------------------------------ */
  (function initSymptomChips() {
    var chips = document.querySelectorAll('.symptom-chip');
    if (!chips.length || !symptomInput) return;

    function syncChipsFromInput() {
      var val = symptomInput.value;
      Array.prototype.forEach.call(chips, function (chip) {
        var kw = chip.getAttribute('data-symptom') || '';
        var active = !!(kw && val.indexOf(kw) !== -1);
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        var kw = chip.getAttribute('data-symptom') || '';
        if (!kw) return;
        var parts = symptomInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var idx = parts.indexOf(kw);
        if (idx >= 0) parts.splice(idx, 1);
        else parts.push(kw);
        symptomInput.value = parts.join(', ');
        syncChipsFromInput();
      });
    });
    symptomInput.addEventListener('input', syncChipsFromInput);
    if (form) {
      form.addEventListener('reset', function () {
        setTimeout(syncChipsFromInput, 0);
      });
    }
  })();

  (function initVoiceInput() {
    if (!voiceBtn || !symptomInput) return;
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null;
    var listening = false;
    var committedText = '';

    voiceBtn.addEventListener('click', function () {
      if (!SpeechRecognition) {
        voiceStatus.textContent = '이 브라우저는 음성 인식을 지원하지 않습니다. 위 증상 칩을 누르거나 직접 적어 주세요.';
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
        voiceBtn.innerHTML = '<span class="mic-red-badge" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg></span><span>음성 멈추기</span>';
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
        voiceBtn.innerHTML = '<span class="mic-red-badge" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg></span><span>말로 증상 적기</span>';
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

  if (intakePinInput) {
    intakePinInput.addEventListener('input', function () {
      intakePinInput.value = intakePinInput.value.replace(/\D/g, '').slice(0, 6);
      if (intakePinInput.getAttribute('aria-invalid') === 'true' && /^\d{6}$/.test(intakePinInput.value)) {
        intakePinInput.removeAttribute('aria-invalid');
        if (pinError) pinError.textContent = '';
      }
    });
  }

  if (regionInput) {
    regionInput.addEventListener('input', function () {
      if (regionInput.getAttribute('aria-invalid') === 'true' && regionInput.value.trim()) {
        regionInput.removeAttribute('aria-invalid');
        if (regionError) regionError.textContent = '';
      }
    });
  }

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
    var checkedSvc = form.querySelector('input[name="service_type"]:checked');
    var typeCode = (checkedSvc && D.SERVICE_TYPES[checkedSvc.value]) ? checkedSvc.value : 'DOCTOR_VISIT';
    var svc = D.SERVICE_TYPES[typeCode];
    var now = new Date();
    var cust = { phone: D.normalizePhone(phoneInput.value) };
    var pinVal = intakePinInput ? intakePinInput.value.replace(/\D/g, '').slice(0, 6) : '';
    if (pinVal.length === 6) cust.pin = pinVal;
    var region = regionInput ? regionInput.value.trim() : '';
    if (region) cust.region = region;
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
    if (pinError) pinError.textContent = '';
    if (intakePinInput) intakePinInput.removeAttribute('aria-invalid');
    if (regionError) regionError.textContent = '';
    if (regionInput) regionInput.removeAttribute('aria-invalid');
    // 사진은 선택 사항 (빈 폼 제출 시에는 안내 표시)
    if (!files.length && !phoneInput.value.trim() && (!regionInput || !regionInput.value.trim())) {
      mediaError.textContent = '사진 등록은 선택 사항입니다. (등록 시 더 빠른 진단 가능)';
    }
    if (!D.normalizePhone(phoneInput.value)) {
      phoneError.textContent = '연락처를 정확히 입력해 주세요. (예: 010-1234-5678)';
      phoneInput.setAttribute('aria-invalid', 'true');
      if (ok) phoneInput.focus();
      ok = false;
    }
    if (intakePinInput) {
      var pinDigits = intakePinInput.value.replace(/\D/g, '');
      if (pinDigits.length !== 6) {
        if (pinError) pinError.textContent = '조회용 간편 비밀번호 숫자 6자리를 입력해 주세요.';
        intakePinInput.setAttribute('aria-invalid', 'true');
        if (ok) intakePinInput.focus();
        ok = false;
      }
    }
    if (regionInput && !regionInput.value.trim()) {
      if (regionError) regionError.textContent = '지역을 입력해 주세요. (예: 서울 강남구 / 부산 해운대구)';
      regionInput.setAttribute('aria-invalid', 'true');
      if (ok) regionInput.focus();
      ok = false;
    }
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
        var headLg = document.getElementById('intake-header-lg');
        if (headLg) headLg.hidden = true;
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
    var headLg = document.getElementById('intake-header-lg');
    if (headLg) headLg.hidden = false;
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

  /* ------------------------------------------------------------
   * 8) 모바일 햄버거 메뉴 & 웰글로벌 카톡채널 안내 & PWA 아이콘 설치
   * ------------------------------------------------------------ */
  (function initMobileHeaderNav() {
    var menuBtn = document.getElementById('mobile-menu-btn');
    var headerNav = document.getElementById('header-nav');
    if (!menuBtn || !headerNav) return;

    function setOpen(open) {
      if (open) headerNav.classList.add('is-open');
      else headerNav.classList.remove('is-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    }

    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!headerNav.classList.contains('is-open'));
    });

    headerNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('click', function (e) {
      if (headerNav.classList.contains('is-open') && !headerNav.contains(e.target) && !menuBtn.contains(e.target)) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && headerNav.classList.contains('is-open')) setOpen(false);
    });
  })();

  (function initAppInstall() {
    if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      });
    }
    var installBtn = document.getElementById('floating-install-btn');
    var dlg = document.getElementById('install-guide-dialog');
    var dlgTitle = document.getElementById('install-dialog-title');
    var guideText = document.getElementById('install-guide-text');
    var closeBtn = document.getElementById('install-dialog-close');
    var okBtn = document.getElementById('install-ok-btn');
    var copyBtn = document.getElementById('install-copy-btn');
    var kakaoTriggers = document.querySelectorAll('.kakao-channel-trigger');
    var deferredPrompt = null;
    var dialogMode = 'install';

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
    });

    function buildGuideMessage() {
      var ua = navigator.userAgent || '';
      if (/iPhone|iPad|iPod/i.test(ua)) {
        return 'Safari 하단 [공유] 버튼을 누른 뒤 [홈 화면에 추가]를 선택하면 Dr.119 로고 아이콘이 모바일 홈 화면에 설치됩니다.';
      }
      if (/Android/i.test(ua)) {
        return '브라우저 우측 상단 메뉴(⋮)에서 [홈 화면에 추가] 또는 [앱 설치]를 누르면 Dr.119 아이콘이 홈 화면에 추가됩니다.';
      }
      return 'PC 브라우저(Chrome·Edge) 주소창 오른쪽 [설치] 아이콘 또는 브라우저 메뉴 → [저장 및 공유 / 앱 → 바로가기 만들기·앱 설치]를 선택하시면 바탕화면에 Dr.119 아이콘이 생성됩니다.';
    }

    function openGuide(mode) {
      if (!dlg) return;
      dialogMode = mode || 'install';
      if (dialogMode === 'kakao') {
        if (dlgTitle) dlgTitle.textContent = '주식회사 웰글로벌 카카오톡 채널 상담';
        if (guideText) {
          guideText.textContent = '카카오톡 상단 검색창(돋보기)에서 "웰글로벌" 채널을 검색해 1:1 상담하시거나, 화면 상단 긴급 접수 폼 또는 대표번호 1661-0783(고객센터 010-5553-8250)으로 바로 연결하실 수 있습니다.';
        }
        if (copyBtn) copyBtn.textContent = '"웰글로벌" 검색어 복사';
      } else {
        if (dlgTitle) dlgTitle.textContent = 'Dr.119 바탕화면·모바일 아이콘 설치';
        if (guideText) guideText.textContent = buildGuideMessage();
        if (copyBtn) copyBtn.textContent = '현재 주소 복사하기';
      }
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', '');
      }
    }

    function closeGuide() {
      if (!dlg) return;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      else dlg.removeAttribute('open');
    }

    if (installBtn) {
      installBtn.addEventListener('click', function () {
        if (deferredPrompt) {
          var p = deferredPrompt;
          deferredPrompt = null;
          p.prompt();
          if (p.userChoice && typeof p.userChoice.then === 'function') {
            p.userChoice.then(function (choice) {
              if (!choice || choice.outcome !== 'accepted') openGuide('install');
            }).catch(function () { openGuide('install'); });
          }
          return;
        }
        openGuide('install');
      });
    }
    Array.prototype.forEach.call(kakaoTriggers, function (btn) {
      btn.addEventListener('click', function () {
        openGuide('kakao');
      });
    });
    if (closeBtn) closeBtn.addEventListener('click', closeGuide);
    if (okBtn) okBtn.addEventListener('click', closeGuide);
    if (dlg) {
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg) closeGuide();
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var textToCopy = dialogMode === 'kakao' ? '웰글로벌' : window.location.href;
        var defaultLabel = dialogMode === 'kakao' ? '"웰글로벌" 검색어 복사' : '현재 주소 복사하기';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy).then(function () {
            copyBtn.textContent = '복사 완료!';
            setTimeout(function () { copyBtn.textContent = defaultLabel; }, 1800);
          }).catch(function () {});
        }
      });
    }
  })();

  /* ================================================================
   * 8) 고객 전용 수리·상담 실시간 조회 (카카오 간편 로그인 & 안심 보안 조회)
   * ================================================================ */
  (function () {
    var statusDlg = document.getElementById('customer-status-dialog');
    var openStatusBtn = document.getElementById('btn-open-status');
    var closeStatusBtn = document.getElementById('status-dialog-close');
    var searchInput = document.getElementById('status-search-input');
    var secPinInput = document.getElementById('status-sec-pin');
    var searchBtn = document.getElementById('btn-status-search');
    var resultBox = document.getElementById('status-result-box');
    var emptyMsg = document.getElementById('status-empty-msg');
    var kakaoStatusBtn = document.getElementById('btn-kakao-status-login');
    var kakaoUserBox = document.getElementById('status-kakao-user');
    var kakaoPhoneSpan = document.getElementById('status-kakao-phone');
    var kakaoLogoutBtn = document.getElementById('btn-status-kakao-logout');
    var viewStatusNowBtn = document.getElementById('btn-view-status-now');

    function maskPhone(p) {
      var norm = D.normalizePhone(p);
      if (!norm) return p || '-';
      return norm.replace(/^(\d{3})-(\d{3,4})-(\d{4})$/, function (_, a, b, c) {
        return a + '-****-' + c;
      });
    }

    function checkKakaoSession() {
      var saved = '';
      try { saved = localStorage.getItem(KAKAO_PHONE_KEY) || ''; } catch (e) {}
      if (saved && kakaoUserBox && kakaoPhoneSpan) {
        kakaoPhoneSpan.textContent = maskPhone(saved);
        kakaoUserBox.style.display = 'flex';
        return saved;
      }
      if (kakaoUserBox) kakaoUserBox.style.display = 'none';
      return null;
    }

    function renderOrder(o) {
      if (!o) {
        if (resultBox) resultBox.style.display = 'none';
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.textContent = '일치하는 접수 내역을 찾을 수 없습니다. 연락처(또는 접수번호)와 간편 비밀번호 6자리를 확인해 주세요.';
        }
        return;
      }
      if (emptyMsg) emptyMsg.style.display = 'none';
      if (resultBox) {
        resultBox.style.display = 'block';
        var cs = o.consultation || {};
        var orderIdEl = document.getElementById('st-order-id');
        var badgeEl = document.getElementById('st-status-badge');
        var custInfoEl = document.getElementById('st-customer-info');
        var consultDetailsEl = document.getElementById('st-consult-details');

        if (orderIdEl) orderIdEl.textContent = '접수번호: ' + o.order_id;
        if (badgeEl) badgeEl.textContent = D.ORDER_STATUS[o.status] || o.status;
        if (custInfoEl) {
          custInfoEl.textContent = '접수일시: ' + (o.created_at ? o.created_at.slice(0, 10) : '-') + ' · 고객 연락처: ' + maskPhone(o.customer ? o.customer.phone : '-');
        }
        if (consultDetailsEl) {
          if (o.consultation_status === 'COMPLETED') {
            consultDetailsEl.innerHTML =
              '• 기기 규격: <b>' + (cs.product_size || '표준') + '</b> (' + (cs.manufacturer || '제조사 확인') + ') · ' + (cs.years_used || '사용연수 확인') + '<br>' +
              '• 고장 증상: ' + (cs.problem_detail || '상세 점검') + ' (' + (cs.duration_of_issue || '지속기간') + ')<br>' +
              '• 권장 처방: <b>공장 입고 40만 전면 재생 (단종·폐업 기기 올수리 복원)</b><br>' +
              '• 견적 안내: 재생 공임 400,000원 (왕복 화물 실비 ' + (cs.freight_quote ? Number(cs.freight_quote).toLocaleString('ko-KR') + '원' : '별도') + ')<br>' +
              (cs.notes ? '• 상담 메모: ' + cs.notes : '');
          } else {
            consultDetailsEl.innerHTML = '현재 본사 기술 상담팀이 접수된 사진을 검토 중입니다. 곧 1차 전화 상담을 통해 맞춤형 견적을 안내해 드립니다.';
          }
        }
      }
    }

    function openStatusModal(prefill, fromReceipt) {
      if (!statusDlg) return;
      var loggedInPhone = checkKakaoSession();
      if (prefill) {
        if (searchInput) searchInput.value = prefill;
      } else if (loggedInPhone && searchInput && !searchInput.value) {
        // 이미 카카오 인증된 고객인 경우 자동 조회
        D.api.getCustomerOrder(loggedInPhone, '', { verifiedByKakao: true }).then(renderOrder).catch(function () {});
      }
      if (typeof statusDlg.showModal === 'function') {
        if (!statusDlg.open) statusDlg.showModal();
      } else {
        statusDlg.setAttribute('open', '');
      }
      if (prefill) doSearch({ fromReceipt: !!fromReceipt });
    }

    function closeStatusModal() {
      if (!statusDlg) return;
      if (typeof statusDlg.close === 'function' && statusDlg.open) statusDlg.close();
      else statusDlg.removeAttribute('open');
    }

    function doSearch(searchOpts) {
      var opts = searchOpts || {};
      var q = searchInput ? searchInput.value.trim() : '';
      if (!q) {
        var kPhone = checkKakaoSession();
        if (kPhone) {
          q = kPhone;
          if (searchInput) searchInput.value = kPhone;
          opts.verifiedByKakao = true;
        }
      }

      if (!q) {
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.textContent = '조회하실 휴대폰 번호 또는 접수번호를 입력해 주세요.';
        }
        if (searchInput) searchInput.focus();
        return;
      }

      var pin = secPinInput ? secPinInput.value.replace(/\D/g, '').slice(0, 6) : '';
      if (secPinInput) secPinInput.value = pin;

      // 카카오 본인 인증 완료 또는 접수 직후 확인이 아닌 경우 6자리 간편 비밀번호 필수 검증
      if (!opts.verifiedByKakao && !opts.fromReceipt && pin.length !== 6) {
        if (resultBox) resultBox.style.display = 'none';
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.textContent = '본인 확인을 위해 접수 시 설정하신 간편 비밀번호 숫자 6자리를 입력해 주세요.';
        }
        if (secPinInput) secPinInput.focus();
        return;
      }

      if (emptyMsg) emptyMsg.style.display = 'none';

      D.api.getCustomerOrder(q, pin, opts).then(function (o) {
        renderOrder(o);
      }).catch(function (err) {
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.textContent = '조회 중 오류가 발생했습니다: ' + err.message;
        }
      });
    }

    function handleKakaoLogin() {
      // 1) 카카오 공식 SDK OAuth 인증 시도 (실제 카카오 본인 인증)
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
                    if (kp) {
                      var norm = D.normalizePhone(kp.replace(/^\+82\s?/, '0'));
                      if (norm) {
                        try { localStorage.setItem(KAKAO_PHONE_KEY, norm); } catch (e) {}
                        checkKakaoSession();
                        if (searchInput) searchInput.value = norm;
                        D.api.getCustomerOrder(norm, '', { verifiedByKakao: true }).then(renderOrder);
                        return;
                      }
                    }
                    if (emptyMsg) {
                      emptyMsg.style.display = 'block';
                      emptyMsg.textContent = '카카오 계정에서 전화번호 정보를 가져오지 못했습니다. 아래 연락처와 간편 비밀번호 6자리로 조회해 주세요.';
                    }
                  },
                  fail: function () {
                    if (emptyMsg) {
                      emptyMsg.style.display = 'block';
                      emptyMsg.textContent = '카카오 계정 정보 조회에 실패했습니다. 아래 연락처와 간편 비밀번호 6자리로 조회해 주세요.';
                    }
                  }
                });
              },
              fail: function () {
                if (emptyMsg) {
                  emptyMsg.style.display = 'block';
                  emptyMsg.textContent = '카카오 로그인 창 연결에 실패했습니다. 아래 연락처와 간편 비밀번호 6자리로 조회해 주세요.';
                }
              }
            });
            return;
          }
        } catch (e) {}
      }

      // 2) SDK 미로드/도메인 미연결 시 안내 (비밀번호 없는 무단 조회 차단)
      if (emptyMsg) {
        emptyMsg.style.display = 'block';
        emptyMsg.textContent = '카카오 간편 로그인을 사용할 수 없는 환경입니다. 아래 연락처와 간편 비밀번호 6자리로 안전하게 조회해 주세요.';
      }
      if (searchInput) searchInput.focus();
    }

    if (kakaoStatusBtn) kakaoStatusBtn.addEventListener('click', handleKakaoLogin);
    if (kakaoLogoutBtn) {
      kakaoLogoutBtn.addEventListener('click', function () {
        try { localStorage.removeItem(KAKAO_PHONE_KEY); } catch (e) {}
        checkKakaoSession();
        if (resultBox) resultBox.style.display = 'none';
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.textContent = '카카오 로그아웃되었습니다. 조회하실 정보를 입력하거나 다시 로그인해 주세요.';
        }
      });
    }

    if (viewStatusNowBtn) {
      viewStatusNowBtn.addEventListener('click', function () {
        var doneOidEl = document.getElementById('done-order-id');
        var oid = doneOidEl ? doneOidEl.textContent.trim() : '';
        openStatusModal(oid !== '-' ? oid : '', true);
      });
    }

    if (openStatusBtn) openStatusBtn.addEventListener('click', function (e) { e.preventDefault(); openStatusModal(); });
    if (closeStatusBtn) closeStatusBtn.addEventListener('click', closeStatusModal);
    if (searchBtn) searchBtn.addEventListener('click', function () { doSearch(); });
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    }
    if (secPinInput) {
      secPinInput.addEventListener('input', function () {
        secPinInput.value = secPinInput.value.replace(/\D/g, '').slice(0, 6);
      });
      secPinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    }

    // URL 파라미터 자동 팝업 (?order_id=... 또는 ?check_status=...)
    try {
      var p = new URLSearchParams(window.location.search);
      var oid = p.get('order_id');
      if (oid) openStatusModal(oid);
    } catch (e) {}

    // B2B 간편 문의 모달
    var b2bDlg = document.getElementById('b2b-inquiry-dialog');
    var openB2bBtn = document.getElementById('btn-open-b2b');
    var bannerB2bBtn = document.getElementById('banner-open-b2b');
    var closeB2bBtn = document.getElementById('b2b-dialog-close');
    var b2bForm = document.getElementById('b2b-inquiry-form');

    function openB2b() {
      if (!b2bDlg) return;
      if (typeof b2bDlg.showModal === 'function') {
        if (!b2bDlg.open) b2bDlg.showModal();
      } else {
        b2bDlg.setAttribute('open', '');
      }
    }
    function closeB2b() {
      if (!b2bDlg) return;
      if (typeof b2bDlg.close === 'function' && b2bDlg.open) b2bDlg.close();
      else b2bDlg.removeAttribute('open');
    }

    if (openB2bBtn) openB2bBtn.addEventListener('click', function (e) { e.preventDefault(); openB2b(); });
    if (bannerB2bBtn) bannerB2bBtn.addEventListener('click', function (e) { e.preventDefault(); openB2b(); });
    if (closeB2bBtn) closeB2bBtn.addEventListener('click', closeB2b);
    if (b2bForm) {
      b2bForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var lead = {
          role: document.getElementById('b2b-type').value,
          name: document.getElementById('b2b-name').value,
          phone: document.getElementById('b2b-phone').value,
          region: document.getElementById('b2b-region').value,
          memo: document.getElementById('b2b-memo').value
        };
        D.api.submitPartnerLead(lead).then(function () {
          alert('제휴 지원서가 정상 접수되었습니다. 본사 제휴팀에서 24시간 이내에 1:1 유선 상담을 드립니다.');
          b2bForm.reset();
          closeB2b();
        }).catch(function (err) { alert('접수 실패: ' + err.message); });
      });
    }
  })();

  /* ================================================================
   * 10) 자주 묻는 질문(FAQ) 마우스 호버 시 즉시 열림 (빠른 탐색)
   * ================================================================ */
  (function () {
    if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;
    var faqItems = document.querySelectorAll('#faq details');
    faqItems.forEach(function (item) {
      item.addEventListener('mouseenter', function () {
        faqItems.forEach(function (other) {
          if (other !== item && other.open) other.open = false;
        });
        item.open = true;
      });
    });
  })();

  /* ================================================================
   * 11) 닥터119 아이콘 설치 완료 시 설치 버튼 자동 숨김
   * ================================================================ */
  (function () {
    function hideInstallButtons() {
      var dock = document.getElementById('floating-dock');
      var mbarBtn = document.getElementById('mbar-install-btn');
      if (dock) dock.style.display = 'none';
      if (mbarBtn) mbarBtn.style.display = 'none';
    }
    var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var wasInstalled = false;
    try { wasInstalled = localStorage.getItem('dr119_app_installed') === '1'; } catch (e) {}
    if (isStandalone || wasInstalled) {
      hideInstallButtons();
    }
    window.addEventListener('appinstalled', function () {
      try { localStorage.setItem('dr119_app_installed', '1'); } catch (e) {}
      hideInstallButtons();
    });
  })();
})();
