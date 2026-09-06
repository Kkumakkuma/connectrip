import { describe, it, expect } from 'vitest';
import {
  kstDateString, dayDiff, boardStatus, boardTitle, boardErrorMessage, replyTargetLabel,
} from './flightBoard';

describe('kstDateString', () => {
  it('UTC 자정 직전은 KST 로는 다음 날', () => {
    // 2026-09-06T15:30Z = 2026-09-07 00:30 KST
    expect(kstDateString(0, Date.parse('2026-09-06T15:30:00Z'))).toBe('2026-09-07');
    expect(kstDateString(21, Date.parse('2026-09-06T15:30:00Z'))).toBe('2026-09-28');
  });
});

describe('dayDiff', () => {
  it('일수 차를 돌려주고 형식이 어긋나면 null', () => {
    expect(dayDiff('2026-09-27', '2026-09-06')).toBe(21);
    expect(dayDiff('2026-09-06', '2026-09-06')).toBe(0);
    expect(dayDiff('2026-09-05', '2026-09-06')).toBe(-1);
    expect(dayDiff('', '2026-09-06')).toBeNull();
    expect(dayDiff('2026-09-06T00:00:00Z', '2026-09-06')).toBe(0);
  });
});

describe('boardStatus', () => {
  it('2주 전 이전 잠김, 기간 안 열림, 지나면 닫힘', () => {
    expect(boardStatus('2026-09-21', '2026-09-06')).toBe('locked');
    expect(boardStatus('2026-09-20', '2026-09-06')).toBe('open');
    expect(boardStatus('2026-09-06', '2026-09-06')).toBe('open');
    expect(boardStatus('2026-09-05', '2026-09-06')).toBe('closed');
    expect(boardStatus(null, '2026-09-06')).toBe('unknown');
  });
});

describe('boardTitle / boardErrorMessage / replyTargetLabel', () => {
  it('회원유형별 제목', () => {
    expect(boardTitle('crew')).toBe('같은 듀티 게시판');
    expect(boardTitle('passenger')).toBe('같은 편 게시판');
  });
  it('서버 코드가 섞인 메시지에서 안내 문구를 찾고, 없으면 기본 문구', () => {
    expect(boardErrorMessage({ message: 'P0001: BOARD_CLOSED' }, '실패')).toMatch(/출발 2주 전/);
    expect(boardErrorMessage({ message: 'network' }, '실패')).toBe('실패');
    expect(boardErrorMessage(null, '실패')).toBe('실패');
  });
  it('답글 대상은 서버 alias 우선, 없으면 형제 목록에서', () => {
    expect(replyTargetLabel({ parent_id: 'x', parent_alias: '익명 승객 2' })).toBe('익명 승객 2');
    expect(replyTargetLabel({ parent_id: 'x' }, [{ id: 'x', author_name: '홍길동' }])).toBe('홍길동');
    expect(replyTargetLabel({ parent_id: 'x' }, [])).toBe('');
    expect(replyTargetLabel({ parent_id: null })).toBe('');
  });
});
