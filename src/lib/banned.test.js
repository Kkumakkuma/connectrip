import { describe, it, expect } from 'vitest';
import { isBannedError, BANNED_MESSAGE } from './banned';

describe('isBannedError', () => {
  it('message 에 BANNED 가 들어 있으면 true (PostgREST P0001 형식 포함)', () => {
    expect(isBannedError({ message: 'BANNED' })).toBe(true);
    expect(isBannedError({ message: 'P0001: BANNED', code: 'P0001' })).toBe(true);
  });
  it('code 에 있거나, 우리 RAISE(P0001)의 details/hint 에 있으면 true', () => {
    expect(isBannedError({ message: 'x', code: 'BANNED' })).toBe(true);
    expect(isBannedError({ message: 'x', code: 'P0001', details: 'BANNED' })).toBe(true);
    expect(isBannedError({ message: 'x', code: 'P0001', hint: 'BANNED' })).toBe(true);
  });
  it('제약 위반 details 에 실린 사용자 본문의 BANNED 는 오탐하지 않는다', () => {
    expect(isBannedError({
      message: 'new row for relation "companion_comments" violates check constraint "c"',
      code: '23514',
      details: 'Failing row contains (1, 2, I got BANNED from a bar, null).',
    })).toBe(false);
    expect(isBannedError({ message: 'UNBANNED', code: 'P0001' })).toBe(false);
  });
  it('BANNED 가 없거나 오류가 비면 false', () => {
    expect(isBannedError({ message: 'BLOCKED', code: 'P0001' })).toBe(false);
    expect(isBannedError({ message: 'phone verification required' })).toBe(false);
    expect(isBannedError(null)).toBe(false);
    expect(isBannedError(undefined)).toBe(false);
    expect(isBannedError({})).toBe(false);
  });
  it('문구는 한 문장으로 고정', () => {
    expect(BANNED_MESSAGE).toBe('이용이 제한된 계정입니다. 동행 모집·참여, 쪽지·대화, 장터 거래를 할 수 없습니다.');
  });
});
