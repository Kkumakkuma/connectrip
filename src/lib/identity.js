// 통신사 휴대폰 본인확인(PASS 앱/SMS) — 포트원 V2 브라우저 SDK 래퍼 + 증빙(proof) 보관.
//
// 가입 순서: 본인확인 먼저 → 가입 폼. 본인확인 성공 시 서버(/api/verify-identity)가 포트원에서
// 결과를 직접 조회해 일회성 토큰을 발급하고, 우리는 {token, name, birthdate, phone} 을 세션 스토리지에
// 1시간(서버 소비 유효기간과 동일) 보관해 가입 폼을 채운다. 가입 완료 RPC 는 토큰만 믿고 값은 서버 보관본을 쓴다.
//
// 모바일·앱은 REDIRECTION(페이지 이동)이라 복귀 URL 로 돌아온다. 복귀 URL 에는 우리가 붙인
// flow=identity&state=<난수> 가 함께 오며, 시작 시 저장한 {id, state} 와 정확히 일치할 때만 서버 검증을 한다
// (스토리지가 유실됐거나 남이 만든 링크면 "다시 시작" 안내 — codex 지적 반영).
//
// 환경변수(VITE_PORTONE_STORE_ID / VITE_PORTONE_CHANNEL_KEY)가 없으면 IDENTITY_ENABLED=false 이고
// 가입 화면은 기존 SMS OTP 흐름을 그대로 쓴다(PG 계약 전 기간 회귀 없음).

import { apiUrl } from './api';
import { isNativeApp } from './native';

export const IDENTITY_STORE_ID = (import.meta.env.VITE_PORTONE_STORE_ID || '').trim();
export const IDENTITY_CHANNEL_KEY = (import.meta.env.VITE_PORTONE_CHANNEL_KEY || '').trim();
export const IDENTITY_ENABLED = !!(IDENTITY_STORE_ID && IDENTITY_CHANNEL_KEY);
// 본인확인 수탁사 표기 — 개인정보처리방침·가입 동의문이 이 값을 쓴다(PG 를 바꾸면 여기만 수정).
export const IDENTITY_PG_NAME = 'NHN KCP';
export const IDENTITY_PROOF_TTL_MS = 60 * 60 * 1000;

const PROOF_KEY = 'pendingIdentityProof';
const START_KEY = 'pendingIdentityStart';
export const IDENTITY_FLOW = 'identity';

const randomHex = (bytes) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
};

// KCP 제약: 영숫자만·40자 이하. 'ct' + 32 hex = 34자.
export function newIdentityId() {
  return `ct${randomHex(16)}`;
}

export function loadIdentityProof() {
  try {
    const raw = sessionStorage.getItem(PROOF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.token || Date.now() - (p.savedAt || 0) >= IDENTITY_PROOF_TTL_MS) {
      sessionStorage.removeItem(PROOF_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function saveIdentityProof(proof) {
  try { sessionStorage.setItem(PROOF_KEY, JSON.stringify(proof)); } catch { /* 스토리지 차단 환경 */ }
}

export function clearIdentityProof() {
  try {
    sessionStorage.removeItem(PROOF_KEY);
    sessionStorage.removeItem(START_KEY);
  } catch { /* noop */ }
}

function loadStart() {
  try {
    const raw = sessionStorage.getItem(START_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.id || !s.state || Date.now() - (s.savedAt || 0) >= IDENTITY_PROOF_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}
function clearStart() {
  try { sessionStorage.removeItem(START_KEY); } catch { /* noop */ }
}
// 시작 기록은 1회용 — 복귀 결과를 화면 state 로 옮긴 직후 부모가 호출한다(멱등, StrictMode 안전).
export function clearIdentityStart() { clearStart(); }

// 복귀 파라미터: 우리가 붙인 flow/state + 포트원이 SDK 응답과 같은 키로 붙이는
//   identityVerificationId(+ identityVerificationTxId, transactionType) / 실패 시 code, message(+pgCode, pgMessage)
export const IDENTITY_RETURN_PARAMS = [
  'flow', 'state', 'identityVerificationId', 'identityVerificationTxId', 'transactionType',
  'code', 'message', 'pgCode', 'pgMessage',
];

// URL 이 본인확인 복귀인지(flow=identity). 아니면 null.
//   { ok:true, id }              — 시작 기록과 id·state 일치 → 서버 검증 진행
//   { ok:false, message }        — 실패/취소 복귀, 또는 시작 기록 불일치·유실(다시 시작 안내)
// 순수 함수(스토리지를 지우지 않는다) — React 개발모드 StrictMode 처럼 마운트 효과가 두 번 돌아도 결과가 같다.
// 시작 기록은 confirmIdentity 성공 시, 또는 다음 startIdentityVerification 에서 교체된다.
export function parseIdentityReturn(search) {
  const sp = new URLSearchParams(search || '');
  if (sp.get('flow') !== IDENTITY_FLOW) return null;
  const id = (sp.get('identityVerificationId') || '').trim();
  const state = (sp.get('state') || '').trim();
  const code = sp.get('code');
  const start = loadStart();
  if (code) {
    return { ok: false, message: sp.get('message') || sp.get('pgMessage') || '본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.' };
  }
  if (!id || !start || start.id !== id || start.state !== state) {
    return { ok: false, message: '본인확인 정보를 확인할 수 없습니다. 본인확인을 다시 시작해주세요.' };
  }
  return { ok: true, id };
}

// 복귀 파라미터만 제거한 search 문자열(type·ref·airline 등 우리 파라미터는 보존)
export function stripIdentityParams(search) {
  const sp = new URLSearchParams(search || '');
  IDENTITY_RETURN_PARAMS.forEach((k) => sp.delete(k));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const isMobileUA = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

// 본인확인 창 띄우기. PC(팝업/iframe)는 응답 객체가 돌아오고, 모바일·앱(REDIRECTION)은 페이지가
// 이동하므로 이 함수는 돌아오지 않는다 — 복귀는 parseIdentityReturn 으로 처리한다.
// returnPath: 복귀할 경로(+기존 쿼리). 앱에서는 origin 이 https://localhost 라 WebView 안으로 돌아온다.
export async function startIdentityVerification({ returnPath }) {
  if (!IDENTITY_ENABLED) {
    const e = new Error('본인확인 서비스가 아직 준비되지 않았습니다.');
    e.code = 'IDENTITY_DISABLED';
    throw e;
  }
  clearIdentityProof(); // 새 인증을 시작하면 이전 증빙·시작 기록은 폐기
  const PortOne = await import('@portone/browser-sdk/v2');
  const id = newIdentityId();
  const state = randomHex(16);
  try { sessionStorage.setItem(START_KEY, JSON.stringify({ id, state, savedAt: Date.now() })); } catch { /* noop */ }

  const base = returnPath || (window.location.pathname + window.location.search);
  const [path, query = ''] = base.split('?');
  const sp = new URLSearchParams(stripIdentityParams(query ? `?${query}` : ''));
  sp.set('flow', IDENTITY_FLOW);
  sp.set('state', state);
  const redirectUrl = `${window.location.origin}${path}?${sp.toString()}`;

  const useRedirect = isNativeApp() || isMobileUA();
  const resp = await PortOne.requestIdentityVerification({
    storeId: IDENTITY_STORE_ID,
    channelKey: IDENTITY_CHANNEL_KEY,
    identityVerificationId: id,
    redirectUrl,
    ...(useRedirect ? { windowType: { mobile: 'REDIRECTION' } } : {}),
  });
  if (!resp) return null; // REDIRECTION — 페이지 이동 중
  if (resp.code !== undefined) {
    clearStart();
    const e = new Error(resp.message || '본인확인이 취소되었거나 실패했습니다.');
    e.code = resp.code;
    throw e;
  }
  const returnedId = resp.identityVerificationId || id;
  if (returnedId !== id) {
    clearStart();
    const e = new Error('본인확인 정보를 확인할 수 없습니다. 다시 시도해주세요.');
    e.code = 'IDENTITY_MISMATCH';
    throw e;
  }
  clearStart();
  return id;
}

// 서버 검증 → 증빙 저장. 실패 시 Error(code, status) throw.
export async function confirmIdentity(identityVerificationId) {
  const resp = await fetch(apiUrl('/api/verify-identity'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityVerificationId }),
  });
  let data = null;
  try { data = await resp.json(); } catch { /* 본문 없음 */ }
  if (!resp.ok || !data?.ok) {
    const e = new Error(data?.error || '본인확인 결과를 확인하지 못했습니다. 다시 시도해주세요.');
    e.code = data?.code || '';
    e.status = resp.status;
    throw e;
  }
  const proof = {
    token: data.verifyToken,
    name: data.customer?.name || '',
    birthdate: data.customer?.birthdate || '',
    phone: data.customer?.phone || '',
    savedAt: Date.now(),
  };
  saveIdentityProof(proof);
  clearStart(); // 시작 기록은 1회용 — 성공적으로 소비됐으니 제거
  return proof;
}
