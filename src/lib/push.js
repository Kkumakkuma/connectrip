// 앱 푸시(FCM) 클라이언트 골격 (2026-09-20, 쿠마님 10068: "앱에는 기능만 만들어 놓고 나중에 클라우드플레어 연결하면 바로 가능하게").
// 웹에서는 전부 no-op. 네이티브에서만 @capacitor/push-notifications·preferences·app 을 동적 import 한다(웹 번들 비대화 방지).
// 흐름: 로그인·세션 복원(PushBridge) → 권한 요청 → FCM 토큰 → RPC push_token_upsert / 로그아웃(AuthContext.signOut) → push_token_remove.
// 서버 쪽은 push_20260920.sql. 발송 워커가 아직 없어도 여기까지는 그대로 돌고 토큰만 쌓인다.
// ⚠ google-services.json 이 없는 빌드에서 register() 를 부르면 앱이 종료된다(2026-09-27 에뮬레이터 실측 — 조용히 실패하지 않는다).
//   그래서 등록·탭 처리는 PUSH_ENABLED(빌드 플래그, featureFlags.js)일 때만 한다. 로그아웃 때 토큰 삭제는 저장된 토큰이 있을 때만이라 그대로 둔다.
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import { isNativeApp } from './native';
import { PUSH_ENABLED } from './featureFlags';

const TOKEN_KEY = 'ct_fcm_token'; // 이 기기에서 마지막으로 서버에 등록한 토큰(로테이션·로그아웃 삭제용)
const REGISTER_TIMEOUT_MS = 10000;

async function prefs() {
  const { Preferences } = await import('@capacitor/preferences');
  return Preferences;
}

export async function getStoredPushToken() {
  if (!isNativeApp()) return null;
  try {
    const { value } = await (await prefs()).get({ key: TOKEN_KEY });
    return value || null;
  } catch {
    return null;
  }
}

// 권한 확인(없으면 요청, Android 13+ 다이얼로그) → register → 'registration' 이벤트의 토큰.
// 거부·실패·시간초과는 null. 리스너는 어떤 경로로 끝나도 finally 에서 정리한다.
export async function acquirePushToken() {
  if (!PUSH_ENABLED) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  // 아직 안 물어본 상태(prompt·prompt-with-rationale)에서만 OS 다이얼로그를 띄운다. 이미 거부한 기기는 매 실행마다 다시 묻지 않는다(agy 검토).
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return null;

  let regHandle = null;
  let errHandle = null;
  let timer = null;
  try {
    let resolveToken;
    let rejectToken;
    const tokenPromise = new Promise((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    tokenPromise.catch(() => {}); // register() 자체가 throw 하면 아무도 안 기다리는 promise 가 남는다 — unhandled rejection 방지
    regHandle = await PushNotifications.addListener('registration', (t) => resolveToken(t?.value || null));
    errHandle = await PushNotifications.addListener('registrationError', (e) => rejectToken(new Error(e?.error || 'registration-failed')));
    timer = setTimeout(() => rejectToken(new Error('timeout')), REGISTER_TIMEOUT_MS);
    await PushNotifications.register();
    return await tokenPromise;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    // remove() 는 네이티브에선 Promise 를 돌려준다 — 거부돼도 삼킨다(unhandled rejection 방지).
    if (regHandle) Promise.resolve(regHandle.remove()).catch(() => {});
    if (errHandle) Promise.resolve(errHandle.remove()).catch(() => {});
  }
}

// 로그인·세션 복원 때(PushBridge). 성공하면 토큰, 아니면 null — 실패해도 다음 실행 때 다시 시도한다.
// 매 실행마다 upsert 하므로 서버의 updated_at 이 갱신돼 90일 정리(push_purge)에 안 걸린다.
export async function registerPushForUser() {
  if (!isNativeApp() || !PUSH_ENABLED) return null;
  try {
    const token = await acquirePushToken();
    if (!token) return null;
    let version = null;
    try {
      const { App } = await import('@capacitor/app');
      version = (await App.getInfo())?.version || null;
    } catch {
      /* 버전은 참고용 */
    }
    const { error } = await supabase.rpc('push_token_upsert', { p_token: token, p_platform: Capacitor.getPlatform(), p_app_version: version });
    if (error) return null;
    const P = await prefs();
    const prev = (await P.get({ key: TOKEN_KEY })).value || null;
    if (prev && prev !== token) {
      // 토큰 로테이션 — 옛 토큰을 서버에서 지운다. 실패해도 90일 정리가 거둔다.
      try { await supabase.rpc('push_token_remove', { p_token: prev }); } catch { /* noop */ }
    }
    await P.set({ key: TOKEN_KEY, value: token });
    return token;
  } catch {
    return null;
  }
}

// 로그아웃 직전(세션이 아직 있을 때) 호출 — RPC 가 auth.uid() 를 쓴다. 저장 토큰이 없으면 아무것도 안 한다.
// 서버 삭제가 실패해도 로컬은 비운다: 다음 로그인 때 새로 등록되고, 서버 잔여 토큰은 계정 전환 upsert·90일 정리가 거둔다.
export async function unregisterPush() {
  if (!isNativeApp()) return;
  try {
    const P = await prefs();
    const token = (await P.get({ key: TOKEN_KEY })).value || null;
    if (!token) return;
    await P.remove({ key: TOKEN_KEY });
    await supabase.rpc('push_token_remove', { p_token: token });
  } catch {
    /* 로그아웃을 막지 않는다 */
  }
}

// 푸시를 탭했을 때 — data.link 가 사이트 내부 경로면 그 화면으로 이동. cleanup 함수 반환.
// 앱이 완전히 꺼진 상태에서 탭해도 안 놓친다: Capacitor 가 런치 인텐트를 handleOnNewIntent 로 넘기고(BridgeActivity.load)
// 플러그인이 retainUntilConsumed=true 로 이벤트를 붙잡아 두므로, 이 리스너가 늦게 붙어도 그때 전달된다(node_modules 실측 2026-09-20).
export function isSafeInternalLink(link) {
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') && !link.includes('\\');
}

export async function listenPushTap(navigate) {
  if (!isNativeApp() || !PUSH_ENABLED) return () => {};
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const handle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const link = action?.notification?.data?.link;
    if (isSafeInternalLink(link)) navigate(link);
  });
  return () => handle.remove();
}
