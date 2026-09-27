import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = { native: true, platform: 'android' };
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => env.native, getPlatform: () => env.platform } }));

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

// 실제 Capacitor 플러그인 객체처럼: 정의 안 된 속성(then 포함)을 물어도 함수를 돌려준다(@capacitor/core 8 registerPlugin).
// 플러그인 객체를 async 함수에서 return 하거나 await 하면 멈추는 버그(9/20 골격의 prefs(), 2026-09-27 발견)를 테스트가 잡게 한다.
function capPlugin(impl) {
  return new Proxy(impl, { get: (t, p) => (p in t ? t[p] : () => new Promise(() => {})) });
}

const store = new Map();
const prefsCtl = { setFail: false };
vi.mock('@capacitor/preferences', () => ({
  Preferences: capPlugin({
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => {
      if (prefsCtl.setFail) throw new Error('disk full');
      store.set(key, value);
    },
    remove: async ({ key }) => { store.delete(key); },
  }),
}));

const TOK = `tok_${'x'.repeat(40)}`;
// register() 가 내줄 토큰 순서(비면 fcm.token). 같은 이벤트에 리스너가 여럿 붙을 수 있어(첫 등록 + 토큰 갱신 감시) 모두에게 보낸다.
const fcm = {
  perm: 'granted', token: TOK, seq: [], fail: false, listeners: {}, requests: 0,
  channels: [], channelFail: false, unregistered: 0, registerGate: null, registers: 0, registerHang: false,
};
function emit(name, payload) {
  for (const cb of [...(fcm.listeners[name] || [])]) cb(payload);
}
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: capPlugin({
    createChannel: async (c) => {
      if (fcm.channelFail) throw new Error('createChannel failed');
      fcm.channels.push(c);
    },
    checkPermissions: async () => ({ receive: fcm.perm }),
    requestPermissions: async () => {
      fcm.requests += 1;
      return { receive: fcm.perm.startsWith('prompt') ? 'granted' : fcm.perm };
    },
    addListener: async (name, cb) => {
      (fcm.listeners[name] ||= new Set()).add(cb);
      return {
        remove: () => {
          fcm.listeners[name]?.delete(cb);
          if (!fcm.listeners[name]?.size) delete fcm.listeners[name];
        },
      };
    },
    register: async () => {
      fcm.registers += 1;
      if (fcm.registerHang) return new Promise(() => {});   // 영영 안 끝나는 register()
      if (fcm.registerGate) await fcm.registerGate;
      if (fcm.fail) emit('registrationError', { error: 'no google-services.json' });
      else emit('registration', { value: fcm.seq.length ? fcm.seq.shift() : fcm.token });
      return undefined;
    },
    unregister: async () => { fcm.unregistered += 1; },
  }),
}));
vi.mock('@capacitor/app', () => ({ App: capPlugin({ getInfo: async () => ({ version: '1.3.2' }) }) }));
// 빌드 플래그(PUSH_ENABLED). 켠 상태가 기본, 끈 상태는 맨 아래 테스트에서 바꿔 본다.
const flags = vi.hoisted(() => ({ push: true }));
vi.mock('./featureFlags', () => ({ get PUSH_ENABLED() { return flags.push; } }));

const KEY = 'ct_fcm_token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(0);
const FAST = { register: 150, rpc: 150, device: 150, reissueWait: 15, reissueTries: 3, retireWindow: 250 };
let push;

async function freshModule() {
  vi.resetModules();   // 모듈 상태(generation·줄·해제 기록)를 새로
  push = await import('./push');
  push.__setPushTimingForTest(FAST);
}

describe('push (앱 푸시 클라이언트)', () => {
  beforeEach(async () => {
    env.native = true; env.platform = 'android'; flags.push = true; prefsCtl.setFail = false;
    Object.assign(fcm, { perm: 'granted', token: TOK, seq: [], fail: false, listeners: {}, requests: 0, channels: [], channelFail: false, unregistered: 0, registerGate: null, registers: 0, registerHang: false });
    store.clear();
    rpc.mockReset(); rpc.mockResolvedValue({ error: null });
    await freshModule();
  });

  it('웹에서는 전부 no-op — RPC·플러그인을 부르지 않는다', async () => {
    env.native = false;
    expect(await push.registerPushForUser()).toBeNull();
    await push.unregisterPush();
    expect(await push.getStoredPushToken()).toBeNull();
    expect(await push.refreshPushOnResume()).toBeNull();
    const off = await push.listenPushTap(() => {});
    expect(typeof off).toBe('function');
    expect(rpc).not.toHaveBeenCalled();
    expect(fcm.unregistered).toBe(0);
  });

  it('네이티브 로그인: 권한 → 채널 → 토큰 → push_token_upsert(플랫폼·앱 버전) → 로컬 저장, 리스너 정리', async () => {
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(TOK);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', { p_token: TOK, p_platform: 'android', p_app_version: '1.3.2' });
    expect(store.get(KEY)).toBe(TOK);
    expect(fcm.channels[0]).toMatchObject({ id: 'default', name: '알림', importance: 4 });
    expect(Object.keys(fcm.listeners)).toEqual([]);
  });

  it('채널 생성이 실패해도 등록은 계속된다 / 권한 거부 기기는 채널도 만들지 않는다', async () => {
    fcm.channelFail = true;
    expect(await push.registerPushForUser()).toBe(TOK);
    fcm.channelFail = false; fcm.perm = 'denied'; store.clear(); rpc.mockClear();
    expect(await push.registerPushForUser()).toBeNull();
    expect(fcm.channels).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('권한이 prompt 면 요청해서 받고, 이미 거부한 기기는 다시 묻지 않는다', async () => {
    fcm.perm = 'prompt';
    expect(await push.registerPushForUser()).toBe(TOK);
    fcm.perm = 'prompt-with-rationale';
    expect(await push.registerPushForUser()).toBe(TOK);
    expect(fcm.requests).toBe(2);
    fcm.perm = 'denied'; rpc.mockClear();
    expect(await push.registerPushForUser()).toBeNull();
    expect(fcm.requests).toBe(2);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registrationError(google-services 없는 빌드)면 null, 리스너 정리', async () => {
    fcm.fail = true;
    expect(await push.registerPushForUser()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(Object.keys(fcm.listeners)).toEqual([]);
  });

  it('register() 가 영영 안 끝나도 시간 상한 뒤 null 이고, 줄이 막히지 않아 다음 등록이 된다(codex 검토)', async () => {
    fcm.registerHang = true;
    expect(await push.registerPushForUser()).toBeNull();
    fcm.registerHang = false;
    expect(await push.registerPushForUser()).toBe(TOK);
  });

  it('토큰 로테이션: 옛 토큰은 push_token_remove, 새 토큰으로 교체 / upsert 에러·무응답이면 저장 안 함', async () => {
    store.set(KEY, 'old_token_zzzzzzzzzzzzzzzzzzzzzz');
    expect(await push.registerPushForUser()).toBe(TOK);
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: 'old_token_zzzzzzzzzzzzzzzzzzzzzz' });
    expect(store.get(KEY)).toBe(TOK);
    store.clear(); rpc.mockResolvedValue({ error: { message: 'AUTH_REQUIRED' } });
    expect(await push.registerPushForUser()).toBeNull();
    expect(store.has(KEY)).toBe(false);
    rpc.mockImplementation(() => new Promise(() => {}));   // 서버 무응답
    expect(await push.registerPushForUser()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('로그아웃: 서버 삭제 + 기기 토큰 해제, 저장 토큰이 없어도 기기 토큰은 해제, 서버 실패해도 로컬은 비운다', async () => {
    store.set(KEY, TOK);
    await push.unregisterPush();
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: TOK });
    expect(store.has(KEY)).toBe(false);
    expect(fcm.unregistered).toBe(1);

    await freshModule(); rpc.mockClear();
    await push.unregisterPush();
    expect(rpc).not.toHaveBeenCalled();
    expect(fcm.unregistered).toBe(2);

    await freshModule();
    store.set(KEY, TOK); rpc.mockRejectedValue(new Error('network'));
    await push.unregisterPush();
    expect(store.has(KEY)).toBe(false);
    expect(fcm.unregistered).toBe(3);
  });

  it('서버 삭제가 멈춰 있어도 기기 토큰 해제는 바로 되고, 다음 로그인 등록도 막히지 않는다(codex BLOCKER·재검토)', async () => {
    store.set(KEY, TOK);
    rpc.mockImplementation((name) => (name === 'push_token_remove' ? new Promise(() => {}) : Promise.resolve({ error: null })));
    const out = push.unregisterPush();
    await vi.waitFor(() => expect(fcm.unregistered).toBe(1));
    expect(store.has(KEY)).toBe(false);
    fcm.token = `next_${'n'.repeat(40)}`;
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(fcm.token);   // 줄이 서버 삭제를 기다리지 않는다
    await out;   // 서버 삭제도 상한 뒤 끝난다
  });

  it('한 로그아웃에서 두 번 불려도(signOut + SIGNED_OUT 이벤트) 해제는 한 번', async () => {
    store.set(KEY, TOK);
    await Promise.all([push.unregisterPush(), push.unregisterPush()]);
    await push.unregisterPush();
    expect(fcm.unregistered).toBe(1);
    expect(rpc.mock.calls.filter(([n]) => n === 'push_token_remove')).toHaveLength(1);
  });

  it('등록(서버 기록)을 시도한 뒤의 로그아웃은 해제를 새로 한다 — 저장에 실패했어도 마지막 발급 토큰을 지운다(codex 재검토)', async () => {
    await push.unregisterPush();                     // A 로그아웃
    expect(fcm.unregistered).toBe(1);
    prefsCtl.setFail = true;
    fcm.token = `b_${'b'.repeat(40)}`;
    expect(await push.registerPushForUser({ sessionStart: true })).toBeNull();   // B: upsert 는 됐는데 로컬 저장 실패
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', expect.objectContaining({ p_token: fcm.token }));
    rpc.mockClear();
    await push.unregisterPush();                     // B 로그아웃
    expect(fcm.unregistered).toBe(2);
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: fcm.token });
  });

  it('등록 도중 로그아웃: 로그아웃은 등록을 기다리지 않고 해제하며, 늦게 끝난 등록은 서버에 쓰지 않는다', async () => {
    let open;
    fcm.registerGate = new Promise((r) => { open = r; });
    const reg = push.registerPushForUser();
    await vi.waitFor(() => expect(fcm.registers).toBe(1));
    await push.unregisterPush();                  // 게이트가 닫혀 있어도 끝난다
    expect(fcm.unregistered).toBe(1);
    open();
    expect(await reg).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith('push_token_upsert', expect.anything());
    expect(store.has(KEY)).toBe(false);
  });

  it('upsert 하는 사이 로그아웃이 시작되면 방금 붙인 토큰을 다시 떼고 로컬에 쓰지 않는다', async () => {
    let release;
    rpc.mockImplementation((name) => (name === 'push_token_upsert'
      ? new Promise((r) => { release = () => r({ error: null }); })
      : Promise.resolve({ error: null })));
    const reg = push.registerPushForUser();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('push_token_upsert', expect.anything()));
    const out = push.unregisterPush();
    release();
    expect(await reg).toBeNull();
    await out;
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: TOK });
    expect(store.has(KEY)).toBe(false);
  });

  it('로그아웃 뒤: 로그인 시작(sessionStart) 전의 등록·앱 복귀 재등록은 거절, 로그인하면 새 토큰이 바로 등록된다', async () => {
    store.set(KEY, TOK);
    await push.unregisterPush();
    rpc.mockClear();
    fcm.token = `new_${'n'.repeat(40)}`;
    expect(await push.registerPushForUser()).toBeNull();
    expect(await push.refreshPushOnResume()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(fcm.token);
    expect(store.get(KEY)).toBe(fcm.token);
  });

  it('앱 복귀 재등록이 저장 토큰을 읽는 사이 로그아웃되면 등록하지 않는다(codex 재검토)', async () => {
    const p = push.refreshPushOnResume();   // 저장 토큰 없음 → 등록하려는 참
    push.unregisterPush();
    expect(await p).toBeNull();
    await sleep(30);
    expect(rpc).not.toHaveBeenCalledWith('push_token_upsert', expect.anything());
  });

  it('로그아웃 직후 재로그인에 옛 토큰(삭제 중)이 다시 오면 잠깐 기다렸다 새 토큰을 받는다', async () => {
    store.set(KEY, TOK);
    await push.unregisterPush();
    const fresh = `fresh_${'f'.repeat(40)}`;
    fcm.seq = [TOK, fresh];
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(fresh);
    expect(fcm.registers).toBe(2);
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', expect.objectContaining({ p_token: fresh }));
    expect(rpc).not.toHaveBeenCalledWith('push_token_upsert', expect.objectContaining({ p_token: TOK }));
  });

  it('끝내 옛 토큰만 오면 저장하지 않고, 삭제 대기 시간이 지나 다시 받아도 같으면(삭제 실패) 유효한 토큰으로 등록한다(codex 재검토)', async () => {
    store.set(KEY, TOK);
    await push.unregisterPush();
    rpc.mockClear();
    expect(await push.registerPushForUser({ sessionStart: true })).toBeNull();   // 계속 TOK(삭제 중으로 보임)
    expect(rpc).not.toHaveBeenCalledWith('push_token_upsert', expect.anything());
    await vi.waitFor(() => expect(store.get(KEY)).toBe(TOK), { timeout: 2000 });   // 대기 시간 뒤 자동 재시도
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', expect.objectContaining({ p_token: TOK }));
  });

  it('로그인 중 토큰이 바뀌면(onNewToken) 새 토큰을 올리고 옛 토큰은 지운다 — 같은 토큰·로그아웃 뒤엔 무시', async () => {
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(TOK);
    const off = await push.listenTokenRefresh();
    rpc.mockClear();
    emit('registration', { value: TOK });
    await tick(); await tick();
    expect(rpc).not.toHaveBeenCalled();
    const rotated = `rot_${'y'.repeat(40)}`;
    emit('registration', { value: rotated });
    await vi.waitFor(() => expect(store.get(KEY)).toBe(rotated));
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', expect.objectContaining({ p_token: rotated }));
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: TOK });
    await push.unregisterPush();
    rpc.mockClear();
    emit('registration', { value: `late_${'z'.repeat(40)}` });
    await tick(); await tick();
    expect(rpc).not.toHaveBeenCalledWith('push_token_upsert', expect.anything());
    off();
    expect(fcm.listeners.registration).toBeUndefined();
  });

  it('앱 복귀: 최근에 올린 토큰이 있으면 아무것도 안 하고, 없으면 권한을 묻지 않고 조용히 등록한다', async () => {
    expect(await push.registerPushForUser({ sessionStart: true })).toBe(TOK);
    rpc.mockClear();
    expect(await push.refreshPushOnResume()).toBe(TOK);
    expect(rpc).not.toHaveBeenCalled();
    expect(fcm.registers).toBe(1);

    await freshModule();                                   // 새 실행: 저장 토큰 없음
    store.clear(); fcm.perm = 'prompt'; fcm.requests = 0;
    expect(await push.refreshPushOnResume()).toBeNull();
    expect(fcm.requests).toBe(0);                          // 권한 창을 띄우지 않는다
    fcm.perm = 'granted';
    expect(await push.refreshPushOnResume()).toBe(TOK);    // 설정에서 허용한 뒤 복귀 → 등록
    expect(store.get(KEY)).toBe(TOK);
  });

  it('푸시 탭: 내부 경로만 navigate, 외부·프로토콜 상대 경로는 무시, cleanup 으로 리스너 해제', async () => {
    const navigate = vi.fn();
    const off = await push.listenPushTap(navigate);
    const tap = (p) => emit('pushNotificationActionPerformed', p);
    tap({ notification: { data: { link: '/mypage' } } });
    tap({ notification: { data: { link: 'https://evil.example/x' } } });
    tap({ notification: { data: { link: '//evil.example' } } });
    tap({ notification: { data: { link: '/\\evil.example' } } });
    tap({ notification: {} });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/mypage');
    off();
    expect(fcm.listeners.pushNotificationActionPerformed).toBeUndefined();
  });

  it('PUSH_ENABLED 꺼짐(Firebase 설정 없는 빌드): 권한·register·unregister 를 부르지 않는다 — 부르면 앱이 종료된다(9/27 실측)', async () => {
    flags.push = false;
    expect(await push.registerPushForUser()).toBeNull();
    expect(await push.refreshPushOnResume()).toBeNull();
    expect(fcm.requests).toBe(0);
    expect(fcm.registers).toBe(0);
    const cleanup = await push.listenPushTap(() => {});
    const offRefresh = await push.listenTokenRefresh();
    expect(Object.keys(fcm.listeners)).toHaveLength(0);
    cleanup(); offRefresh();
    store.set(KEY, TOK);
    await push.unregisterPush();
    expect(fcm.unregistered).toBe(0);
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: TOK });   // 서버 삭제는 한다
  });
});
