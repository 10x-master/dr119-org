// Dr.119 YouTube Shorts 마스터 오디오 믹서 (48kHz 스테레오 WAV + 타임라인 JSON 생성)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const OUT_SR = 48000;
const OUT_CH = 2;

function readWavMonoFloat(filePath) {
  const buf = fs.readFileSync(filePath);
  const ch = buf.readUInt16LE(22);
  const sr = buf.readUInt32LE(24);
  const bps = buf.readUInt16LE(34);
  let pos = 12;
  let dataOff = 0;
  let dataLen = 0;
  while (pos < buf.length - 8) {
    const id = buf.toString('ascii', pos, pos + 4);
    const sz = buf.readUInt32LE(pos + 4);
    if (id === 'data') {
      dataOff = pos + 8;
      dataLen = Math.min(sz, buf.length - dataOff);
      break;
    }
    pos += 8 + sz;
  }
  const bytesPerFrame = ch * (bps / 8);
  const count = Math.floor(dataLen / bytesPerFrame);
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const off = dataOff + i * bytesPerFrame + c * (bps / 8);
      sum += bps === 16 ? buf.readInt16LE(off) / 32768 : (buf[off] - 128) / 128;
    }
    raw[i] = sum / ch;
  }
  // 앞뒤 무음 구간 트림 (0.008 임계치 + 앞뒤 35ms 여유)
  let s = 0;
  let e = count - 1;
  while (s < count && Math.abs(raw[s]) < 0.006) s++;
  while (e > s && Math.abs(raw[e]) < 0.006) e--;
  const pad = Math.floor(sr * 0.035);
  s = Math.max(0, s - pad);
  e = Math.min(count - 1, e + pad);
  const trimmed = raw.slice(s, e + 1);

  // 선형 보간으로 48kHz 리샘플링
  const ratio = OUT_SR / sr;
  const outLen = Math.floor(trimmed.length * ratio);
  const resampled = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(trimmed.length - 1, i0 + 1);
    const frac = src - i0;
    resampled[i] = trimmed[i0] * (1 - frac) + trimmed[i1] * frac;
  }
  // 짧은 페이드 인/아웃 (팝 노이즈 방지)
  const fade = Math.min(Math.floor(OUT_SR * 0.015), Math.floor(resampled.length / 4));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    resampled[i] *= g;
    resampled[resampled.length - 1 - i] *= g;
  }
  return resampled;
}

const voices = [1, 2, 3, 4, 5].map((n) => {
  const pcm = readWavMonoFloat(path.join(ASSETS, `voice-${n}.wav`));
  return { id: n, pcm, dur: pcm.length / OUT_SR };
});

// 장면 타임라인 동적 계산 (음성이 절대 겹치거나 잘리지 않도록)
const scenes = [];
let cursor = 0;
const prePad = [0.22, 0.25, 0.25, 0.28, 0.22];
const postPad = [0.35, 0.45, 0.40, 1.50, 0.70]; // Scene 4(채널톡 리뷰)는 읽기 여유 +1.5초 확보

for (let i = 0; i < voices.length; i++) {
  const start = cursor;
  const voiceStart = start + prePad[i];
  const voiceEnd = voiceStart + voices[i].dur;
  const end = Math.round((voiceEnd + postPad[i]) * 10) / 10;
  scenes.push({
    scene: i + 1,
    start,
    end,
    duration: Number((end - start).toFixed(2)),
    voiceStart: Number(voiceStart.toFixed(3)),
    voiceEnd: Number(voiceEnd.toFixed(3)),
  });
  cursor = end;
}

const totalDur = cursor;
const totalFrames = Math.ceil(totalDur * OUT_SR);
const left = new Float32Array(totalFrames);
const right = new Float32Array(totalFrames);

// 1) 부드럽고 경쾌한 BGM 신스 패드 + 플럭 리듬 (음성 구간에는 자동 덕킹)
const chords = [
  [261.63, 329.63, 392.00, 493.88], // Cmaj7
  [220.00, 261.63, 329.63, 392.00], // Am7
  [174.61, 220.00, 261.63, 349.23], // Fmaj7
  [196.00, 246.94, 293.66, 392.00], // G6
];

// 음성 활성 엔벨로프 (더킹용)
const voiceEnv = new Float32Array(totalFrames);
for (let i = 0; i < voices.length; i++) {
  const startSample = Math.floor(scenes[i].voiceStart * OUT_SR);
  const pcm = voices[i].pcm;
  for (let j = 0; j < pcm.length && startSample + j < totalFrames; j++) {
    voiceEnv[startSample + j] = Math.max(voiceEnv[startSample + j], 1);
  }
}

let bgPhase = 0;
for (let n = 0; n < totalFrames; n++) {
  const t = n / OUT_SR;
  const bar = Math.floor(t / 2.0);
  const chord = chords[bar % chords.length];
  const beatPos = (t % 0.5) / 0.5;
  const pluck = Math.exp(-beatPos * 4.2);

  // 따뜻한 패드 + 아르페지오 플럭 + 가벼운 킥 펄스
  let sPad = 0;
  for (let k = 0; k < chord.length; k++) {
    sPad += Math.sin(2 * Math.PI * chord[k] * t) * 0.22;
  }
  const arpFreq = chord[Math.floor((t * 4) % chord.length)] * 2;
  const sArp = Math.sin(2 * Math.PI * arpFreq * t) * Math.exp(-((t * 4) % 1) * 5.0) * 0.25;
  const kick = Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-beatPos * 14)) * beatPos * 0.5) * Math.exp(-beatPos * 9) * 0.35;

  // 페이드 인/아웃 및 음성 덕킹
  const inOut = Math.min(1, t / 0.6) * Math.min(1, (totalDur - t) / 0.8);
  const duck = voiceEnv[n] > 0.5 ? 0.14 : 0.26;
  const bgm = (sPad * 0.55 + sArp * 0.65 + kick * 0.5 + pluck * 0.02) * duck * inOut;

  left[n] += bgm * 0.96;
  right[n] += bgm * 1.04;
  bgPhase += 1;
}

// 2) 효과음 유틸: 알림음(딩동), 전환 스우시, 카메라 셔터/마이크 클릭
function addChime(timeSec, freq1, freq2, gain = 0.22) {
  const start = Math.floor(timeSec * OUT_SR);
  const notes = [
    { off: 0, f: freq1, len: 0.22 },
    { off: 0.10, f: freq2, len: 0.38 },
  ];
  for (const nt of notes) {
    const s0 = start + Math.floor(nt.off * OUT_SR);
    const len = Math.floor(nt.len * OUT_SR);
    for (let i = 0; i < len && s0 + i < totalFrames; i++) {
      const tt = i / OUT_SR;
      const env = Math.sin(Math.min(1, tt / 0.008) * Math.PI * 0.5) * Math.exp(-tt * 8.5);
      const val = (Math.sin(2 * Math.PI * nt.f * tt) + 0.35 * Math.sin(2 * Math.PI * nt.f * 2 * tt)) * env * gain;
      left[s0 + i] += val;
      right[s0 + i] += val;
    }
  }
}

function addClick(timeSec, fStart = 1200, gain = 0.20) {
  const s0 = Math.floor(timeSec * OUT_SR);
  const len = Math.floor(0.09 * OUT_SR);
  for (let i = 0; i < len && s0 + i < totalFrames; i++) {
    const tt = i / OUT_SR;
    const env = Math.exp(-tt * 38);
    const f = fStart * Math.exp(-tt * 12);
    const val = Math.sin(2 * Math.PI * f * tt) * env * gain;
    left[s0 + i] += val;
    right[s0 + i] += val;
  }
}

// 장면 1 시작 훅 강조음
addChime(0.02, 784, 1046.5, 0.22);
// 장면 2 사용 방법 스텝 알림 (사진 찍기 & 빨간 마이크 & 접수 완료)
const s2 = scenes[1];
addClick(s2.start + 1.8, 1600, 0.22); // 사진 찰칵
addChime(s2.start + 4.4, 880, 1174.66, 0.18); // 빨간 마이크
addClick(s2.start + 8.6, 1100, 0.22); // 긴급 접수하기 클릭
// 장면 3 투명 실비 전환음
addChime(scenes[2].start, 659.25, 880, 0.18);
// 장면 4 채널톡 리뷰 팝업 딩동 3연타!
const s4 = scenes[3];
addChime(s4.start + 0.05, 880, 1318.5, 0.25);
addChime(s4.start + 2.55, 987.77, 1396.9, 0.23);
addChime(s4.start + 5.05, 1046.5, 1567.98, 0.25);
// 장면 5 엔딩 콜 CTA 강조음
addChime(scenes[4].start + 0.05, 784, 1174.66, 0.24);

// 3) 한국어 음성 믹싱 (선명하게 중앙 배치)
for (let i = 0; i < voices.length; i++) {
  const s0 = Math.floor(scenes[i].voiceStart * OUT_SR);
  const pcm = voices[i].pcm;
  for (let j = 0; j < pcm.length && s0 + j < totalFrames; j++) {
    const v = pcm[j] * 1.15;
    left[s0 + j] += v;
    right[s0 + j] += v;
  }
}

// 소프트 리미터로 클리핑 완전 차단
for (let i = 0; i < totalFrames; i++) {
  left[i] = Math.tanh(left[i] * 0.92);
  right[i] = Math.tanh(right[i] * 0.92);
}

// WAV 파일 기록 (48kHz, 2ch, 16-bit PCM)
const dataBytes = totalFrames * OUT_CH * 2;
const wavBuf = Buffer.alloc(44 + dataBytes);
wavBuf.write('RIFF', 0);
wavBuf.writeUInt32LE(36 + dataBytes, 4);
wavBuf.write('WAVE', 8);
wavBuf.write('fmt ', 12);
wavBuf.writeUInt32LE(16, 16);
wavBuf.writeUInt16LE(1, 20); // PCM
wavBuf.writeUInt16LE(OUT_CH, 22);
wavBuf.writeUInt32LE(OUT_SR, 24);
wavBuf.writeUInt32LE(OUT_SR * OUT_CH * 2, 28);
wavBuf.writeUInt16LE(OUT_CH * 2, 32);
wavBuf.writeUInt16LE(16, 34);
wavBuf.write('data', 36);
wavBuf.writeUInt32LE(dataBytes, 40);

let off = 44;
for (let i = 0; i < totalFrames; i++) {
  const l = Math.max(-1, Math.min(1, left[i]));
  const r = Math.max(-1, Math.min(1, right[i]));
  wavBuf.writeInt16LE(Math.round(l * 32767), off);
  wavBuf.writeInt16LE(Math.round(r * 32767), off + 2);
  off += 4;
}

const outWav = path.join(ASSETS, 'master-audio.wav');
fs.writeFileSync(outWav, wavBuf);

const timeline = {
  sampleRate: OUT_SR,
  channels: OUT_CH,
  fps: 30,
  totalDur: Number(totalDur.toFixed(2)),
  totalFrames: Math.round(totalDur * 30),
  scenes,
};
fs.writeFileSync(path.join(ASSETS, 'timeline.json'), JSON.stringify(timeline, null, 2));
console.log('MASTER_AUDIO_OK:', outWav, 'totalDur:', totalDur.toFixed(2) + 's', 'frames@30fps:', timeline.totalFrames);
console.log('SCENES:', scenes);
