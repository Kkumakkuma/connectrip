// @vitest-environment jsdom
// 앱 본인확인 카드(2026-09-27 PASS 복귀 수정·교차검토 반영): resume 은 안내로, 실패·취소는 진행 기록까지 끝,
// 성공 뒤 늦게 온 같은 복귀는 무시, 앱 재개 자동 확인은 15초 간격·최대 3번.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cap = vi.hoisted(() => ({ listeners: {} }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (ev, cb) => {
      cap.listeners[ev] = cb;
      return Promise.resolve({ remove: () => { if (cap.listeners[ev] === cb) delete cap.listeners[ev]; } });
    },
  },
}));
vi.mock('../lib/native', () => ({ isNativeApp: () => true }));

const { default: IdentityVerifyStep } = await import('./IdentityVerifyStep');

const START_KEY = 'pendingIdentityStart';
const STATE = '0123456789abcdef0123456789abcdef';
let seq = 0;
const newId = () => `ct${String(seq += 1).padStart(32, '0')}`;   // 확인 결과 캐시가 테스트끼리 섞이지 않게 매번 새 id
const putStart = (id) => localStorage.setItem(START_KEY, JSON.stringify({
  id, state: STATE, purpose: 'find_id', returnPath: '/find-id', savedAt: Date.now(),
}));
const notVerified = () => ({ ok: false, status: 400, json: async () => ({ ok: false, code: 'IDENTITY_NOT_VERIFIED', error: '아직 인증 전' }) });
const verified = () => ({ ok: true, status: 200, json: async () => ({ ok: true, verifyToken: 'tok', customer: { name: '가', birthdate: '2000-01-01', phone: '01000000000' } }) });

let root;
let div;
async function render(props) {
  await act(async () => {
    root.render(<IdentityVerifyStep purpose="find_id" returnPath="/find-id" {...props} />);
  });
  await flush();
}
async function flush() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const text = () => div.textContent;
const ret = (search) => act(async () => {
  window.dispatchEvent(new CustomEvent('ct-app-return', { detail: { path: '/find-id', search } }));
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  cap.listeners = {};
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

describe('IdentityVerifyStep (앱)', () => {
  it('resume=1 복귀가 아직 인증 전이면 오류 대신 안내 + 진행 기록·결과 확인 단추 유지', async () => {
    const id = newId();
    putStart(id);
    vi.stubGlobal('fetch', vi.fn(async () => notVerified()));
    await render({ returnResult: { ok: true, id, resume: true } });
    expect(text()).toContain('본인확인이 아직 끝나지 않았어요');
    expect(text()).not.toContain('⚠️');
    expect(text()).toContain('인증 결과 확인');
    expect(localStorage.getItem(START_KEY)).not.toBeNull();
  });

  it('실패·취소 복귀(같은 시도)는 오류 표시 + 진행 기록·결과 확인 단추 정리', async () => {
    const id = newId();
    putStart(id);
    const fetchMock = vi.fn(async () => notVerified());
    vi.stubGlobal('fetch', fetchMock);
    await render({});
    expect(text()).toContain('인증 결과 확인');
    await ret(`?flow=identity&code=IDENTITY_VERIFICATION_FAILED&message=${encodeURIComponent('사용자가 취소했습니다')}&identityVerificationId=${id}`);
    expect(text()).toContain('사용자가 취소했습니다');
    expect(text()).not.toContain('인증 결과 확인');
    expect(localStorage.getItem(START_KEY)).toBeNull();
    // 그 뒤 앱 재개가 와도 서버에 되묻지 않는다
    await act(async () => { cap.listeners.resume?.(); });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('성공 뒤 같은 복귀가 다시 와도(재클릭) 오류를 띄우지 않고 onVerified 도 한 번', async () => {
    const id = newId();
    putStart(id);
    vi.stubGlobal('fetch', vi.fn(async () => verified()));
    const onVerified = vi.fn();
    await render({ onVerified });
    const search = `?flow=identity&state=${STATE}&identityVerificationId=${id}`;
    await ret(search);
    await flush();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(START_KEY)).toBeNull();
    await ret(search);
    await flush();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain('⚠️');
  });

  it('앱 재개 자동 확인: 15초 간격·최대 3번, 그 뒤는 단추로', async () => {
    const id = newId();
    putStart(id);
    const fetchMock = vi.fn(async () => notVerified());
    vi.stubGlobal('fetch', fetchMock);
    await render({});
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const resume = async () => { await act(async () => { cap.listeners.resume(); }); await flush(); };
    await resume();
    await resume();                       // 15초 안 — 건너뜀
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i += 1) { now += 16000; await resume(); }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { [...div.querySelectorAll('button')].find((b) => b.textContent.includes('인증 결과 확인')).click(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
