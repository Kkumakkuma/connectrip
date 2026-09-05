// 이메일 OTP 의 purpose 판정 + 승무원 회사 이메일 도메인 판정 (2026-09-05 가입 개편).
//
// 가입 본인확인은 PASS(NHN KCP) 하나. 이메일 OTP 는 두 용도만 있다(쿠마님 확정):
//   'signup'        여행자의 로그인·연락용 개인 이메일 소유 확인 — 도메인 제한 없음
//   'airline_email' 승무원의 회사 메일 소유 확인(= 승무원 증빙) — airline_domains 에 있는 도메인만
// purpose 는 서버가 이 둘로만 제한하고, 검증 RPC 에도 서버가 확정한 값만 넘긴다(클라이언트 자유 문자열 금지).
// 최종 판정은 DB RPC complete_signup_profile 이 같은 표(airline_domains)로 다시 한다 — 여기는
// "아무 주소로나 메일을 쏘는" 비용·남용을 막는 앞단 게이트다.
//
// 규칙: 소문자·양끝 공백 제거 → 마지막 '@' 뒤를 도메인으로 → 정확히 일치만 허용
// (서브도메인·endsWith 허용 안 함: evil-koreanair.com 류 우회 방지, DB RPC 와 같은 규칙).
// 조회 오류(503)와 미등록(403)은 구분하되 둘 다 발송을 막는다(fail-closed).

// 라벨 = 영숫자로 시작·끝(하이픈은 가운데만), 점으로 2개 이상 연결. lookbehind 없이 이식성 우선(codex 지적).
const LABEL = '(?:[a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])';
const DOMAIN_RE = new RegExp('^' + LABEL + '(?:[.]' + LABEL + ')+$'); // 점은 [.] 로 — 이스케이프 실수 방지

/** 이메일에서 비교용 도메인을 뽑는다. 형식이 이상하면 ''. */
export function extractDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '';
  const domain = e.slice(at + 1);
  if (!DOMAIN_RE.test(domain)) return ''; // 후행 점·연속 점·빈 라벨·비ASCII 거부
  return domain;
}

/**
 * airline_domains 에 등록된 도메인인지.
 * @returns {{ ok: true, name: string } | { ok: false, reason: 'not_airline' | 'lookup_failed' }}
 */
export async function checkAirlineDomain(supabase, email) {
  const domain = extractDomain(email);
  if (!domain) return { ok: false, reason: 'not_airline' };
  const { data, error } = await supabase
    .from('airline_domains')
    .select('domain, name')
    .eq('domain', domain)
    .limit(1);
  if (error) return { ok: false, reason: 'lookup_failed' };
  if (!data || data.length === 0) return { ok: false, reason: 'not_airline' };
  return { ok: true, name: data[0].name };
}

/** 판정 실패를 API 응답으로 옮긴다. 성공이면 null. */
export function airlineDomainFailure(check) {
  if (check.ok) return null;
  if (check.reason === 'lookup_failed') {
    return { status: 503, code: 'SERVICE_UNAVAILABLE', error: '인증 서비스 준비 중입니다. 잠시 후 다시 시도해주세요.' };
  }
  return { status: 403, code: 'AIRLINE_DOMAIN_REQUIRED', error: '승무원 회사 이메일 주소만 인증할 수 있습니다. 지원 항공사 목록을 확인해주세요.' };
}

export const OTP_PURPOSES = ['signup', 'airline_email'];

/** 클라이언트 purpose 를 서버 허용값으로 정규화. 허용 밖이면 ''. */
export function normalizePurpose(raw) {
  const v = String(raw || '').trim();
  return OTP_PURPOSES.includes(v) ? v : '';
}

/**
 * purpose 에 따라 도메인 게이트를 적용한다. 'signup' 은 통과, 'airline_email' 은 항공사 도메인만.
 * @returns {{ status, code, error } | null}  실패 응답 또는 null(통과)
 */
export async function gateByPurpose(supabase, email, purpose) {
  if (purpose === 'signup') return null;
  return airlineDomainFailure(await checkAirlineDomain(supabase, email));
}
