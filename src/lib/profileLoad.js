// 본인 프로필 조회(AuthContext.loadMyProfile) 보조 판정. 화면 없이 테스트한다.
//
// get_my_profile RPC 가 "없어서" 실패한 경우(SQL 미적용 전환기)에만 profiles 직접 조회 폴백을 허용한다.
// RPC 는 있는데 네트워크·일시 오류로 실패했을 때 폴백하면, 폴백 컬럼에 profile_completed·login_id·
// crew_verified_at 이 없어 부분 프로필이 정상 프로필처럼 쓰인다 → 가입을 마친 회원이
// /signup/complete 로 튕기고 승무원 인증 만료일이 사라진다(2026-09-16 codex 검토, cb05c1b 회귀).
// 그런 실패는 '조회 실패'로 돌려 이전 프로필을 유지한다.
export function isMissingRpcError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  // PGRST202: PostgREST 가 함수를 찾지 못함 / 42883: Postgres undefined_function
  if (code === 'PGRST202' || code === '42883') return true;
  // 코드 없이 메시지만 오는 경우 대비(PostgREST 원문 "Could not find the function public.get_my_profile ...")
  return !code && /could not find the function/i.test(String(error.message || ''));
}
