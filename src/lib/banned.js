import { useAuth } from './AuthContext';
import { supabase } from './supabase';

// 이용 제한(is_banned) 계정 공용 처리 (2026-09-16).
// 서버는 "다른 사람과 하는 활동"만 막는다 — 동행 모집 글·동행 댓글(참여), 같은 편 게시판 참여 스위치,
// 쪽지·1:1 대화·장터 거래. Q&A·후기·자유·추천지·CREW 글·댓글, 좋아요, 장터 글 올리기, 본인 글 수정·삭제는 막지 않는다.
// 막힌 경우 서버(트리거·RPC)는 RAISE EXCEPTION 'BANNED' 를 던지고, 화면 문구는 아래 한 문장만 쓴다.
export const BANNED_MESSAGE = '이용이 제한된 계정입니다. 동행 모집·참여, 쪽지·대화, 장터 거래를 할 수 없습니다.';

// 서버 계약: 트리거·RPC 는 RAISE EXCEPTION 'BANNED' (P0001) 를 던진다 → PostgREST 오류 message 가 정확히 'BANNED'.
// 단어 포함 검사는 다른 오류 설명에 BANNED 단어가 섞이면 오인하므로(2026-09-16 codex 검토) 식별자 전체 일치로 본다.
// 허용 형태: message 'BANNED' / 'P0001: BANNED', code 'BANNED', 우리 RAISE(P0001)의 details·hint 'BANNED'.
// 제약 위반 오류의 details("Failing row contains (...)")에 실린 사용자 본문은 P0001 이 아니라 보지 않는다.
const BANNED_ID = /^(?:P0001:\s*)?BANNED$/;
const isBannedId = (v) => BANNED_ID.test(String(v ?? '').trim());
export const isBannedError = (err) => {
  if (!err) return false;
  if (isBannedId(err.message) || String(err.code ?? '').trim() === 'BANNED') return true;
  if (String(err.code ?? '') !== 'P0001') return false;
  return isBannedId(err.details) || isBannedId(err.hint);
};

// 본인 프로필의 is_banned 가 정확히 true 일 때만 제한 계정으로 본다(폴백 조회는 컬럼이 없어 undefined → false).
export const useIsBanned = () => {
  const { profile } = useAuth();
  return profile?.is_banned === true;
};

// 제출 전 가드용(2026-09-16 codex 검토). 화면에 들고 있는 is_banned 는 관리자가 제한을 풀거나 새로 걸어도
// 프로필을 다시 읽기 전까지 옛 값이다.
//  - stillBanned(): 로컬 값이 true 일 때만 get_my_profile 로 is_banned 를 직접 다시 읽는다(해제됐으면 통과).
//    fetchProfile 을 바로 부르면 전역 profileLoading 이 켜져 배너·권한 화면이 깜빡이므로, 확인은 조용히 하고
//    값이 바뀐 경우에만 fetchProfile 로 화면 상태를 맞춘다. 조회가 실패하면 막은 채로 둔다(서버도 같은 이유로 막음).
//  - syncAfterBannedError(): 서버가 BANNED 로 거부했을 때 프로필을 갱신해 배너가 바로 뜨게 한다.
export const useBannedGuard = () => {
  const { user, profile, fetchProfile } = useAuth();
  const isBanned = profile?.is_banned === true;
  const canRefresh = !!user?.id && typeof fetchProfile === 'function';
  const stillBanned = async () => {
    if (!isBanned) return false;
    try {
      const { data, error } = await supabase.rpc('get_my_profile').maybeSingle();
      if (error || !data || data.id !== user?.id) return true;
      if (data.is_banned === true) return true;
      if (canRefresh) fetchProfile(user.id);
      return false;
    } catch {
      return true;
    }
  };
  const syncAfterBannedError = () => {
    if (canRefresh) fetchProfile(user.id);
  };
  return { isBanned, stillBanned, syncAfterBannedError };
};
