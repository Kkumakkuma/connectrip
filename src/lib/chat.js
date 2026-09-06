// 쪽지·대화·장터 화면의 순수 보조 함수. 권한·차단 판정은 전부 서버(RPC/RLS)가 한다.

// "방금 전" / "N분 전" / "N시간 전" / "N일 전" / 그 이상은 날짜
export const timeAgo = (iso, now = Date.now()) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return '방금 전';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
};

// 대화 메시지 시각 (오늘이면 시:분, 아니면 M.D 시:분)
export const messageTime = (iso, now = Date.now()) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t); const n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}.${d.getDate()} ${hm}`;
};

// 날짜 구분선 라벨 (YYYY년 M월 D일)
export const dayLabel = (iso) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

// 같은 날짜끼리 묶어서 [{ day, items }] 로
export const groupByDay = (messages) => {
  const out = [];
  (messages || []).forEach((m) => {
    const day = dayLabel(m.created_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(m);
    else out.push({ day, items: [m] });
  });
  return out;
};

// 장터 가격 표기: 0 또는 없음 = 나눔(type share) 또는 가격 없음
export const priceLabel = (listing) => {
  if (!listing) return '';
  if (listing.type === 'share') return '나눔';
  const p = Number(listing.price);
  if (!Number.isFinite(p) || p <= 0) return '가격 없음';
  return `${p.toLocaleString()}원`;
};

export const STATUS_LABEL = { active: '판매중', reserved: '예약중', sold: '거래완료' };
export const statusLabel = (listing) => {
  if (!listing) return '';
  if (listing.type === 'share') return listing.status === 'sold' ? '나눔완료' : listing.status === 'reserved' ? '예약중' : '나눔중';
  return STATUS_LABEL[listing.status] || '판매중';
};

// 서버 RPC 오류 코드 → 라벨
export const CHAT_ERRORS = {
  BLOCKED: '차단된 회원입니다.',
  BANNED: '이용이 제한된 계정입니다.',
  NOT_FOUND: '찾을 수 없습니다.',
  BAD_CONTENT: '내용을 확인해 주세요.',
  RATE_LIMIT: '잠시 후 다시 시도해 주세요.',
  BUMP_WAIT: '끌어올리기는 24시간에 한 번입니다.',
  AUTH_REQUIRED: '로그인이 필요합니다.',
  UNAVAILABLE: '대화할 수 없는 회원입니다.',
  PAID_FINAL: '결제가 끝난 매물은 변경할 수 없습니다.',
};
export const chatErrorMessage = (err, fallback) => {
  const raw = String(err?.message || err?.details || '');
  const hit = Object.keys(CHAT_ERRORS).find((k) => raw.includes(k));
  return hit ? CHAT_ERRORS[hit] : fallback;
};

// 폴링 주기: 화면이 보이지 않으면 멈추고, 마지막 조작 후 오래 지나면 늦춘다
export const pollDelay = (base, idleMs) => {
  if (idleMs > 5 * 60 * 1000) return base * 10;
  if (idleMs > 60 * 1000) return base * 3;
  return base;
};
