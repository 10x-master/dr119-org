# Dr.119 플랫폼 기반 신규 브랜드·멀티 도메인 사이트 복제 매뉴얼

이 문서는 **Dr.119 (`dr119.org`)** 원본 프로젝트를 그대로 복제하여 **새로운 도메인·새 브랜드·타 업종 사이트를 순서대로 구축하는 매뉴얼**입니다.

> [!NOTE]
> **복제해야 할 원본 저장소 위치**
> - **GitHub 원격 저장소:** `https://github.com/10x-master/dr119-org`
> - **로컬 PC 원본 폴더:** [c:/work/dr119-org](file:///c:/work/dr119-org)
> - **워드 문서 파일:** [신규_브랜드_사이트_복제_매뉴얼.docx](file:///c:/work/dr119-org/%EC%8B%A0%EA%B7%9C_%EB%B8%8C%EB%9E%9C%EB%93%9C_%EC%82%AC%EC%9D%B4%ED%8A%B8_%EB%B3%B5%EC%A0%9C_%EB%A7%A4%EB%89%B4%EC%96%BC.docx) / [신규_브랜드_사이트_복제_매뉴얼.doc](file:///c:/work/dr119-org/%EC%8B%A0%EA%B7%9C_%EB%B8%8C%EB%9E%9C%EB%93%9C_%EC%82%AC%EC%9D%B4%ED%8A%B8_%EB%B3%B5%EC%A0%9C_%EB%A7%A4%EB%89%B4%EC%96%BC.doc)

---

```mermaid
flowchart LR
  S1["1단계: GitHub 원본 저장소 통째로 복제"] --> S2["2단계: site-config.json 수정"]
  S2 --> S3["3단계: node clone-site.mjs 자동 변환 실행"]
  S3 --> S4["4단계: DB(Supabase)·쇼츠 분리 (선택)"]
  S4 --> S5["5단계: GitHub Push 및 새 도메인 DNS 연결"]
```

---

## 1단계. GitHub 원본 저장소 통째로 복제하기

1. 브라우저에서 `https://github.com/10x-master/dr119-org/settings` 에 접속해 **Template repository** 체크박스를 켭니다. *(최초 1회만 설정)*
2. `https://github.com/10x-master/dr119-org` 우측 상단의 녹색 **`Use this template` → `Create a new repository`** 버튼을 눌러 새 저장소 이름으로 통째로 복제합니다.
3. 내 PC로 내려받으려면 PowerShell 터미널에서 다음을 실행합니다.
```powershell
git clone https://github.com/10x-master/<새저장소이름>.git
cd <새저장소이름>
```
*(이미 내 PC의 [c:/work/dr119-org](file:///c:/work/dr119-org) 폴더에서 바로 새 폴더로 찍어내려면 3단계의 `--out` 옵션을 사용하세요.)*

---

## 2단계. 복제된 폴더의 `site-config.json` 수정하기

복제한 폴더 맨 바깥(루트)에 있는 [site-config.json](file:///c:/work/dr119-org/site-config.json) 파일을 메모장·VS Code·Antigravity로 열어 아래 값을 새 사이트 정보로 수정 후 저장합니다.

| 설정 키 | 설명 | Dr.119 기본값 | 새 사이트 입력 예시 |
|---|---|---|---|
| `domain` | 연결할 새 도메인 (`CNAME` 자동 생성) | `dr119.org` | `cleanfix119.kr` |
| `siteUrl` | 대표 URL (끝 `/` 포함) | `https://dr119.org/` | `https://cleanfix119.kr/` |
| `brand.code` / `nameKo` | 영문 로고 / 한글 브랜드명 | `Dr.119` / `닥터119` | `Fix.119` / `픽스119` |
| `brand.primaryColor` | 메인 포인트 컬러 | `#a50034` | `#0f4c81` |
| `service.category` | 수리·취급 대상 기종 | `초음파 세척기` | `업소용 식기세척기` |
| `contact.mainPhone` | 헤더·푸터 대표 전화번호 | `1661-0783` | `1588-0119` |
| `contact.csPhone` | 고객센터 직통번호 | `010-5553-8250` | `010-1234-5678` |
| `company.*` | 법인명, CEO, 사업자번호, 주소 | `주식회사 웰글로벌 / 최광웅` | 새 사업자 정보 입력 |

---

## 3단계. 자동 변환 스크립트 실행하기 (`node clone-site.mjs`)

복제한 폴더에서 PowerShell 터미널을 열고 [clone-site.mjs](file:///c:/work/dr119-org/clone-site.mjs) 를 실행합니다.

```powershell
# 1) 수정될 항목 수 미리 확인 (실제 파일 변경 없음)
node clone-site.mjs --dry-run

# 2) 복제된 폴더의 site-config.json 내용을 전체 파일에 즉시 반영
node clone-site.mjs --in-place --config .\site-config.json

# (참고) c:\work\dr119-org 원본에서 아예 새 폴더로 한 번에 찍어낼 때:
node clone-site.mjs --config .\my-site.json --out ..\my-new-site
```

실행 즉시 `index.html`, `partner.html`, `admin.html`, `manifest.webmanifest`, `style.css`, `dr119-core.js`, `script.js`, 로고 SVG 및 `CNAME` 파일이 일괄 변환됩니다.

---

## 4단계. DB(Supabase) 및 홍보 쇼츠 분리 *(필요 시 선택)*

- **DB 분리:** 새 Supabase 프로젝트를 만든 뒤 [schema.sql](file:///c:/work/dr119-org/schema.sql) 을 SQL Editor에서 실행하고, `site-config.json`의 `supabase.url`·`anonKey`를 교체한 뒤 3단계를 다시 실행합니다.
- **유튜브 쇼츠 재생성:** [shorts/make-tts.ps1](file:///c:/work/dr119-org/shorts/make-tts.ps1) 과 [shorts/build-shorts.mjs](file:///c:/work/dr119-org/shorts/build-shorts.mjs) 의 상호·전화번호 문구를 새 브랜드로 바꿔 실행합니다.

---

## 5단계. GitHub 업로드 및 새 도메인 연결하기

1. 변환된 파일을 새 GitHub 저장소에 올립니다.
```powershell
git add .
git commit -m "새 브랜드 도메인 설정 적용"
git push origin main
```
2. GitHub 저장소 `Settings → Pages → Source` 를 **`GitHub Actions`** 로 선택합니다([deploy.yml](file:///c:/work/dr119-org/.github/workflows/deploy.yml) 자동 배포).
3. 도메인 구입처(가비아·카페24 등) DNS 관리에 아래 레코드를 넣고, GitHub Pages `Custom domain`에 새 도메인 입력 + **`Enforce HTTPS`** 를 켭니다.

| 레코드 타입 | 호스트(Host) | 연결 값(IP / 주소) | 비고 |
|---|---|---|---|
| `A` | `@` | `185.199.108.153` | GitHub Pages IP #1 |
| `A` | `@` | `185.199.109.153` | GitHub Pages IP #2 |
| `A` | `@` | `185.199.110.153` | GitHub Pages IP #3 |
| `A` | `@` | `185.199.111.153` | GitHub Pages IP #4 |
| `CNAME` | `www` | `10x-master.github.io` | `www.` 서브도메인 |
