# Dr.119 (dr119.org) Platform

전국망 초음파 세척기 수리·렌탈 플랫폼 **Dr.119**의 초경량 프론트엔드(Pure HTML/CSS/Vanilla JS) 및 DB 스키마 저장소입니다.

## 배포 페이지 (GitHub Pages)

- **라이브 URL:** https://10x-master.github.io/dr119-org/
- **Phase 1 — B2C 간편 접수 (고객용):** [`index.html`](https://10x-master.github.io/dr119-org/index.html?agent_id=SEOUL_01)
- **Phase 2 — B2B 본사 관리자 (Super Admin):** [`admin.html`](https://10x-master.github.io/dr119-org/admin.html)
- **Phase 3 — 지역 총판·닥터 대시보드 (Partner):** [`partner.html`](https://10x-master.github.io/dr119-org/partner.html?partner_id=DIST_SEOUL)

## 핵심 비즈니스 로직 (`dr119-core.js`)

1. **영업사원 QR 파라미터 추적 (First-touch Attribution):** 접속 URL의 `?agent_id=`를 파싱해 최초 유입 값을 `localStorage` 및 폼 hidden 필드에 고정(Lock-in)하고, 폼 제출 시 JSON으로 전송합니다.
2. **40만 원 정액제 배분 계산기:** 고객 결제 총액 `400,000원`에서 본사 입력 '실제 발생 화물비'를 차감해 `설치 공임비 = 400,000 − 화물비`를 자동 계산 및 확정합니다.
3. **B2B 총판 자동 정산 (Split Settlement):** 총판별 설치 공임비와 크로스셀링 부가 마진 수수료를 합산하고 본사 차감액(페널티)을 반영하여 세금계산서용 CSV(`UTF-8 BOM`)로 내보냅니다.

## SQL 스키마 (`schema.sql`)

- [`schema.sql`](./schema.sql): PostgreSQL / Supabase / SQLite 호환 DDL 및 시드 데이터(`distributors`, `agents`, `orders`, `margins`, `contracts`, `penalties`).
- `orders` 테이블에는 `freight_cost BETWEEN 0 AND 400000 AND labor_fee = 400000 - freight_cost` CHECK 제약이 적용되어 있습니다.

## 테스트 실행

```bash
# 단위 테스트 및 schema.sql 실행 검증 (Node 24+)
node --test tests/

# 헤드리스 브라우저 E2E 테스트 (Phase 1 -> 2 -> 3 순서로 실행)
node tests/e2e-phase1.mjs
node tests/e2e-phase2.mjs
node tests/e2e-phase3.mjs
```
