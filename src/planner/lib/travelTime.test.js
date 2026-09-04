import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  estimateLeg,
  estimateLegs,
  pickMode,
  totalDurationSeconds,
  formatDuration,
  formatDistance,
  TRAVEL_ASSUMPTIONS,
  WALK_MAX_M,
} from './travelTime';

// 서울시청 ↔ 광화문(약 900m), 서울시청 ↔ 강남역(약 8.2km)
const cityHall = { lat: 37.5663, lng: 126.9779 };
const gwanghwamun = { lat: 37.5759, lng: 126.9769 };
const gangnam = { lat: 37.4979, lng: 127.0276 };

describe('하버사인 거리', () => {
  it('알려진 두 지점 사이 거리를 오차 5% 안에서 계산한다', () => {
    expect(haversineMeters(cityHall, gwanghwamun)).toBeGreaterThan(950);
    expect(haversineMeters(cityHall, gwanghwamun)).toBeLessThan(1150);
    expect(haversineMeters(cityHall, gangnam)).toBeGreaterThan(8000);
    expect(haversineMeters(cityHall, gangnam)).toBeLessThan(9200);
  });

  it('같은 지점은 0m 다', () => {
    expect(haversineMeters(cityHall, cityHall)).toBeCloseTo(0, 6);
  });

  it('좌표가 없으면 null 을 돌려준다', () => {
    expect(haversineMeters(null, cityHall)).toBeNull();
    expect(haversineMeters({ lat: 'x', lng: 1 }, cityHall)).toBeNull();
  });
});

describe('이동 수단 선택', () => {
  it('직선 1.2km 이하는 도보, 넘으면 대중교통으로 본다', () => {
    expect(pickMode(WALK_MAX_M)).toBe('WALK');
    expect(pickMode(WALK_MAX_M + 1)).toBe('TRANSIT');
  });
});

describe('구간 추정', () => {
  it('보정계수를 적용한 거리와 평균 속도로 시간을 낸다', () => {
    const leg = estimateLeg(cityHall, gwanghwamun);
    expect(leg.mode).toBe('WALK');
    expect(leg.source).toBe('estimate');

    const straight = haversineMeters(cityHall, gwanghwamun);
    const { speedKmh, detour } = TRAVEL_ASSUMPTIONS.WALK;
    expect(leg.distance_m).toBe(Math.round(straight * detour));
    expect(leg.duration_s).toBe(Math.round(((straight * detour) / (speedKmh * 1000)) * 3600));
  });

  it('수단을 지정하면 그 수단으로 계산한다', () => {
    const walk = estimateLeg(cityHall, gangnam, 'WALK');
    const transit = estimateLeg(cityHall, gangnam, 'TRANSIT');
    expect(walk.mode).toBe('WALK');
    expect(transit.mode).toBe('TRANSIT');
    expect(transit.duration_s).toBeLessThan(walk.duration_s);
  });

  it('좌표 없는 핀이 끼면 그 구간만 null 이고 인덱스는 밀리지 않는다', () => {
    const legs = estimateLegs([cityHall, { lat: null, lng: null }, gangnam]);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toBeNull();
    expect(legs[1]).toBeNull();
  });

  it('핀이 하나 이하면 구간이 없다', () => {
    expect(estimateLegs([cityHall])).toEqual([]);
    expect(estimateLegs([])).toEqual([]);
  });

  it('합계는 null 구간을 0으로 센다', () => {
    expect(totalDurationSeconds([{ duration_s: 600 }, null, { duration_s: 300 }])).toBe(900);
  });
});

describe('표시 형식', () => {
  it('시간을 한국어로 옮긴다', () => {
    expect(formatDuration(30)).toBe('1분 미만');
    expect(formatDuration(720)).toBe('12분');
    expect(formatDuration(3600)).toBe('1시간');
    expect(formatDuration(3900)).toBe('1시간 5분');
  });

  it('거리는 1km 를 경계로 단위를 바꾼다', () => {
    expect(formatDistance(904)).toBe('900m');
    expect(formatDistance(1420)).toBe('1.4km');
  });
});
