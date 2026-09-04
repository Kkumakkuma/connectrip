import { describe, it, expect } from 'vitest';
import {
  formatInZone,
  isValidTimeZone,
  offsetMsAt,
  resolveTripZone,
  timeZoneGapText,
  zoneForCountry,
  zonedTimeToUtc,
} from './timezone';

const HOUR = 3600000;

describe('isValidTimeZone', () => {
  it('IANA 이름을 받는다', () => {
    expect(isValidTimeZone('Asia/Seoul')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
  });
  it('빈 값·이상한 이름은 거부한다', () => {
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});

describe('offsetMsAt', () => {
  it('서울은 연중 +9시간', () => {
    expect(offsetMsAt(Date.UTC(2026, 0, 15), 'Asia/Seoul')).toBe(9 * HOUR);
    expect(offsetMsAt(Date.UTC(2026, 6, 15), 'Asia/Seoul')).toBe(9 * HOUR);
  });
  it('뉴욕은 여름에 -4, 겨울에 -5시간', () => {
    expect(offsetMsAt(Date.UTC(2026, 6, 15), 'America/New_York')).toBe(-4 * HOUR);
    expect(offsetMsAt(Date.UTC(2026, 0, 15), 'America/New_York')).toBe(-5 * HOUR);
  });
});

describe('zonedTimeToUtc', () => {
  it('도쿄 10:30 은 UTC 01:30 이다', () => {
    const d = zonedTimeToUtc('2026-10-01', '10:30', 'Asia/Tokyo');
    expect(d.toISOString()).toBe('2026-10-01T01:30:00.000Z');
  });

  it('같은 벽시계라도 타임존이 다르면 다른 순간이 된다', () => {
    const seoul = zonedTimeToUtc('2026-10-01', '21:40', 'Asia/Seoul');
    const paris = zonedTimeToUtc('2026-10-01', '21:40', 'Europe/Paris');
    expect(paris.getTime() - seoul.getTime()).toBe(7 * HOUR); // 파리가 7시간 늦다
  });

  it('시각을 안 주면 자정으로 본다', () => {
    const d = zonedTimeToUtc('2026-10-01', null, 'Asia/Seoul');
    expect(d.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('서머타임 시작 뒤 시각은 여름 오프셋으로 계산한다', () => {
    // 뉴욕 2026-03-08 02:00 에 시계를 앞당긴다. 그날 09:00 은 EDT(-4).
    const d = zonedTimeToUtc('2026-03-08', '09:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('서머타임 시작 직전 시각은 겨울 오프셋으로 계산한다', () => {
    const d = zonedTimeToUtc('2026-03-08', '01:30', 'America/New_York');
    expect(d.toISOString()).toBe('2026-03-08T06:30:00.000Z'); // EST(-5)
  });

  it('없는 시각(봄 전환의 02:30)은 전환 뒤로 밀어 유효한 순간을 준다', () => {
    const d = zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York');
    expect(d).toBeInstanceOf(Date);
    expect(Number.isFinite(d.getTime())).toBe(true);
    // 되돌려 읽으면 03:30(전환 뒤 시각)이 된다 — 사라지지 않는다.
    expect(formatInZone(d, 'America/New_York')).toBe('2026-03-08 03:30');
  });

  it('겹치는 시각(가을 전환의 01:30)은 앞선 쪽을 고른다', () => {
    // 2026-11-01 01:30 은 EDT(-4)와 EST(-5) 두 번 온다. 앞선 쪽 = EDT.
    const d = zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(d.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });


  it('남반구 겹치는 시각(오클랜드 가을 전환)도 앞선 쪽을 고른다', () => {
    // 2026-04-05 02:30 Pacific/Auckland 는 두 번 온다(+13 먼저, +12 나중).
    // 초기 추측 방향에 끌려가면 남반구에서만 틀린다 — 실제로 그랬다(2026-09-04 교차검토).
    const d = zonedTimeToUtc('2026-04-05', '02:30', 'Pacific/Auckland');
    expect(d.toISOString()).toBe('2026-04-04T13:30:00.000Z');
  });

  it('달력에 없는 날짜는 다른 달로 넘기지 않고 거부한다', () => {
    expect(zonedTimeToUtc('2026-02-31', '10:00', 'Asia/Seoul')).toBeNull();
    expect(zonedTimeToUtc('2026-13-01', '10:00', 'Asia/Seoul')).toBeNull();
  });

  it('타임존을 모르면 null — 추측하지 않는다', () => {
    expect(zonedTimeToUtc('2026-10-01', '10:30', null)).toBeNull();
    expect(zonedTimeToUtc('2026-10-01', '10:30', 'Not/AZone')).toBeNull();
  });

  it('날짜·시각 형식이 틀리면 null', () => {
    expect(zonedTimeToUtc('2026/10/01', '10:30', 'Asia/Seoul')).toBeNull();
    expect(zonedTimeToUtc('2026-10-01', '25:00', 'Asia/Seoul')).toBeNull();
  });

  it('왕복 변환이 어긋나지 않는다', () => {
    ['Asia/Seoul', 'Asia/Tokyo', 'Europe/Paris', 'America/New_York', 'Pacific/Auckland'].forEach((z) => {
      ['2026-01-15', '2026-06-15', '2026-10-01'].forEach((day) => {
        const d = zonedTimeToUtc(day, '14:05', z);
        expect(formatInZone(d, z)).toBe(`${day} 14:05`);
      });
    });
  });
});

describe('timeZoneGapText', () => {
  it('한국에서 볼 때 도쿄는 시차가 없다', () => {
    expect(timeZoneGapText(Date.UTC(2026, 9, 1), 'Asia/Tokyo', 'Asia/Seoul')).toBe('');
  });
  it('한국에서 볼 때 파리는 7시간 느리다', () => {
    expect(timeZoneGapText(Date.UTC(2026, 9, 1), 'Europe/Paris', 'Asia/Seoul')).toBe('현지가 7시간 느립니다');
  });
  it('30분 단위 시차도 문장으로 낸다', () => {
    expect(timeZoneGapText(Date.UTC(2026, 9, 1), 'Asia/Kathmandu', 'Asia/Seoul')).toBe('현지가 3시간 15분 느립니다');
  });
});

describe('zoneForCountry / resolveTripZone', () => {
  it('한 시간대 나라는 이름으로 찾는다', () => {
    expect(zoneForCountry('일본')).toBe('Asia/Tokyo');
    expect(zoneForCountry('대한민국')).toBe('Asia/Seoul');
  });
  it('여러 시간대인 나라는 추측하지 않는다', () => {
    expect(zoneForCountry('미국')).toBeNull();
    expect(zoneForCountry('러시아')).toBeNull();
    expect(zoneForCountry('')).toBeNull();
  });

  it('여러 시간대인 나라는 넣지 않는다 — 발리·퍼스에서 알림이 어긋난다', () => {
    expect(zoneForCountry('호주')).toBeNull();
    expect(zoneForCountry('인도네시아')).toBeNull();
    expect(zoneForCountry('스페인')).toBeNull();
    expect(zoneForCountry('포르투갈')).toBeNull();
  });

  it('여행에 저장된 타임존이 나라 이름보다 우선한다', () => {
    expect(resolveTripZone({ timezone: 'America/Los_Angeles', country: '일본' })).toBe('America/Los_Angeles');
    expect(resolveTripZone({ timezone: null, country: '일본' })).toBe('Asia/Tokyo');
    expect(resolveTripZone({ timezone: 'Not/AZone', country: '미국' })).toBeNull();
  });
});
