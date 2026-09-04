// 동선 경고를 화면 문구로 옮긴다 (설계 §6 표시 규칙).
//
// 규칙
//   · 단정하지 않는다. "문 닫았어요"(✕) 가 아니라 "폐점 30분 전 기준으로는 늦을 수 있어요"(○).
//   · 배지를 누르면 판정 근거(사용한 영업시간 구간·출처·적용한 가정값)를 그대로 보여준다.

import { CLOSE_REASONS, WARNING_CODES } from '../../lib/feasibility';

const SOURCE_LABEL = { google: 'Google', osm: 'OpenStreetMap' };

// 배지에 들어가는 짧은 말.
export function warningLabel(warning) {
  switch (warning?.code) {
    case WARNING_CODES.TIME_ORDER:
      return '시각 순서';
    case WARNING_CODES.CLOSED_DAY:
      return '쉬는 날';
    case WARNING_CODES.OVER_DAY:
      return '하루 시간 초과';
    case WARNING_CODES.ARRIVE_AFTER_CLOSE:
      if (warning.reason === CLOSE_REASONS.BREAK) return '휴게시간';
      if (warning.reason === CLOSE_REASONS.BEFORE_OPEN) return '개점 전';
      return '마감 임박';
    default:
      return '확인 필요';
  }
}

// 시트에 들어가는 한 문장.
export function warningSentence(warning) {
  const buffer = warning?.detail?.assumptions?.bufferMin ?? 30;
  switch (warning?.code) {
    case WARNING_CODES.TIME_ORDER:
      return '앞 장소보다 이른 시각이 적혀 있습니다.';
    case WARNING_CODES.CLOSED_DAY:
      return '이 요일에는 영업하지 않는 것으로 나옵니다.';
    case WARNING_CODES.OVER_DAY:
      return `하루 활동 시간 기준을 ${warning.detail?.overMin ?? 0}분 넘깁니다.`;
    case WARNING_CODES.ARRIVE_AFTER_CLOSE:
      if (warning.reason === CLOSE_REASONS.BREAK) return '휴게시간에 도착할 수 있습니다.';
      if (warning.reason === CLOSE_REASONS.BEFORE_OPEN) return '문을 열기 전에 도착할 수 있습니다.';
      return `폐점 ${buffer}분 전 기준으로는 늦을 수 있습니다.`;
    default:
      return '';
  }
}

// 시트에 나열하는 판정 근거. [{ term, value }]
export function warningBasis(warning) {
  const detail = warning?.detail || {};
  const assumptions = detail.assumptions || {};
  const lines = [];

  if (detail.arrivalAt) lines.push({ term: '도착 예상', value: detail.arrivalAt });
  if (detail.plannedAt) lines.push({ term: '적어 둔 시각', value: detail.plannedAt });
  if (detail.previousAt) lines.push({ term: '앞 장소 시각', value: detail.previousAt });
  if (detail.endsAt) lines.push({ term: '마지막 일정 종료', value: detail.endsAt });

  if (Array.isArray(detail.intervals)) {
    lines.push({
      term: '영업시간',
      value:
        detail.intervals.length > 0
          ? detail.intervals.map((it) => `${it.from}–${it.to}`).join(', ')
          : '이 요일은 영업 구간이 없습니다',
    });
  }
  if (detail.source) {
    lines.push({ term: '영업시간 출처', value: SOURCE_LABEL[detail.source] || detail.source });
  }

  if (assumptions.dayStart && assumptions.dayEnd) {
    lines.push({ term: '하루 기준', value: `${assumptions.dayStart}–${assumptions.dayEnd}` });
  }
  // 마지막 입장 버퍼는 영업시간을 본 판정에만 적용된다. 하루 시간 초과·시각 순서에 이 줄을
  // 같이 붙이면 쓰지도 않은 값을 근거처럼 보여주게 된다.
  if (warning?.code === WARNING_CODES.ARRIVE_AFTER_CLOSE && Number.isFinite(assumptions.bufferMin)) {
    lines.push({ term: '마지막 입장', value: `폐점 ${assumptions.bufferMin}분 전` });
  }
  if (warning?.code === WARNING_CODES.ARRIVE_AFTER_CLOSE || warning?.code === WARNING_CODES.CLOSED_DAY) {
    lines.push({ term: '공휴일', value: '반영하지 않습니다' });
  }

  return lines;
}
