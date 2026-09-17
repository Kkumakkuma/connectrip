import { describe, expect, it } from 'vitest';

import {
  AIRLINE_TAGS,
  AIRLINE_TAG_IDS,
  airlineFromSearch,
  airlineTagOf,
  isAirlineTagId,
  withAirlineParam,
} from './airlineTags';

describe('airlineTags', () => {
  it('id 와 이름이 겹치지 않는다', () => {
    expect(new Set(AIRLINE_TAG_IDS).size).toBe(AIRLINE_TAGS.length);
    expect(new Set(AIRLINE_TAGS.map((a) => a.name)).size).toBe(AIRLINE_TAGS.length);
  });

  it('색 토큰이 정적 문자열이고 말머리마다 다르다', () => {
    for (const a of AIRLINE_TAGS) {
      expect(a.text).toMatch(/^text-[a-z]+-\d{3}$/);
      expect(a.bg).toMatch(/^bg-[a-z]+-\d{2,3}$/);
    }
    expect(new Set(AIRLINE_TAGS.map((a) => a.bg)).size).toBe(AIRLINE_TAGS.length);
  });

  it('국내 항공사와 외항사·공통이 들어 있다', () => {
    for (const id of ['ke', 'oz', '7c', 'lj', 'tw', 'bx', 'rs', 'ze', 'yp', 'rf', 'foreign', 'common']) {
      expect(isAirlineTagId(id), `${id} 없음`).toBe(true);
    }
  });

  it('모르는 값은 undefined 를 준다(배지를 안 그린다)', () => {
    expect(airlineTagOf('zz')).toBeUndefined();
    expect(airlineTagOf(null)).toBeUndefined();
    expect(airlineTagOf('')).toBeUndefined();
  });

  it('URL 파라미터를 왕복한다', () => {
    expect(airlineFromSearch('?airline=ke')).toBe('ke');
    expect(airlineFromSearch('?airline=zz')).toBeNull();
    expect(airlineFromSearch('')).toBeNull();
    expect(withAirlineParam('?tab=free', 'ke')).toBe('?tab=free&airline=ke');
    expect(withAirlineParam('?tab=free&airline=ke', null)).toBe('?tab=free');
    // 다른 파라미터는 건드리지 않는다
    expect(withAirlineParam('?tab=free&q=%EB%A0%88%EC%9D%B4', '7c')).toContain('q=');
  });
});
