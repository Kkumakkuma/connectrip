// 같은 편 게시판 화면 보조 함수(순수 함수). 자격·가시성·작성 기간 판정은 서버 RPC 가 하고, 여기 값은 표시용이다.

const DAY_MS = 24 * 60 * 60 * 1000;
export const BOARD_OPEN_DAYS = 21;

// flight_date 는 'YYYY-MM-DD' 문자열이다. new Date(문자열) 은 UTC 자정으로 파싱되므로
// 현재 시각과 직접 비교하면 비행 당일 09:00 KST 를 넘긴 항공편이 과거로 취급된다.
// KST 기준 날짜 문자열끼리 비교해 당일까지 포함시킨다.
export const kstDateString = (offsetDays = 0, now = Date.now()) =>
  new Date(now + 9 * 60 * 60 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10);

// 두 'YYYY-MM-DD' 의 일수 차(target - today). 형식이 어긋나면 null.
export const dayDiff = (dateStr, todayStr) => {
  const parse = (s) => {
    const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d);
  };
  const a = parse(dateStr);
  const b = parse(todayStr);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY_MS);
};

export const PAST_BOARD_DAYS = 30;

// 게시판 목록에 둘 항공편: 오늘(KST) 이후 전부(잠긴 편 포함, 잠김 안내는 게시판이 한다) + 지난 30일 안의 편(읽기 전용).
// 다가오는 편은 날짜 오름차순, 지난 편은 그 뒤에 최근 것부터.
export const boardFlights = (flights, todayStr, pastDays = PAST_BOARD_DAYS) => {
  const list = (flights || []).filter((f) => f && String(f.flight_date || '').length >= 10);
  const date = (f) => String(f.flight_date).slice(0, 10);
  const upcoming = list.filter((f) => date(f) >= todayStr).sort((x, y) => date(x).localeCompare(date(y)));
  const past = list
    .filter((f) => date(f) < todayStr && dayDiff(date(f), todayStr) >= -pastDays)
    .sort((x, y) => date(y).localeCompare(date(x)));
  return [...upcoming, ...past];
};

// 'locked' = 출발 3주 전 이전, 'open' = 쓸 수 있는 기간, 'closed' = 비행이 지남(읽기 전용)
export const boardStatus = (dateStr, todayStr) => {
  const d = dayDiff(dateStr, todayStr);
  if (d === null) return 'unknown';
  if (d > BOARD_OPEN_DAYS) return 'locked';
  if (d < 0) return 'closed';
  return 'open';
};

export const boardTitle = (memberType) => (memberType === 'crew' ? '같은 듀티 게시판' : '같은 편 게시판');

// 서버 RPC 가 RAISE 하는 코드 → 안내 문구. 연락처 차단(CONTACT_*) 트리거는 현재 꺼져 있다(운영자 결정).
export const BOARD_ERRORS = {
  AUTH_REQUIRED: '로그인이 필요합니다.',
  NOT_MEMBER: '이 편에 등록된 스케줄이 없어 글을 쓸 수 없습니다.',
  BOARD_CLOSED: '작성 기간이 아닙니다. 출발 3주 전부터 출발일까지 쓸 수 있습니다.',
  NOT_FOUND: '글이나 댓글을 찾을 수 없습니다. 목록을 새로 불러와 주세요.',
  BAD_PARENT: '답글 대상을 찾을 수 없습니다. 목록을 새로 불러와 주세요.',
  BAD_CONTENT: '내용을 확인해 주세요.',
  SELF_REPORT: '내 글은 신고할 수 없습니다.',
  CONTACT_BLOCKED_PHONE: '휴대폰 번호는 게시판에 쓸 수 없습니다. 비밀댓글이나 오픈채팅 링크를 이용해 주세요.',
  CONTACT_BLOCKED_MESSENGER: '개인 메신저 아이디는 쓸 수 없습니다. 오픈채팅 링크는 올릴 수 있습니다.',
  CONTACT_BLOCKED_ACCOUNT: '계좌번호는 쓸 수 없습니다. 미리 입금을 요구하는 사기를 막기 위한 것입니다.',
  CONTACT_BLOCKED_EMAIL: '이메일 주소는 게시판에 쓸 수 없습니다. 비밀댓글이나 오픈채팅 링크를 이용해 주세요.',
  CONTACT_BLOCKED_HOTEL: '체류 호텔·객실 정보는 안전을 위해 쓸 수 없습니다.',
};

export const boardErrorMessage = (err, fallback) => {
  const raw = String(err?.message || err?.details || '');
  const hit = Object.keys(BOARD_ERRORS).find((k) => raw.includes(k));
  return hit ? BOARD_ERRORS[hit] : fallback;
};

// 댓글 목록에서 답글 대상 표시. 서버가 parent_alias 를 주면 그걸, 아니면 목록에서 찾는다(Q&A).
export const replyTargetLabel = (comment, siblings = []) => {
  if (!comment?.parent_id) return '';
  if (comment.parent_alias) return comment.parent_alias;
  const parent = siblings.find((c) => c?.id === comment.parent_id);
  return parent ? (parent.alias || parent.author_name || '익명') : '';
};
