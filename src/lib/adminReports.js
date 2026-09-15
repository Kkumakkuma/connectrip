// 관리자 신고 목록 행 정리(2026-09-15). 신고 목록은 admin_list_reports RPC(is_admin() 검사, SECURITY DEFINER)로만 받는다.
// 실제 RPC 반환(author_nickname_20260915.sql): to_jsonb(reports 행) || { reporter: {id,name,nickname,avatar_url} | null,
//   reported: {id,name,nickname,avatar_url} | null }.
// 하위 객체를 먼저 쓰고, 예전·다른 형태(reporter_name, target_name 같은 평평한 필드)는 예비로만 받는다.
// 화면(Admin.jsx)은 report.reporter / report.reported 모양을 그대로 쓴다.
function person(obj, flatId, flatName, flatNickname) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return {
    id: o.id ?? flatId ?? null,
    name: o.name ?? flatName ?? null,
    nickname: o.nickname ?? flatNickname ?? null,
    avatar_url: o.avatar_url ?? null,
  };
}

export function normalizeAdminReport(row) {
  const r = row || {};
  const reportedId = r.reported_user_id ?? r.reported?.id ?? r.target_user_id ?? null;
  return {
    ...r,
    reported_user_id: reportedId,
    post_id: r.post_id ?? r.target_id ?? null,
    board_type: r.board_type ?? r.target_type ?? null,
    reporter: person(r.reporter, r.reporter_id, r.reporter_name, r.reporter_nickname),
    reported: person(r.reported, reportedId, r.target_name, r.target_nickname),
  };
}
