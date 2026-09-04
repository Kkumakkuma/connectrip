// 게시글 "미반영" 배지 판정 보정.
//
// 문제(2026-09-04 운영 DB 실측)
//   planner_board_sync_state / planner_board_sync_list 의 stale 은 스냅샷 md5 비교인데,
//   planner_build_snapshot 이 호출 시각 generated_at 을 스냅샷 안에 넣는다. 그래서 게시 직후
//   1초만 지나도 두 스냅샷의 md5 가 달라지고, 내용이 완전히 같아도 stale=true 가 된다.
//     SELECT md5(p.snapshot::text) = md5(planner_build_snapshot(p.trip_id)::text)               → false
//     SELECT md5((p.snapshot - 'generated_at')::text)
//            = md5((planner_build_snapshot(p.trip_id) - 'generated_at')::text)                  → true
//   그대로 두면 게시된 모든 여행에 "미반영" 배지가 늘 떠 있고, "게시글 갱신"을 눌러도 사라지지 않는다.
//
// 제대로 된 해결은 SQL 쪽이다. planner_board_sync_state / planner_board_sync_list 의 비교를
//   md5((v_cur - 'generated_at')::text) IS DISTINCT FROM md5((v_snap - 'generated_at')::text)
// 로 바꾸면 이 파일은 통째로 지워도 된다. 스키마를 건드리지 않는 지금은 아래 게이트로 거른다.
//
// 게이트: "게시글이 갱신된 시각보다 나중에 고친 흔적이 실제로 있는가".
//   여행·핀·날짜 행의 updated_at 이 근거다(핀 추가·수정·정렬·기간 변경 모두 여기서 잡힌다).
// 한계: 핀 삭제는 남은 어느 행의 updated_at 도 올리지 않아 이 방식으로는 잡히지 않는다.
//   삭제 뒤 다른 편집이 한 번이라도 있으면 다시 잡힌다.

import { isAfter } from './format';

export function resolveStale({ serverStale, postUpdatedAt, lastChangedAt }) {
  if (!serverStale || !postUpdatedAt || !lastChangedAt) return false;
  return isAfter(lastChangedAt, postUpdatedAt);
}
