import { describe, expect, it } from 'vitest';
import { composeJamo, qwertyToHangul, suggestHangul } from './hangulFix';

describe('qwertyToHangul', () => {
  it('영문 자판으로 친 장소 이름을 한글로 되살린다', () => {
    expect(qwertyToHangul('elwhdrhksrhkdwl')).toBe('디종관광지');
    expect(qwertyToHangul('fnqmfm')).toBe('루브르');
    expect(qwertyToHangul('dkssudgktpdy')).toBe('안녕하세요');
    expect(qwertyToHangul('gksrmf')).toBe('한글');
  });

  it('받침이 다음 음절 초성으로 넘어간다', () => {
    expect(qwertyToHangul('rkrk')).toBe('가가');
    expect(qwertyToHangul('dhkstjd')).toBe('완성');
    expect(qwertyToHangul('rkqt')).toBe('값');          // 겹받침 ㅄ
    expect(qwertyToHangul('rkqtdl')).toBe('값이');      // 자음(ㅇ)이 이어지면 겹받침은 그대로
    expect(qwertyToHangul('rkqtl')).toBe('갑시');       // 모음이 이어지면 겹받침의 뒷낱자가 넘어간다
  });

  it('겹모음·쌍자음(대문자)', () => {
    expect(qwertyToHangul('rhk')).toBe('과');
    expect(qwertyToHangul('dnl')).toBe('위');
    expect(qwertyToHangul('Rhc')).toBe('꽃');
    expect(qwertyToHangul('Tkf')).toBe('쌀');
  });

  it('공백·숫자·기호는 그대로 둔다', () => {
    expect(qwertyToHangul('tjdnf 2dlfck')).toBe('서울 2일차');
    expect(qwertyToHangul('rkr, dho?')).toBe('각, 왜?');
  });

  it('낱자만 있으면 낱자 그대로', () => {
    expect(composeJamo(['ㄱ'])).toBe('ㄱ');
    expect(composeJamo(['ㅏ', 'ㅏ'])).toBe('ㅏㅏ');
  });

  it('초성 없는 모음 뒤의 자음은 받침이 아니라 새 초성(codex)', () => {
    expect(qwertyToHangul('krt')).toBe('ㅏㄱㅅ');
    expect(qwertyToHangul('kqt')).toBe('ㅏㅂㅅ');
    expect(qwertyToHangul('krk')).toBe('ㅏ가');
  });

  it('같은 자음 연타 쌍받침(ㅅㅅ·ㄱㄱ)과 그 뒤 모음 처리(agy)', () => {
    expect(qwertyToHangul('rkttek')).toBe('갔다');
    expect(qwertyToHangul('dlTdj')).toBe('있어');
    expect(qwertyToHangul('dlttdj')).toBe('있어');   // ㅆ 받침 뒤에 자음(ㅇ)이 오면 받침 유지
    expect(qwertyToHangul('dlttj')).toBe('이써');    // MS IME 와 같다: ㅆ 받침 뒤 모음이 오면 통째로 다음 초성
    expect(qwertyToHangul('rkRrl')).toBe('갂기');
    expect(qwertyToHangul('rkrrk')).toBe('가까');
  });
});

describe('suggestHangul', () => {
  it('영문 자판 한글로 보이면 변환 결과를 준다', () => {
    expect(suggestHangul('elwhdrhksrhkdwl')).toBe('디종관광지');
    expect(suggestHangul('tjdnf dur')).toBe('서울 역');
  });

  it('영어 단어·지명·코드는 제안하지 않는다', () => {
    for (const w of ['Louvre', 'Paris', 'Shibuya', 'Tokyo Tower', 'ok', 'KE081', 'JFK', 'wifi', 'go', 'gogo', 'sofa', 'DPS', 'hotel wifi', 'seoul', 'cafe', 'bus']) {
      expect(suggestHangul(w)).toBeNull();
    }
  });

  it('한글이 섞였거나 영문자가 3자 이하면 제안하지 않는다', () => {
    expect(suggestHangul('디종 rhksrhkdwl')).toBeNull();
    expect(suggestHangul('rk')).toBeNull();      // 가 — 2자는 판단 근거가 부족하다
    expect(suggestHangul('ehz')).toBeNull();
    expect(suggestHangul('ehzy')).toBe('도쿄');   // 4자부터
    expect(suggestHangul('')).toBeNull();
    expect(suggestHangul(null)).toBeNull();
  });
});
