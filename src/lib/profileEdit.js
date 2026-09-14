// 마이페이지 회원 정보 수정(components/ProfileCard)이 쓰는 순수 함수·상수. 화면 없이 테스트한다.

export const EMAIL_OTP_PURPOSE_CHANGE = 'email_change';   // api/_airline_domain.js OTP_PURPOSES 와 같아야 한다
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
// 운영진 사칭 방지 — 이 단어가 들어간 닉네임은 막는다(검토 지적, 2026-09-14)
export const NICKNAME_RESERVED = /(관리자|운영자|운영진|admin|connecttrip|커넥트립)/i;

// 휴대폰 가운데 자리 가리기: 01012345678 → 010-****-5678, 0212345678(비휴대폰) 도 안전하게 처리
export function maskPhone(raw) {
  const d = String(raw || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.length < 7) return d.slice(0, 3) + '-****';
  const head = d.slice(0, 3);
  const tail = d.slice(-4);
  return `${head}-****-${tail}`;
}

// 이메일 가리기: kuma@example.com → ku**@example.com
export function maskEmail(raw) {
  const s = String(raw || '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const local = s.slice(0, at);
  const keep = Math.min(2, local.length);
  return local.slice(0, keep) + '*'.repeat(Math.max(1, local.length - keep)) + s.slice(at);
}

export function normalizeNickname(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

// 닉네임 규칙(가입 화면과 동일: 2자 이상, 서버 20자 절단). 통과하면 '' 아니면 안내 문구.
export function nicknameProblem(raw) {
  const n = normalizeNickname(raw);
  if (n.length < NICKNAME_MIN) return `닉네임은 ${NICKNAME_MIN}자 이상 입력해주세요.`;
  if (n.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자 이하로 입력해주세요.`;
  if (NICKNAME_RESERVED.test(n)) return '운영진으로 오해할 수 있는 단어는 닉네임에 쓸 수 없습니다.';
  return '';
}

export function formatJoinedDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export function userTypeLabel(userType) {
  return userType === 'crew' ? '승무원 회원' : '일반 회원';
}

// RPC 상태값·오류 코드 → 사용자 문구. 모르는 값은 fallback.
const MESSAGES = {
  // change_my_email
  crew_managed: '승무원 회원은 항공사 이메일을 사용합니다.',
  email_invalid: '이메일 형식이 올바르지 않습니다.',
  email_claimed: '이미 다른 계정에서 사용 중인 이메일입니다.',
  // 공통
  same: '현재 등록된 정보와 같습니다.',
  proof_invalid: '인증이 만료되었거나 이미 사용되었습니다. 인증을 다시 진행해주세요.',
  NICKNAME_TAKEN: '이미 사용 중인 닉네임입니다.',
};

export function messageFor(code, fallback = '처리에 실패했습니다. 잠시 후 다시 시도해주세요.') {
  const key = String(code || '').trim();
  return MESSAGES[key] || fallback;
}

// supabase 오류 → 코드. 유니크 위반은 제약 이름으로 가른다.
export function codeFromError(err) {
  if (!err) return '';
  const msg = String(err.message || err.details || '');
  if (err.code === '23505' || /duplicate key value/.test(msg)) {
    if (/profiles_nickname_key/.test(msg)) return 'NICKNAME_TAKEN';
    if (/uq_profiles_email_lower/.test(msg)) return 'email_claimed';
    return 'DUPLICATE';
  }
  const m = msg.match(/^([A-Z_]{4,})\b/);
  return m ? m[1] : '';
}
