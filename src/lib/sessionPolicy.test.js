import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_LIMIT_MS, KEEP_KEY, LAST_ACTIVE_KEY,
  clearSessionPolicy, getLastActive, isIdleExpired, isKeepLogin, setKeepLogin, touchActivity,
} from './sessionPolicy';

// vitest 기본 환경은 node 라 window/localStorage 가 없다 — 모듈이 window.localStorage 만 쓰므로 메모리 저장소를 붙인다.
class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
Object.defineProperty(globalThis.window, 'localStorage', { value: storage, configurable: true });

describe('sessionPolicy', () => {
  beforeEach(() => { storage.clear(); vi.restoreAllMocks(); });

  it('기본은 유지 아님, 체크하면 유지', () => {
    expect(isKeepLogin()).toBe(false);
    setKeepLogin(true);
    expect(isKeepLogin()).toBe(true);
    expect(storage.getItem(KEEP_KEY)).toBe('1');
    setKeepLogin(false);
    expect(isKeepLogin()).toBe(false);
    expect(storage.getItem(KEEP_KEY)).toBeNull();
  });

  it('활동 기록이 없으면 만료가 아니다(정책 도입 전 로그인한 사람을 바로 내쫓지 않는다)', () => {
    expect(getLastActive()).toBeNull();
    expect(isIdleExpired(1_000_000)).toBe(false);
  });

  it('한도 안이면 유지, 한도를 넘기면 만료', () => {
    const t0 = 1_700_000_000_000;
    touchActivity(t0);
    expect(getLastActive()).toBe(t0);
    expect(isIdleExpired(t0 + IDLE_LIMIT_MS)).toBe(false);      // 딱 한도 = 아직
    expect(isIdleExpired(t0 + IDLE_LIMIT_MS + 1)).toBe(true);   // 1ms 초과 = 만료
    expect(isIdleExpired(t0 + 10, 5)).toBe(true);               // 한도 인자
  });

  it('유지를 선택했으면 아무리 오래 지나도 만료가 아니다', () => {
    setKeepLogin(true);
    touchActivity(1);
    expect(isIdleExpired(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('시계가 거꾸로 가면(now < last) 만료가 아니다', () => {
    touchActivity(5_000_000);
    expect(isIdleExpired(1_000)).toBe(false);
  });

  it('깨진 값은 기록 없음으로 본다', () => {
    storage.setItem(LAST_ACTIVE_KEY, 'abc');
    expect(getLastActive()).toBeNull();
    storage.setItem(LAST_ACTIVE_KEY, '-3');
    expect(getLastActive()).toBeNull();
  });

  it('로그아웃 정리는 둘 다 지운다', () => {
    setKeepLogin(true); touchActivity(123);
    clearSessionPolicy();
    expect(storage.getItem(KEEP_KEY)).toBeNull();
    expect(storage.getItem(LAST_ACTIVE_KEY)).toBeNull();
  });

  it('localStorage 가 막힌 환경에서는 예외 없이 "적용 안 함" 으로 간다', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setKeepLogin(true)).not.toThrow();
    expect(touchActivity(1)).toBe(false);
    expect(isKeepLogin()).toBe(false);
    expect(isIdleExpired(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(() => clearSessionPolicy()).not.toThrow();
  });
});
