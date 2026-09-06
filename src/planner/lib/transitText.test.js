import { describe, expect, it } from 'vitest';
import { hasMoreSteps, transferCount, transitStepText, transitStepsText, vehicleLabel } from './transitText';

describe('transitText', () => {
  it('단계를 한국어 문장으로', () => {
    expect(transitStepText({ t: 'WALK', s: 300 })).toBe('도보 5분');
    expect(transitStepText({ t: 'TRANSIT', v: 'SUBWAY', line: '2호선', from: '강남', to: '삼성', stops: 6, s: 600 })).toBe('지하철 2호선 강남 → 삼성 (6정거장)');
    expect(transitStepText({ t: 'TRANSIT', v: 'BUS', line: '146', from: '역삼역', to: '', stops: null, s: 100 })).toBe('버스 146 역삼역');
    expect(transitStepText({ t: 'TRANSIT', v: 'WEIRD', line: '', from: '', to: '', stops: 0, s: 1 })).toBe('대중교통');
    expect(transitStepText({ t: 'MORE' })).toBe('이후 구간 생략');
    // 문자열이 아닌 값은 무시한다(legs 는 소유자가 직접 고칠 수 있는 jsonb)
    expect(transitStepText({ t: 'TRANSIT', v: 'BUS', line: { x: 1 }, from: 3, to: null, stops: 2.5, s: 1 })).toBe('버스');
    expect(transitStepText({ t: 'WALK', s: 'abc' })).toBe('');
  });

  it('차량 라벨', () => {
    expect(vehicleLabel('HEAVY_RAIL')).toBe('기차');
    expect(vehicleLabel('tram')).toBe('트램');
    expect(vehicleLabel(undefined)).toBe('대중교통');
    expect(vehicleLabel({ toString: null })).toBe('대중교통');
    expect(vehicleLabel(42)).toBe('대중교통');
  });

  it('대중교통 단계가 없으면 빈 목록, 환승 수', () => {
    expect(transitStepsText([{ t: 'WALK', s: 100 }])).toEqual([]);
    expect(transitStepsText(null)).toEqual([]);
    const steps = [{ t: 'WALK', s: 60 }, { t: 'TRANSIT', v: 'SUBWAY', line: '1', from: 'a', to: 'b', stops: 2, s: 1 }, { t: 'TRANSIT', v: 'BUS', line: '9', from: 'b', to: 'c', stops: 3, s: 1 }];
    expect(transitStepsText(steps)).toHaveLength(3);
    expect(transferCount(steps)).toBe(1);
    expect(transferCount([])).toBe(0);
    expect(hasMoreSteps([...steps, { t: 'MORE' }])).toBe(true);
    expect(hasMoreSteps(steps)).toBe(false);
  });
});
