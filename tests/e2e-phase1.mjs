// Phase 1 E2E: QR 귀속 → 사진 업로드 → 연락처 → 옵션 → 제출 → JSON 콘솔 출력 검증
// 실행: node tests/e2e-phase1.mjs
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchBrowser, makePng, check, ROOT } from './cdp.mjs';

const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const img = path.join(OUT, 'broken-part.png');
const vid = path.join(OUT, 'broken-part.mp4');
makePng(img, 2000, 1500, [200, 30, 30]);
fs.writeFileSync(vid, Buffer.alloc(2048, 7));

const { srv, base } = await startServer();
const { cdp, close } = await launchBrowser();
const R = [];
try {
  await cdp.viewport(390, 844, true);
  console.log('▶ Phase 1 — B2C 접수 페이지');

  // 1) QR 첫 접속 + 올 화이트 + SEO/AEO + 3대 기관 배너 + 가격 미노출 검증
  await cdp.goto(`${base}/index.html?agent_id=seoul_01`);
  check(R, 'URL agent_id 파싱 → hidden 필드 주입', (await cdp.eval(`document.getElementById('agent_id').value`)) === 'SEOUL_01');
  check(R, 'JSON-LD LocalBusiness + Service + HowTo + FAQPage 스키마 존재', await cdp.eval(`(() => { const t=[...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent)['@type']); return t.includes('LocalBusiness') && t.includes('Service') && t.includes('HowTo') && t.includes('FAQPage'); })()`));
  const designAudit = await cdp.eval(`(() => {
    const t = document.body.innerText;
    const kw = document.querySelector('meta[name="keywords"]')?.content || '';
    return {
      bgBody: getComputedStyle(document.body).backgroundColor,
      bgHead: getComputedStyle(document.querySelector('.site-header')).backgroundColor,
      priceLeak: /40만|400,000|착불/.test(t),
      banners: t.includes('한국AI인테리어공간협회') && t.includes('중소기업사업전환지원단') && t.includes('투데이 플랫폼'),
      excludesOrion: !t.includes('오리온이앤에스') && !kw.includes('오리온'),
      noAiLabels: !/Transparent Cost|HQ Quality|Customer Protection|Answer Engine|SYSTEM 01|POLICY 01|PARTNER TRACK|COOPERATIVE & SUPPORT/i.test(t),
      noEmojis: !/[📸🖼️🎙️⏹️]/.test(t),
      hasBlueprint: !!document.querySelector('.washer-blueprint'),
      controls: !!(document.getElementById('camera-media') && document.getElementById('symptom_note') && document.getElementById('voice-btn') && document.getElementById('kakao-sync-btn')),
      kwLen: kw.length
    };
  })()`);
  check(R, '올 화이트 + 가격 미노출 + 3대 배너(오리온 제외) + 탈AI/도면 + 카메라/음성/카카오 + SEO',
    designAudit.bgBody === 'rgb(255, 255, 255)' && designAudit.bgHead === 'rgb(255, 255, 255)' &&
    !designAudit.priceLeak && designAudit.banners && designAudit.excludesOrion &&
    designAudit.noAiLabels && designAudit.noEmojis && designAudit.hasBlueprint &&
    designAudit.controls && designAudit.kwLen > 120,
    JSON.stringify(designAudit));
  await cdp.screenshot(path.join(OUT, 'phase1-form.png'));

  // Desktop 1366x768 '한 페이지(1 viewport)' 확인 + "초음파 세척기 고장" 문구 확인
  await cdp.viewport(1366, 768, false);
  const desktopCheck = await cdp.eval(`(() => {
    const h1 = document.getElementById('hero-title').innerText;
    const h2 = document.getElementById('form-title').innerText;
    const btnBottom = document.getElementById('submit-btn').getBoundingClientRect().bottom;
    return { hasUltrasoundHeading: h1.includes('초음파 세척기 고장') && h2.includes('초음파 세척기 고장'), btnBottom };
  })()`);
  check(R, 'PC 1페이지(한 화면 768px) 수용 + "초음파 세척기 고장" 문구 확인',
    desktopCheck.hasUltrasoundHeading && desktopCheck.btnBottom <= 768,
    JSON.stringify(desktopCheck));
  await cdp.screenshot(path.join(OUT, 'phase1-desktop.png'));
  await cdp.viewport(390, 844, true);

  // 2) 다른 QR로 재접속 → First-touch 유지
  await cdp.goto(`${base}/index.html?agent_id=BUSAN_01`);
  check(R, 'First-touch Lock-in (BUSAN_01 재접속에도 SEOUL_01 유지)', (await cdp.eval(`document.getElementById('agent_id').value`)) === 'SEOUL_01');

  // 3) 빈 제출 → 검증 에러
  await cdp.eval(`document.getElementById('submit-btn').click()`);
  check(R, '필수값 누락 시 제출 차단', await cdp.eval(`!!document.getElementById('media-error').textContent && !!document.getElementById('phone-error').textContent && document.getElementById('done').hidden`));

  // 4) 정상 제출 (방문 설치)
  await cdp.setFiles('#media', [img, vid]);
  check(R, '사진/영상 미리보기 2건', (await cdp.eval(`document.querySelectorAll('#preview li').length`)) === 2);
  await cdp.eval(`(() => { const p=document.getElementById('phone'); p.value='01012345678'; p.dispatchEvent(new Event('input')); })()`);
  check(R, '연락처 자동 하이픈', (await cdp.eval(`document.getElementById('phone').value`)) === '010-1234-5678');
  const payload = await cdp.eval(`new Promise(r => { addEventListener('dr119:submitted', e => r(e.detail), { once: true }); document.getElementById('submit-btn').click(); })`);
  check(R, 'payload.attribution.agent_id = SEOUL_01', payload.attribution.agent_id === 'SEOUL_01' && payload.attribution.model === 'FIRST_TOUCH');
  check(R, 'payload.service = DOCTOR_VISIT / 400,000 / 화물비 포함', payload.service.type === 'DOCTOR_VISIT' && payload.service.fixed_price === 400000 && payload.service.freight_payment === 'INCLUDED');
  check(R, 'payload.customer.phone', payload.customer.phone === '010-1234-5678');
  const [m1, m2] = payload.media;
  check(R, '사진 base64 포함 + 1280px 리사이즈', m1.data_url.startsWith('data:image/jpeg;base64,') && m1.width === 2000, `원본 ${m1.width}x${m1.height}, ${m1.data_url.length}B`);
  check(R, '영상 base64 포함', m2.type === 'video/mp4' && m2.data_url.startsWith('data:video/mp4;base64,'));
  const consoleJson = cdp.logs.find((l) => l.type === 'log' && l.text.trim().startsWith('{'));
  check(R, '콘솔에 JSON payload 출력', consoleJson && JSON.parse(consoleJson.text).order_id === payload.order_id);
  check(R, '접수 완료 화면 표시', await cdp.eval(`!document.getElementById('done').hidden && document.getElementById('done-order-id').textContent === ${JSON.stringify(payload.order_id)}`));
  await cdp.screenshot(path.join(OUT, 'phase1-done.png'));

  // 5) 직접 수령 옵션 + 증상 메모 + 카카오 1초 간편 등록
  await cdp.eval(`document.getElementById('again-btn').click()`);
  await cdp.setFiles('#media', [img]);
  await cdp.eval(`(() => {
    document.getElementById('symptom_note').value = '초음파 소리가 약하고 물이 샘';
    document.getElementById('kakao-sync-btn').click();
    const kp = document.getElementById('kakao-phone-input');
    kp.value = '01098765432';
    kp.dispatchEvent(new Event('input'));
    document.getElementById('kakao-confirm-btn').click();
    document.querySelector('input[value=SELF_PICKUP]').checked = true;
  })()`);
  const p2 = await cdp.eval(`new Promise(r => { addEventListener('dr119:submitted', e => r(e.detail), { once: true }); document.getElementById('submit-btn').click(); })`);
  check(R, '직접 수령: SELF_PICKUP / 착불(COD) / agent + note + KAKAO 유지',
    p2.service.type === 'SELF_PICKUP' && p2.service.freight_payment === 'COD' &&
    p2.attribution.agent_id === 'SEOUL_01' &&
    p2.customer.note === '초음파 소리가 약하고 물이 샘' && p2.customer.auth_provider === 'KAKAO');

  // 6) 파트너(지역 센터/수리 닥터) 가입 상담 저장 확인
  await cdp.eval(`(() => {
    document.getElementById('pa-role').value = 'LOCAL_CENTER';
    document.getElementById('pa-name').value = '대구중앙센터';
    document.getElementById('pa-region').value = '대구광역시';
    const pp = document.getElementById('pa-phone'); pp.value = '01033334444'; pp.dispatchEvent(new Event('input'));
    document.querySelector('#partner-apply-form button[type=submit]').click();
  })()`);
  const leads = await cdp.eval(`JSON.parse(localStorage.getItem('dr119_partner_leads') || '[]')`);
  check(R, '파트너 가입 신청 저장 (dr119_partner_leads)', leads.length === 1 && leads[0].role === 'LOCAL_CENTER' && leads[0].phone === '010-3333-4444');

  // 6) Mock API 저장 확인 (원본 제거, 썸네일만)
  const stored = await cdp.eval(`JSON.parse(localStorage.getItem('dr119_orders'))`);
  check(R, 'Mock API 저장 2건 + 총판 자동 매핑(DIST_SEOUL)', stored.length === 2 && stored.every((o) => o.assigned_distributor_id === 'DIST_SEOUL' && o.status === 'RECEIVED'));
  check(R, '저장본은 원본 data_url 제거·썸네일 유지', stored.every((o) => o.media.every((m) => !('data_url' in m))) && stored[1].media[0].thumb_url.startsWith('data:image/jpeg'));

  fs.writeFileSync(path.join(OUT, 'phase1-payload.json'), JSON.stringify({ ...payload, media: payload.media.map((m) => ({ ...m, data_url: m.data_url.slice(0, 60) + '…(생략)', thumb_url: m.thumb_url && m.thumb_url.slice(0, 60) + '…' })) }, null, 2));
  const errs = cdp.logs.filter((l) => l.type === 'exception' || l.type === 'error');
  check(R, 'JS 런타임 에러 없음', errs.length === 0, errs.map((e) => e.text).join(' | '));
} finally {
  await close(); srv.close();
}
const fail = R.filter((r) => !r.ok).length;
console.log(`\n결과: ${R.length - fail}/${R.length} 통과`);
process.exit(fail ? 1 : 0);
