// @vitest-environment jsdom
// 본인확인 카드(2026-09-27 PASS 복귀 수정 → 2026-10-02 결속 설계 v2 §3.3·§7).
// 앱: 결과(ds)를 받은 뒤에만 서버에 묻는다(resume·재개 자동 확인 3회·15초), 못 받았으면 서버 0회 + '인증 결과 가져오기',
// 실패·취소는 같은 시도(state)일 때 진행 기록까지 끝, 성공 뒤 늦게 온 같은 복귀는 무시, C3 용도 대조, C4 재확인, R3 단추 정리.
// 웹: PC 는 화면을 열 때 미리 등록 → 클릭 → 확인 본문에 ds, 확인 실패 뒤엔 다음 것을 미리 등록(재클릭은 start 없이 SDK),
// 모바일 REDIRECTION 복귀는 세션 기록의 ds 로 확인. 마지막에 '가져오기' 왕복 통합 테스트(codex v2 #1).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const native = vi.hoisted(() => ({ value: true }));
const cap = vi.hoisted(() => ({ listeners: {} }));
const sdk = vi.hoisted(() => ({ request: null }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (ev, cb) => {
      cap.listeners[ev] = cb;
      return Promise.resolve({ remove: () => { if (cap.listeners[ev] === cb) delete cap.listeners[ev]; } });
    },
  },
}));
vi.mock('../lib/native', () => ({ isNativeApp: () => native.value }));
vi.mock('@portone/browser-sdk/v2', () => ({ requestIdentityVerification: (...a) => sdk.request(...a) }));
vi.stubEnv('VITE_PORTONE_STORE_ID', 'store-test');
vi.stubEnv('VITE_PORTONE_CHANNEL_KEY', 'channel-key-test');

const START_KEY = 'pendingIdentityStart';
const RESULTS_KEY = 'ctAppIdResults';
const STATE = '0123456789abcdef0123456789abcdef';
const DS = '89abcdef'.repeat(8);
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
let seq = 0;
const newId = () => `ct${String(seq += 1).padStart(32, '0')}`;   // 확인 결과 캐시가 테스트끼리 섞이지 않게 매번 새 id
// 앱 시작 기록: 결과를 받기 전에는 state 만(id·ds 는 딥링크로 받아 붙는다)
const putApp = (over = {}) => localStorage.setItem(START_KEY, JSON.stringify({
  state: STATE, purpose: 'find_id', returnPath: '/find-id', savedAt: Date.now(), ...over,
}));
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const notVerified = () => res(400, { ok: false, code: 'IDENTITY_NOT_VERIFIED', error: '아직 인증 전' });
const verified = () => res(200, { ok: true, verifyToken: 'tok', customer: { name: '가', birthdate: '2000-01-01', phone: '01000000000' } });
// fetch 를 본문 기준으로 흉내 낸다 — calls 에 { url, body } 를 쌓는다
function stubFetch(route) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init?.body || '{}');
    calls.push({ url, body });
    return route(body, calls.length);
  }));
  return calls;
}
const confirms = (calls) => calls.filter((c) => !c.body.action);

let React;
let act;
let createRoot;
let Step;
let lib;
let root;
let div;
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  cap.listeners = {};
  native.value = true;
  sdk.request = vi.fn(async () => undefined);
  // identity.js 의 모듈 상태(확인 캐시·미리 등록분)가 테스트끼리 섞이지 않게 매번 새로 읽는다(React 도 같은 인스턴스로)
  vi.resetModules();
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ default: Step } = await import('./IdentityVerifyStep'));
  lib = await import('../lib/identity');
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  div.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(props) {
  await act(async () => {
    root.render(React.createElement(Step, { purpose: 'find_id', returnPath: '/find-id', ...props }));
  });
  await flush();
}
async function flush() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
// 비동기 사슬(sha256·SDK·확인)이 끝날 때까지 — 조건이 맞거나 횟수가 다할 때까지 act 안에서 기다린다.
// Node 의 setImmediate 로 돈다(브라우저 전역 목록에 없어 globalThis 로 부른다 — 윈도에서 setTimeout(1) 은 약 15ms 로 반올림돼 느리다).
async function until(cond, tries = 3000) {
  for (let i = 0; i < tries && !cond(); i += 1) await act(async () => { await new Promise((r) => globalThis.setImmediate(r)); });
}
// '요청 0회' 검사용 — 사슬이 돌았다면 끝났을 만큼 기다린다
async function quiet() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await flush();
}
const text = () => div.textContent;
const button = (label) => [...div.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const click = async (label) => {
  await act(async () => { button(label).click(); });
  await flush();
};
const ret = async (search) => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('ct-app-return', { detail: { path: '/find-id', search } }));
  });
  await flush();
};
const resume = async () => {
  await act(async () => { cap.listeners.resume(); });
  await flush();
};

describe('IdentityVerifyStep (앱)', () => {
  it('resume=1 복귀(기록에 id·ds)가 아직 인증 전이면 오류 대신 안내 + 진행 기록·결과 확인 단추 유지', async () => {
    const id = newId();
    putApp({ id, ds: DS });
    const calls = stubFetch(() => notVerified());
    await render({ returnResult: lib.parseIdentityReturn('?flow=identity&resume=1') });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: DS });
    expect(text()).toContain('본인확인이 아직 끝나지 않았어요');
    expect(text()).not.toContain('⚠️');
    expect(button('인증 결과 확인')).toBeTruthy();
    expect(localStorage.getItem(START_KEY)).not.toBeNull();
  });

  it('실패·취소 복귀(같은 시도·같은 state)는 오류 표시 + 진행 기록·결과 확인 단추 정리', async () => {
    const id = newId();
    putApp({ id, ds: DS });
    const calls = stubFetch(() => notVerified());
    await render({});
    expect(button('인증 결과 확인')).toBeTruthy();
    await ret(`?flow=identity&state=${STATE}&code=IDENTITY_VERIFICATION_FAILED&message=${encodeURIComponent('사용자가 취소했습니다')}&identityVerificationId=${id}`);
    expect(text()).toContain('사용자가 취소했습니다');
    expect(button('인증 결과 확인')).toBeUndefined();
    expect(localStorage.getItem(START_KEY)).toBeNull();
    // 그 뒤 앱 재개가 와도 서버에 되묻지 않는다
    await resume();
    expect(calls).toHaveLength(0);
  });

  it('state 가 다른 실패 복귀(위조·옛 링크)는 진행 기록을 끝내지 않는다(C2)', async () => {
    putApp();
    stubFetch(() => notVerified());
    await render({});
    await ret('?flow=identity&state=ffffffffffffffffffffffffffffffff&code=X&message=x');
    expect(localStorage.getItem(START_KEY)).not.toBeNull();
    expect(button('인증 결과 가져오기')).toBeTruthy();
  });

  it('결과 딥링크(id·ds) → 기록에 붙이고 확인(본문에 ds) → onVerified 한 번, 같은 복귀가 다시 와도(재클릭) 무시', async () => {
    const id = newId();
    putApp();
    const seen = [];
    const calls = stubFetch(() => {
      seen.push(JSON.parse(localStorage.getItem(START_KEY)));   // 확인을 부를 때의 기록 — attach 가 먼저 됐는지
      return verified();
    });
    const onVerified = vi.fn();
    await render({ onVerified });
    const search = `?flow=identity&state=${STATE}&identityVerificationId=${id}&ds=${DS}`;
    await ret(search);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified.mock.calls[0][0]).toMatchObject({ token: 'tok', purpose: 'find_id' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: DS });
    expect(seen[0]).toMatchObject({ id, ds: DS, state: STATE });
    expect(localStorage.getItem(START_KEY)).toBeNull();
    await ret(search);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(text()).not.toContain('⚠️');
  });

  it('결과 딥링크(resume 아님)의 확인이 아직 인증 전이면 안내가 아니라 오류(⚠️) — 기록·결과 확인 단추는 남아 다시 물을 수 있다', async () => {
    const id = newId();
    putApp();
    const calls = stubFetch(() => notVerified());
    await render({});
    await ret(`?flow=identity&state=${STATE}&identityVerificationId=${id}&ds=${DS}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: DS });
    expect(text()).toContain('⚠️');
    expect(text()).toContain('아직 인증 전');                              // 서버 문구 그대로
    expect(text()).not.toContain('본인확인이 아직 끝나지 않았어요');        // resume·재개용 안내 문구가 아니다
    expect(JSON.parse(localStorage.getItem(START_KEY))).toMatchObject({ id, ds: DS, state: STATE });   // attach 는 됐다
    expect(button('인증 결과 확인')).toBeTruthy();
  });

  it('앱 재개 자동 확인(기록에 id·ds): 15초 간격·최대 3번, 그 뒤는 단추로', async () => {
    const id = newId();
    putApp({ id, ds: DS });
    const calls = stubFetch(() => notVerified());
    await render({});
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await resume();
    await resume();                       // 15초 안 — 건너뜀
    expect(calls).toHaveLength(1);
    for (let i = 0; i < 4; i += 1) { now += 16000; await resume(); }
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.body.ds === DS)).toBe(true);
    await click('인증 결과 확인');
    expect(calls).toHaveLength(4);
  });

  it('앱 재개: 결과(ds)를 아직 못 받았으면 서버를 부르지 않고 안내만(같은 문장은 한 번만 보인다)', async () => {
    putApp();
    const calls = stubFetch(() => notVerified());
    await render({});
    expect(text()).toContain('「인증 결과 가져오기」를 눌러 주세요');
    await resume();
    await resume();
    expect(calls).toHaveLength(0);
    expect(text().split('이미 닫았다면').length - 1).toBe(1);
    expect(button('인증 결과 가져오기')).toBeTruthy();
    expect(button('인증 결과 확인')).toBeUndefined();
  });

  it("resume=1 + 기록에 ds 없음 → 서버 0회 + 안내, '인증 결과 가져오기'는 크롬 탭 /app-identity?v=2&resume=1 로", async () => {
    putApp({ returnPath: '/find-id?x=1' });
    const calls = stubFetch(() => notVerified());
    const go = vi.spyOn(lib.identityNav, 'go').mockImplementation(() => {});
    await render({ returnResult: lib.parseIdentityReturn('?flow=identity&resume=1') });
    expect(calls).toHaveLength(0);
    expect(text()).toContain('PASS 인증을 마친 뒤');
    await click('인증 결과 가져오기');
    await click('인증 결과 가져오기');    // 연타 — 크롬 탭을 두 번 열지 않는다
    expect(go).toHaveBeenCalledTimes(1);
    const u = new URL(go.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-identity');
    expect(Object.fromEntries(u.searchParams)).toEqual({ v: '2', state: STATE, purpose: 'find_id', to: '/find-id', q: 'x=1', resume: '1' });
    expect(calls).toHaveLength(0);
  });

  it('needResult: 성공 딥링크에 ds 가 없으면(크롬 저장소 차단 등) 서버 0회 + 가져오기 안내', async () => {
    putApp();
    const calls = stubFetch(() => verified());
    await render({});
    await ret(`?flow=identity&state=${STATE}&identityVerificationId=${newId()}`);
    expect(calls).toHaveLength(0);
    expect(text()).toContain('인증 결과를 앱으로 가져오지 못했어요');
    expect(text()).not.toContain('⚠️');
    expect(button('인증 결과 가져오기')).toBeTruthy();
  });

  it('C4: 확인 중에 같은 id 의 결과 복귀가 오면, 진행 중 확인이 아직 인증 전으로 끝날 때 1.5초 뒤 한 번 더 확인한다', async () => {
    const id = newId();
    putApp({ id, ds: DS });
    let release;
    const calls = stubFetch((body, n) => (n === 1 ? new Promise((r) => { release = () => r(notVerified()); }) : verified()));
    const onVerified = vi.fn();
    await render({ onVerified });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await resume();                                    // 앱 재개 자동 확인 — 응답 대기 중
    expect(calls).toHaveLength(1);
    await ret(`?flow=identity&state=${STATE}&identityVerificationId=${id}&ds=${DS}`);   // 그사이 완료 딥링크
    expect(calls).toHaveLength(1);                     // 같은 id 는 겹쳐 묻지 않는다
    await act(async () => { release(); });
    await flush();
    expect(text()).not.toContain('⚠️');
    expect(text()).toContain('확인 중');               // 다시 확인할 때까지 '확인 중' 유지
    const recheck = timers.mock.calls.find((c) => c[1] === 1500);
    expect(recheck).toBeTruthy();
    await act(async () => { recheck[0](); });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: DS });
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('R3: 최종 거절이면 진행 기록과 결과 확인 단추가 사라진다(같은 거절을 되풀이하지 않게)', async () => {
    const id = newId();
    putApp({ id, ds: DS });
    stubFetch(() => res(403, { ok: false, code: 'IDENTITY_BINDING_INVALID', error: '본인확인 요청 정보가 맞지 않습니다. 본인확인을 다시 진행해주세요.' }));
    await render({});
    await click('인증 결과 확인');
    expect(text()).toContain('본인확인 요청 정보가 맞지 않습니다');
    expect(localStorage.getItem(START_KEY)).toBeNull();
    expect(button('인증 결과 확인')).toBeUndefined();
    expect(button('인증 결과 가져오기')).toBeUndefined();
  });

  it('C3: 다른 용도로 시작한 결과는 이 화면에서 쓰지 않는다(서버 0회, 오류)', async () => {
    const calls = stubFetch(() => verified());
    const onVerified = vi.fn();
    await render({ onVerified, returnResult: { ok: true, id: newId(), ds: DS, state: STATE, purpose: 'password_reset' } });
    expect(calls).toHaveLength(0);
    expect(onVerified).not.toHaveBeenCalled();
    expect(text()).toContain('본인확인 용도가 맞지 않습니다');
  });

  it("앱 'PASS로 본인확인': 시작 기록에 state 만 남기고 크롬 탭 주소(id 없음)로 — 서버·SDK 0회", async () => {
    const calls = stubFetch(() => verified());
    const go = vi.spyOn(lib.identityNav, 'go').mockImplementation(() => {});
    await render({});
    await click('PASS로 본인확인');
    expect(go).toHaveBeenCalledTimes(1);
    const u = new URL(go.mock.calls[0][0]);
    expect(u.searchParams.get('v')).toBe('2');
    expect(u.searchParams.has('id')).toBe(false);
    const rec = JSON.parse(localStorage.getItem(START_KEY));
    expect(u.searchParams.get('state')).toBe(rec.state);
    expect(rec.id).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(sdk.request).not.toHaveBeenCalled();
  });
});

describe('IdentityVerifyStep (웹)', () => {
  beforeEach(() => { native.value = false; });

  it('PC: 마운트 때 미리 등록 → 클릭 → SDK(서버 id) → 확인 본문에 ds → onVerified 1회', async () => {
    const id = newId();
    const calls = stubFetch((body) => (body.action === 'start' ? res(200, { ok: true, identityVerificationId: id }) : verified()));
    sdk.request = vi.fn(async (req) => ({ transactionType: 'IDENTITY_VERIFICATION', identityVerificationId: req.identityVerificationId, identityVerificationTxId: 'tx' }));
    const onVerified = vi.fn();
    await render({ onVerified });
    await until(() => calls.length === 1);
    expect(calls[0].body).toMatchObject({ action: 'start', purpose: 'find_id' });   // 화면을 열 때 등록
    await click('PASS로 본인확인');
    await until(() => onVerified.mock.calls.length > 0);
    expect(sdk.request).toHaveBeenCalledTimes(1);
    expect(sdk.request.mock.calls[0][0].identityVerificationId).toBe(id);
    expect(calls).toHaveLength(2);                     // 클릭 뒤에는 확인만(등록 왕복 없음)
    const confirm = confirms(calls)[0].body;
    expect(confirm).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(createHash('sha256').update(confirm.ds, 'utf8').digest('hex')).toBe(calls[0].body.dsHash);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(START_KEY)).toBeNull();   // 확인 성공 → 시작 기록 정리
  });

  // 2026-10-02 검토 should-fix: 창은 성공했는데 서버 확인이 실패하면(409 PHONE_ALREADY_CLAIMED 등) 다음 것을 미리 등록해 둔다 —
  // startIdentityVerification 의 failWith(창 실패·취소)와 같게. 재클릭은 등록 왕복 없이 바로 SDK.
  it('PC: 창 성공 → 확인 실패(409 PHONE_ALREADY_CLAIMED) → 다음 것 미리 등록 → 재클릭은 start 없이 SDK(새 id·새 ds)', async () => {
    const ids = [newId(), newId()];
    let starts = 0;
    let confirmed = 0;
    const calls = stubFetch((body) => {
      if (body.action === 'start') return res(200, { ok: true, identityVerificationId: ids[starts++] });
      confirmed += 1;
      return confirmed === 1
        ? res(409, { ok: false, code: 'PHONE_ALREADY_CLAIMED', error: '이미 가입된 휴대폰 번호입니다.' })
        : verified();
    });
    sdk.request = vi.fn(async (req) => ({ transactionType: 'IDENTITY_VERIFICATION', identityVerificationId: req.identityVerificationId, identityVerificationTxId: 'tx' }));
    const onVerified = vi.fn();
    await render({ onVerified });
    await until(() => calls.length === 1);                 // 화면을 열 때 등록
    await click('PASS로 본인확인');
    await until(() => text().includes('이미 가입된 휴대폰 번호입니다.'));
    expect(text()).toContain('⚠️');
    expect(sdk.request).toHaveBeenCalledTimes(1);
    expect(sdk.request.mock.calls[0][0].identityVerificationId).toBe(ids[0]);
    expect(onVerified).not.toHaveBeenCalled();
    // 확인 실패 직후 다음 것을 미리 등록한다(start) — 재클릭을 기다리지 않는다
    await until(() => calls.length === 3);
    expect(calls.map((c) => c.body.action || 'confirm')).toEqual(['start', 'confirm', 'start']);
    expect(calls[1].body).toEqual({ identityVerificationId: ids[0], purpose: 'find_id', ds: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(sessionStorage.getItem(START_KEY)).toBeNull();   // 최종 거절(R3) → 그 시도의 시작 기록 정리
    expect(button('PASS로 본인확인').disabled).toBe(false);
    // 재클릭: 미리 등록분(둘째 id)으로 바로 SDK — 클릭과 SDK 사이에 start 없음
    await click('PASS로 본인확인');
    await until(() => onVerified.mock.calls.length > 0);
    expect(sdk.request).toHaveBeenCalledTimes(2);
    expect(sdk.request.mock.calls[1][0].identityVerificationId).toBe(ids[1]);
    expect(calls.map((c) => c.body.action || 'confirm')).toEqual(['start', 'confirm', 'start', 'confirm']);
    expect(calls[3].body).toEqual({ identityVerificationId: ids[1], purpose: 'find_id', ds: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(calls[3].body.ds).not.toBe(calls[1].body.ds);
    expect(createHash('sha256').update(calls[3].body.ds, 'utf8').digest('hex')).toBe(calls[2].body.dsHash);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain('⚠️');                    // 성공하면 앞의 오류는 지운다
  });

  it('모바일 REDIRECTION 복귀: 세션의 웹 기록(id·ds) + returnResult → 확인 본문에 기록의 ds(주소의 ds 는 무시) → 성공 뒤 기록 정리', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA_ANDROID);
    const id = newId();
    sessionStorage.setItem(START_KEY, JSON.stringify({ id, state: STATE, purpose: 'find_id', returnPath: '/find-id', ds: DS, savedAt: Date.now() }));
    const calls = stubFetch(() => verified());
    const onVerified = vi.fn();
    const urlDs = 'f'.repeat(64);   // 웹 복귀 주소에는 ds 가 없어야 하지만, 붙어 와도 기록의 ds 만 쓴다
    const returnResult = lib.parseIdentityReturn(
      `?flow=identity&state=${STATE}&identityVerificationId=${id}&identityVerificationTxId=tx&transactionType=IDENTITY_VERIFICATION&ds=${urlDs}`,
    );
    expect(returnResult).toEqual({ ok: true, id, ds: DS, state: STATE, purpose: 'find_id' });
    await render({ onVerified, returnResult });
    await until(() => onVerified.mock.calls.length > 0);
    expect(calls).toHaveLength(1);                         // 미리 등록(start) 없이 확인만
    expect(calls[0].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: DS });
    expect(sdk.request).not.toHaveBeenCalled();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified.mock.calls[0][0]).toMatchObject({ token: 'tok', purpose: 'find_id' });
    expect(sessionStorage.getItem(START_KEY)).toBeNull();   // 확인 성공 → 시작 기록 정리
    expect(text()).not.toContain('⚠️');
  });

  it.each([
    ['모바일(REDIRECTION — 팝업 없음)', () => { vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA_ANDROID); return {}; }],
    ['복귀 화면(returnResult)', () => ({ returnResult: { ok: false, failed: false, state: '', purpose: '', message: '다시' } })],
    ['복귀 주소(부모가 아직 읽기 전)', () => { window.history.replaceState(null, '', `/find-id?flow=identity&state=${STATE}`); return {}; }],
    ['준비 중(disabled)', () => ({ disabled: true })],
  ])('%s 에서는 미리 등록하지 않는다', async (_, setup) => {
    const calls = stubFetch(() => res(200, { ok: true, identityVerificationId: newId() }));
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');   // 등록은 마운트 효과 안에서 동기로 sha256 부터 부른다
    const props = setup();
    await render(props);
    expect(digest).not.toHaveBeenCalled();
    await quiet();
    expect(calls).toHaveLength(0);
  });
});

// ── '인증 결과 가져오기' 왕복 통합 테스트(codex v2 #1, 설계 v2 §3.2·§7) ──────────────────────
// 앱 기록에 state 만 있음 → 가져오기 → (크롬 탭) /app-identity resume 이 findAppIdResult 로 찾은 id 로 다리 주소를 만든다
// (resume=1 없음) → 다리 페이지(public/app-return.html 스크립트를 jsdom 으로 실행)가 크롬 저장소의 ds 를 intent 에 붙임 →
// 그 딥링크로 ct-app-return → parse ok → attach → confirm 본문에 ds 1회.
// jsdom 환경의 전역 URL 은 jsdom 것이라 readFileSync 가 받지 않는다 — 문자열 경로로 읽는다
const BRIDGE_HTML = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public/app-return.html'), 'utf8');
class NoFetch extends ResourceLoader {
  fetch() { return null; }   // 로고 같은 하위 자원은 받지 않는다(네트워크 0)
}
// 크롬(같은 www 출처)에서 다리 페이지를 연다 — 크롬 탭이 남긴 보관함을 그대로 심는다. 앱으로 가는 intent 주소를 돌려준다.
function openBridge(url, results) {
  const virtualConsole = new VirtualConsole();   // 자동 이동(intent://)은 jsdom 미구현 경고만 낸다 — 버린다
  const dom = new JSDOM(BRIDGE_HTML, {
    url,
    runScripts: 'dangerously',
    resources: new NoFetch({ userAgent: UA_ANDROID }),
    virtualConsole,
    beforeParse(w) { if (results) w.localStorage.setItem(RESULTS_KEY, results); },
  });
  const href = dom.window.document.getElementById('go').getAttribute('href');
  dom.window.close();
  return href;
}
// intent://app-return<경로>?<쿼리>#Intent;scheme=connecttrip;…;end → 안드로이드가 앱에 넘기는 주소
const deepLinkOf = (href) => {
  const scheme = /;scheme=([^;]+);/.exec(href)[1];
  return `${scheme}://${href.slice('intent://'.length, href.indexOf('#'))}`;
};

describe("'인증 결과 가져오기' 왕복(통합)", () => {
  it('앱 기록에 state 만 → 가져오기 → 크롬 resume → 다리(ds 첨부) → 딥링크 → attach → confirm(ds 1회)', async () => {
    const id = newId();
    const { appReturnTarget } = await import('../lib/appReturn');
    const { MemoryRouter } = await import('react-router-dom');
    const { default: AppIdentity } = await import('../pages/AppIdentity');

    // 0) 앞서 크롬 탭이 PASS 를 띄우며 등록·보관해 둔 상태(같은 출처 localStorage) + 앱 기록에는 state 만
    native.value = false;
    stubFetch(() => res(200, { ok: true, identityVerificationId: id }));
    const ticket = await lib.prepareAppIdentity({ state: STATE, purpose: 'find_id' });
    const chromeStore = localStorage.getItem(RESULTS_KEY);
    native.value = true;
    putApp();

    // 1) 앱: '인증 결과 가져오기' → 크롬 탭 주소
    const seen = [];
    const calls = stubFetch(() => {
      seen.push(JSON.parse(localStorage.getItem(START_KEY)));
      return verified();
    });
    const go = vi.spyOn(lib.identityNav, 'go').mockImplementation(() => {});
    const replace = vi.spyOn(lib.identityNav, 'replace').mockImplementation(() => {});
    const onVerified = vi.fn();
    await render({ onVerified });
    await click('인증 결과 가져오기');
    expect(go).toHaveBeenCalledTimes(1);
    const tabUrl = new URL(go.mock.calls[0][0]);
    expect(tabUrl.pathname).toBe('/app-identity');
    expect(Object.fromEntries(tabUrl.searchParams)).toEqual({ v: '2', state: STATE, purpose: 'find_id', to: '/find-id', resume: '1' });

    // 2) 크롬 탭: /app-identity resume — 보관분을 찾아 다리로 replace(resume=1 없음, SDK·등록 없음)
    native.value = false;
    const tabDiv = document.createElement('div');
    document.body.appendChild(tabDiv);
    const tabRoot = createRoot(tabDiv);
    await act(async () => {
      tabRoot.render(React.createElement(MemoryRouter, { initialEntries: [`${tabUrl.pathname}${tabUrl.search}`] },
        React.createElement(AppIdentity)));
    });
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
    const bridgeUrl = replace.mock.calls[0][0];
    const b = new URL(bridgeUrl);
    expect(b.pathname).toBe('/app-return.html');
    expect(Object.fromEntries(b.searchParams)).toEqual({ to: '/find-id', flow: 'identity', state: STATE, identityVerificationId: id });
    expect(sdk.request).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    await act(async () => { tabRoot.unmount(); });
    tabDiv.remove();
    native.value = true;

    // 3) 다리 페이지: 같은 state 라 크롬 저장소의 ds 를 intent 쿼리에만 붙인다(화면 주소에는 없음)
    expect(bridgeUrl).not.toContain(ticket.ds);
    const intent = openBridge(bridgeUrl, chromeStore);
    const deepLink = deepLinkOf(intent);
    expect(deepLink.startsWith('connecttrip://app-return/find-id?')).toBe(true);
    expect(new URL(deepLink).searchParams.get('ds')).toBe(ticket.ds);
    expect(new URL(deepLink).searchParams.has('resume')).toBe(false);

    // 크롬(www 출처)과 앱(WebView 출처)의 저장소는 다르다 — 이 테스트는 한 jsdom 저장소를 같이 쓰므로, 앱 쪽에는 크롬 보관함이
    // 없는 상태를 흉내 내 앱이 딥링크의 id·ds 와 자기 시작 기록만으로 확인하는지 본다(검토 지적, 2026-10-02)
    localStorage.removeItem(RESULTS_KEY);

    // 4) 앱: 딥링크 → AppReturnBridge 와 같은 변환(appReturnTarget) → 지금 화면이면 ct-app-return
    const target = appReturnTarget(deepLink);
    const search = target.slice(target.indexOf('?'));
    expect(lib.parseIdentityReturn(search)).toEqual({ ok: true, id, ds: ticket.ds, state: STATE, purpose: 'find_id' });
    await ret(search);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identityVerificationId: id, purpose: 'find_id', ds: ticket.ds });
    expect(seen[0]).toMatchObject({ id, ds: ticket.ds, state: STATE });   // attach 가 confirm 보다 먼저
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(START_KEY)).toBeNull();
  });
});
