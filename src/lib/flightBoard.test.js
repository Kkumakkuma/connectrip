import { describe, it, expect } from 'vitest';
import {
  kstDateString, dayDiff, boardFlights, boardStatus, boardTitle, boardErrorMessage, replyTargetLabel,
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

describe('boardFlights', () => {
  it('다가오는 편은 날짜순(3주 밖 포함), 지난 30일 편은 뒤에 최근 것부터, 더 오래된 편은 제외', () => {
    const list = [
      { id: 'c', flight_date: '2026-11-01' },
      { id: 'a', flight_date: '2026-09-06' },
      { id: 'p1', flight_date: '2026-09-05' },
      { id: 'p2', flight_date: '2026-08-10' },
      { id: 'old', flight_date: '2026-08-01' },
      { id: 'b', flight_date: '2026-09-20' },
      null,
    ];
    expect(boardFlights(list, '2026-09-06').map((f) => f.id)).toEqual(['a', 'b', 'c', 'p1', 'p2']);
    expect(boardFlights(undefined, '2026-09-06')).toEqual([]);
  });
});

describe('boardStatus', () => {
  it('3주 전 이전 잠김, 기간 안 열림, 지나면 읽기 전용', () => {
    expect(boardStatus('2026-09-28', '2026-09-06')).toBe('locked');
    expect(boardStatus('2026-09-27', '2026-09-06')).toBe('open');
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
    expect(boardErrorMessage({ message: 'P0001: BOARD_CLOSED' }, '실패')).toMatch(/출발 3주 전/);
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
