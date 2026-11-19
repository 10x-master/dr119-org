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
      excludesOrion: t.includes('삼숭로58번길') && t.includes('1661-0783'),
      noAiLabels: !/Transparent Cost|HQ Quality|Customer Protection|Answer Engine|SYSTEM 01|POLICY 01|PARTNER TRACK|COOPERATIVE & SUPPORT/i.test(t),
      noEmojis: !/[📸🖼️🎙️⏹️]/.test(t),
      hasBlueprint: !!document.querySelector('.washer-blueprint'),
      controls: !!(document.getElementById('camera-media') && document.getElementById('symptom_note') && document.getElementById('voice-btn') && document.getElementById('kakao-sync-btn') && document.getElementById('region') && !document.querySelector('input[name="service_type"]') && document.getElementById('floating-install-btn') && document.querySelector('link[rel="manifest"]')),
      footerOrgs: t.includes('중소기업사업지원단') && t.includes('주식회사 웰글로벌'),
      companyInfo: t.includes('최광웅') && t.includes('217-88-03660') && t.includes('삼숭로58번길 84-9') && t.includes('1661-0783') && t.includes('010-5553-8250'),
      mobileHeader: (() => {
        const logo = document.querySelector('.site-header .brand')?.getBoundingClientRect();
        const mTitle = document.querySelector('.mobile-header-title')?.getBoundingClientRect();
        const phone = document.querySelector('.header-phone')?.getBoundingClientRect();
        const ham = document.getElementById('mobile-menu-btn')?.getBoundingClientRect();
        const head = document.querySelector('.site-header')?.getBoundingClientRect();
        return !!(logo && mTitle && phone && ham && head &&
          logo.width > 0 && mTitle.width > 0 && phone.width > 0 && ham.width > 0 &&
          logo.left < mTitle.left && mTitle.left < phone.left && phone.left < ham.left &&
          head.height <= 56);
      })(),
      mobileFirstScreen: (() => {
        const intake = document.querySelector('.intake-col')?.getBoundingClientRect();
        const hero = document.querySelector('.hero')?.getBoundingClientRect();
        const sub = document.getElementById('submit-btn')?.getBoundingClientRect();
        const bar = document.getElementById('mobile-bottom-bar')?.getBoundingClientRect();
        const headerPhone = document.querySelector('.header-phone')?.innerText || '';
        return {
          intakeAboveHero: !!(intake && hero && intake.top < hero.top),
          subBottom: sub?.bottom || 9999,
          barTop: bar?.top || 844,
          fitsInFirstScreen: !!(sub && bar && sub.bottom <= bar.top + 1),
          noDuplicateIntakeHead: !document.querySelector('.intake-head') && !document.getElementById('form-title') && !document.querySelector('.intake-phone'),
          noGrayDividerLines: getComputedStyle(document.querySelector('.site-header')).borderBottomWidth === '0px' && getComputedStyle(document.querySelector('.top-stage')).borderBottomWidth === '0px',
          hasHeaderPhone: headerPhone.includes('1661-0783')
        };
      })(),
      symptomBoxRedMic: (() => {
        const wrap = document.querySelector('.symptom-input-wrap');
        const badge = document.querySelector('.mic-red-badge');
        const hasBoth = !!(wrap && wrap.querySelector('#symptom_note') && wrap.querySelector('#voice-btn') && badge);
        const redBg = badge ? getComputedStyle(badge).backgroundColor : '';
        return hasBoth && redBg === 'rgb(234, 25, 23)';
      })(),
      witBg: getComputedStyle(document.querySelector('.hero-wit')).backgroundColor,
      orgTopBorder: getComputedStyle(document.querySelector('.org-banner')).borderTopWidth,
      kwLen: kw.length
    };
  })()`);
  check(R, '올 화이트 + 가격 미노출 + 3대 배너 + 모바일 헤더/1화면 + 상단중복·그레이선 제거 + 빨간 마이크',
    designAudit.bgBody === 'rgb(255, 255, 255)' && designAudit.bgHead === 'rgb(255, 255, 255)' &&
    !designAudit.priceLeak && designAudit.banners && designAudit.excludesOrion &&
    designAudit.noAiLabels && designAudit.noEmojis && designAudit.hasBlueprint &&
    designAudit.controls && designAudit.footerOrgs && designAudit.companyInfo &&
    designAudit.mobileHeader && designAudit.mobileFirstScreen.intakeAboveHero &&
    designAudit.mobileFirstScreen.fitsInFirstScreen && designAudit.mobileFirstScreen.noDuplicateIntakeHead &&
    designAudit.mobileFirstScreen.noGrayDividerLines && designAudit.mobileFirstScreen.hasHeaderPhone &&
    designAudit.symptomBoxRedMic && designAudit.orgTopBorder === '1px' && designAudit.kwLen > 120,
    JSON.stringify(designAudit));
  const hamburgerWorks = await cdp.eval(`(() => {
    const btn = document.getElementById('mobile-menu-btn');
    const nav = document.getElementById('header-nav');
    btn.click();
    const opened = nav.classList.contains('is-open') && btn.getAttribute('aria-expanded') === 'true' && nav.getBoundingClientRect().height > 0;
    btn.click();
    const closed = !nav.classList.contains('is-open') && btn.getAttribute('aria-expanded') === 'false';
    return opened && closed;
  })()`);
  check(R, '모바일 햄버거 메뉴 열기/닫기 동작', hamburgerWorks);
  await cdp.screenshot(path.join(OUT, 'phase1-form.png'));

  // Desktop 1366x768 '한 페이지(1 viewport)' 확인 + 접수카드 상단 2줄 삭제 확인
  await cdp.viewport(1366, 768, false);
  const desktopCheck = await cdp.eval(`(() => {
    const h1 = document.getElementById('hero-title').innerText;
    const intakeHeadRemoved = !document.querySelector('.intake-head') && !document.getElementById('form-title') && !document.querySelector('.intake-phone');
    const btnBottom = document.getElementById('submit-btn').getBoundingClientRect().bottom;
    const stripRect = document.querySelector('.b2b-apply-strip').getBoundingClientRect();
    const b2bBtnRect = document.querySelector('.b2b-submit').getBoundingClientRect();
    return {
      hasUltrasoundHeading: h1.includes('초음파 세척기 고장') && intakeHeadRemoved,
      btnBottom,
      b2bFits: b2bBtnRect.right <= stripRect.right - 8
    };
  })()`);
  check(R, 'PC 1페이지(한 화면 768px) 수용 + "초음파 세척기 고장" 문구 + 파트너 폼 내부 수용',
    desktopCheck.hasUltrasoundHeading && desktopCheck.btnBottom <= 768 && desktopCheck.b2bFits,
    JSON.stringify(desktopCheck));
  await cdp.screenshot(path.join(OUT, 'phase1-desktop.png'));
  await cdp.viewport(390, 844, true);

  // 2) 다른 QR로 재접속 → First-touch 유지
  await cdp.goto(`${base}/index.html?agent_id=BUSAN_01`);
  check(R, 'First-touch Lock-in (BUSAN_01 재접속에도 SEOUL_01 유지)', (await cdp.eval(`document.getElementById('agent_id').value`)) === 'SEOUL_01');

  // 3) 빈 제출 → 검증 에러
  await cdp.eval(`document.getElementById('submit-btn').click()`);
  check(R, '필수값 누락 시 제출 차단', await cdp.eval(`!!document.getElementById('media-error').textContent && !!document.getElementById('phone-error').textContent && !!document.getElementById('region-error').textContent && document.getElementById('done').hidden`));

  // 4) 정상 제출 (방문 설치)
  await cdp.setFiles('#media', [img, vid]);
  check(R, '사진/영상 미리보기 2건', (await cdp.eval(`document.querySelectorAll('#preview li').length`)) === 2);
  await cdp.eval(`(() => { const p=document.getElementById('phone'); p.value='01012345678'; p.dispatchEvent(new Event('input')); const rg=document.getElementById('region'); rg.value='서울 강남구'; rg.dispatchEvent(new Event('input')); })()`);
  check(R, '연락처 자동 하이픈', (await cdp.eval(`document.getElementById('phone').value`)) === '010-1234-5678');
  const payload = await cdp.eval(`new Promise(r => { addEventListener('dr119:submitted', e => r(e.detail), { once: true }); document.getElementById('submit-btn').click(); })`);
  check(R, 'payload.attribution.agent_id = SEOUL_01', payload.attribution.agent_id === 'SEOUL_01' && payload.attribution.model === 'FIRST_TOUCH');
  check(R, 'payload.service = DOCTOR_VISIT / 400,000 / 화물비 포함', payload.service.type === 'DOCTOR_VISIT' && payload.service.fixed_price === 400000 && payload.service.freight_payment === 'INCLUDED');
  check(R, 'payload.customer.phone + region', payload.customer.phone === '010-1234-5678' && payload.customer.region === '서울 강남구');
  const [m1, m2] = payload.media;
  check(R, '사진 base64 포함 + 1280px 리사이즈', m1.data_url.startsWith('data:image/jpeg;base64,') && m1.width === 2000, `원본 ${m1.width}x${m1.height}, ${m1.data_url.length}B`);
  check(R, '영상 base64 포함', m2.type === 'video/mp4' && m2.data_url.startsWith('data:video/mp4;base64,'));
  const consoleJson = cdp.logs.find((l) => l.type === 'log' && l.text.trim().startsWith('{'));
  check(R, '콘솔에 JSON payload 출력', consoleJson && JSON.parse(consoleJson.text).order_id === payload.order_id);
  check(R, '접수 완료 화면 및 수리 진행 프로세스 안내 표시', await cdp.eval(`(() => {
    const done = document.getElementById('done');
    const proc = document.querySelector('.done-process');
    const again = document.getElementById('again-btn')?.getBoundingClientRect();
    const bar = document.getElementById('mobile-bottom-bar')?.getBoundingClientRect();
    return !done.hidden && document.getElementById('done-order-id').textContent === ${JSON.stringify(payload.order_id)} &&
      !!proc && proc.innerText.includes('접수 후 수리 진행 프로세스 안내') && proc.innerText.includes('1661-0783') &&
      !!(again && bar && again.bottom <= bar.top + 1);
  })()`));
  await cdp.screenshot(path.join(OUT, 'phase1-done.png'));

  // 5) 지역 + 증상 메모 + 카카오 1초 간편 등록
  await cdp.eval(`document.getElementById('again-btn').click()`);
  await cdp.setFiles('#media', [img]);
  await cdp.eval(`(() => {
    document.getElementById('symptom_note').value = '초음파 소리가 약하고 물이 샘';
    document.getElementById('kakao-sync-btn').click();
    const kp = document.getElementById('kakao-phone-input');
    kp.value = '01098765432';
    kp.dispatchEvent(new Event('input'));
    document.getElementById('kakao-confirm-btn').click();
    const rg = document.getElementById('region');
    rg.value = '부산 해운대구';
    rg.dispatchEvent(new Event('input'));
  })()`);
  const p2 = await cdp.eval(`new Promise(r => { addEventListener('dr119:submitted', e => r(e.detail), { once: true }); document.getElementById('submit-btn').click(); })`);
  check(R, '지역·증상 메모·카카오 1초 간편 등록 유지',
    p2.service.type === 'DOCTOR_VISIT' &&
    p2.customer.region === '부산 해운대구' &&
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
