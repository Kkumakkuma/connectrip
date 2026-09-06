import { describe, expect, it } from 'vitest';
import { MAX_STEPS, MAX_TEXT, summarizeTransitSteps } from './_transit.js';

const walk = (s) => ({ travelMode: 'WALK', staticDuration: `${s}s` });
const ride = (line, from, to, stops, s, vehicle = 'SUBWAY', nameShort = undefined) => ({
  travelMode: 'TRANSIT',
  staticDuration: `${s}s`,
  transitDetails: {
    stopCount: stops,
    transitLine: { name: line, nameShort, vehicle: { type: vehicle } },
    stopDetails: { departureStop: { name: from }, arrivalStop: { name: to } },
  },
});

describe('summarizeTransitSteps', () => {
  it('도보 → 지하철 → 도보를 요약하고 연속 도보는 합친다', () => {
    const route = { legs: [{ steps: [walk(120), walk(60), ride('2호선', '강남', '삼성', 6, 600), walk(90)] }] };
    expect(summarizeTransitSteps(route)).toEqual([
      { t: 'WALK', s: 180 },
      { t: 'TRANSIT', v: 'SUBWAY', line: '2호선', from: '강남', to: '삼성', stops: 6, s: 600 },
      { t: 'WALK', s: 90 },
    ]);
  });

  it('노선 짧은 이름(nameShort)이 있으면 그것을, 없으면 이름을 쓴다', () => {
    const r = { legs: [{ steps: [ride('Central Line', 'A', 'B', 2, 100, 'SUBWAY', 'Central')] }] };
    expect(summarizeTransitSteps(r)[0].line).toBe('Central');
    const r2 = { legs: [{ steps: [ride('Central Line', 'A', 'B', 2, 100)] }] };
    expect(summarizeTransitSteps(r2)[0].line).toBe('Central Line');
  });

  it('대중교통 단계가 없으면 null, 빈 입력도 null', () => {
    expect(summarizeTransitSteps({ legs: [{ steps: [walk(300)] }] })).toBeNull();
    expect(summarizeTransitSteps(null)).toBeNull();
    expect(summarizeTransitSteps({})).toBeNull();
  });

  it('긴 문자열은 자르고 단계 수는 상한을 넘지 않는다', () => {
    const long = 'x'.repeat(100);
    const steps = [];
    for (let i = 0; i < 30; i += 1) steps.push(ride(long, long, long, 1, 10), walk(10));
    const out = summarizeTransitSteps({ legs: [{ steps }] });
    expect(out.length).toBe(MAX_STEPS + 1);
    expect(out[out.length - 1]).toEqual({ t: 'MORE' });   // 생략 표시(codex 9/6)
    expect(out[0].line.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(out[0].line.endsWith('…')).toBe(true);
  });

  it('차량 종류·정류장 수가 없어도 안전하게 채운다', () => {
    const r = { legs: [{ steps: [{ travelMode: 'TRANSIT', staticDuration: '30s', transitDetails: { transitLine: {} } }] }] };
    expect(summarizeTransitSteps(r)).toEqual([{ t: 'TRANSIT', v: 'OTHER', line: '', from: '', to: '', stops: null, s: 30 }]);
  });

  it('도보 이외의 비대중교통 단계도 도보로 합쳐 세지 않는다', () => {
    const r = { legs: [{ steps: [{ travelMode: 'WALK', staticDuration: '10s' }, { travelMode: 'DRIVE', staticDuration: '20s' }, ride('A', 'B', 'C', 1, 5)] }] };
    expect(summarizeTransitSteps(r)[0]).toEqual({ t: 'WALK', s: 30 });
  });
});
