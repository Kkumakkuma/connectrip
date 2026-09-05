// 승무원 인증 유효기간 (쿠마님 확정 2026-09-05: 회사 메일 인증 시각부터 1년)
//
// DB 는 매일 새벽 pg_cron(crew_verification_expire)으로 만료분의 crew_verified 를 false 로 내린다.
// user_type 은 'crew' 그대로라 만료된 계정도 갱신 안내 대상이다.
// 화면은 crew_verified_at 으로 만료일을 직접 계산해, cron 이 돌기 전 구간(만료일 ~ 다음 새벽)에도
// DB 와 같은 판정을 낸다. 판정 기준을 한 곳에 모아 두려고 이 파일에 둔다.
// SQL 원본은 src/lib/crew_renewal_20260905.sql.

// 만료 며칠 전부터 갱신 안내를 띄울지
export const CREW_RENEW_NOTICE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// 인증 시각 + 1년. 2/29 인증분은 다음 해 3/1 이 된다(Date 표준 동작).
export function crewExpiresAt(verifiedAt) {
  if (!verifiedAt) return null;
  const at = new Date(verifiedAt);
  if (Number.isNaN(at.getTime())) return null;
  const exp = new Date(at.getTime());
  exp.setFullYear(exp.getFullYear() + 1);
  return exp;
}

// profile(get_my_profile 결과) → 승무원 인증 상태
//   applicable : 승무원 계정인가(user_type === 'crew')
//   state      : 'none'(승무원 아님) | 'valid' | 'expiring' | 'expired'
//   expiresAt  : 만료 시각(Date). 인증 시각이 없으면 null
//   daysLeft   : 남은 일수(올림). 만료됐거나 알 수 없으면 null
export function crewVerificationStatus(profile, now = new Date()) {
  const none = { applicable: false, state: 'none', expiresAt: null, daysLeft: null };
  if (!profile || profile.user_type !== 'crew') return none;

  const verified = !!profile.crew_verified;
  const expiresAt = crewExpiresAt(profile.crew_verified_at);

  // 인증 시각이 없는 레거시 계정: DB 플래그만 믿고 만료일·남은 일수는 표시하지 않는다.
  if (!expiresAt) {
    return { applicable: true, state: verified ? 'valid' : 'expired', expiresAt: null, daysLeft: null };
  }

  const remain = expiresAt.getTime() - now.getTime();
  // 플래그가 내려갔거나(cron 반영) 만료일이 지났으면(cron 전) 둘 다 만료로 본다.
  if (!verified || remain <= 0) {
    return { applicable: true, state: 'expired', expiresAt, daysLeft: null };
  }

  const daysLeft = Math.ceil(remain / DAY_MS);
  return {
    applicable: true,
    state: daysLeft <= CREW_RENEW_NOTICE_DAYS ? 'expiring' : 'valid',
    expiresAt,
    daysLeft,
  };
}

// renew_crew_verification RPC 예외 → 화면 안내.
// 문구는 api/signup.js 의 같은 코드 매핑과 맞춘다(가입/갱신에서 다른 말이 나오지 않게).
export function renewErrorMessage(raw) {
  const msg = String(raw || '');
  if (msg.includes('crew airline verification required')) return '지원하지 않는 항공사 도메인입니다. 회사 이메일 주소를 확인해주세요.';
  if (msg.includes('AIRLINE_EMAIL_ALREADY_CLAIMED')) return '이미 다른 계정이 사용 중인 회사 이메일입니다.';
  if (msg.includes('AIRLINE_EMAIL_PREVIOUSLY_USED')) return '이전에 사용된 회사 이메일은 다시 쓸 수 없습니다.';
  if (msg.includes('OTP_PROOF_REQUIRED_AIRLINE')) return '회사 이메일 인증을 먼저 완료해주세요.';
  if (msg.includes('OTP_PROOF_INVALID_AIRLINE')) return '회사 이메일 인증이 만료되었습니다. 다시 인증해주세요.';
  if (msg.includes('NOT_CREW')) return '승무원 계정에서만 갱신할 수 있습니다.';
  if (msg.includes('auth required')) return '로그인 후 다시 시도해주세요.';
  return '갱신에 실패했습니다. 잠시 후 다시 시도해주세요.';
}

// 2027년 9월 5일
export function formatExpiryDate(date) {
  if (!date) return '';
  try {
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

// ── 전역 배너 닫기(하루 단위) ───────────────────────────────────────────────
// 하루 한 번만 닫히고 다음 날 다시 뜬다. 만료 상태도 같다(닫아도 영구 숨김은 없다).
const BANNER_KEY = 'ct_crew_renew_dismissed';

// 로컬 기준 YYYY-MM-DD
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isRenewBannerHidden(userId, today = dayKey()) {
  try {
    const raw = globalThis.localStorage?.getItem(BANNER_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    // 계정별로 따로 본다 — 한 기기에서 계정을 바꾸면 다시 보여야 한다.
    return saved?.u === (userId || '') && saved?.d === today;
  } catch {
    // 저장소가 막힌 환경(사생활 모드 등)은 '안 닫음'으로 둔다.
    return false;
  }
}

export function hideRenewBannerToday(userId, today = dayKey()) {
  try {
    globalThis.localStorage?.setItem(BANNER_KEY, JSON.stringify({ u: userId || '', d: today }));
  } catch {
    // 저장 실패는 무시한다 — 배너가 다시 보일 뿐이다.
  }
}
