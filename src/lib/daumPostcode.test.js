import { describe, it, expect } from 'vitest';
import { formatDaumAddress } from './daumPostcode';

describe('formatDaumAddress — 확정 도로명이 있으면 도로명, 없으면 사용자가 고른 지번', () => {
  it('도로명 검색: 우편번호와 도로명 주소, 법정동을 참고항목으로 붙인다', () => {
    const r = formatDaumAddress({
      zonecode: '06236', userSelectedType: 'R',
      roadAddress: '서울 강남구 테헤란로 152', jibunAddress: '서울 강남구 역삼동 737',
      bname: '역삼동', buildingName: '강남파이낸스센터', apartment: 'N',
    });
    expect(r).toEqual({ zipcode: '06236', road: '서울 강남구 테헤란로 152 (역삼동)', isRoad: true });
  });

  it('지번으로 찾아도 도로명 주소가 있으면 도로명을 넣는다', () => {
    const r = formatDaumAddress({
      zonecode: '16489', userSelectedType: 'J',
      roadAddress: '경기 수원시 영통구 광교로 145', jibunAddress: '경기 수원시 영통구 이의동 1271',
      bname: '이의동', buildingName: '', apartment: 'N',
    });
    expect(r.road).toBe('경기 수원시 영통구 광교로 145 (이의동)');
    expect(r.zipcode).toBe('16489');
    expect(r.isRoad).toBe(true);
  });

  it('1:N 필지에서 선택 안함이면 임의 매핑 도로명(autoRoadAddress)은 버리고 사용자가 고른 지번을 쓴다', () => {
    const r = formatDaumAddress({ zonecode: '12345', roadAddress: '', autoRoadAddress: '경기 어딘가로 1', jibunAddress: '경기 어딘가 1-2', bname: '', apartment: 'N' });
    expect(r).toEqual({ zipcode: '12345', road: '경기 어딘가 1-2', isRoad: false });
  });

  it('도로명이 전혀 없으면 지번으로 대체하고 isRoad=false', () => {
    const r = formatDaumAddress({ zonecode: '12345', roadAddress: '', jibunAddress: '강원 산골 1-2', bname: '산골리', apartment: 'N' });
    expect(r).toEqual({ zipcode: '12345', road: '강원 산골 1-2', isRoad: false });
  });

  it('공동주택이면 건물명을 참고항목에 같이 붙인다', () => {
    const r = formatDaumAddress({ zonecode: '13561', roadAddress: '경기 성남시 분당구 판교역로 4', bname: '백현동', buildingName: '봇들마을1단지', apartment: 'Y' });
    expect(r.road).toBe('경기 성남시 분당구 판교역로 4 (백현동, 봇들마을1단지)');
  });

  it('법정리(리로 끝남)는 참고항목에 넣지 않고, 일반 건물명도 붙이지 않는다', () => {
    const r = formatDaumAddress({ zonecode: '27000', roadAddress: '충북 어딘가로 10', bname: '용전리', buildingName: '어느빌딩', apartment: 'N' });
    expect(r.road).toBe('충북 어딘가로 10');
  });

  it('빈 입력도 안전하게 빈 값으로 돌려준다', () => {
    expect(formatDaumAddress(undefined)).toEqual({ zipcode: '', road: '', isRoad: false });
    expect(formatDaumAddress({})).toEqual({ zipcode: '', road: '', isRoad: false });
  });
});
