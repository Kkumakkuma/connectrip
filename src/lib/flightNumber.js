// 편명(항공편 번호) 정규화·검증의 단일 출처.
//
// 왜 한 곳으로 모았나 (2026-09-17, 쿠마님 9871):
// 마이페이지 등록 폼과 플래너가 각자 다른 규칙을 들고 있었다. 마이페이지 쪽 정규식이
// /^[A-Z]{2}[0-9]{1,4}$/ 라서 제주항공 7C2604 가 "편명 형식을 확인해주세요"로 막혔다.
// IATA 지정부호는 2자이되 영문2·영문+숫자·숫자+영문 세 조합이 실재한다(7C·9C·5J·6E·8M).
// 플래너 쪽은 그걸 허용하고 있어서, 플래너가 자동 등록한 편을 마이페이지에서 고치려 하면
// 막히는 어긋남까지 있었다.
//
// 저장 형식을 canonical 로 통일한다:
//   입력 "ke 081" / "KE081" / "KE81"  →  저장 "KE81"
// 칭찬매칭과 같은 편 게시판이 편명+날짜 **정확 일치**로 사람을 묶기 때문에, 같은 비행기를
// 탄 두 사람이 KE081 과 KE81 로 따로 저장되면 서로를 영영 못 만난다. 표기가 갈릴 여지를
// 저장 단계에서 없앤다. (운영 DB 의 flight_schedules·commendation_matches·flight_posts 는
// 2026-09-17 실측 0행이라 기존 데이터 이관 문제가 없다.)
//
// 검증은 형식만 보지 않고 **실제 등록된 항공사 부호인지** 대조한다(쿠마님 9881).
// 형식만 보면 ZZ1234 같은 없는 부호도 통과하는데, 오타가 곧 "못 만남"이 되는 구조라
// 입력 단계에서 걸러야 한다. 목록은 src/lib/airlineCodes.js 가 갖는다.

import { airlineName } from './airlineCodes';

// 부호 2자(숫자 2자 조합은 배정되지 않는다) + 번호 1~4자리 + 선택적 접미 영문 1자.
// 접미 영문은 운항 구분자(예: KE081A)로, 받아는 두되 저장에서 유지한다.
// 숫자부를 {1,4} 로 먼저 묶는다 — 선행 0 을 따로 떼어내면 KE000001 처럼 5자리 넘는 원문도
// 통과한다(2026-09-17 코덱스 지적). 선행 0 제거는 매칭 뒤 Number() 가 한다.
export const FLIGHT_SHAPE = /^((?:[A-Z][A-Z0-9]|[0-9][A-Z]))([0-9]{1,4})([A-Z]?)$/;

/** 표기 흔들림을 없앤 저장·비교용 값. 형식이 아니면 null. */
export function canonFlightNumber(input) {
  const raw = String(input || '').toUpperCase().replace(/\s+/g, '');
  const m = raw.match(FLIGHT_SHAPE);
  if (!m) return null;
  const [, code, num, suffix] = m;
  const n = Number(num);
  if (!n) return null; // 0편은 없다
  return `${code}${n}${suffix}`;
}

/**
 * 편명 검증. { ok, value, code, name, reason } 반환.
 *   value  저장할 canonical 값
 *   name   항공사 한글명(안내용)
 *   reason 실패 사유 문구(사용자에게 그대로 보여줄 수 있는 말)
 */
export function validateFlightNumber(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { ok: false, reason: '편명을 입력해주세요. (예: KE081, 7C2604)' };
  }
  const value = canonFlightNumber(raw);
  if (!value) {
    return {
      ok: false,
      reason: '편명 형식이 맞지 않습니다. 항공사 부호 두 자리와 편명 번호를 붙여 적어주세요. (예: KE081, 7C2604)',
    };
  }
  const code = value.slice(0, 2);
  const name = airlineName(code);
  if (!name) {
    return {
      ok: false,
      code,
      reason: `'${code}' 로 시작하는 항공사를 찾지 못했습니다. 항공권에 적힌 편명을 그대로 입력해주세요. 실제로 운항하는 항공사인데 등록되지 않았다면 문의해주세요.`,
    };
  }
  return { ok: true, value, code, name };
}

/** 두 편명이 같은 비행편인가(표기 차이 무시). */
export function isSameFlight(a, b) {
  const x = canonFlightNumber(a);
  const y = canonFlightNumber(b);
  return Boolean(x && y && x === y);
}

/** 화면에 곁들일 항공사 이름. 모르면 null. */
export function flightAirlineName(flightNumber) {
  const value = canonFlightNumber(flightNumber);
  return value ? airlineName(value.slice(0, 2)) : null;
}
