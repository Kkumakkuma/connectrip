import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { clearIdentityProof } from './identity';
import { isSyntheticEmail } from './loginId';

const AuthContext = createContext({});

// context 파일 관례상 hook과 Provider를 함께 export (fast refresh 예외)
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

// 저장된 세션이 있는지 동기적으로 판별.
// supabase-js v2 는 세션을 localStorage 의 `sb-<project-ref>-auth-token` 에 둔다.
// 키가 하나도 없으면 "확실히 비로그인" 이므로 세션 확인 스피너로 첫 렌더를 막을 이유가 없다
// (검색 유입·크롤러 등 공개 페이지 방문자 = 대부분 이 경우 → LCP 를 스피너가 잡아먹던 것).
// 반대로 키가 있으면 기존대로 대기해 로그인 상태가 뒤늦게 바뀌는 깜빡임을 막는다.
// localStorage 접근이 막힌 환경(사생활 모드 등)은 안전하게 기존 동작(대기)으로 둔다.
const hasStoredSession = () => {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('sb-') && key.includes('-auth-token')) return true;
    }
    return false;
  } catch {
    return true;
  }
};

// 아직 localStorage 에 세션이 없더라도, 주소에 인증 토큰이 실려 오는 착지 경로
// (OAuth 리다이렉트 / 비밀번호 재설정 메일 링크)는 곧 로그인 상태가 된다.
// 이 경우 비로그인 화면을 먼저 그리면 깜빡임·오판정이 생기므로 세션 확정까지 기다린다.
const hasAuthCallbackInUrl = () => {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    // 휴대폰 본인확인(포트원) 모바일 복귀는 우리가 붙인 ?flow=identity 와 함께 code=/message= 가 올 수 있다 —
    // OAuth 콜백이 아니므로 세션 대기(3초)를 걸지 않는다. (경로 기준 예외는 두지 않는다 — 기존 콜백 판정 유지)
    if (/[?&]flow=identity(&|$)/.test(search)) return false;
    return hash.includes('access_token=')
      || hash.includes('error_description=')
      || /[?&](code|token_hash)=/.test(search)
      || /[?&]type=recovery/.test(search)
      || /[?&]error(_description)?=/.test(search);
  } catch {
    return false;
  }
};

const shouldWaitForSession = () => hasStoredSession() || hasAuthCallbackInUrl();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(shouldWaitForSession);
  // 프로필 조회(get_my_profile RPC)는 네트워크 왕복이라 세션 확인과 분리한다.
  // 세션이 확정되면 화면을 먼저 그리고, 프로필은 뒤이어 채운다.
  const [profileLoading, setProfileLoading] = useState(false);
  // 프로필 조회가 실패한 상태. "프로필이 없다(= 일반 회원)" 와 "못 불러왔다" 를 구분해야
  // 권한 화면이 네트워크 오류를 '권한 없음' 으로 단정하지 않는다.
  const [profileError, setProfileError] = useState(false);
  const profileReqRef = useRef(0);

  // 본인 프로필 조회: get_my_profile RPC 우선 (profiles SELECT 컬럼 잠금 대비),
  // RPC 미존재/실패 시 기존 select('*') 폴백.
  // 전환기 폴백: profiles 잠금 SQL 적용 후 select('*') 폴백은 제거 가능.
  // 반환 { data, failed } — failed 는 "조회 자체가 실패"(권한/네트워크).
  // data=null & failed=false 는 "프로필 row 가 아직 없음"(아래 upsert 경로가 처리).
  // 둘을 섞으면 네트워크 오류가 '일반 회원'으로 확정돼 권한 화면이 오판한다.
  const loadMyProfile = async (userId) => {
    try {
      const { data: rpcRows, error: rpcError } = await supabase
        .rpc('get_my_profile')
        .maybeSingle();
      if (!rpcError) return { data: rpcRows ?? null, failed: false };
    } catch { /* RPC 미존재(SQL 미적용)면 폴백 */ }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    // PGRST116 = 0건 → row 미생성이지 오류가 아니다.
    if (error) return { data: null, failed: error.code !== 'PGRST116' };
    return { data: data ?? null, failed: false };
  };

  // 상태를 건드리지 않는 순수 조회. setProfile 은 호출자가 요청 id 를 확인한 뒤에만 한다.
  // isCurrent() = 이 요청이 아직 최신인지. upsert 는 DB 쓰기라 반영 시점이 아니라
  // "쓰기 직전"에 유효성을 봐야 한다(계정이 바뀐 뒤 도착한 요청이 남의 행을 건드리지 않게).
  const resolveProfile = async (userId, isCurrent) => {
    const first = await loadMyProfile(userId);
    if (first.failed || first.data) return first;
    if (!isCurrent()) return first;

    // 프로필 row 가 아예 없으면 (트리거 불발/OAuth 경합) 즉시 최소 프로필 upsert
    const authUser = (await supabase.auth.getUser()).data?.user;
    // 대상 불일치(=그 사이 계정 전환)면 쓰지 않는다 — 다른 계정 정보가 섞이는 것 차단
    if (!authUser || authUser.id !== userId || !isCurrent()) return first;
    const meta = authUser.user_metadata || {};
    // 아이디 기반 계정의 Auth 주소는 합성 주소(<login_id>@id.connecttrip.co.kr)라 연락처도 이름도 아니다.
    // profiles.email 에 넣지 않고, 기본 이름으로도 쓰지 않는다(화면 노출 0건 원칙).
    const contactEmail = isSyntheticEmail(authUser.email) ? null : (authUser.email || null);
    const defaultName = meta.full_name || meta.name
      || (contactEmail ? contactEmail.split('@')[0] : '여행자');
    // returning 제거: profiles SELECT 컬럼 잠금 후 .select() returning 이 깨지므로
    // upsert 후 get_my_profile 로 재조회한다.
    await supabase
      .from('profiles')
      .upsert({
        id: userId,
        email: contactEmail,
        name: defaultName,
        avatar_url: meta.avatar_url || null,
        provider: authUser.app_metadata?.provider || 'email',
        profile_completed: false,
      }, { onConflict: 'id' });
    return loadMyProfile(userId);
  };

  // 요청 id 를 올려 진행 중이던 응답을 무효화한다(로그아웃·계정 전환 시 필수).
  const invalidateProfileRequests = () => {
    profileReqRef.current += 1;
    return profileReqRef.current;
  };

  // 늦게 도착한 응답이 다른 사용자의 프로필을 덮어쓰지 않도록 요청 id 가 최신일 때만 반영.
  const applyProfileResult = (reqId, result) => {
    if (profileReqRef.current !== reqId) return;
    if (result.failed) {
      setProfileError(true); // 이전 profile 은 유지 — 실패를 '프로필 없음'으로 확정하지 않는다
      return;
    }
    setProfileError(false);
    setProfile(result.data);
  };

  // 조회 시작 시 다른 계정의 프로필이 남아 있으면 즉시 비운다.
  // (계정 전환 직후 이전 사용자의 isCrew/isAdmin·개인정보를 승계하지 않게)
  // 같은 사용자의 새로고침이면 유지해 불필요한 깜빡임을 만들지 않는다.
  const dropForeignProfile = (userId) => {
    setProfile((prev) => (prev && prev.id === userId ? prev : null));
  };

  // 프로필 조회를 백그라운드로 돌린다(세션 확정 후 화면을 먼저 그리기 위해).
  const runProfileFetch = (userId) => {
    const reqId = invalidateProfileRequests();
    dropForeignProfile(userId);
    setProfileLoading(true);
    setProfileError(false);
    resolveProfile(userId, () => profileReqRef.current === reqId)
      .then((result) => applyProfileResult(reqId, result))
      .catch(() => { if (profileReqRef.current === reqId) setProfileError(true); })
      .finally(() => { if (profileReqRef.current === reqId) setProfileLoading(false); });
  };

  // 외부(마이페이지·칭찬매칭 등)에서 프로필을 새로고침할 때 쓰는 공개 API.
  const fetchProfile = async (userId) => {
    const reqId = invalidateProfileRequests();
    dropForeignProfile(userId);
    setProfileLoading(true);
    setProfileError(false);
    try {
      const result = await resolveProfile(userId, () => profileReqRef.current === reqId);
      applyProfileResult(reqId, result);
      return result.data;
    } catch {
      if (profileReqRef.current === reqId) setProfileError(true);
      return null;
    } finally {
      if (profileReqRef.current === reqId) setProfileLoading(false);
    }
  };

  useEffect(() => {
    // Safety timeout - never hang on loading forever
    const timeout = setTimeout(() => {
      console.warn('Auth loading timeout - forcing ready state');
      setLoading(false);
    }, 3000);

    let initialDone = false;

    // OAuth 리다이렉트: 해시에 access_token 이 있으면 즉시 세션으로 변환 + URL 정리
    // (detectSessionInUrl 기본값이 있어도 일부 브라우저·상황에서 자동 처리가 안 될 때 대비)
    const hashStr = typeof window !== 'undefined' ? window.location.hash : '';
    if (hashStr && hashStr.includes('access_token=')) {
      try {
        const params = new URLSearchParams(hashStr.startsWith('#') ? hashStr.slice(1) : hashStr);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          supabase.auth.setSession({ access_token, refresh_token }).catch((err) => {
            console.warn('setSession from hash failed:', err?.message);
          });
        }
      } catch (e) {
        console.warn('hash parse failed:', e);
      }
      // URL 에서 해시 제거 (토큰이 주소창에 남지 않게)
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch { /* noop */ }
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialDone) {
        initialDone = true;
        clearTimeout(timeout);
        setUser(session?.user ?? null);
        // 프로필 응답을 기다리지 않고 세션 확정 즉시 렌더한다(프로필은 뒤이어 채워짐).
        if (session?.user) runProfileFetch(session.user.id);
        setLoading(false);
      }
    }).catch(() => {
      if (!initialDone) {
        initialDone = true;
        clearTimeout(timeout);
        setLoading(false);
      }
    });

    // Listen for auth changes (after initial session)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // 재설정 메일 링크 착지 시(redirectTo 미허용 폴백으로 / 에 떨어져도) 새 비밀번호
        // 설정 화면으로 보낸다 — 비밀번호 재설정 플로우(2026-07-20 신설).
        // sessionStorage 플래그 = ResetPassword 가 '복구 링크로 온 세션'만 허용하는 근거
        // (일반 로그인 세션의 무검증 비번 변경 차단 — codex 지적)
        if (_event === 'PASSWORD_RECOVERY') {
          try { sessionStorage.setItem('ct_pw_recovery', '1'); } catch { /* 무시 */ }
          if (window.location.pathname !== '/reset-password') {
            window.location.replace('/reset-password');
            return;
          }
        }
        // Skip INITIAL_SESSION since getSession handles it
        if (!initialDone) {
          initialDone = true;
          clearTimeout(timeout);
        }
        setUser(session?.user ?? null);
        if (session?.user) {
          runProfileFetch(session.user.id);
          // 로그인 성공: 기기에 남은 이전 계정 사본과 만료분을 청소한다(플래너 오프라인 저장).
          // 동적 import 다 — 정적으로 끌어오면 플래너 코드가 앱 번들에 딸려 들어온다.
          import('@planner-offline')
            .then((m) => m.sweep(session.user.id))
            .catch(() => {});
        } else {
          // 로그아웃: 진행 중이던 프로필 응답이 뒤늦게 도착해도 무시되도록 id 를 올린다.
          invalidateProfileRequests();
          setProfile(null);
          setProfileLoading(false);
          setProfileError(false);
          // 기기에 남은 여행 사본·티켓 원본 삭제.
          //
          // ⚠ "세션이 없으면 무조건 지운다"로 두면 안 된다(2026-09-04 교차검토에서 잡힘).
          //   티켓 지갑의 주 시나리오가 "비행기 안·로밍 끔"인데, 그 상태에서는 토큰 갱신 요청이
          //   네트워크 실패로 떨어진다. 그걸 로그아웃으로 오해해 지우면, 티켓을 보려고 연 순간
          //   바로 그 티켓이 사라진다.
          //   그래서 **명시적 로그아웃(SIGNED_OUT)** 이고 **온라인일 때만** 지운다.
          //   오프라인에서 진짜 로그아웃된 경우는 다시 온라인이 되어 SIGNED_OUT 이 오거나,
          //   다른 계정으로 로그인할 때 sweep 이 정리한다.
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          if (_event === 'SIGNED_OUT' && !offline) {
            import('@planner-offline')
              .then((m) => m.purgeAll())
              .catch(() => {});
          }
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // 가입 함수는 두지 않는다 — 계정 생성은 서버(POST /api/signup)가 증빙(PASS·이메일 OTP)을 검증한 뒤 한다.
  // 브라우저에서 직접 Auth 계정을 만들 수 있으면 남의 아이디의 합성 주소를 선점할 수 있어서다(2026-09-05).

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signInWithProvider = async (provider) => {
    // 같은 탭에서 이메일 가입(본인확인 완료) 도중 OAuth 로 갈아타면, 남아 있던 본인확인 증빙이
    // 다른 계정의 프로필 완성에 쓰이지 않도록 폐기한다(OAuth 복귀 후 /signup/complete 에서 다시 본인확인).
    clearIdentityProof();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider, // 'google', 'kakao'
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    // 로컬 세션 먼저 강제 초기화.
    // 진행 중이던 프로필 응답이 뒤늦게 도착해 로그아웃 후 프로필을 되살리지 않게 무효화한다.
    invalidateProfileRequests();
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    setProfileError(false);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) console.error('signOut error:', error.message);
    } catch (err) {
      console.error('signOut exception:', err);
    }
  };

  const updateProfile = async (updates) => {
    if (!user) return;
    // returning 제거: profiles SELECT 컬럼 잠금 후 .select() returning 이 깨지므로
    // update 후 get_my_profile 로 재조회한다.
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) throw error;
    const reqId = invalidateProfileRequests();
    const result = await loadMyProfile(user.id);
    applyProfileResult(reqId, result);
    return result.data;
  };

  // 프로필은 반드시 "현재 로그인한 사용자 본인의 것"일 때만 유효로 본다.
  // 계정 전환 과도기에 이전 사용자의 프로필로 권한(isCrew/isAdmin)이 판정되는 것을 원천 차단.
  const ownedProfile = user && profile && profile.id === user.id ? profile : null;

  const value = {
    user,
    profile: ownedProfile,
    loading,
    // 세션은 확정됐지만 프로필(role/user_type)이 아직인 구간.
    // isCrew/isAdmin 로 화면을 가르는 곳은 이 값이 true 인 동안 판정을 미뤄야 한다.
    profileLoading,
    // 프로필 조회 실패(네트워크/권한). true 면 '권한 없음'이 아니라 '확인 실패'로 다뤄야 한다.
    profileError,
    signIn,
    signInWithProvider,
    signOut,
    updateProfile,
    fetchProfile,
    isLoggedIn: !!user,
    isCrew: ownedProfile?.user_type === 'crew',
    isAdmin: ownedProfile?.role === 'admin',
  };

  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ color: '#64748b', fontSize: '14px' }}>ConnectTrip</p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
