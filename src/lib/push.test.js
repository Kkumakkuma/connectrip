import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = { native: true, platform: 'android' };
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => env.native, getPlatform: () => env.platform } }));

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
  },
}));

const fcm = { perm: 'granted', token: `tok_${'x'.repeat(40)}`, fail: false, listeners: {}, requests: 0 };
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => ({ receive: fcm.perm }),
    requestPermissions: async () => {
      fcm.requests += 1;
      return { receive: fcm.perm.startsWith('prompt') ? 'granted' : fcm.perm };
    },
    addListener: async (name, cb) => {
      fcm.listeners[name] = cb;
      return { remove: () => { delete fcm.listeners[name]; } };
    },
    register: async () => {
      if (fcm.fail) fcm.listeners.registrationError?.({ error: 'no google-services.json' });
      else fcm.listeners.registration?.({ value: fcm.token });
    },
  },
}));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.2.1' }) } }));
// 빌드 플래그(PUSH_ENABLED). 이 파일의 흐름 테스트는 켠 상태, 끈 상태는 맨 아래 테스트에서 바꿔 본다.
const flags = vi.hoisted(() => ({ push: true }));
vi.mock('./featureFlags', () => ({ get PUSH_ENABLED() { return flags.push; } }));

import { getStoredPushToken, listenPushTap, registerPushForUser, unregisterPush } from './push';

const KEY = 'ct_fcm_token';

describe('push (앱 푸시 골격)', () => {
  beforeEach(() => {
    env.native = true; env.platform = 'android'; flags.push = true;
    fcm.perm = 'granted'; fcm.fail = false; fcm.listeners = {}; fcm.requests = 0;
    store.clear();
    rpc.mockReset(); rpc.mockResolvedValue({ error: null });
  });

  it('웹에서는 전부 no-op — RPC 를 부르지 않는다', async () => {
    env.native = false;
    expect(await registerPushForUser()).toBeNull();
    await unregisterPush();
    expect(await getStoredPushToken()).toBeNull();
    const off = await listenPushTap(() => {});
    expect(typeof off).toBe('function');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('네이티브 로그인: 권한 → 토큰 → push_token_upsert(플랫폼·앱 버전) → 로컬 저장, 리스너 정리', async () => {
    expect(await registerPushForUser()).toBe(fcm.token);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('push_token_upsert', { p_token: fcm.token, p_platform: 'android', p_app_version: '1.2.1' });
    expect(store.get(KEY)).toBe(fcm.token);
    expect(await getStoredPushToken()).toBe(fcm.token);
    expect(Object.keys(fcm.listeners)).toEqual([]);
  });

  it('권한이 prompt 면 요청해서 받고, 이미 거부한 기기는 다시 묻지 않고 RPC 없이 null', async () => {
    fcm.perm = 'prompt';
    expect(await registerPushForUser()).toBe(fcm.token);
    expect(fcm.requests).toBe(1);
    rpc.mockClear(); store.clear();
    fcm.perm = 'prompt-with-rationale';
    expect(await registerPushForUser()).toBe(fcm.token);
    expect(fcm.requests).toBe(2);
    rpc.mockClear(); store.clear();
    fcm.perm = 'denied';
    expect(await registerPushForUser()).toBeNull();
    expect(fcm.requests).toBe(2);   // denied 면 requestPermissions 를 부르지 않는다
    expect(rpc).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(false);
  });

  it('registrationError(google-services 없는 빌드)면 null, 리스너 정리, 로그인은 막지 않는다', async () => {
    fcm.fail = true;
    expect(await registerPushForUser()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(Object.keys(fcm.listeners)).toEqual([]);
  });

  it('토큰 로테이션: 옛 토큰은 push_token_remove, 새 토큰으로 교체', async () => {
    store.set(KEY, 'old_token_zzzzzzzzzzzzzzzzzzzzzz');
    expect(await registerPushForUser()).toBe(fcm.token);
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: 'old_token_zzzzzzzzzzzzzzzzzzzzzz' });
    expect(store.get(KEY)).toBe(fcm.token);
  });

  it('upsert 가 에러면 null 이고 로컬에 저장하지 않는다', async () => {
    rpc.mockResolvedValue({ error: { message: 'AUTH_REQUIRED' } });
    expect(await registerPushForUser()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('로그아웃: 저장 토큰이 있으면 push_token_remove 후 로컬 삭제, 서버 실패해도 로컬은 비운다', async () => {
    await unregisterPush();
    expect(rpc).not.toHaveBeenCalled();
    store.set(KEY, fcm.token);
    await unregisterPush();
    expect(rpc).toHaveBeenCalledWith('push_token_remove', { p_token: fcm.token });
    expect(store.has(KEY)).toBe(false);
    store.set(KEY, fcm.token);
    rpc.mockRejectedValue(new Error('network'));
    await unregisterPush();
    expect(store.has(KEY)).toBe(false);
  });

  it('푸시 탭: 내부 경로만 navigate, 외부·프로토콜 상대 경로는 무시, cleanup 으로 리스너 해제', async () => {
    const navigate = vi.fn();
    const off = await listenPushTap(navigate);
    const tap = fcm.listeners.pushNotificationActionPerformed;
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

  it('PUSH_ENABLED 꺼짐(Firebase 설정 없는 빌드): 네이티브여도 권한·register 를 부르지 않는다 — 부르면 앱이 종료된다(9/27 실측)', async () => {
    flags.push = false;
    const registerSpy = vi.fn();
    fcm.listeners = {};
    expect(await registerPushForUser()).toBeNull();
    expect(fcm.requests).toBe(0);
    expect(Object.keys(fcm.listeners)).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    const cleanup = await listenPushTap(registerSpy);
    expect(Object.keys(fcm.listeners)).toHaveLength(0);
    cleanup();
  });
});
