import { describe, it, expect, vi } from 'vitest';
import {
  displayAuthor, displayMember, hasNickname, ensureNickname, AUTHOR_FALLBACK, WITHDRAWN_MEMBER,
} from './authorName';

describe('authorName — 작성자 닉네임 표시', () => {
  it('닉네임이 있으면 그대로, 없으면 회원', () => {
    expect(displayAuthor('여행자곰')).toBe('여행자곰');
    expect(displayAuthor('  여행자곰 ')).toBe('여행자곰');
    expect(displayAuthor(null)).toBe(AUTHOR_FALLBACK);
    expect(displayAuthor(undefined)).toBe('회원');
    expect(displayAuthor('')).toBe('회원');
    expect(displayAuthor('   ')).toBe('회원');
    expect(displayAuthor()).toBe('회원');
  });

  it('여러 후보 중 처음으로 값이 있는 것을 쓴다', () => {
    expect(displayAuthor('', '조인닉네임')).toBe('조인닉네임');
    expect(displayAuthor('저장값', '조인닉네임')).toBe('저장값');
    expect(displayAuthor(null, '  ')).toBe('회원');
  });

  it('문자열이 아닌 값은 무시한다', () => {
    expect(displayAuthor(123)).toBe('회원');
    expect(displayAuthor({ name: '실명' })).toBe('회원');
  });

  it('프로필이 없으면 탈퇴한 회원, 닉네임만 비면 회원', () => {
    expect(displayMember(null)).toBe(WITHDRAWN_MEMBER);
    expect(displayMember(undefined)).toBe('탈퇴한 회원');
    expect(displayMember({ nickname: '' })).toBe('회원');
    expect(displayMember({ nickname: '곰', name: '실명' })).toBe('곰');
    expect(displayMember({ name: '실명' })).toBe('회원');
  });

  it('hasNickname 은 공백만 있는 닉네임을 없는 것으로 본다', () => {
    expect(hasNickname({ nickname: '곰돌' })).toBe(true);
    expect(hasNickname({ nickname: '  ' })).toBe(false);
    expect(hasNickname({ name: '실명' })).toBe(false);
    expect(hasNickname(null)).toBe(false);
  });

  it('ensureNickname: 닉네임이 있으면 창을 열지 않고 true', () => {
    const open = vi.fn();
    expect(ensureNickname({ nickname: '곰돌' }, open)).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('ensureNickname: 닉네임이 없으면 창을 열고 false', () => {
    const open = vi.fn();
    expect(ensureNickname({ nickname: null, name: '실명' }, open)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(ensureNickname(null)).toBe(false);
  });
});
