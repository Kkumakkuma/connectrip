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

  it('구글 경로 좌표(polyline)가 있는 구간은 실제 길로, 없거나 깨졌으면 직선으로 그린다', () => {
    const pins = [{ id: 'a', lat: 38.5, lng: -120.2 }, { id: 'b', lat: 43.252, lng: -126.453 }, { id: 'c', lat: 44, lng: -127 }];
    // 구글 문서 예시 벡터: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const legs = [{ mode: 'WALK', polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, { mode: 'TRANSIT', polyline: '가나' }];
    const [s1, s2] = routeSegments(pins, legs);
    expect(s1.real).toBe(true);
    expect(s1.path[0]).toEqual({ lat: 38.5, lng: -120.2 });                  // 양 끝은 핀 좌표로 닫는다
    expect(s1.path[s1.path.length - 1]).toEqual({ lat: 43.252, lng: -126.453 });
    expect(s1.path).toHaveLength(5);
    expect(s1.path[2]).toEqual({ lat: 40.7, lng: -120.95 });
    expect(s2.real).toBe(false);
    expect(s2.path).toEqual([{ lat: 43.252, lng: -126.453 }, { lat: 44, lng: -127 }]);
    const [s3] = routeSegments(pins.slice(0, 2), [{ mode: 'WALK' }]);        // polyline 없음 → 직선
    expect(s3.real).toBe(false);
    expect(s3.path).toHaveLength(2);
  });

  it('범례는 실제로 그려진 모드만, 표 순서대로', () => {
    const seg = routeSegments([P(1, 1), P(2, 2), P(3, 3), P(4, 4)], [{ mode: 'TRANSIT' }, { mode: 'WALK' }, { mode: 'TRANSIT' }]);
    expect(legendEntries(seg).map((e) => e.mode)).toEqual(['WALK', 'TRANSIT']);
    expect(legendEntries(routeSegments([P(1, 1), P(2, 2)], null))).toEqual([]);
    expect(legendEntries([])).toEqual([]);
  });
});
