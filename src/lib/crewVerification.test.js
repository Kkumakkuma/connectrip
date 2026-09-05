import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CREW_RENEW_NOTICE_DAYS,
  crewExpiresAt,
  crewVerificationStatus,
  renewErrorMessage,
  formatExpiryDate,
  dayKey,
  isRenewBannerHidden,
  hideRenewBannerToday,
} from './crewVerification';

const crew = (over = {}) => ({ user_type: 'crew', crew_verified: true, crew_verified_at: '2026-01-01T00:00:00Z', ...over });
const at = (iso) => new Date(iso);

describe('crewExpiresAt', () => {
  it('인증 시각 + 1년', () => {
    expect(crewExpiresAt('2026-03-10T09:00:00Z').toISOString()).toBe(new Date('2027-03-10T09:00:00Z').toISOString());
  });

  it('값이 없거나 깨졌으면 null', () => {
    expect(crewExpiresAt(null)).toBeNull();
    expect(crewExpiresAt('')).toBeNull();
    expect(crewExpiresAt('nope')).toBeNull();
  });
});

describe('crewVerificationStatus', () => {
  it('승무원이 아니면 대상 아님', () => {
    expect(crewVerificationStatus({ user_type: 'passenger', crew_verified: false }).applicable).toBe(false);
    expect(crewVerificationStatus(null).state).toBe('none');
  });

  it('만료까지 여유가 있으면 valid + 남은 일수', () => {
    const s = crewVerificationStatus(crew({ crew_verified_at: '2026-01-01T00:00:00Z' }), at('2026-06-01T00:00:00Z'));
    expect(s.state).toBe('valid');
    expect(s.expiresAt.toISOString()).toBe(new Date('2027-01-01T00:00:00Z').toISOString());
    expect(s.daysLeft).toBe(214);
  });

  it('만료 30일 이내면 expiring', () => {
    // 만료 2027-01-01, 현재 2026-12-10 → 22일 남음
    const s = crewVerificationStatus(crew(), at('2026-12-10T00:00:00Z'));
    expect(s.state).toBe('expiring');
    expect(s.daysLeft).toBe(22);
    expect(s.daysLeft).toBeLessThanOrEqual(CREW_RENEW_NOTICE_DAYS);
  });

  it('경계: 정확히 30일 남으면 expiring, 31일이면 valid', () => {
    expect(crewVerificationStatus(crew(), at('2026-12-02T00:00:00Z')).state).toBe('expiring');
    expect(crewVerificationStatus(crew(), at('2026-12-01T00:00:00Z')).state).toBe('valid');
  });

  it('만료일이 지났으면 crew_verified 가 아직 true 여도 expired (cron 전 구간)', () => {
    const s = crewVerificationStatus(crew(), at('2027-01-02T00:00:00Z'));
    expect(s.state).toBe('expired');
    expect(s.daysLeft).toBeNull();
  });

  it('DB 가 플래그를 내렸으면 expired', () => {
    expect(crewVerificationStatus(crew({ crew_verified: false }), at('2026-06-01T00:00:00Z')).state).toBe('expired');
  });

  it('만료 시각 정각은 만료로 본다(경계)', () => {
    expect(crewVerificationStatus(crew(), at('2027-01-01T00:00:00Z')).state).toBe('expired');
    // 1초 전은 아직 유효 — 남은 일수는 최소 1일로 표시된다('0일 전'이 나오지 않게)
    const almost = crewVerificationStatus(crew(), at('2026-12-31T23:59:59Z'));
    expect(almost.state).toBe('expiring');
    expect(almost.daysLeft).toBe(1);
  });

  it('2월 29일 인증분은 다음 해 3월 1일에 만료된다(DB 의 NOW() - 1 year 비교와 같은 날)', () => {
    const leap = crew({ crew_verified_at: '2024-02-29T00:00:00Z' });
    expect(crewVerificationStatus(leap, at('2025-02-28T12:00:00Z')).state).not.toBe('expired');
    expect(crewVerificationStatus(leap, at('2025-03-01T00:00:00Z')).state).toBe('expired');
  });

  it('인증 시각이 없는 레거시 계정은 플래그만 본다', () => {
    const ok = crewVerificationStatus(crew({ crew_verified_at: null }));
    expect(ok.state).toBe('valid');
    expect(ok.expiresAt).toBeNull();
    expect(crewVerificationStatus(crew({ crew_verified_at: null, crew_verified: false })).state).toBe('expired');
  });
});

describe('renewErrorMessage', () => {
  it('RPC 예외 문구를 안내로 바꾼다', () => {
    expect(renewErrorMessage('crew airline verification required')).toContain('지원하지 않는 항공사');
    expect(renewErrorMessage('AIRLINE_EMAIL_ALREADY_CLAIMED')).toContain('다른 계정이 사용 중');
    expect(renewErrorMessage('AIRLINE_EMAIL_PREVIOUSLY_USED')).toContain('다시 쓸 수 없습니다');
    expect(renewErrorMessage('OTP_PROOF_REQUIRED_AIRLINE')).toContain('먼저 완료');
    expect(renewErrorMessage('OTP_PROOF_INVALID_AIRLINE')).toContain('만료');
    expect(renewErrorMessage('NOT_CREW')).toContain('승무원 계정');
    expect(renewErrorMessage('auth required')).toContain('로그인');
  });

  it('Postgres 접두사가 붙어도 매칭된다', () => {
    expect(renewErrorMessage('P0001: AIRLINE_EMAIL_ALREADY_CLAIMED')).toContain('다른 계정이 사용 중');
  });

  it('모르는 오류·빈 값은 기본 안내', () => {
    expect(renewErrorMessage('')).toContain('갱신에 실패');
    expect(renewErrorMessage(undefined)).toContain('갱신에 실패');
    expect(renewErrorMessage('boom')).toContain('갱신에 실패');
  });
});

describe('formatExpiryDate', () => {
  it('null 이면 빈 문자열', () => {
    expect(formatExpiryDate(null)).toBe('');
  });

  it('날짜를 한국어로 적는다', () => {
    expect(formatExpiryDate(new Date(2027, 8, 5))).toContain('2027');
  });
});

describe('배너 닫기(하루 단위)', () => {
  let store;
  const hadOriginal = 'localStorage' in globalThis;
  const original = globalThis.localStorage;
  // Node 는 localStorage 를 접근자 속성으로 둘 수 있어 단순 대입이 막힌다 → defineProperty 로 갈아끼운다.
  const install = (impl) => Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });

  beforeEach(() => {
    store = new Map();
    install({
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
  });

  afterEach(() => {
    if (hadOriginal) install(original);
    else delete globalThis.localStorage;
  });

  it('dayKey 는 로컬 기준 YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('닫은 날에는 숨기고 다음 날에는 다시 보인다', () => {
    hideRenewBannerToday('u1', '2026-09-05');
    expect(isRenewBannerHidden('u1', '2026-09-05')).toBe(true);
    expect(isRenewBannerHidden('u1', '2026-09-06')).toBe(false);
  });

  it('다른 계정에는 적용되지 않는다', () => {
    hideRenewBannerToday('u1', '2026-09-05');
    expect(isRenewBannerHidden('u2', '2026-09-05')).toBe(false);
  });

  it('저장된 값이 깨져 있으면 숨기지 않는다', () => {
    store.set('ct_crew_renew_dismissed', '{oops');
    expect(isRenewBannerHidden('u1', '2026-09-05')).toBe(false);
  });

  it('저장소가 막혀 있어도 던지지 않는다', () => {
    install({
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(isRenewBannerHidden('u1')).toBe(false);
    expect(() => hideRenewBannerToday('u1')).not.toThrow();
  });
});
