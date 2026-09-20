import { describe, expect, it } from 'vitest';
import { ROUTE_DEFAULT_STYLE, ROUTE_MODE_STYLE, dashArrayFor, legendEntries, routeSegments, routeStyleFor } from './routeStyle';

describe('routeStyle', () => {
  const P = (lat, lng, id) => ({ lat, lng, id });

  it('모드별 색이 서로 다르고, 실선은 대중교통 하나뿐이다(색각 이상에서도 형태로 갈린다)', () => {
    const s = Object.values(ROUTE_MODE_STYLE);
    expect(new Set(s.map((x) => x.color)).size).toBe(s.length);
    expect(s.filter((x) => x.dash === null)).toHaveLength(1);
    expect(ROUTE_MODE_STYLE.WALK.dash).toBe('short');
    expect(ROUTE_MODE_STYLE.DRIVE.dash).toBe('long');
    expect(routeStyleFor('없는모드')).toBe(ROUTE_DEFAULT_STYLE);
    expect(dashArrayFor(null)).toBeNull();
    expect(dashArrayFor('short')).not.toBe(dashArrayFor('long'));
  });

  it('핀 i→i+1 구간에 legs[i] 의 모드를 붙이고 key 는 핀 id 로 만든다', () => {
    const pins = [P(1, 1, 'a'), P(2, 2, 'b'), P(3, 3, 'c')];
    const legs = [{ mode: 'WALK' }, { mode: 'TRANSIT' }];
    const seg = routeSegments(pins, legs);
    expect(seg.map((s) => s.mode)).toEqual(['WALK', 'TRANSIT']);
    expect(seg.map((s) => s.key)).toEqual(['a-b', 'b-c']);
    expect(seg[0].a).toEqual({ lat: 1, lng: 1 }); expect(seg[0].b).toEqual({ lat: 2, lng: 2 });
    expect(seg[1].style.color).toBe(ROUTE_MODE_STYLE.TRANSIT.color);
  });

  it('좌표 없는 핀을 건너뛴 구간은 모드를 단정하지 않는다(기본 스타일)', () => {
    const pins = [P(1, 1, 'a'), { lat: null, lng: null, id: 'x' }, P(3, 3, 'c')];
    const legs = [{ mode: 'WALK' }, { mode: 'TRANSIT' }];
    const seg = routeSegments(pins, legs);
    expect(seg).toHaveLength(1);
    expect(seg[0].key).toBe('a-c');
    expect(seg[0].mode).toBeNull();
    expect(seg[0].style).toBe(ROUTE_DEFAULT_STYLE);
  });

  it('legs 가 없거나 짧으면 기본 스타일로 그린다', () => {
    const pins = [P(1, 1), P(2, 2), P(3, 3)];
    expect(routeSegments(pins, null).every((s) => s.style === ROUTE_DEFAULT_STYLE)).toBe(true);
    expect(routeSegments(pins, null).map((s) => s.key)).toEqual(['0-1', '1-2']);   // id 없으면 인덱스
    const seg = routeSegments(pins, [{ mode: 'WALK' }]);
    expect(seg[0].mode).toBe('WALK'); expect(seg[1].mode).toBeNull();
  });

  it('범례는 실제로 그려진 모드만, 표 순서대로', () => {
    const seg = routeSegments([P(1, 1), P(2, 2), P(3, 3), P(4, 4)], [{ mode: 'TRANSIT' }, { mode: 'WALK' }, { mode: 'TRANSIT' }]);
    expect(legendEntries(seg).map((e) => e.mode)).toEqual(['WALK', 'TRANSIT']);
    expect(legendEntries(routeSegments([P(1, 1), P(2, 2)], null))).toEqual([]);
    expect(legendEntries([])).toEqual([]);
  });
});
