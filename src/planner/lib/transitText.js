// 서버가 요약한 대중교통 단계(legs items[].steps)를 화면 문장으로 바꾼다. 순수 함수.
//   [{t:'WALK',s}, {t:'TRANSIT',v,line,from,to,stops,s}] → ['도보 5분', '지하철 2호선 강남 → 삼성 (6정거장)', '도보 3분']
import { formatDuration } from './travelTime';

const VEHICLE_LABEL = {
  SUBWAY: '지하철',
  METRO_RAIL: '지하철',
  BUS: '버스',
  INTERCITY_BUS: '버스',
  TROLLEYBUS: '버스',
  RAIL: '기차',
  HEAVY_RAIL: '기차',
  COMMUTER_TRAIN: '기차',
  HIGH_SPEED_TRAIN: '기차',
  LONG_DISTANCE_TRAIN: '기차',
  TRAM: '트램',
  LIGHT_RAIL: '트램',
  MONORAIL: '모노레일',
  FERRY: '페리',
  CABLE_CAR: '케이블카',
  GONDOLA_LIFT: '케이블카',
  FUNICULAR: '케이블카',
  SHARE_TAXI: '택시',
};

export function vehicleLabel(type) {
  if (typeof type !== 'string') return '대중교통';   // 소유자가 legs 를 직접 고칠 수 있어 문자열만 믿는다(codex 9/6: toString 없는 객체로 TypeError)
  return VEHICLE_LABEL[type.toUpperCase()] || '대중교통';
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');   // legs 는 소유자가 직접 UPDATE 할 수도 있어 문자열만 믿는다(codex 9/6)

export function transitStepText(step) {
  if (!step || typeof step !== 'object') return '';
  if (step.t === 'WALK') return Number.isFinite(step.s) && step.s > 0 ? `도보 ${formatDuration(step.s)}` : '';
  if (step.t === 'MORE') return '이후 구간 생략';
  if (step.t !== 'TRANSIT') return '';
  const line = str(step.line);
  const from = str(step.from);
  const to = str(step.to);
  const head = [vehicleLabel(step.v), line].filter(Boolean).join(' ');
  const route = from && to ? ` ${from} → ${to}` : from ? ` ${from}` : '';
  const stops = Number.isInteger(step.stops) && step.stops > 0 ? ` (${step.stops}정거장)` : '';
  return `${head}${route}${stops}`.trim();
}

/** 표시할 단계 문장 목록. 요약이 없거나 대중교통 단계가 없으면 빈 배열. */
export function transitStepsText(steps) {
  if (!Array.isArray(steps) || steps.length > 40 || !steps.some((s) => s?.t === 'TRANSIT')) return [];
  return steps.map(transitStepText).filter(Boolean);
}

/** 요약이 상한(MAX_STEPS)에 걸려 뒷부분이 생략됐는가. */
export function hasMoreSteps(steps) {
  return Array.isArray(steps) && steps.some((s) => s?.t === 'MORE');
}

/** 환승 횟수(대중교통 단계 수 - 1, 0 이상). 생략(MORE)이 있으면 실제보다 적을 수 있다 — 화면은 '이상'을 붙인다. */
export function transferCount(steps) {
  const rides = Array.isArray(steps) ? steps.filter((s) => s?.t === 'TRANSIT').length : 0;
  return Math.max(0, rides - 1);
}
