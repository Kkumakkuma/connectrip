import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline';

// 구글 문서의 예시 벡터: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
const SAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

describe('decodePolyline', () => {
  it('구글 예시 벡터를 정확히 푼다', () => {
    expect(decodePolyline(SAMPLE)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('빈 값·문자열 아님은 빈 배열', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(123)).toEqual([]);
  });

  it('중간에서 잘린 문자열·이상한 문자(범위 밖)는 통째로 빈 배열(앞부분만 그리면 목적지로 튀는 꺾은선이 된다)', () => {
    expect(decodePolyline(SAMPLE.slice(0, 15))).toEqual([]);
    expect(decodePolyline(SAMPLE + '_p')).toEqual([]);
    expect(decodePolyline('가나다')).toEqual([]);
    expect(decodePolyline('~~~~~~~~~~~~~~')).toEqual([]);   // shift 폭주(끝없이 이어지는 5비트 덩어리)
  });

  it('점 개수 상한을 지킨다', () => {
    expect(decodePolyline(SAMPLE, 2)).toHaveLength(2);
  });
});
