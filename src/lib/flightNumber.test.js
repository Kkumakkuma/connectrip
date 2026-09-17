import { describe, expect, it } from 'vitest';

import { AIRLINE_CODES, KOREAN_AIRLINES, airlineName } from './airlineCodes';
import {
  canonFlightNumber,
  flightAirlineName,
  isSameFlight,
  validateFlightNumber,
} from './flightNumber';

describe('canonFlightNumber', () => {
  it('선행 0·공백·소문자를 하나의 표기로 모은다', () => {
    expect(canonFlightNumber('KE081')).toBe('KE81');
    expect(canonFlightNumber('KE81')).toBe('KE81');
    expect(canonFlightNumber('ke 081')).toBe('KE81');
    expect(canonFlightNumber('  ke081  ')).toBe('KE81');
    expect(canonFlightNumber('KE0081')).toBe('KE81');
  });

  it('숫자로 시작하는 항공사 부호를 받는다(2026-09-17 버그)', () => {
    expect(canonFlightNumber('7C2604')).toBe('7C2604');
    expect(canonFlightNumber('7c 2604')).toBe('7C2604');
    expect(canonFlightNumber('9C8901')).toBe('9C8901');
    expect(canonFlightNumber('5J188')).toBe('5J188');
    expect(canonFlightNumber('6E1234')).toBe('6E1234');
  });

  it('운항 구분자(접미 영문 1자)를 유지한다', () => {
    expect(canonFlightNumber('KE081A')).toBe('KE81A');
  });

  it('선행 0 을 붙여도 원문 숫자는 4자리를 넘을 수 없다', () => {
    // 선행 0 을 따로 떼어내는 구현이면 KE000001 이 통과해 버린다(2026-09-17 코덱스 지적)
    expect(canonFlightNumber('KE000001')).toBeNull();
    expect(canonFlightNumber('KE0081')).toBe('KE81');
  });

  it('형식이 아니면 null', () => {
    expect(canonFlightNumber('')).toBeNull();
    expect(canonFlightNumber(null)).toBeNull();
    expect(canonFlightNumber('KE')).toBeNull();
    expect(canonFlightNumber('KEA1234')).toBeNull();    // 부호가 3자
    expect(canonFlightNumber('12345')).toBeNull();      // 숫자 2자 부호는 없다
    expect(canonFlightNumber('KE12345')).toBeNull();    // 번호 5자리
    expect(canonFlightNumber('KE000')).toBeNull();      // 0편
    expect(canonFlightNumber('KE-081')).toBeNull();
    expect(canonFlightNumber('KE081AB')).toBeNull();    // 접미 2자
  });
});

describe('validateFlightNumber', () => {
  it('국내 항공사를 전부 통과시킨다', () => {
    const samples = Object.keys(KOREAN_AIRLINES).map((code) => `${code}123`);
    for (const f of samples) {
      const r = validateFlightNumber(f);
      expect(r.ok, `${f} 가 막혔다`).toBe(true);
      expect(r.name).toBeTruthy();
    }
  });

  it('쿠마님이 막혔던 제주항공 편명을 통과시킨다', () => {
    const r = validateFlightNumber('7C2604');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('7C2604');
    expect(r.name).toBe('제주항공');
  });

  it('형식은 맞아도 목록에 없는 부호는 막는다', () => {
    // 'K1234' 는 부호 K1 + 234 편으로 읽히는 모양이라 형식 검사는 통과한다.
    // 실제로 배정된 부호가 아니므로 목록 대조에서 걸러져야 한다.
    expect(canonFlightNumber('K1234')).toBe('K1234');
    const r = validateFlightNumber('K1234');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('K1');
  });

  it('등록되지 않은 부호는 막고 사유를 알려준다', () => {
    const r = validateFlightNumber('ZZ1234');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ZZ');
    expect(r.reason).toContain('ZZ');
  });

  it('형식 오류와 미등록 부호를 다른 사유로 구분한다', () => {
    expect(validateFlightNumber('KE').reason).toContain('형식');
    expect(validateFlightNumber('ZZ1').reason).toContain('찾지 못했습니다');
    expect(validateFlightNumber('').reason).toContain('입력해주세요');
  });

  it('저장값은 언제나 canonical 이다', () => {
    expect(validateFlightNumber('ke 081').value).toBe('KE81');
    expect(validateFlightNumber(' oz201 ').value).toBe('OZ201');
  });
});

describe('isSameFlight', () => {
  it('표기가 달라도 같은 편으로 본다', () => {
    expect(isSameFlight('KE081', 'KE81')).toBe(true);
    expect(isSameFlight('ke 081', 'KE0081')).toBe(true);
    expect(isSameFlight('7C2604', '7c2604')).toBe(true);
  });

  it('다른 편은 다르게 본다', () => {
    expect(isSameFlight('KE081', 'KE82')).toBe(false);
    expect(isSameFlight('KE081', 'OZ081')).toBe(false);
    expect(isSameFlight('KE081', '')).toBe(false);
    expect(isSameFlight('KE081', 'KE081A')).toBe(false);
  });
});

describe('airlineCodes', () => {
  it('부호는 전부 두 자이고 숫자 두 자 조합은 없다', () => {
    for (const code of AIRLINE_CODES) {
      expect(code, `${code} 형식 이상`).toMatch(/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])$/);
    }
  });

  it('국내 항공사가 빠짐없이 들어 있다', () => {
    for (const code of ['KE', 'OZ', '7C', 'LJ', 'TW', 'BX', 'RS', 'ZE', 'YP', 'RF']) {
      expect(airlineName(code), `${code} 누락`).toBeTruthy();
    }
  });

  it('숫자가 들어간 해외 부호도 들어 있다', () => {
    for (const code of ['9C', '5J', '6E', '8M', '3U', 'B6', 'U2', 'W6']) {
      expect(airlineName(code), `${code} 누락`).toBeTruthy();
    }
  });

  it('없는 부호는 null 을 준다', () => {
    expect(airlineName('ZZ')).toBeNull();
    expect(airlineName('')).toBeNull();
  });
});

describe('flightAirlineName', () => {
  it('편명에서 항공사 이름을 뽑는다', () => {
    expect(flightAirlineName('7C2604')).toBe('제주항공');
    expect(flightAirlineName('KE081')).toBe('대한항공');
    expect(flightAirlineName('ZZ1')).toBeNull();
    expect(flightAirlineName('bad')).toBeNull();
  });
});
