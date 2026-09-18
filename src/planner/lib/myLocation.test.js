import { afterEach, describe, expect, it, vi } from 'vitest';

// navigator 를 통째로 바꿔 끼우고 모듈을 새로 불러온다(모듈 안 캐시·inflight·세대가 테스트 사이에 새지 않게).
async function fresh() {
  vi.resetModules();
  return import('./myLocation.js');
}
const stubNav = ({ geo, perm } = {}) => vi.stubGlobal('navigator', { geolocation: geo, permissions: perm });
const pos = (lat, lng) => ({ coords: { latitude: lat, longitude: lng } });
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getMyLocation', () => {
  it('미지원이면 coords null + unsupported', async () => {
    stubNav({});
    const { canLocate, getMyLocation } = await fresh();
    expect(canLocate()).toBe(false);
    expect(await getMyLocation()).toEqual({ coords: null, error: 'unsupported' });
  });

  it('성공하면 좌표를 주고 5분 캐시를 쓴다. force 는 캐시·브라우저 캐시 없이 새로 잰다', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(pos(37.5, 127.0)));
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation } = await fresh();

    expect(await getMyLocation()).toEqual({ coords: { lat: 37.5, lng: 127.0 }, error: null });
    expect(await getMyLocation()).toEqual({ coords: { lat: 37.5, lng: 127.0 }, error: null });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    await getMyLocation({ force: true });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[1][2].maximumAge).toBe(0);
    // 저정밀(네트워크만)은 기기에 따라 영영 안 온다 — 항상 GPS 포함 fused 로 요청한다(2026-09-18 실측)
    expect(getCurrentPosition.mock.calls[0][2].enableHighAccuracy).toBe(true);
  });

  it('권한이 이미 허용된 상태에서만 8초, 아니면(prompt·API 없음) 60초를 기다린다', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(pos(1, 2)));
    const query = vi.fn().mockResolvedValue({ state: 'granted' });
    stubNav({ geo: { getCurrentPosition }, perm: { query } });
    await (await fresh()).getMyLocation();
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(getCurrentPosition.mock.calls[0][2].timeout).toBe(8000);

    query.mockResolvedValue({ state: 'prompt' });
    await (await fresh()).getMyLocation();
    expect(getCurrentPosition.mock.calls[1][2].timeout).toBe(60000);

    stubNav({ geo: { getCurrentPosition } });
    await (await fresh()).getMyLocation();
    expect(getCurrentPosition.mock.calls[2][2].timeout).toBe(60000);

    // 명시한 timeoutMs 가 있으면 그대로
    await (await fresh()).getMyLocation({ timeoutMs: 1234 });
    expect(getCurrentPosition.mock.calls[3][2].timeout).toBe(1234);
  });

  it('Permissions API 가 denied 라고 해도 요청은 하고, 실패 콜백의 코드로 이유를 준다', async () => {
    const getCurrentPosition = vi.fn((ok, fail) => fail({ code: 1 }));
    const query = vi.fn().mockResolvedValue({ state: 'denied' });
    stubNav({ geo: { getCurrentPosition }, perm: { query } });
    const { getMyLocation } = await fresh();
    expect(await getMyLocation()).toEqual({ coords: null, error: 'denied' });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    getCurrentPosition.mockImplementation((ok, fail) => fail({ code: 2 }));
    expect(await getMyLocation({ force: true })).toEqual({ coords: null, error: 'unavailable' });

    getCurrentPosition.mockImplementation((ok, fail) => fail({ code: 3 }));
    expect(await getMyLocation({ force: true })).toEqual({ coords: null, error: 'timeout' });
  });

  it('Permissions API 가 던져도 요청은 진행된다', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(pos(5, 6)));
    const query = vi.fn().mockRejectedValue(new Error('nope'));
    stubNav({ geo: { getCurrentPosition }, perm: { query } });
    expect((await (await fresh()).getMyLocation()).coords).toEqual({ lat: 5, lng: 6 });
  });

  it('좌표가 숫자가 아니면 unavailable', async () => {
    const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: NaN, longitude: 1 } }));
    stubNav({ geo: { getCurrentPosition } });
    expect(await (await fresh()).getMyLocation()).toEqual({ coords: null, error: 'unavailable' });
  });

  it('콜백이 영영 안 오면 우리 타이머(timeout + 1초)가 timeout 으로 끊는다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn(() => {});
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation } = await fresh();

    const p = getMyLocation({ timeoutMs: 3000 });
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toEqual({ coords: null, error: 'timeout' });
  });

  it('진행 중인 요청은 같이 기다리고, 끝나면 다음 호출은 캐시를 쓴다', async () => {
    let deliver;
    const getCurrentPosition = vi.fn((ok) => {
      deliver = () => ok(pos(3, 4));
    });
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation } = await fresh();

    const a = getMyLocation();
    const b = getMyLocation();
    expect(b).toBe(a);
    await tick();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    deliver();
    expect((await a).coords).toEqual({ lat: 3, lng: 4 });
    expect((await getMyLocation()).coords).toEqual({ lat: 3, lng: 4 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('늦게 끝난 옛 요청이 새 요청(force)의 위치를 캐시에서 지우지 않는다', async () => {
    const callbacks = [];
    const getCurrentPosition = vi.fn((ok) => callbacks.push(ok));
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation } = await fresh();

    const a = getMyLocation(); // 지도 열 때 자동 요청
    await tick();
    const b = getMyLocation({ force: true }); // 사용자가 "내 위치" 누름
    await tick();
    expect(callbacks).toHaveLength(2);
    callbacks[1](pos(2, 2)); // 새 요청이 먼저 끝남
    expect((await b).coords).toEqual({ lat: 2, lng: 2 });
    callbacks[0](pos(1, 1)); // 옛 요청이 늦게 끝남
    expect((await a).coords).toEqual({ lat: 1, lng: 1 }); // 그 호출 자체는 자기 결과를 받는다
    expect((await getMyLocation()).coords).toEqual({ lat: 2, lng: 2 }); // 캐시는 새 요청 것
  });

  it('동시 요청의 실패·성공이 서로의 결과를 바꾸지 않는다', async () => {
    const callbacks = [];
    const getCurrentPosition = vi.fn((ok, fail) => callbacks.push({ ok, fail }));
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation } = await fresh();

    const a = getMyLocation({ force: true });
    await tick();
    const b = getMyLocation({ force: true });
    await tick();
    callbacks[0].fail({ code: 1 });
    callbacks[1].ok(pos(9, 9));
    expect(await a).toEqual({ coords: null, error: 'denied' });
    expect(await b).toEqual({ coords: { lat: 9, lng: 9 }, error: null });
  });

  it('clearMyLocationCache 뒤에는 다시 잰다', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(pos(7, 8)));
    stubNav({ geo: { getCurrentPosition } });
    const { getMyLocation, clearMyLocationCache } = await fresh();
    await getMyLocation();
    clearMyLocationCache();
    await getMyLocation();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });
});
