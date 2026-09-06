import { describe, expect, it } from 'vitest';
import { legItems, legsCurrent, legsUseGoogle, legsValid, normalizeLegs } from './legs';

const items3 = [
  { from: 0, to: 1, mode: 'WALK', duration_s: 60, distance_m: 100, source: 'google' },
  { from: 1, to: 2, mode: 'TRANSIT', duration_s: 600, distance_m: 5000, source: 'cache', steps: [] },
  { from: 2, to: 3, mode: 'WALK', duration_s: 60, distance_m: 100, source: 'estimate' },
];

describe('legItems / normalizeLegs', () => {
  it('서버 스냅샷(배열)과 로컬 봉투({items}) 를 같은 배열로', () => {
    expect(legItems(items3)).toBe(items3);
    expect(legItems({ v: 2, items: items3 })).toBe(items3);
    expect(legItems(null)).toEqual([]);
    expect(legItems({ items: 'x' })).toEqual([]);
  });
  it('개수·연속성이 맞으면 stale=false, 아니면 stale=true', () => {
    expect(normalizeLegs(items3, 4)).toEqual({ items: items3, stale: false });
    expect(normalizeLegs({ items: items3 }, 5).stale).toBe(true);
    const shuffled = [items3[1], items3[0], items3[2]];
    expect(normalizeLegs(shuffled, 4).stale).toBe(true);   // 같은 개수라도 순서가 어긋나면 신뢰하지 않는다(codex)
    expect(normalizeLegs([], 4)).toEqual({ items: [], stale: false });
    expect(normalizeLegs(null, 1)).toEqual({ items: [], stale: false });
  });
  it('legsValid', () => {
    expect(legsValid(items3, 3)).toBe(true);
    expect(legsValid(items3, 2)).toBe(false);
    expect(legsValid(null, 0)).toBe(false);
  });
});

describe('legsCurrent', () => {
  it('v2 는 최신, 구버전은 구글 대중교통 구간이 있을 때만 재계산 대상', () => {
    expect(legsCurrent({ v: 2, items: items3 })).toBe(true);
    expect(legsCurrent({ items: items3 })).toBe(false);            // cache TRANSIT 있음 → 재계산
    expect(legsCurrent({ items: [items3[0], items3[2]] })).toBe(true);   // 도보·추정만 → 그대로
    expect(legsCurrent({ items: [{ ...items3[1], source: 'estimate' }] })).toBe(true);
    expect(legsCurrent(null)).toBe(false);
    expect(legsCurrent(items3)).toBe(false);
  });
});

describe('legsUseGoogle', () => {
  it('google/cache 출처가 하나라도 있으면 true', () => {
    expect(legsUseGoogle(items3)).toBe(true);
    expect(legsUseGoogle([items3[2]])).toBe(false);
    expect(legsUseGoogle(undefined)).toBe(false);
  });
});
