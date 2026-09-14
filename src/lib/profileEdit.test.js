import { describe, it, expect } from 'vitest';
import {
  maskPhone, maskEmail, normalizeNickname, nicknameProblem, formatJoinedDate,
  messageFor, codeFromError, EMAIL_OTP_PURPOSE_CHANGE, EMAIL_RE,
} from './profileEdit';
import { OTP_PURPOSES } from '../../api/_airline_domain.js';

describe('profileEdit — 마이페이지 회원 정보 수정 보조 함수', () => {
  it('휴대폰은 가운데 네 자리를 가린다', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('0101')).toBe('010-****');
  });

  it('이메일은 앞 두 글자만 남긴다', () => {
    expect(maskEmail('kuma@example.com')).toBe('ku**@example.com');
    expect(maskEmail('a@x.io')).toBe('a*@x.io');
    expect(maskEmail('없음')).toBe('없음');
  });

  it('닉네임은 앞뒤 공백 제거·2~20자', () => {
    expect(normalizeNickname('  쿠마  ')).toBe('쿠마');
    expect(nicknameProblem('쿠')).toContain('2자');
    expect(nicknameProblem('가'.repeat(21))).toContain('20자');
    expect(nicknameProblem('쿠마님')).toBe('');
    expect(nicknameProblem('관리자쿠마')).toContain('운영진');
    expect(nicknameProblem('Admin01')).toContain('운영진');
  });

  it('가입일은 YYYY.MM.DD', () => {
    expect(formatJoinedDate('2026-09-14T03:00:00Z')).toMatch(/^2026\.09\.1[45]$/);
    expect(formatJoinedDate('')).toBe('');
    expect(formatJoinedDate('not-a-date')).toBe('');
  });

  it('상태값은 문구로, 모르는 값은 기본 문구로', () => {
    expect(messageFor('email_claimed')).toContain('다른 계정');
    expect(messageFor('mismatch')).toContain('본인 명의');
    expect(messageFor('zzz', '기본')).toBe('기본');
  });

  it('유니크 위반은 제약 이름으로 코드를 가른다', () => {
    expect(codeFromError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_nickname_key"' })).toBe('NICKNAME_TAKEN');
    expect(codeFromError({ code: '23505', message: '... "uq_profiles_email_lower"' })).toBe('email_claimed');
    expect(codeFromError({ message: 'PROFILE_ALREADY_COMPLETED' })).toBe('PROFILE_ALREADY_COMPLETED');
    expect(codeFromError(null)).toBe('');
  });

  it('이메일 변경 용도는 서버 허용 목록과 같다', () => {
    expect(OTP_PURPOSES).toContain(EMAIL_OTP_PURPOSE_CHANGE);
    expect(EMAIL_RE.test('Kuma@Example.com')).toBe(true);
    expect(EMAIL_RE.test('kuma@')).toBe(false);
  });
});
