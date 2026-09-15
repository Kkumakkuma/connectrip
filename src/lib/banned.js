import { useAuth } from './AuthContext';

// 이용 제한(is_banned) 계정 공용 처리 (2026-09-16).
// 서버는 "다른 사람과 하는 활동"만 막는다 — 동행 모집 글·동행 댓글(참여), 같은 편 게시판 참여 스위치,
// 쪽지·1:1 대화·장터 거래. Q&A·후기·자유·추천지·CREW 글·댓글, 좋아요, 장터 글 올리기, 본인 글 수정·삭제는 막지 않는다.
// 막힌 경우 서버(트리거·RPC)는 RAISE EXCEPTION 'BANNED' 를 던지고, 화면 문구는 아래 한 문장만 쓴다.
export const BANNED_MESSAGE = '이용이 제한된 계정입니다. 동행 모집·참여, 쪽지·대화, 장터 거래를 할 수 없습니다.';

// PostgREST 오류에 단어 'BANNED' 가 있으면 이용 제한 오류다(단어 경계 — UNBANNED 같은 부분 일치는 제외).
// message/code 는 항상 보고, details/hint 는 우리 RAISE(P0001)일 때만 본다 — 제약 위반 오류의 details 에는
// "Failing row contains (...)" 로 사용자 입력 본문이 그대로 실려 본문에 BANNED 가 있으면 오탐하기 때문.
// 다른 게시판·기능은 서버가 BANNED 를 던지지 않으므로 게시판 구분 없이 써도 된다.
const BANNED_RE = /\bBANNED\b/;
export const isBannedError = (err) => {
  if (!err) return false;
  const message = String(err.message ?? '');
  const code = String(err.code ?? '');
  if (BANNED_RE.test(message) || BANNED_RE.test(code)) return true;
  if (code !== 'P0001') return false;
  return BANNED_RE.test(String(err.details ?? '')) || BANNED_RE.test(String(err.hint ?? ''));
};

// 본인 프로필의 is_banned 가 정확히 true 일 때만 제한 계정으로 본다(폴백 조회는 컬럼이 없어 undefined → false).
export const useIsBanned = () => {
  const { profile } = useAuth();
  return profile?.is_banned === true;
};
