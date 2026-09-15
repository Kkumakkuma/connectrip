import { describe, it, expect } from 'vitest';
import { normalizeAdminReport } from './adminReports';

describe('adminReports — 관리자 신고 목록 RPC 행 매핑', () => {
  it('실제 RPC 형태(reporter/reported 하위 객체)를 그대로 살린다', () => {
    const r = normalizeAdminReport({
      id: 'r1', status: '대기', reason: '욕설', board_type: 'qna', post_id: 'p1',
      reporter_id: 'u1', reported_user_id: 'u2', admin_note: null,
      reporter: { id: 'u1', name: 'A', nickname: 'a닉', avatar_url: null },
      reported: { id: 'u2', name: 'B', nickname: 'b닉', avatar_url: 'x.png' },
    });
    expect(r.reporter).toEqual({ id: 'u1', name: 'A', nickname: 'a닉', avatar_url: null });
    expect(r.reported).toEqual({ id: 'u2', name: 'B', nickname: 'b닉', avatar_url: 'x.png' });
    expect(r.reported_user_id).toBe('u2');
    expect(r.board_type).toBe('qna');
    expect(r.post_id).toBe('p1');
    expect(r.status).toBe('대기');
  });

  it('프로필이 없어 하위 객체가 null 이면 id 만 남기고 이름은 null', () => {
    const r = normalizeAdminReport({ id: 'r3', reporter_id: 'u7', reported_user_id: 'u8', reporter: null, reported: null });
    expect(r.reporter).toEqual({ id: 'u7', name: null, nickname: null, avatar_url: null });
    expect(r.reported).toEqual({ id: 'u8', name: null, nickname: null, avatar_url: null });
  });

  it('평평한 필드 형태도 예비로 받는다', () => {
    const r = normalizeAdminReport({
      id: 'r2', target_user_id: 'u9', target_type: 'market', target_id: 'm1',
      reporter_id: 'u1', reporter_name: 'A', reporter_nickname: 'a닉', target_name: 'B', target_nickname: 'b닉',
    });
    expect(r.reported_user_id).toBe('u9');
    expect(r.reported).toEqual({ id: 'u9', name: 'B', nickname: 'b닉', avatar_url: null });
    expect(r.reporter).toEqual({ id: 'u1', name: 'A', nickname: 'a닉', avatar_url: null });
    expect(r.board_type).toBe('market');
    expect(r.post_id).toBe('m1');
  });

  it('빈 행도 깨지지 않는다', () => {
    const r = normalizeAdminReport(null);
    expect(r.reported_user_id).toBeNull();
    expect(r.reported.name).toBeNull();
    expect(r.reporter.id).toBeNull();
  });
});
