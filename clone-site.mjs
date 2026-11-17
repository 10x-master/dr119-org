#!/usr/bin/env node
/**
 * Dr.119 템플릿 자동 복제·도메인/브랜드 치환 스크립트
 * ------------------------------------------------------------------
 * 사용 예시:
 *   1) 변경 내역 미리보기 (파일 수정 없음):
 *      node clone-site.mjs --dry-run
 *   2) 새 폴더로 다른 도메인·업종 사이트 복제:
 *      node clone-site.mjs --config ./my-brand.json --out ../my-brand-site
 *   3) 현재 폴더에 site-config.json 내용 즉시 반영:
 *      node clone-site.mjs --in-place --config ./site-config.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE = {
  domain: 'dr119.org',
  siteUrl: 'https://dr119.org/',
  brand: {
    code: 'Dr.119',
    prefix: 'Dr.',
    highlight: '119',
    nameKo: '닥터119',
    tagline: '초음파 세척계의 공임나라',
    primaryColor: '#a50034',
    primaryDarkColor: '#820027',
    primaryBrightColor: '#ea1917',
  },
  service: {
    category: '초음파 세척기',
    headerTitle: '초음파 세척기 수리 접수',
    itemKeywords: '업소용·싱크볼 초음파 세척기',
  },
  contact: {
    mainPhone: '1661-0783',
    csPhone: '010-5553-8250',
    email: 'cyshop@naver.com',
    kakaoLabel: '웰글로벌 카톡',
    kakaoChannelName: '웰글로벌 카톡채널 상담',
    kakaoUrl: 'http://pf.kakao.com/_wellglobal',
  },
  company: {
    orgName: '중소기업사업지원단',
    corpName: '주식회사 웰글로벌',
    corpNameEn: 'Well Global',
    ceo: '최광웅',
    bizNo: '217-88-03660',
    address: '(11486) 경기도 양주시 삼숭로58번길 84-9 (삼숭동) D동 1층',
  },
  supabase: {
    url: 'https://acpibgztyugrcdrpiiuk.supabase.co',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjcGliZ3p0eXVncmNkcnBpaXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzQwMTcsImV4cCI6MjExMDI1MDAxN30._CJvLsBUjElopRVhDAKioa8Yj9GAOj1tsAfsvNXdgW4',
  },
};

const TARGET_FILES = [
  'index.html',
  'partner.html',
  'admin.html',
  'manifest.webmanifest',
  'style.css',
  'admin.css',
  'dr119-core.js',
  'script.js',
  'partner.js',
  'admin.js',
  'sw.js',
  'icons/dr119-logo.svg',
];

function parseArgs(argv) {
  const opts = {
    configPath: path.join(HERE, 'site-config.json'),
    outDir: '',
    inPlace: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1]) opts.configPath = path.resolve(argv[++i]);
    else if (a === '--out' && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === '--in-place') opts.inPlace = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function deepMerge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function buildReplacementPairs(base, next) {
  // 긴 문자열·구체적 마크업을 먼저 치환해야 부분 치환 충돌이 발생하지 않음
  const pairs = [
    [base.siteUrl, next.siteUrl],
    ...(next.siteUrl !== base.siteUrl ? [['https://10x-master.github.io/dr119-org/', next.siteUrl]] : []),
    [`${base.brand.prefix}<strong>${base.brand.highlight}</strong>`, `${next.brand.prefix}<strong>${next.brand.highlight}</strong>`],
    [`${base.brand.prefix}<b>${base.brand.highlight}</b>`, `${next.brand.prefix}<b>${next.brand.highlight}</b>`],
    [base.service.headerTitle, next.service.headerTitle],
    [base.service.itemKeywords, next.service.itemKeywords],
    [base.brand.tagline, next.brand.tagline],
    [base.service.category, next.service.category],
    [base.contact.kakaoChannelName, next.contact.kakaoChannelName],
    [base.contact.kakaoLabel, next.contact.kakaoLabel],
    [base.contact.kakaoUrl, next.contact.kakaoUrl],
    [base.company.address, next.company.address],
    [base.company.bizNo, next.company.bizNo],
    [base.company.corpName, next.company.corpName],
    [base.company.corpNameEn, next.company.corpNameEn],
    [base.company.orgName, next.company.orgName],
    [base.company.ceo, next.company.ceo],
    [base.contact.mainPhone, next.contact.mainPhone],
    [base.contact.csPhone, next.contact.csPhone],
    [base.contact.email, next.contact.email],
    [base.brand.code, next.brand.code],
    [base.brand.nameKo, next.brand.nameKo],
    [base.domain, next.domain],
    [base.supabase.url, next.supabase.url],
    [base.supabase.anonKey, next.supabase.anonKey],
    [base.brand.primaryColor, next.brand.primaryColor],
    [base.brand.primaryDarkColor, next.brand.primaryDarkColor],
    [base.brand.primaryBrightColor, next.brand.primaryBrightColor],
  ];
  return pairs.filter(([from, to]) => from && to && from !== to);
}

function copyDirClean(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const sp = path.join(src, ent.name);
    const dp = path.join(dst, ent.name);
    // tests/output 프로필 임시 디렉터리 제외
    if (sp.endsWith(path.join('tests', 'output'))) continue;
    if (ent.isDirectory()) copyDirClean(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.dryRun && !opts.outDir && !opts.inPlace)) {
    console.log(`
Dr.119 사이트 템플릿 복제기 (clone-site.mjs)
사용법:
  node clone-site.mjs --dry-run
  node clone-site.mjs --config ./my-site.json --out ../my-new-site
  node clone-site.mjs --in-place --config ./site-config.json
`);
    if (opts.help) process.exit(0);
    // 인자 없이 실행하면 안내만 출력하고 안전 종료
    process.exit(0);
  }

  if (!fs.existsSync(opts.configPath)) {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${opts.configPath}`);
  }
  const userCfg = JSON.parse(fs.readFileSync(opts.configPath, 'utf8'));
  const nextCfg = deepMerge(DEFAULT_BASE, userCfg);
  const pairs = buildReplacementPairs(DEFAULT_BASE, nextCfg);

  const workDir = opts.outDir || HERE;
  if (!opts.dryRun && opts.outDir) {
    if (path.resolve(opts.outDir) === path.resolve(HERE)) {
      throw new Error('--out 경로는 원본 폴더와 달라야 합니다.');
    }
    copyDirClean(HERE, opts.outDir);
    fs.writeFileSync(path.join(opts.outDir, 'site-config.json'), JSON.stringify(nextCfg, null, 2));
  }

  let totalHits = 0;
  const fileReport = [];
  for (const rel of TARGET_FILES) {
    const srcFile = path.join(opts.dryRun ? HERE : workDir, rel);
    if (!fs.existsSync(srcFile)) continue;
    let content = fs.readFileSync(srcFile, 'utf8');
    let hits = 0;
    for (const [from, to] of pairs) {
      if (content.includes(from)) {
        const parts = content.split(from);
        hits += parts.length - 1;
        content = parts.join(to);
      }
    }
    if (!opts.dryRun && hits > 0) {
      fs.writeFileSync(srcFile, content, 'utf8');
    }
    totalHits += hits;
    fileReport.push({ file: rel, hits });
  }

  // GitHub Pages 용 CNAME 자동 생성
  const cnameContent = `${nextCfg.domain}\n`;
  if (!opts.dryRun) {
    fs.writeFileSync(path.join(workDir, 'CNAME'), cnameContent, 'utf8');
  }

  console.log(`=== Dr.119 템플릿 복제 ${opts.dryRun ? '(미리보기 --dry-run)' : '완료'} ===`);
  console.log(`대상 경로: ${workDir}`);
  console.log(`도메인(CNAME): ${nextCfg.domain}`);
  console.log(`활성 치환 규칙: ${pairs.length}개 | 총 치환 건수: ${totalHits}건`);
  for (const r of fileReport) {
    console.log(`  - ${r.file.padEnd(24)} (${r.hits}건)`);
  }
  if (!opts.dryRun) {
    console.log(`  + CNAME                    (생성: ${nextCfg.domain})`);
  }
}

main();
