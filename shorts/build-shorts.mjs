// Dr.119 초음파 세척기 수리센터 유튜브 쇼츠 자동 제작 빌더
// - 실시간 모바일 화면 캡처(index.html) + 채널톡 리뷰/고맙다 캡처 3종 PNG 생성
// - Chrome WebCodecs(avc1.42002a H.264 + mp4a.40.2 AAC) & ISO-BMFF faststart MP4 먹서로 1080x1920 MP4 출력
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startServer, sleep } from '../tests/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSETS = path.join(HERE, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ─── 1. 채널톡(ChannelTalk) 실제 상담 스타일 리뷰 & "고맙다" 캡처 3종 HTML 템플릿 ───
const REVIEWS = [
  {
    id: 1,
    file: 'channeltalk-review-1.png',
    date: '2026년 11월 12일 목요일',
    store: '서울 마포구 · OO한우곰탕 사장님',
    badge: '타사 부도 기기 복원 완료 · 진동자/발진기 교체',
    agent: 'Dr.119 본사 직할 수리팀',
    photoTitle: '초음파 수조 복원 전 → 후',
    photoSub: '진동자 24구 + 발진기 실비 교체 완료',
    messages: [
      {
        text: '원장님! 타사 브랜드 제조사 부도나서 AS도 안 되고, 딴 데서 200만 원 부르길래 그냥 대파 씻는 비싼 물통으로 방치하고 있었어요 😭',
        time: '오후 2:11',
      },
      {
        text: '근데 닥터119에서 진동자·발진기 부품 원가표 그대로 공개해주시고 표준 공임만 받아서 새 기계처럼 살려주셨네요!!',
        time: '오후 2:12',
      },
      {
        highlight: '수백만 원 아꼈습니다! 사장님 진짜 너무 고맙습니다!! 🙏✨',
        time: '오후 2:12',
        reactions: '❤️ 18   👍 고맙다 후기',
      },
    ],
    reply: '감사합니다 사장님! 😊 본사 전산 1년 AS 보증 등록 완료되었으니 앞으로 걱정 없이 영업하세요! (1661-0783)',
    replyTime: '오후 2:14',
  },
  {
    id: 2,
    file: 'channeltalk-review-2.png',
    date: '2026년 11월 13일 금요일',
    store: '부산 해운대 · OO활어횟집 사장님',
    badge: '사진 1장 + 빨간 마이크 접수 · 대체 기기 대여',
    agent: 'Dr.119 영남 수리 닥터팀',
    photoTitle: '모바일 빨간 마이크 1분 간편 접수',
    photoSub: '임시 대체 세척기 현장 무료 연계',
    messages: [
      {
        text: '장사 준비 때문에 전화 길게 못 했는데, 닥터119 모바일에서 고장 사진 한 장 찍고 빨간 마이크 눌러서 말로 증상 적으니 1분 만에 접수 끝났어요 👍',
        time: '오전 11:04',
      },
      {
        highlight: '수리하는 동안 설거지 마비될 뻔했는데 임시 대체 기기까지 빌려주셔서 정말 고맙습니다 닥터119!! 🔥',
        time: '오전 11:05',
        reactions: '❤️ 24   🙌 사장님 찐추천',
      },
    ],
    reply: '영업 공백 없으셔서 정말 다행입니다 사장님! 😊 언제든 사진 한 장·전화 한 통(1661-0783)이면 바로 달려갑니다!',
    replyTime: '오전 11:07',
  },
  {
    id: 3,
    file: 'channeltalk-review-3.png',
    date: '2026년 11월 14일 토요일',
    store: '경기 수원 · OO단체급식소 영양사님',
    badge: '다각도 검수 사진 · 부품 실비·화물비 투명 공개',
    agent: 'Dr.119 본사 팩토리 검수팀',
    photoTitle: '수거·출고 4면 다각도 검수 완료',
    photoSub: '부품 원가 내역서 & 합포장 화물 실비 정산',
    messages: [
      {
        text: '수거 전이랑 출고 전 다각도 사진 다 보내주시고, 부품 실비랑 왕복 합포장 화물비 내역서까지 투명하게 주셔서 내부 결재가 한 번에 났습니다.',
        time: '오후 4:38',
      },
      {
        highlight: '부품 직접 사도 공임만 맞춰주는 공임나라 방식이라 믿고 맡겼는데, 정직하게 고쳐주셔서 정말 고맙습니다! ❤️',
        time: '오후 4:39',
        reactions: '❤️ 31   ✅ 투명 실비 인증',
      },
    ],
    reply: '정직한 부품 실비와 표준 공임이 Dr.119의 원칙입니다. 🏥 오래오래 안전하게 사용하세요!',
    replyTime: '오후 4:41',
  },
];

function buildChannelTalkHtml(rev) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const msgHtml = rev.messages
    .map((m) => {
      if (m.highlight) {
        return `<div class="ct-row ct-cust">
          <div class="ct-bubble ct-bubble-hl">
            <span class="ct-mark">${esc(m.highlight)}</span>
            <div class="ct-react">${esc(m.reactions)}</div>
          </div>
          <span class="ct-time">읽음 1 · ${esc(m.time)}</span>
        </div>`;
      }
      return `<div class="ct-row ct-cust">
        <div class="ct-bubble">${esc(m.text)}</div>
        <span class="ct-time">읽음 1 · ${esc(m.time)}</span>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 860px; height: 1140px; overflow: hidden;
    background: transparent;
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
    color: #111827;
  }
  .ct-win {
    width: 860px; height: 1140px;
    background: #f5f6fa;
    border-radius: 38px;
    overflow: hidden;
    border: 3px solid #e2e8f0;
    box-shadow: 0 28px 64px rgba(15, 23, 42, 0.28);
    display: flex; flex-direction: column;
  }
  .ct-header {
    background: linear-gradient(135deg, #4f46e5 0%, #6d28d9 52%, #a50034 100%);
    color: #fff;
    padding: 28px 34px 24px;
  }
  .ct-head-top {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }
  .ct-brand {
    display: flex; align-items: center; gap: 16px;
  }
  .ct-avatar {
    width: 62px; height: 62px; border-radius: 20px;
    background: #ffffff; color: #a50034;
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 22px; box-shadow: 0 6px 16px rgba(0,0,0,0.2);
  }
  .ct-title { font-size: 27px; font-weight: 800; letter-spacing: -0.02em; }
  .ct-status {
    margin-top: 4px; font-size: 18px; color: #e0e7ff;
    display: flex; align-items: center; gap: 8px;
  }
  .ct-dot {
    width: 11px; height: 11px; border-radius: 50%;
    background: #4ade80; box-shadow: 0 0 0 4px rgba(74,222,128,0.3);
  }
  .ct-pill {
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.35);
    padding: 8px 16px; border-radius: 999px;
    font-size: 16px; font-weight: 700;
  }
  .ct-subbar {
    background: rgba(15, 23, 42, 0.22);
    border-radius: 16px; padding: 12px 18px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 18px; font-weight: 700;
  }
  .ct-badge {
    background: #fef08a; color: #713f12;
    padding: 5px 14px; border-radius: 999px;
    font-size: 15px; font-weight: 800;
  }
  .ct-body {
    flex: 1; padding: 16px 26px; display: flex; flex-direction: column; gap: 10px;
  }
  .ct-date {
    align-self: center;
    background: #e2e8f0; color: #475569;
    font-size: 15px; font-weight: 700;
    padding: 5px 16px; border-radius: 999px;
  }
  .ct-photo-card {
    align-self: flex-end;
    width: 540px;
    background: #ffffff; border: 2px solid #cbd5e1;
    border-radius: 20px; padding: 12px 16px;
    display: flex; align-items: center; gap: 14px;
    box-shadow: 0 6px 18px rgba(15,23,42,0.06);
  }
  .ct-photo-thumb {
    width: 78px; height: 78px; border-radius: 14px; flex-shrink: 0;
    background: linear-gradient(135deg, #ecfdf5, #d1fae5);
    border: 2px solid #10b981;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-size: 28px; color: #047857; font-weight: 900;
  }
  .ct-photo-thumb span { font-size: 12px; margin-top: 2px; }
  .ct-photo-title { font-size: 19px; font-weight: 800; color: #0f172a; }
  .ct-photo-sub { font-size: 15px; color: #475569; margin-top: 3px; }
  .ct-row { display: flex; flex-direction: column; max-width: 88%; gap: 4px; }
  .ct-cust { align-self: flex-end; align-items: flex-end; }
  .ct-agent { align-self: flex-start; align-items: flex-start; max-width: 90%; }
  .ct-agent-head {
    display: flex; align-items: center; gap: 10px;
    font-size: 16px; font-weight: 800; color: #334155;
  }
  .ct-mini-cross {
    width: 26px; height: 26px; border-radius: 8px;
    background: #a50034; color: #fff; font-weight: 900; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .ct-bubble {
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 22px 22px 6px 22px;
    padding: 13px 20px;
    font-size: 22px; line-height: 1.42; font-weight: 600;
    color: #0f172a;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  }
  .ct-bubble-hl {
    background: #fffbeb;
    border: 3px solid #f59e0b;
    box-shadow: 0 12px 28px rgba(245, 158, 11, 0.22);
  }
  .ct-mark {
    background: linear-gradient(180deg, transparent 42%, #fde047 42%, #fde047 96%, transparent 96%);
    font-weight: 900; font-size: 25px; color: #111827;
  }
  .ct-react {
    margin-top: 8px;
    display: inline-block;
    background: #fef3c7; border: 1.5px solid #fcd34d;
    color: #92400e; border-radius: 999px;
    padding: 3px 12px; font-size: 15px; font-weight: 800;
  }
  .ct-bubble-agent {
    background: #eef2ff;
    border: 2px solid #c7d2fe;
    border-radius: 6px 22px 22px 22px;
    padding: 13px 20px;
    font-size: 21px; line-height: 1.4; font-weight: 700;
    color: #1e1b4b;
  }
  .ct-time { font-size: 14px; color: #64748b; font-weight: 600; padding: 0 6px; }
  .ct-footer {
    background: #ffffff; border-top: 2px solid #e2e8f0;
    padding: 14px 26px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .ct-input {
    flex: 1; background: #f1f5f9; border-radius: 999px;
    padding: 14px 22px; font-size: 20px; color: #64748b; font-weight: 600;
  }
  .ct-send {
    margin-left: 14px;
    background: #5b46f6; color: #fff;
    padding: 14px 26px; border-radius: 999px;
    font-size: 20px; font-weight: 800;
  }
</style>
</head>
<body>
  <div class="ct-win">
    <div class="ct-header">
      <div class="ct-head-top">
        <div class="ct-brand">
          <div class="ct-avatar">Dr.119</div>
          <div>
            <div class="ct-title">Dr.119 초음파 수리센터 채널톡</div>
            <div class="ct-status"><span class="ct-dot"></span> 실제 고객 상담 · 빠른 응답 운영중 (1661-0783)</div>
          </div>
        </div>
        <div class="ct-pill">ChannelTalk</div>
      </div>
      <div class="ct-subbar">
        <span>🏪 ${esc(rev.store)}</span>
        <span class="ct-badge">${esc(rev.badge)}</span>
      </div>
    </div>

    <div class="ct-body">
      <div class="ct-date">${esc(rev.date)}</div>
      <div class="ct-photo-card">
        <div class="ct-photo-thumb">✓<span>검수완료</span></div>
        <div>
          <div class="ct-photo-title">${esc(rev.photoTitle)}</div>
          <div class="ct-photo-sub">${esc(rev.photoSub)}</div>
        </div>
      </div>
      ${msgHtml}
      <div class="ct-row ct-agent">
        <div class="ct-agent-head"><span class="ct-mini-cross">+</span> ${esc(rev.agent)}</div>
        <div class="ct-bubble-agent">${esc(rev.reply)}</div>
        <span class="ct-time">${esc(rev.replyTime)}</span>
      </div>
    </div>

    <div class="ct-footer">
      <div class="ct-input">📷 고장 사진 첨부 또는 궁금한 점을 입력해 주세요...</div>
      <div class="ct-send">상담 완료</div>
    </div>
  </div>
</body>
</html>`;
}

// ─── 2. ISO-BMFF (MP4 faststart) 순수 JS 정밀 먹서 ───
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; }
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff, 0); return b; }
function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  return Buffer.concat([u32(8 + payload.length), Buffer.from(type, 'ascii'), payload]);
}
function fullBox(type, version, flags, ...parts) {
  return box(type, Buffer.from([version & 0xff, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
}
function zeros(n) { return Buffer.alloc(n); }
function matrixUnity() {
  return Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
}
function langKor() {
  const code = (('k'.charCodeAt(0) - 0x60) << 10) | (('o'.charCodeAt(0) - 0x60) << 5) | ('r'.charCodeAt(0) - 0x60);
  return u16(code);
}
function mp4Desc(tag, body) {
  // 1-byte length (sufficient for AAC AudioSpecificConfig & small descriptors)
  return Buffer.concat([Buffer.from([tag, body.length]), body]);
}

function buildEsds(ascBuf, bitrate = 128000) {
  const decSpecific = mp4Desc(0x05, ascBuf);
  const decConfig = mp4Desc(
    0x04,
    Buffer.concat([
      Buffer.from([0x40, 0x15]), // MPEG-4 Audio + AudioStream
      Buffer.from([0x00, 0x18, 0x00]), // bufferSizeDB
      u32(bitrate),
      u32(bitrate),
      decSpecific,
    ])
  );
  const slConfig = mp4Desc(0x06, Buffer.from([0x02]));
  const esDesc = mp4Desc(0x03, Buffer.concat([u16(1), Buffer.from([0x00]), decConfig, slConfig]));
  return fullBox('esds', 0, 0, esDesc);
}

function chunkSamples(sizes, samplesPerChunk = 30) {
  const chunks = [];
  let idx = 0;
  while (idx < sizes.length) {
    const count = Math.min(samplesPerChunk, sizes.length - idx);
    let bytes = 0;
    for (let k = 0; k < count; k++) bytes += sizes[idx + k];
    chunks.push({ firstSample: idx, count, bytes });
    idx += count;
  }
  // RLE encode stsc
  const stscEntries = [];
  let prevCount = -1;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].count !== prevCount) {
      stscEntries.push({ firstChunk: i + 1, samplesPerChunk: chunks[i].count, descIdx: 1 });
      prevCount = chunks[i].count;
    }
  }
  return { chunks, stscEntries };
}

function buildMoov({
  movieTimescale,
  movieDurationMs,
  width,
  height,
  vTimescale,
  vSamples,
  vSampleDur,
  vKeyIndices,
  avcC,
  vChunkData,
  vChunkOffsets,
  aTimescale,
  aSamples,
  aSampleDur,
  aSpecificConfig,
  aChunkData,
  aChunkOffsets,
}) {
  const mvhd = fullBox(
    'mvhd', 0, 0,
    u32(0), u32(0), u32(movieTimescale), u32(movieDurationMs),
    u32(0x00010000), u16(0x0100), zeros(10),
    matrixUnity(), zeros(24), u32(3)
  );

  // Video track
  const vDurationMedia = vSamples.length * vSampleDur;
  const vDurationMovie = Math.round((vDurationMedia / vTimescale) * movieTimescale);
  const vTkhd = fullBox(
    'tkhd', 0, 0x000007,
    u32(0), u32(0), u32(1), u32(0), u32(vDurationMovie),
    zeros(8), u16(0), u16(0), u16(0), u16(0),
    matrixUnity(), u32(width << 16), u32(height << 16)
  );
  const vMdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(vTimescale), u32(vDurationMedia), langKor(), u16(0));
  const vHdlr = fullBox('hdlr', 0, 0, u32(0), Buffer.from('vide', 'ascii'), zeros(12), Buffer.from('VideoHandler\0', 'ascii'));
  const vmhd = fullBox('vmhd', 0, 1, zeros(8));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
  const avc1 = box(
    'avc1',
    zeros(6), u16(1), zeros(16), u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    zeros(32), u16(0x0018), u16(0xffff),
    box('avcC', avcC)
  );
  const vStsd = fullBox('stsd', 0, 0, u32(1), avc1);
  const vStts = fullBox('stts', 0, 0, u32(1), u32(vSamples.length), u32(vSampleDur));
  const vStss = fullBox('stss', 0, 0, u32(vKeyIndices.length), ...vKeyIndices.map((idx) => u32(idx)));
  const vStsc = fullBox(
    'stsc', 0, 0, u32(vChunkData.stscEntries.length),
    ...vChunkData.stscEntries.flatMap((e) => [u32(e.firstChunk), u32(e.samplesPerChunk), u32(e.descIdx)])
  );
  const vStsz = fullBox('stsz', 0, 0, u32(0), u32(vSamples.length), ...vSamples.map((s) => u32(s.length)));
  const vStco = fullBox('stco', 0, 0, u32(vChunkOffsets.length), ...vChunkOffsets.map((o) => u32(o)));
  const vStbl = box('stbl', vStsd, vStts, vStss, vStsc, vStsz, vStco);
  const vMinf = box('minf', vmhd, dinf, vStbl);
  const vMdia = box('mdia', vMdhd, vHdlr, vMinf);
  const vTrak = box('trak', vTkhd, vMdia);

  // Audio track
  const aDurationMedia = aSamples.length * aSampleDur;
  const aDurationMovie = Math.round((aDurationMedia / aTimescale) * movieTimescale);
  const aTkhd = fullBox(
    'tkhd', 0, 0x000007,
    u32(0), u32(0), u32(2), u32(0), u32(aDurationMovie),
    zeros(8), u16(0), u16(0), u16(0x0100), u16(0),
    matrixUnity(), u32(0), u32(0)
  );
  const aMdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(aTimescale), u32(aDurationMedia), langKor(), u16(0));
  const aHdlr = fullBox('hdlr', 0, 0, u32(0), Buffer.from('soun', 'ascii'), zeros(12), Buffer.from('SoundHandler\0', 'ascii'));
  const smhd = fullBox('smhd', 0, 0, u16(0), u16(0));
  const mp4a = box(
    'mp4a',
    zeros(6), u16(1), zeros(8),
    u16(2), u16(16), u16(0), u16(0), u32(aTimescale << 16),
    buildEsds(aSpecificConfig, 128000)
  );
  const aStsd = fullBox('stsd', 0, 0, u32(1), mp4a);
  const aStts = fullBox('stts', 0, 0, u32(1), u32(aSamples.length), u32(aSampleDur));
  const aStsc = fullBox(
    'stsc', 0, 0, u32(aChunkData.stscEntries.length),
    ...aChunkData.stscEntries.flatMap((e) => [u32(e.firstChunk), u32(e.samplesPerChunk), u32(e.descIdx)])
  );
  const aStsz = fullBox('stsz', 0, 0, u32(0), u32(aSamples.length), ...aSamples.map((s) => u32(s.length)));
  const aStco = fullBox('stco', 0, 0, u32(aChunkOffsets.length), ...aChunkOffsets.map((o) => u32(o)));
  const aStbl = box('stbl', aStsd, aStts, aStsc, aStsz, aStco);
  const aMinf = box('minf', smhd, dinf, aStbl);
  const aMdia = box('mdia', aMdhd, aHdlr, aMinf);
  const aTrak = box('trak', aTkhd, aMdia);

  return box('moov', mvhd, vTrak, aTrak);
}

function muxMp4({ width, height, fps, vSamples, vKeyIndices, avcC, aSamples, aSpecificConfig }) {
  const ftyp = box('ftyp', Buffer.from('isom', 'ascii'), u32(0x200), Buffer.from('isomiso2avc1mp41', 'ascii'));
  const movieTimescale = 1000;
  const vTimescale = 90000;
  const vSampleDur = Math.round(vTimescale / fps); // 3000
  const aTimescale = 48000;
  const aSampleDur = 1024;
  const movieDurationMs = Math.round(Math.max((vSamples.length / fps) * 1000, (aSamples.length * aSampleDur / aTimescale) * 1000));

  const vChunkData = chunkSamples(vSamples.map((s) => s.length), 30);
  const aChunkData = chunkSamples(aSamples.map((s) => s.length), 46);

  const dummyVOffsets = vChunkData.chunks.map(() => 0);
  const dummyAOffsets = aChunkData.chunks.map(() => 0);

  const moovSizeProbe = buildMoov({
    movieTimescale, movieDurationMs, width, height,
    vTimescale, vSamples, vSampleDur, vKeyIndices, avcC, vChunkData, vChunkOffsets: dummyVOffsets,
    aTimescale, aSamples, aSampleDur, aSpecificConfig, aChunkData, aChunkOffsets: dummyAOffsets,
  }).length;

  let cursor = ftyp.length + moovSizeProbe + 8; // 8-byte mdat header
  const vChunkOffsets = [];
  for (const ch of vChunkData.chunks) {
    vChunkOffsets.push(cursor);
    cursor += ch.bytes;
  }
  const aChunkOffsets = [];
  for (const ch of aChunkData.chunks) {
    aChunkOffsets.push(cursor);
    cursor += ch.bytes;
  }

  const moov = buildMoov({
    movieTimescale, movieDurationMs, width, height,
    vTimescale, vSamples, vSampleDur, vKeyIndices, avcC, vChunkData, vChunkOffsets,
    aTimescale, aSamples, aSampleDur, aSpecificConfig, aChunkData, aChunkOffsets,
  });
  const mdatPayloadSize = cursor - (ftyp.length + moov.length + 8);
  const mdatHeader = Buffer.concat([u32(8 + mdatPayloadSize), Buffer.from('mdat', 'ascii')]);
  return Buffer.concat([ftyp, moov, mdatHeader, ...vSamples, ...aSamples]);
}

// ─── 3. 메인 빌드 프로세스 ───
console.log('=== Dr.119 YouTube Shorts 빌더 시작 ===');
const timeline = JSON.parse(fs.readFileSync(path.join(ASSETS, 'timeline.json'), 'utf8'));
const { srv, base } = await startServer();
const browser = await launchBrowser();

try {
  const { cdp } = browser;

  // (A) 채널톡 리뷰·고맙다 캡처 PNG 3종 렌더링
  console.log('1) 채널톡 리뷰/감사 캡처 3종 생성 중...');
  await cdp.viewport(860, 1140, false);
  await cdp.goto(base + '/index.html');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  for (const rev of REVIEWS) {
    const html = buildChannelTalkHtml(rev);
    await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await sleep(120);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', omitBackground: true });
    fs.writeFileSync(path.join(ASSETS, rev.file), Buffer.from(data, 'base64'));
    console.log('   ✅', rev.file);
  }

  // (B) 실제 Dr.119 모바일 화면 고해상도(2x) 캡처 (초기 폼 / 입력 완료 / 접수 완료)
  console.log('2) Dr.119 모바일 실제 화면 고해상도 캡처 중...');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.goto(base + '/index.html');
  await sleep(300);
  const captureViewPng = async (outName) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(ASSETS, outName), Buffer.from(data, 'base64'));
    console.log('   ✅', outName);
  };
  await captureViewPng('mobile-form-raw.png');

  // 빨간 마이크 근처 힌트 & 입력 시연 상태 캡처
  await cdp.eval(`(() => {
    const s = document.getElementById('symptom_note');
    const p = document.getElementById('phone');
    const r = document.getElementById('region');
    if (s) s.value = '전원 먹통·진동 약함 (음성 입력)';
    if (p) p.value = '010-1234-5678';
    if (r) r.value = '서울 마포구';
  })()`);
  await sleep(120);
  await captureViewPng('mobile-form-filled.png');

  // 접수 완료 화면(#done) 강제 표시 캡처 (네트워크 없이 즉시 전환)
  await cdp.eval(`(() => {
    const form = document.getElementById('as-form');
    const done = document.getElementById('done');
    const idEl = document.getElementById('done-order-id');
    if (form) form.hidden = true;
    if (done) done.hidden = false;
    if (idEl) idEl.textContent = 'DR-20261116-0119';
    window.scrollTo(0, 0);
  })()`);
  await sleep(150);
  await captureViewPng('mobile-done-raw.png');

  // (C) 브라우저 캔버스 + WebCodecs로 1080x1920 30fps 쇼츠 프레임 렌더링 & 인코딩
  console.log('3) 쇼츠 렌더러 페이지 로드 및 AAC 오디오 인코딩 중...');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  await cdp.goto(base + '/shorts/renderer.html');
  await sleep(200);

  // master-audio.wav를 HTTP로 직접 로드하여 AAC(mp4a.40.2) 인코딩 수행
  const resAudio = await cdp.eval(`window.__encodeAudio('./assets/master-audio.wav')`);
  console.log(`   ✅ AAC 오디오 인코딩 완료: ${resAudio.samples.length} frames, ASC=${resAudio.ascBase64}, durPerSample=${resAudio.sampleDurations[0] || 1024}`);

  // 비디오 인코더 초기화 & 에셋 프리로드
  await cdp.eval(`window.__initRenderer(${JSON.stringify(timeline)})`);

  // 총 프레임 렌더링 (20프레임마다 진행률 표시)
  const totalFrames = timeline.totalFrames;
  const previewFrames = {};
  const previewTimes = {
    s1: Math.round((timeline.scenes[0].start + 2.8) * 30),
    s2: Math.round((timeline.scenes[1].start + 5.0) * 30),
    s3: Math.round((timeline.scenes[2].start + 3.0) * 30),
    s4: Math.round((timeline.scenes[3].start + 3.8) * 30),
    s5: Math.round((timeline.scenes[4].start + 2.5) * 30),
  };

  console.log(`4) 1080x1920 H.264 프레임 렌더링 및 인코딩 (${totalFrames} 프레임)...`);
  const tStart = Date.now();
  // 15프레임 배치로 CDP 왕복 오버헤드 최소화
  const BATCH = 15;
  for (let startF = 0; startF < totalFrames; startF += BATCH) {
    const endF = Math.min(totalFrames, startF + BATCH);
    const snapShots = await cdp.eval(`window.__renderBatch(${startF}, ${endF}, ${JSON.stringify(Object.values(previewTimes))})`);
    for (const [fStr, dataUrl] of Object.entries(snapShots || {})) {
      previewFrames[fStr] = dataUrl;
    }
    if (startF % 150 === 0 || endF === totalFrames) {
      const pct = Math.round((endF / totalFrames) * 100);
      console.log(`   ... ${endF}/${totalFrames} (${pct}%) [${((Date.now() - tStart) / 1000).toFixed(1)}s]`);
    }
  }

  // 스토리보드 5장 그리드 PNG 저장
  await cdp.eval(`window.__buildGrid(${JSON.stringify(Object.values(previewTimes))}, ${JSON.stringify(previewFrames)})`);
  const gridB64 = await cdp.eval(`window.__getGridBase64()`);
  fs.writeFileSync(path.join(ASSETS, 'scene-preview-grid.png'), Buffer.from(gridB64, 'base64'));
  console.log('   ✅ scene-preview-grid.png 저장 완료');

  // 인코딩된 H.264 프레임 수집 (base64 청크)
  const vMeta = await cdp.eval(`window.__flushVideo()`);
  console.log(`   ✅ H.264 비디오 인코딩 완료: ${vMeta.count} frames, 키프레임 ${vMeta.keyIndices.length}개, avcC=${vMeta.avcC.length}chars`);

  const vSamples = [];
  for (let i = 0; i < vMeta.count; i += 60) {
    const chunkList = await cdp.eval(`window.__getVideoSlice(${i}, ${Math.min(vMeta.count, i + 60)})`);
    for (const b64 of chunkList) vSamples.push(Buffer.from(b64, 'base64'));
  }
  const aSamples = resAudio.samples.map((b64) => Buffer.from(b64, 'base64'));

  // ISO-BMFF MP4 먹싱 및 저장
  console.log('5) faststart MP4 먹싱 및 저장 중...');
  const mp4Buf = muxMp4({
    width: 1080,
    height: 1920,
    fps: 30,
    vSamples,
    vKeyIndices: vMeta.keyIndices,
    avcC: Buffer.from(vMeta.avcC, 'base64'),
    aSamples,
    aSpecificConfig: Buffer.from(resAudio.ascBase64, 'base64'),
  });
  const outMp4 = path.join(HERE, 'dr119-youtube-shorts.mp4');
  fs.writeFileSync(outMp4, mp4Buf);
  console.log(`🎉 완성: ${outMp4} (${(mp4Buf.length / (1024 * 1024)).toFixed(2)} MB)`);
} finally {
  await browser.close();
  srv.close();
}
