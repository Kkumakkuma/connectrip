import { describe, it, expect } from 'vitest';
import { timeAgo, messageTime, groupByDay, priceLabel, statusLabel, chatErrorMessage, pollDelay } from './chat';

const NOW = Date.parse('2026-09-06T12:00:00+09:00');

describe('timeAgo', () => {
  it('구간별 표기', () => {
    expect(timeAgo('2026-09-06T11:59:30+09:00', NOW)).toBe('방금 전');
    expect(timeAgo('2026-09-06T11:45:00+09:00', NOW)).toBe('15분 전');
    expect(timeAgo('2026-09-06T09:00:00+09:00', NOW)).toBe('3시간 전');
    expect(timeAgo('2026-09-03T12:00:00+09:00', NOW)).toBe('3일 전');
    expect(timeAgo('', NOW)).toBe('');
  });
});

describe('messageTime / groupByDay', () => {
  it('오늘은 시:분, 다른 날은 월.일 시:분', () => {
    expect(messageTime('2026-09-06T09:05:00+09:00', NOW)).toBe('09:05');
    expect(messageTime('2026-09-05T21:07:00+09:00', NOW)).toBe('9.5 21:07');
  });
  it('날짜별 묶기', () => {
    const g = groupByDay([
      { id: 1, created_at: '2026-09-05T10:00:00+09:00' },
      { id: 2, created_at: '2026-09-05T11:00:00+09:00' },
      { id: 3, created_at: '2026-09-06T08:00:00+09:00' },
    ]);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([['2026년 9월 5일', 2], ['2026년 9월 6일', 1]]);
    expect(groupByDay([])).toEqual([]);
  });
});

describe('priceLabel / statusLabel', () => {
  it('나눔·가격·상태 라벨', () => {
    expect(priceLabel({ type: 'share', price: 0 })).toBe('나눔');
    expect(priceLabel({ type: 'sell', price: 15000 })).toBe('15,000원');
    expect(priceLabel({ type: 'sell', price: null })).toBe('가격 없음');
    expect(statusLabel({ type: 'sell', status: 'reserved' })).toBe('예약중');
    expect(statusLabel({ type: 'share', status: 'sold' })).toBe('나눔완료');
    expect(statusLabel({ type: 'share', status: 'active' })).toBe('나눔중');
  });
});

describe('chatErrorMessage / pollDelay', () => {
  it('서버 코드 매핑', () => {
    expect(chatErrorMessage({ message: 'P0001: BLOCKED' }, '실패')).toBe('차단된 회원입니다.');
    expect(chatErrorMessage({ message: 'x' }, '실패')).toBe('실패');
  });
  it('유휴 시간에 따라 늦춘다', () => {
    expect(pollDelay(3000, 0)).toBe(3000);
    expect(pollDelay(3000, 90 * 1000)).toBe(9000);
    expect(pollDelay(3000, 6 * 60 * 1000)).toBe(30000);
  });
});
