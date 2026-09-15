import { supabase } from './supabase';

// 닉네임 중복 확인(check_nickname_taken RPC). 마이페이지 회원 정보 카드와 글쓰기 전 닉네임 설정 창이 함께 쓴다.
// 반환: true = 이미 사용 중, false = 사용 가능, null = 확인 실패(판정은 저장 시 UNIQUE 제약이 한다).
export async function checkNicknameTaken(nickname) {
  try {
    const { data, error } = await supabase.rpc('check_nickname_taken', { p_nickname: nickname });
    if (error || data === null || data === undefined) return null;
    return !!data;
  } catch {
    return null;
  }
}
