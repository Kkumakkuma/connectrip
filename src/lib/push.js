// 앱 푸시(FCM) 클라이언트 (2026-09-20 골격, 2026-09-27 발송기 연결 — 발송은 Supabase Edge Function push-send).
// 웹에서는 전부 no-op. 네이티브에서만 @capacitor/push-notifications·preferences·app 을 동적 import 한다(웹 번들 비대화 방지).
// 흐름: 로그인·세션 복원(PushBridge) → 권한 요청 → FCM 토큰 → RPC push_token_upsert / 로그아웃(AuthContext) → push_token_remove + 기기 토큰 해제.
// 서버 쪽은 push_20260920.sql(골격) + push_worker_20260927.sql(발송기).
// ⚠ google-services.json 이 없는 빌드에서 register() 를 부르면 앱이 종료된다(2026-09-27 에뮬레이터 실측 — 조용히 실패하지 않는다).
//   그래서 등록·탭 처리·기기 토큰 해제는 PUSH_ENABLED(빌드 플래그, featureFlags.js)일 때만 한다.
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import { isNativeApp } from './native';
import { PUSH_ENABLED } from './featureFlags';

const TOKEN_KEY = 'ct_fcm_token'; // 이 기기에서 마지막으로 서버에 등록한 토큰(로테이션·로그아웃 삭제용)
// 시간 값은 테스트가 줄일 수 있게 한곳에 둔다(__setPushTimingForTest).
const T = {
  register: 10000,       // FCM 토큰 받기 상한
  rpc: 8000,             // 서버 RPC 하나의 상한 — 응답이 없어도 줄이 막히지 않게(codex 검토)
  device: 5000,          // 기기 토큰 해제 상한
  reissueWait: 1500,     // 로그아웃 직후 재로그인 때 옛 토큰 삭제가 끝나길 기다리는 간격
  reissueTries: 3,
  retireWindow: 30000,   // 해제한 토큰을 '삭제 중'으로 보는 시간. 지나서도 같은 토큰이면 삭제가 실패한 것 = 유효한 토큰
  resumeRefresh: 6 * 60 * 60 * 1000,   // 앱 복귀 때 재등록 최소 간격(저장 토큰이 없으면 바로 시도)
};
export function __setPushTimingForTest(over) { Object.assign(T, over); }

// 로그인·등록·로그아웃 경합 방지(2026-09-27 codex 검토 3회) — 등록 도중 로그아웃하면 이전 계정 알림이 이 기기로 계속 올 수 있다.
//  · 등록과 토큰 갱신 저장은 한 줄(queue)로 세워 순서가 뒤집히지 않게 한다. 줄의 모든 기다림에는 상한이 있다.
//  · 로그아웃은 줄을 기다리지 않고 바로 서버 삭제와 기기 토큰 해제를 동시에 시작한다(서버가 늦어도 기기 쪽은 끊긴다).
//    다음 등록은 기기 해제가 끝난 뒤(상한 있음)에 줄을 선다.
//  · generation 은 로그아웃마다 오르고, 이전 로그인의 작업은 결과를 쓰지 않는다(이미 올렸으면 되돌린다).
//  · loggedOut 은 로그아웃~다음 로그인(PushBridge 의 sessionStart 등록) 사이 true — 그동안 앱 복귀 재등록 등은 거절한다.
let generation = 0;
let loggedOut = false;
let queue = Promise.resolve();
let lastIssuedToken = null;      // 기기가 마지막으로 받은 토큰(서버 저장 전이라도)
let retiredToken = null;         // 로그아웃 때 해제한 토큰 — 곧바로 다시 받으면 삭제가 덜 끝난 것
let retiredAt = 0;
let unregisterWork = null;       // 진행 중·완료된 해제(한 로그아웃에서 signOut + SIGNED_OUT 이벤트로 두 번 불려도 한 번만)
let attemptedSinceUnregister = false;   // 해제 뒤 서버 등록을 시도했는가 — 했으면 다음 로그아웃은 해제를 새로 한다
let lastSavedAt = 0;

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]);
}

function rpc(name, args) {
  return withTimeout(Promise.resolve().then(() => supabase.rpc(name, args)), T.rpc);
}

// ⚠ Capacitor 플러그인 객체(Proxy)는 어떤 속성을 물어도 함수를 돌려줘서 'then' 까지 있는 것처럼 보인다(@capacitor/core 8 registerPlugin).
//   그래서 async 함수에서 플러그인 객체를 그대로 return 하거나 await 하면 그 Promise 가 영영 끝나지 않는다. 9/20 골격의 prefs() 가
//   `return Preferences` 여서 앱 로그아웃의 토큰 삭제가 멈춰 3초 제한에 걸리고 있었다(2026-09-27 발견). 모듈째로 받아 꺼내 쓴다.
let prefsModule = null;
function prefs() {
  if (!prefsModule) prefsModule = import('@capacitor/preferences');   // 모듈 네임스페이스(then 없음)의 Promise 를 한 번만 만들어 재사용
  return prefsModule;
}

export async function getStoredPushToken() {
  if (!isNativeApp()) return null;
  try {
    const { Preferences } = await prefs();
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    return value || null;
  } catch {
    return null;
  }
}

function isRetired(token) {
  return !!token && token === retiredToken && Date.now() - retiredAt < T.retireWindow;
}

// 권한 확인(prompt=true 면 없을 때 요청, Android 13+ 다이얼로그) → 채널 → register → 'registration' 이벤트의 토큰.
// 거부·실패·시간초과는 null. 리스너는 어떤 경로로 끝나도 finally 에서 정리한다.
export async function acquirePushToken({ prompt = true } = {}) {
  if (!PUSH_ENABLED) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  // 아직 안 물어본 상태(prompt·prompt-with-rationale)에서만 OS 다이얼로그를 띄운다. 이미 거부한 기기는 다시 묻지 않는다(agy 검토).
  // 앱 복귀 때의 조용한 재등록(prompt=false)은 절대 묻지 않는다 — 설정에서 허용했을 때만 등록된다.
  if (prompt && (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale')) perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return null;
  // 서버가 보내는 channel_id 'default' 와 AndroidManifest 의 기본 채널이 이 채널을 가리킨다. 없으면 FCM 이 이름 없는 '기타' 채널로 보낸다.
  // 같은 id 로 다시 만들어도 사용자가 바꾼 설정은 유지된다(안드로이드 채널 규칙). 실패해도 등록은 계속한다.
  try {
    await withTimeout(PushNotifications.createChannel({ id: 'default', name: '알림', description: '댓글·쪽지 등 커넥트립 알림', importance: 4 }), T.device);
  } catch {
    /* 채널 생성 실패 = 기본 채널로 표시될 뿐 */
  }

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
    tokenPromise.catch(() => {}); // 아무도 안 기다리는 promise 가 남는 경우 — unhandled rejection 방지
    regHandle = await PushNotifications.addListener('registration', (t) => {
      if (t?.value) lastIssuedToken = t.value;
      resolveToken(t?.value || null);
    });
    errHandle = await PushNotifications.addListener('registrationError', (e) => rejectToken(new Error(e?.error || 'registration-failed')));
    timer = setTimeout(() => rejectToken(new Error('timeout')), T.register);
    // register() 가 끝나지 않아도 타이머가 풀어 주도록 기다리지 않는다(codex 검토) — 실패는 토큰 대기로 넘긴다.
    Promise.resolve()
      .then(() => PushNotifications.register())
      .catch((e) => rejectToken(e instanceof Error ? e : new Error('register-failed')));
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

// 로그아웃 직후 재로그인이면 기기가 아직 옛 토큰(삭제 중)을 돌려줄 수 있다 — 플러그인 unregister() 는
// deleteToken() 완료를 기다리지 않고 끝난다(8.1.2 소스, codex 검토). 같은 토큰이 오면 잠깐 기다렸다 다시 받는다.
// 그래도 같으면 저장하지 않고 { stuck: true } — 삭제 중인 토큰을 등록하면 곧 무효가 된다(codex 검토).
async function freshToken(gen, opts) {
  let token = await acquirePushToken(opts);
  for (let i = 0; isRetired(token) && i < T.reissueTries; i++) {
    await new Promise((r) => setTimeout(r, T.reissueWait));
    if (gen !== generation) return { token: null };
    token = await acquirePushToken(opts);
  }
  if (isRetired(token)) return { token: null, stuck: true };
  return { token };
}

// 토큰을 서버에 올리고 로컬에 기록한다. gen 이 바뀌었으면(그사이 로그아웃) 쓰지 않고, 올린 뒤에 바뀌었으면 되돌린다.
async function saveToken(token, gen) {
  let version = null;
  try {
    const { App } = await import('@capacitor/app');
    version = (await withTimeout(App.getInfo(), T.device))?.version || null;
  } catch {
    /* 버전은 참고용 */
  }
  if (gen !== generation || loggedOut) return null;
  attemptedSinceUnregister = true;   // 이제 서버에 이 기기가 붙을 수 있다 — 다음 로그아웃은 해제를 새로 한다
  let upsert;
  try {
    upsert = await rpc('push_token_upsert', { p_token: token, p_platform: Capacitor.getPlatform(), p_app_version: version });
  } catch {
    return null;   // 응답 없음 — 늦게 붙었더라도 다음 로그아웃이 lastIssuedToken 으로 지운다
  }
  if (upsert?.error) return null;
  const { Preferences: P } = await prefs();
  const prev = (await P.get({ key: TOKEN_KEY })).value || null;
  if (prev && prev !== token) {
    // 토큰 로테이션 — 옛 토큰을 서버에서 지운다. 실패해도 90일 정리가 거둔다.
    try { await rpc('push_token_remove', { p_token: prev }); } catch { /* noop */ }
  }
  if (gen !== generation || loggedOut) {
    // 올리는 사이 로그아웃이 시작됐다 — 방금 붙인 토큰을 떼고 로컬에도 쓰지 않는다(기기 토큰은 로그아웃이 해제한다).
    try { await rpc('push_token_remove', { p_token: token }); } catch { /* 기기 쪽 unregister 가 마저 막는다 */ }
    return null;
  }
  await P.set({ key: TOKEN_KEY, value: token });
  retiredToken = null;
  lastSavedAt = Date.now();
  return token;
}

function registerAt(gen, opts, allowDelayedRetry) {
  return enqueue(async () => {
    if (gen !== generation || loggedOut) return null;
    try {
      const { token, stuck } = await freshToken(gen, opts);
      if (stuck && allowDelayedRetry) {
        // 삭제가 덜 끝난 옛 토큰만 온다 — 삭제 대기 시간이 지난 뒤 한 번 더(그때도 같으면 삭제 실패 = 유효한 토큰으로 인정)
        setTimeout(() => {
          if (gen === generation && !loggedOut) registerAt(gen, { ...opts, prompt: false }, false).catch(() => {});
        }, T.retireWindow + T.reissueWait);
      }
      if (!token || gen !== generation || loggedOut) return null;
      return await saveToken(token, gen);
    } catch {
      return null;
    }
  });
}

// 로그인·세션 복원 때(PushBridge, sessionStart=true). 성공하면 토큰, 아니면 null — 실패해도 다음 실행·앱 복귀 때 다시 시도한다.
// 매 실행마다 upsert 하므로 서버의 updated_at 이 갱신돼 90일 정리(push_purge)에 안 걸린다.
export function registerPushForUser(opts = {}) {
  if (!isNativeApp() || !PUSH_ENABLED) return Promise.resolve(null);
  if (opts.sessionStart) loggedOut = false;
  return registerAt(generation, opts, true);
}

// 앱 복귀(resume) 때: 첫 등록이 실패했거나(네트워크) 설정에서 알림을 나중에 허용한 경우를 거둔다. 권한은 묻지 않는다.
// 토큰이 저장돼 있고 최근에 올렸으면 아무것도 안 한다. 로그아웃 중·후에는 하지 않는다(codex 검토).
export async function refreshPushOnResume() {
  if (!isNativeApp() || !PUSH_ENABLED || loggedOut) return null;
  const gen = generation;
  const stored = await getStoredPushToken();
  if (gen !== generation || loggedOut) return null;
  if (stored && Date.now() - lastSavedAt < T.resumeRefresh) return stored;
  return registerAt(gen, { prompt: false }, true);
}

// 앱이 켜진 동안 FCM 이 토큰을 바꾸면(onNewToken) 플러그인이 같은 'registration' 이벤트를 다시 보낸다(8.1.2 소스 실측).
// 로그인 중(PushBridge 가 로그인 동안만 붙인다)이면 새 토큰을 같은 줄에 세워 서버에 올린다 — 다음 실행까지 알림이 끊기지 않게.
export async function listenTokenRefresh() {
  if (!isNativeApp() || !PUSH_ENABLED) return () => {};
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const gen = generation;
  const handle = await PushNotifications.addListener('registration', (t) => {
    const token = t?.value || null;
    if (!token || gen !== generation || loggedOut || isRetired(token)) return;
    lastIssuedToken = token;
    enqueue(async () => {
      if (gen !== generation || loggedOut) return null;
      if ((await getStoredPushToken()) === token) return null;   // 첫 등록이 이미 저장한 토큰
      return saveToken(token, gen);
    }).catch(() => {});
  });
  return () => { Promise.resolve(handle.remove()).catch(() => {}); };
}

// 로그아웃 직전(세션이 아직 있을 때) 또는 세션이 끊긴 직후(SIGNED_OUT) 호출.
// 서버 삭제(RPC 는 auth.uid() 를 쓴다 — 세션이 없으면 실패)와 기기 토큰 해제를 동시에 한다. 둘 다 상한이 있다.
// 기기 토큰이 해제되면 FCM 이 그 토큰에 UNREGISTERED 로 답하고 발송기가 서버 쪽 토큰도 지우므로, 서버 삭제가 실패해도 알림은 끊긴다.
export function unregisterPush() {
  if (!isNativeApp()) return Promise.resolve();
  generation += 1;
  loggedOut = true;
  if (unregisterWork && !attemptedSinceUnregister) return unregisterWork;
  attemptedSinceUnregister = false;
  // 다음 등록이 기다릴 문: 기기 해제가 끝나면 열린다(서버 삭제는 기다리지 않는다 — 응답이 없어도 줄이 막히지 않게).
  let openGate;
  const deviceGate = new Promise((r) => { openGate = r; });
  const work = (async () => {
    let stored = null;
    try {
      const { Preferences: P } = await prefs();
      stored = (await P.get({ key: TOKEN_KEY })).value || null;
      if (stored) await P.remove({ key: TOKEN_KEY });
    } catch {
      /* 로그아웃을 막지 않는다 */
    }
    // 저장에 실패했어도 서버에 붙었을 수 있는 마지막 발급 토큰까지 지운다(codex 검토).
    const targets = [...new Set([stored, lastIssuedToken].filter(Boolean))];
    retiredToken = stored || lastIssuedToken;
    retiredAt = Date.now();
    const server = Promise.all(targets.map((t) => rpc('push_token_remove', { p_token: t }).then(() => {}, () => {})));
    const device = PUSH_ENABLED
      ? withTimeout(import('@capacitor/push-notifications').then(({ PushNotifications }) => PushNotifications.unregister()), T.device)
        .then(() => {}, () => {})
      : Promise.resolve();
    device.then(openGate);
    await Promise.all([server, device]);
  })();
  work.catch(() => {}).finally(() => openGate());   // 어떤 경우에도 문은 열린다
  unregisterWork = work;
  queue = queue.then(() => deviceGate, () => deviceGate).catch(() => {});
  return work;
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
