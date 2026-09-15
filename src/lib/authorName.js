// 게시판·댓글·장터 작성자 표시 규칙(2026-09-15, 쿠마님 지시 "실명 대신 닉네임").
// · 일반 회원 화면의 작성자는 닉네임만 쓴다. 없으면 '회원'. 실명(profiles.name)으로 대체하지 않는다.
// · 쪽지·대화에서 상대 프로필이 아예 없을 때만 '탈퇴한 회원'.
// · 저장 값(author_name / 장터 author)은 서버 트리거가 profiles.nickname 으로 덮어쓴다. 클라이언트가 보내는 값은 참고용이다.

export const AUTHOR_FALLBACK = '회원';
export const WITHDRAWN_MEMBER = '탈퇴한 회원';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 표시용 작성자명. 인자를 앞에서부터 보고 처음으로 비어 있지 않은 값을 쓴다(예: author_name, profiles.nickname).
export function displayAuthor(...candidates) {
  for (const c of candidates) {
    const v = clean(c);
    if (v) return v;
  }
  return AUTHOR_FALLBACK;
}

// 쪽지·차단 목록처럼 상대 프로필 자체가 없을 수 있는 곳. profile 이 없으면 '탈퇴한 회원'.
export function displayMember(profile) {
  if (!profile) return WITHDRAWN_MEMBER;
  return displayAuthor(profile.nickname);
}

export function hasNickname(profile) {
  return !!clean(profile?.nickname);
}

// 글쓰기 전에 부른다. 닉네임이 있으면 true. 없으면 openPrompt(닉네임 설정 창 열기)를 부르고 false.
export function ensureNickname(profile, openPrompt) {
  if (hasNickname(profile)) return true;
  if (typeof openPrompt === 'function') openPrompt();
  return false;
}
