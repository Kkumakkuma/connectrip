// 통신사 휴대폰 본인확인(PASS) — 포트원 V2 브라우저 SDK 래퍼 + 증빙(proof) 보관.
//
// 가입 순서: 본인확인 먼저 → 가입 폼. 본인확인 성공 시 서버(/api/verify-identity)가 포트원에서
// 결과를 직접 조회해 일회성 토큰을 발급하고, 우리는 {token, name, birthdate, phone, purpose} 를 세션 스토리지에
// 1시간(서버 소비 유효기간과 동일) 보관해 가입 폼을 채운다. 가입 완료 RPC 는 토큰만 믿고 값은 서버 보관본을 쓴다.
//
// 모바일·앱은 REDIRECTION(페이지 이동)이라 복귀 URL 로 돌아온다. 복귀 URL 에는 우리가 붙인
// flow=identity&state=<난수> 가 함께 오며, 시작 시 저장한 기록과 state 가 정확히 일치할 때만 서버 검증을 한다
// (스토리지가 유실됐거나 남이 만든 링크면 "다시 시작" 안내 — codex 지적 반영).
//
// 2026-10-02 PASS 결속(R1 근본 수정 — 설계 문서/커넥트립_PASS결속_설계_v2_20261002.md §3.1·§3.2):
// - 본인확인 번호(id)는 서버가 발급한다. PASS 창을 띄우는 페이지가 32바이트 비밀값 ds 를 만들어 sha256(ds) 와 용도만 보내면
//   (start) 서버가 새 id 를 그 해시·용도에 묶어 돌려준다. 결과 확인(confirm)은 ds 원문을 가진 쪽이, 묶어 둔 용도로,
//   1시간 안에만 받는다 — 남이 만든 링크로 피해자가 PASS 를 끝내도 공격자는 그 결과를 가져갈 수 없다.
// - ds 는 http 주소에 싣지 않는다(포트원 redirectUrl·정적 요청 로그·방문 기록·Referer·GA 에 남지 않게, codex #4).
//   웹은 시작 기록(sessionStorage)에만, 앱 경로는 크롬 탭 localStorage(ctAppIdResults)에만 두고 다리 페이지
//   (public/app-return.html)가 앱을 여는 intent 를 만들 때만 붙인다.
//
// 환경변수(VITE_PORTONE_STORE_ID / VITE_PORTONE_CHANNEL_KEY)가 없으면 IDENTITY_ENABLED=false 이고
// 가입 화면은 본인확인 카드를 "준비 중"으로 잠근다 — 대체 수단이 없으므로 가입이 막히는 게 정상이다.

import { apiUrl, SITE_ORIGIN } from './api';
import { isNativeApp } from './native';
import { externalReturnUrl, isAppReturnPath } from './appReturn';

export const IDENTITY_STORE_ID = (import.meta.env.VITE_PORTONE_STORE_ID || '').trim();
export const IDENTITY_CHANNEL_KEY = (import.meta.env.VITE_PORTONE_CHANNEL_KEY || '').trim();
export const IDENTITY_ENABLED = !!(IDENTITY_STORE_ID && IDENTITY_CHANNEL_KEY);
// 본인확인 수탁사 표기 — 개인정보처리방침·가입 동의문이 이 값을 쓴다(PG 를 바꾸면 여기만 수정).
export const IDENTITY_PG_NAME = 'NHN KCP';
export const IDENTITY_PROOF_TTL_MS = 60 * 60 * 1000;

// 증빙의 용도. 서버가 증빙 토큰을 그 용도로만 인정한다 — 가입용 증빙으로 남의 비밀번호를 바꾸는 것을 막기 위해서다(2026-09-05).
// 결속(2026-10-02) 뒤에는 서버가 id 를 발급할 때의 용도로만 결과를 내준다(용도 바꿔치기 차단, C3).
export const IDENTITY_PURPOSE_SIGNUP = 'signup_identity';
export const IDENTITY_PURPOSE_PASSWORD_RESET = 'password_reset';
export const IDENTITY_PURPOSE_FIND_ID = 'find_id';
const PURPOSES = [IDENTITY_PURPOSE_SIGNUP, IDENTITY_PURPOSE_PASSWORD_RESET, IDENTITY_PURPOSE_FIND_ID];

const PROOF_KEY = 'pendingIdentityProof';
const START_KEY = 'pendingIdentityStart';
export const IDENTITY_FLOW = 'identity';

// 서버 발급 id = 'ct' + 16바이트 hex(34자 — KCP 제약: 영숫자만·40자 이하). state 는 16바이트, ds 는 32바이트 hex.
const ID_RE = /^ct[0-9a-f]{32}$/;
const STATE_RE = /^[0-9a-f]{32}$/;
const DS_RE = /^[0-9a-f]{64}$/;
// 미리 등록분(PC 웹)·크롬 보관분(앱 새로 고침)을 새 PASS 에 다시 쓰는 한도. 서버 결속은 등록 1시간 뒤 만료되므로
// 30분이 지난 것은 다시 쓰지 않는다 — PASS 를 할 시간을 30분 이상 남긴다(codex v2 #4).
// PC 웹 미리 등록분은 버리고 새로 등록한다. 크롬 보관분은 새로 등록하지 않고 IDENTITY_START_STALE 로 앱에서 다시 시작하게 한다
// (같은 state 로는 id 를 바꾸지 않는다 — prepareAppIdentity, 2026-10-02 codex 코드 검토 지적 1).
const REUSE_MS = 30 * 60 * 1000;

const randomHex = (bytes) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
};
// 결속 비밀값: 32바이트 난수 hex 64자. 서버에는 sha256 만 보낸다.
const newDs = () => randomHex(32);

// sha256(문자열의 UTF-8) hex — 서버(api/verify-identity.js)의 createHash('sha256').update(s, 'utf8') 와 같은 값.
async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // 보안 연결(https)이 아니거나 아주 옛 브라우저 — 결속 없이는 서버가 결과를 내주지 않으므로 시작하지 않는다
    throw identityError('BROWSER_UNSUPPORTED', '이 브라우저에서는 본인확인을 진행할 수 없습니다. 최신 브라우저로 다시 시도해주세요.');
  }
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 오류: code(서버·포트원·우리 사유), status(HTTP, 없으면 0), final(다시 물어도 같은 답 — R3, confirm 만 씀)
function identityError(code, message, { status = 0, final = false } = {}) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  e.final = final;
  return e;
}
const disabledError = () => identityError('IDENTITY_DISABLED', '본인확인 서비스가 아직 준비되지 않았습니다.');
// 저장소를 못 쓰면 PASS 를 열지 않는다 — 끝내도 결과를 받을 수 없어 KCP 비용·사용자 시간만 쓴다(codex v2 #5)
const storageError = () => identityError(
  'STORAGE_UNAVAILABLE',
  '브라우저 저장소를 쓸 수 없어요. 이 사이트의 데이터 저장(쿠키)을 허용하거나 시크릿 창이 아닌 일반 창에서 다시 시도해 주세요.',
);

// 포트원 SDK 모듈 — 청크를 못 받으면(배포 직후 옛 청크 해시·네트워크) 영어 브라우저 오류 대신 다시 시도 안내로
const loadSdk = () => import('@portone/browser-sdk/v2').catch(() => {
  throw identityError('IDENTITY_SDK_ERROR', '본인확인 창을 불러오지 못했습니다. 화면을 새로 고친 뒤 다시 시도해주세요.');
});

// '/경로?쿼리' → ['/경로', '쿼리'] — 첫 '?' 에서만 자른다(쿼리 값 안의 '?' 를 잃지 않게)
function splitPath(p) {
  const s = String(p || '');
  const i = s.indexOf('?');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// ── 증빙 ────────────────────────────────────────────────────────────────
// { token, name, birthdate, phone, purpose, savedAt }. 용도가 다르거나 없는 증빙은 지우고 null — 비밀번호·아이디 찾기
// 증빙이 같은 키에 남아 다음 가입 흐름에 섞이지 않게(codex #8·flows1). 가입 화면은 기본값(가입)으로 부른다.
export function loadIdentityProof(purpose = IDENTITY_PURPOSE_SIGNUP) {
  try {
    const raw = sessionStorage.getItem(PROOF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.token || p.purpose !== purpose || Date.now() - (p.savedAt || 0) >= IDENTITY_PROOF_TTL_MS) {
      sessionStorage.removeItem(PROOF_KEY);
      return null;
    }
    return p;
  } catch {
    try { sessionStorage.removeItem(PROOF_KEY); } catch { /* 스토리지 차단 환경 */ }
    return null;
  }
}

export function saveIdentityProof(proof) {
  try { sessionStorage.setItem(PROOF_KEY, JSON.stringify(proof)); } catch { /* 스토리지 차단 환경 */ }
}

export function clearIdentityProof() {
  try { sessionStorage.removeItem(PROOF_KEY); } catch { /* noop */ }
  clearStart();
}

// ── 시작 기록 ─────────────────────────────────────────────────────────────
// 앱은 localStorage — PASS 앱·크롬 탭에 가 있는 동안 앱 프로세스가 종료돼도 남아야 돌아와서 결과를 확인할 수 있다
// (2026-09-27 PASS 복귀 수정, agy B3). 웹은 탭을 닫으면 끝나는 sessionStorage 그대로.
//   웹: { id, state, purpose, returnPath, ds, savedAt } — 시작할 때 서버 발급 id 와 ds 를 함께 적는다.
//   앱: { state, purpose, returnPath, savedAt } — id·ds 는 크롬 탭이 등록하고, 결과 딥링크로 받아 덧붙인다(attachStartDs).
// id 와 ds 는 늘 함께 있거나 함께 없다. 웹 기록은 둘 다 있어야 한다.
function startStore() {
  try { return isNativeApp() ? window.localStorage : window.sessionStorage; } catch { return null; }
}

function validStart(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const age = Date.now() - Number(s.savedAt);
  if (!Number.isFinite(age) || age >= IDENTITY_PROOF_TTL_MS) return false;
  if (typeof s.state !== 'string' || !STATE_RE.test(s.state) || !PURPOSES.includes(s.purpose)) return false;
  if (s.returnPath !== undefined && typeof s.returnPath !== 'string') return false;
  const id = s.id ?? '';
  const ds = s.ds ?? '';
  if (id || ds || !isNativeApp()) {
    return typeof id === 'string' && typeof ds === 'string' && ID_RE.test(id) && DS_RE.test(ds);
  }
  return true;
}

// 읽기만 — 만료·형식 오류 기록은 없는 것으로 본다(지우지 않는다). parseIdentityReturn 이 쓴다(agy v2: 복귀 해석은
// 저장소를 바꾸지 않아야 React 개발모드 StrictMode 처럼 마운트 효과가 두 번 돌아도 결과가 같다).
function readStart() {
  try {
    const raw = startStore()?.getItem(START_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return validStart(s) ? s : null;
  } catch {
    return null;
  }
}
// 읽으면서 만료·형식 오류 기록은 지운다(codex #10) — 남겨 두면 앱 재개 때마다 '진행 중'으로 보인다.
function loadStart() {
  const s = readStart();
  if (!s) clearStart();
  return s;
}
function saveStart(rec) {
  try {
    const store = startStore();
    if (!store) return false;
    store.setItem(START_KEY, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}
function clearStart() {
  try { startStore()?.removeItem(START_KEY); } catch { /* noop */ }
  // 저장소를 옮기기 전(세션)에 남은 기록도 같이 지운다
  try { sessionStorage.removeItem(START_KEY); } catch { /* noop */ }
}
// 조건에 맞는 기록만 지운다 — 늦게 끝난 앞 시도(A)가 새 시도(B)의 기록을 지우지 않게(C5·R3)
function clearStartIf(match) {
  const s = readStart();
  if (s && match(s)) clearStart();
}

// 진행 중인 본인확인(시작 기록) — { id, ds, state, purpose, returnPath, savedAt } | null. 앱에서 결과를 아직 받지 못했으면
// id·ds 가 ''(그때 화면은 서버를 부르지 않고 '인증 결과 가져오기'를 안내한다).
export function loadPendingIdentity() {
  const s = loadStart();
  if (!s) return null;
  return {
    id: s.id || '', ds: s.ds || '', state: s.state, purpose: s.purpose,
    returnPath: s.returnPath || '', savedAt: Number(s.savedAt),
  };
}
// 시작 기록 정리 — 실패·취소 복귀(parseIdentityReturn 의 failed)일 때 부르는 쪽이 호출한다(멱등, StrictMode 안전).
// 성공 복귀의 기록은 서버 확인이 성공할 때 confirmIdentity 가 지운다. 아직 인증 전이거나 일시 오류면
// 남겨 두어야 '인증 결과 확인'·앱 재개 자동 확인으로 다시 물을 수 있다(교차검토 지적, 2026-09-27).
export function clearIdentityStart() { clearStart(); }

// 앱: 딥링크로 받은 결과(id·ds)를 같은 시도(state)의 시작 기록에 붙인다 — 일시 오류 뒤 '인증 결과 확인'·앱 재개 자동 확인·
// 콜드 스타트 재개(resume=1)가 이 값으로 다시 확인한다. 이미 id 가 붙은 기록은 바꾸지 않는다(먼저 받은 값을 지킨다 —
// 위조 딥링크가 ds 를 덮어써 그 위조 ds 의 최종 거절(R3)로 진짜 기록이 지워지지 않게). 붙였거나 이미 같은 id 면 true.
export function attachStartDs(id, ds, state) {
  if (!ID_RE.test(id || '') || !DS_RE.test(ds || '')) return false;
  const s = readStart();
  if (!s || s.state !== state) return false;
  if (s.id) return s.id === id;
  return saveStart({ ...s, id, ds });
}

// ── 복귀 해석 ─────────────────────────────────────────────────────────────
// 복귀 파라미터: 우리가 붙인 flow/state + 포트원이 SDK 응답과 같은 키로 붙이는
//   identityVerificationId(+ identityVerificationTxId, transactionType) / 실패 시 code, message(+pgCode, pgMessage)
//   + resume=1: 앱이 복귀 주소 없이 다시 열렸을 때(프로세스 종료 뒤 등) 저장해 둔 결과로 확인하라는 표시(앱 전용)
//   + ds: 다리 페이지가 앱으로 가는 intent 에만 붙이는 결속 값(2026-10-02). 화면들이 복귀 뒤 주소에서 함께 지운다.
// analytics.js 가 이 목록 + ds 를 늘 지운다(analytics.test.js 가 이 선언을 정규식으로 읽어 대조하므로 작은따옴표 문자열만 든
// 배열 리터럴 형식을 유지한다 — 펼침 연산자·상수 참조로 바꾸면 대조가 깨진다).
export const IDENTITY_RETURN_PARAMS = [
  'flow', 'state', 'identityVerificationId', 'identityVerificationTxId', 'transactionType',
  'code', 'message', 'pgCode', 'pgMessage', 'resume', 'ds',
];

const RESTART_MSG = '본인확인 정보를 확인할 수 없습니다. 본인확인을 다시 시작해주세요.';
const CANCELED_MSG = '본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.';
// 앱: 결과(ds)를 아직 받지 못했을 때의 안내 — 카드 하단 문구·앱 재개 안내·resume 복귀가 같이 쓴다
export const IDENTITY_NEED_RESULT_MSG = 'PASS 인증을 마친 뒤 화면의 「커넥트립 앱으로 돌아가기」를 눌러 주세요. 이미 닫았다면 「인증 결과 가져오기」를 눌러 주세요.';
// 앱: 성공 복귀인데 ds 가 붙어 오지 않음(크롬 저장소 차단·다른 브라우저에서 다리를 엶 등)
const RESULT_MISSING_MSG = '인증 결과를 앱으로 가져오지 못했어요. 「인증 결과 가져오기」를 눌러 주세요.';

// URL 이 본인확인 복귀인지(flow=identity). 아니면 null. 모든 결과에 state(주소의 state — resume 은 기록의 state)와
// purpose(기록의 용도, 없으면 '')를 넣는다(agy v2 — 화면이 attachStartDs·용도 대조에 쓴다).
//   { ok:true, id, ds, state, purpose, resume? }     — 확인할 수 있는 결과(resume: 앱 안 재개 — 아직 인증 전일 수 있음)
//   { ok:false, failed, needResult?, state, purpose, message }
//       failed=true: 지금 진행 중인 시도(같은 state)의 실패·취소 복귀 → 시작 기록 정리
//       needResult=true: 앱에서 결과(ds)를 아직 받지 못함 → '인증 결과 가져오기' 안내
//       그 밖: 시작 기록 불일치·유실(다른 시도의 옛 링크 등) → 다시 시작 안내만
// 저장소를 읽기만 한다(readStart). 시작 기록은 confirmIdentity 성공 시, 실패·취소 복귀 시(clearIdentityStart),
// 또는 다음 startIdentityVerification 에서 교체된다.
export function parseIdentityReturn(search) {
  const sp = new URLSearchParams(search || '');
  if (sp.get('flow') !== IDENTITY_FLOW) return null;
  const native = isNativeApp();
  const start = readStart();
  const purpose = start?.purpose || '';
  if (sp.get('resume') === '1') {
    // 앱 안에서 끝나는 재개 전용(콜드 스타트 resumePending·앱 재개) — 우리 저장소 값만 쓴다(주소의 id·ds·state 는 보지 않는다).
    // 웹은 받지 않는다(C3). '인증 결과 가져오기'로 다리를 거쳐 오는 복귀에는 resume 이 없다(codex v2 #1 — 일반 성공 복귀).
    const state = start?.state || '';
    if (!native || !start) return { ok: false, failed: false, state, purpose, message: RESTART_MSG };
    if (start.id && start.ds) return { ok: true, id: start.id, ds: start.ds, state, purpose, resume: true };
    return { ok: false, failed: false, needResult: true, state, purpose, message: IDENTITY_NEED_RESULT_MSG };
  }
  const id = (sp.get('identityVerificationId') || '').trim();
  const state = (sp.get('state') || '').trim();
  if (sp.get('code')) {
    // C2: 지금 진행 중인 시도(같은 state)일 때만 기록을 끝낸다 — 위조·다른 시도의 옛 실패 링크가 진행 중 기록을 지우지 못하게.
    // id 가 함께 오면 같은 시도인지도 본다(앱 기록은 결과를 받기 전에는 id 가 없다).
    const failed = !!start && state === start.state && (!id || !start.id || id === start.id);
    return {
      ok: false, failed, state, purpose,
      message: sp.get('message') || sp.get('pgMessage') || CANCELED_MSG,
    };
  }
  if (!start || state !== start.state) return { ok: false, failed: false, state, purpose, message: RESTART_MSG };
  if (!native) {
    // 웹: ds 는 시작 기록에만 있다 — 주소의 ds 는 보지 않는다
    if (!id || id !== start.id || !start.ds) return { ok: false, failed: false, state, purpose, message: RESTART_MSG };
    return { ok: true, id, ds: start.ds, state, purpose };
  }
  // 앱: 다리 페이지가 크롬 저장소의 ds 를 intent 에 붙여 보낸다. 기록에 이미 id 가 있으면(앞선 복귀) 같아야 한다.
  if (!ID_RE.test(id) || (start.id && start.id !== id)) return { ok: false, failed: false, state, purpose, message: RESTART_MSG };
  const urlDs = (sp.get('ds') || '').trim();
  const ds = DS_RE.test(urlDs) ? urlDs : (start.id === id ? start.ds || '' : '');
  if (!ds) return { ok: false, failed: false, needResult: true, state, purpose, message: RESULT_MISSING_MSG };
  return { ok: true, id, ds, state, purpose };
}

// 복귀 파라미터만 제거한 search 문자열(type·ref·airline 등 우리 파라미터는 보존)
export function stripIdentityParams(search) {
  const sp = new URLSearchParams(search || '');
  IDENTITY_RETURN_PARAMS.forEach((k) => sp.delete(k));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const isMobileUA = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

// 페이지 밖 주소로 이동(앱 → 크롬 탭 /app-identity, 크롬 탭 → 다리 페이지). 객체 메서드로 묶어 둔 이유: jsdom 은 다른 문서로의
// 이동을 구현하지 않아(주소가 바뀌지 않는다) 테스트가 이 메서드를 바꿔 끼워 이동한 주소를 확인한다.
export const identityNav = {
  go(url) { window.location.href = url; },
  replace(url) { window.location.replace(url); },
};

// ── 서버 등록(start) ──────────────────────────────────────────────────────
// sha256(ds)·용도를 보내고 서버가 발급한 id 를 받는다. 실패는 Error(code, status) — 429 RATE_LIMITED·503 IDENTITY_DISABLED·
// 네트워크 NETWORK_ERROR 등. ds 원문은 보내지 않는다.
export async function registerIdentityStart({ purpose, ds }) {
  const dsHash = await sha256Hex(ds);
  let resp;
  try {
    resp = await fetch(apiUrl('/api/verify-identity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', purpose, dsHash }),
    });
  } catch {
    throw identityError('NETWORK_ERROR', '네트워크 오류로 본인확인을 시작하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.');
  }
  let data = null;
  try { data = await resp.json(); } catch { /* 본문 없음 */ }
  if (!resp.ok || !data?.ok) {
    throw identityError(
      data?.code || 'IDENTITY_START_FAILED',
      data?.error || '본인확인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
      { status: resp.status },
    );
  }
  const id = String(data.identityVerificationId || '');
  if (!ID_RE.test(id)) {
    throw identityError('IDENTITY_START_FAILED', '본인확인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.', { status: resp.status });
  }
  return id;
}

// 등록권 { id, ds, at } — at 은 요청을 보낸 시각(서버 등록 시각보다 이르므로 남은 시간을 보수적으로 잰다)
async function newTicket(purpose) {
  const ds = newDs();
  const at = Date.now();
  const id = await registerIdentityStart({ purpose, ds });
  return { id, ds, at };
}

// ── 웹(PC) 미리 등록(설계 v2 §0-5·§3.1) ────────────────────────────────────
// PC 는 PASS 를 팝업으로 연다. 클릭과 팝업(window.open) 사이에 서버 왕복이 끼면 사용자 동작 효력이 지나 팝업이 막힐 수 있어
// 화면을 열 때 등록해 둔다. 메모리 캐시 purpose → { promise, at }. 실패한 것은 캐시에서 지운다(실패는 삼킨다 — 클릭 때 다시 등록).
// 모바일 웹(REDIRECTION, 팝업 없음)·앱·복귀 화면은 미리 등록하지 않는다(쓰지 않을 행·속도 제한, agy v2). 쓰지 않은 등록은
// 서버가 24시간 뒤 정리한다.
const webPrepared = new Map();

export function prepareWebIdentity(purpose = IDENTITY_PURPOSE_SIGNUP) {
  if (!IDENTITY_ENABLED || isNativeApp() || isMobileUA() || !PURPOSES.includes(purpose)) return;
  const cur = webPrepared.get(purpose);
  if (cur && Date.now() - cur.at < REUSE_MS) return;
  const entry = { at: Date.now(), promise: newTicket(purpose) };
  webPrepared.set(purpose, entry);
  entry.promise.catch(() => { if (webPrepared.get(purpose) === entry) webPrepared.delete(purpose); });
  // SDK 모듈 청크도 미리 받아 둔다 — 클릭 뒤 남는 왕복을 하나 줄인다(포트원 CDN 스크립트는 SDK 가 첫 요청 때 넣는다)
  loadSdk().catch(() => {});
}

// 미리 등록분의 사용권을 이 호출로 넘긴다(캐시에서 꺼내 지운다 — 두 클릭이 같은 id 를 쓰지 않게). 첫 await 전에 불러야 한다.
function takeWebPrepared(purpose) {
  const cur = webPrepared.get(purpose);
  webPrepared.delete(purpose);
  return cur ? cur.promise : null;
}

// 본인확인 창 띄우기.
// · 웹: 미리 등록분(PC, 없거나 30분 넘었으면 새로 등록)과 SDK import 를 함께 기다림 → 시작 기록(ds 포함) 저장 → SDK.
//   PC(팝업/iframe)는 응답이 돌아오므로 { id, ds } 를 돌려준다(시작 기록은 확인이 성공할 때까지 유지 — codex #5).
//   모바일(REDIRECTION)은 페이지가 이동하므로 null — 복귀는 parseIdentityReturn 으로 처리한다.
// · 앱: 시작 기록 { state, purpose, returnPath } 저장 → 사이트의 /app-identity 를 연다(크롬 탭) → null.
// returnPath: 복귀할 경로(+기존 쿼리). purpose: 이 본인확인을 어디에 쓸지(기본 가입).
export async function startIdentityVerification({ returnPath, purpose = IDENTITY_PURPOSE_SIGNUP }) {
  if (!IDENTITY_ENABLED) throw disabledError();
  clearIdentityProof(); // 새 인증을 시작하면 이전 증빙·시작 기록은 폐기
  const state = randomHex(16);
  const [path, query] = splitPath(returnPath || (window.location.pathname + window.location.search));
  const cleanQuery = stripIdentityParams(query);
  const cleanReturn = `${path}${cleanQuery}`;

  if (isNativeApp()) {
    // 앱: 사이트의 /app-identity 를 연다 — IntentUrlPlugin 이 크롬 탭으로 띄우고 이 화면은 그대로 남는다.
    // id·ds 는 PASS 창을 띄우는 크롬 탭이 만들고 등록한다(등록 주체 = SDK 를 띄우는 페이지, 설계 v1 §2-A·D).
    // 기록이 없으면 돌아와도 결과를 받을 수 없으므로 저장에 실패하면 열지 않는다.
    if (!saveStart({ state, purpose, returnPath: cleanReturn, savedAt: Date.now() })) throw storageError();
    identityNav.go(appIdentityUrl({ state, purpose, returnPath: cleanReturn }));
    return null;
  }

  const mobile = isMobileUA();
  const prepared = mobile ? null : takeWebPrepared(purpose);
  const ticketP = (async () => {
    if (prepared) {
      try {
        const t = await prepared;
        if (Date.now() - t.at < REUSE_MS) return t;
      } catch { /* 미리 등록 실패 — 새로 등록 */ }
    }
    return newTicket(purpose);
  })();
  const [ticket, PortOne] = await Promise.all([ticketP, loadSdk()]);
  const saved = saveStart({ id: ticket.id, state, purpose, returnPath: cleanReturn, ds: ticket.ds, savedAt: ticket.at });
  // 모바일은 페이지를 떠났다 돌아오므로 기록(ds) 없이는 결과를 받을 수 없다. PC 는 응답이 이 함수로 돌아와 기록 없이도 된다.
  if (!saved && mobile) throw storageError();

  // 창이 실패·취소로 끝남: 이 시도의 기록을 끝내고, PC 면 쓴 등록분 대신 다음 것을 미리 등록한다 — 다시 누를 때 왕복 없이
  // 팝업이 뜨게. 성공하면 화면이 다음 단계로 넘어가므로 미리 등록하지 않는다(쓰지 않을 행·같은 IP 속도 제한 절약).
  const failWith = (e) => {
    clearStartIf((s) => s.id === ticket.id);
    if (!mobile) prepareWebIdentity(purpose);
    return e;
  };
  const sp = new URLSearchParams(cleanQuery);
  sp.set('flow', IDENTITY_FLOW);
  sp.set('state', state);
  const redirectUrl = externalReturnUrl(path, sp);   // ds 는 싣지 않는다(설계 v2 §0-4)
  let resp;
  try {
    resp = await PortOne.requestIdentityVerification({
      storeId: IDENTITY_STORE_ID,
      channelKey: IDENTITY_CHANNEL_KEY,
      identityVerificationId: ticket.id,
      redirectUrl,
      ...(mobile ? { windowType: { mobile: 'REDIRECTION' } } : {}),
    });
  } catch (err) {
    throw failWith(identityError(err?.code || 'IDENTITY_SDK_ERROR', '본인확인 창을 열지 못했습니다. 다시 시도해주세요.'));
  }
  if (!resp) return null; // REDIRECTION — 페이지 이동 중
  if (resp.code !== undefined) {
    throw failWith(identityError(resp.code, resp.message || '본인확인이 취소되었거나 실패했습니다.'));
  }
  if ((resp.identityVerificationId || ticket.id) !== ticket.id) {
    throw failWith(identityError('IDENTITY_MISMATCH', '본인확인 정보를 확인할 수 없습니다. 다시 시도해주세요.'));
  }
  return { id: ticket.id, ds: ticket.ds };
}

// ── 서버 확인(confirm) ────────────────────────────────────────────────────
// 서버 검증 → 증빙 저장. 실패 시 Error(code, status, final) throw.
// purpose 는 발급받을 증빙의 용도 — 서버가 등록 때의 용도와 대조하고 토큰에 함께 묶는다. ds 는 결속 비밀값(본문에만 싣는다).
// 같은 id·용도는 한 번만 서버에 묻는다 — 앱에서는 복귀 주소·앱 재개·화면 진입이 거의 동시에 확인을 부를 수 있고,
// 서버는 한 건을 한 번만 소비하므로 두 번째 요청이 "이미 처리됨"으로 실패한다(agy B4). 실패하면 다시 물을 수 있게 비운다.
const confirmCache = new Map();
export function confirmIdentity(identityVerificationId, purpose = IDENTITY_PURPOSE_SIGNUP, ds = '') {
  const key = `${purpose}:${identityVerificationId}`;
  const hit = confirmCache.get(key);
  if (hit) return hit;
  const p = confirmIdentityOnce(identityVerificationId, purpose, ds).catch((e) => {
    confirmCache.delete(key);
    throw e;
  });
  confirmCache.set(key, p);
  return p;
}

// 다시 물어도 같은 답인 거절(R3) — 이 시도의 시작 기록을 끝내 '인증 결과 확인' 단추·자동 확인이 같은 거절을 되풀이하지 않게.
// 그 밖(IDENTITY_NOT_VERIFIED·IDENTITY_NOT_FOUND·RATE_LIMITED·PROVIDER_*·SERVER_*·네트워크 오류)은 기록을 남겨 다시 묻는다.
const FINAL_CODES = new Set([
  'IDENTITY_ALREADY_USED', 'IDENTITY_ALREADY_REGISTERED', 'PHONE_ALREADY_CLAIMED', 'IDENTITY_BLOCKED', 'UNDER_14',
  'IDENTITY_STALE', 'IDENTITY_BINDING_INVALID', 'IDENTITY_BINDING_REQUIRED', 'IDENTITY_PURPOSE_MISMATCH',
  'IDENTITY_CHANNEL_INVALID', 'PHONE_UNAVAILABLE', 'BAD_REQUEST', 'BAD_PURPOSE',
]);

async function confirmIdentityOnce(identityVerificationId, purpose, ds) {
  let resp;
  try {
    resp = await fetch(apiUrl('/api/verify-identity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityVerificationId, purpose, ds }),
    });
  } catch {
    throw identityError('NETWORK_ERROR', '네트워크 오류로 본인확인 결과를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.');
  }
  let data = null;
  try { data = await resp.json(); } catch { /* 본문 없음 */ }
  if (!resp.ok || !data?.ok) {
    const code = data?.code || '';
    const final = FINAL_CODES.has(code);
    // 같은 id 에 같은 ds 로 받은 최종 거절일 때만 기록을 끝낸다 — 위조 ds 의 거절이 진짜 기록을 지우지 않게(R3·codex #9)
    if (final) clearStartIf((s) => s.id === identityVerificationId && s.ds === ds);
    throw identityError(code, data?.error || '본인확인 결과를 확인하지 못했습니다. 다시 시도해주세요.', { status: resp.status, final });
  }
  const proof = {
    token: data.verifyToken,
    name: data.customer?.name || '',
    birthdate: data.customer?.birthdate || '',
    phone: data.customer?.phone || '',
    purpose,
    savedAt: Date.now(),
  };
  saveIdentityProof(proof);
  // 시작 기록은 1회용 — 이 id 의 기록일 때만 지운다. 늦게 끝난 앞 시도가 새로 시작한 기록을 지우지 않게(C5)
  clearStartIf((s) => s.id === identityVerificationId);
  return proof;
}

// ── 앱의 본인확인(2026-09-27 PASS 복귀 실패 수정, 2026-10-02 결속) ─────────────────────
// 앱 WebView 안에서 SDK 를 돌리면 KCP 창이 폼 POST 로 WebView 를 통째로 바꾸고(네이티브가 가로챌 수 없다),
// PASS 앱을 거치며 흐름이 크롬 쪽으로 새면 https://localhost 복귀 주소를 열 수 없었다(테스터 실기기 제보).
// 그래서 앱은 사이트의 /app-identity 화면을 크롬 탭으로 열어(IntentUrlPlugin) 웹과 똑같이 인증하고,
// 끝나면 다리 페이지(app-return.html) → 앱(intent://app-return, 패키지 고정)으로 돌아온다. 앱 화면은 그대로 남는다.
// 결속(2026-10-02): PASS 창을 띄우는 크롬 탭이 ds 를 만들어 등록하고(prepareAppIdentity) 크롬 localStorage 에 둔다.
// 다리 페이지가 같은 출처라 그 값을 읽어 intent 에만 붙이고, 앱은 딥링크로 받은 id·ds 로 서버에 확인한다.
export const APP_IDENTITY_PATH = '/app-identity';
// /app-identity 계약 버전. 1.3.4 이하 앱은 v 없이 id(앱이 만든 값)를 넘긴다 → 업데이트 안내(legacy).
const APP_IDENTITY_VERSION = '2';
// 앱이 /app-identity 크롬 탭을 열지 못했을 때(브라우저 없음·실행 거부) IntentUrlPlugin.java 가 앱 WebView 의 window 에 보내는
// 이벤트 — 자바의 APP_IDENTITY_OPEN_FAILED_EVENT 와 같은 문자열이어야 한다(IdentityVerifyStep.test.jsx 가 대조). 2026-10-02 codex 지적 2.
export const APP_IDENTITY_OPEN_FAILED_EVENT = 'ct-app-identity-open-failed';
// 브라우저를 열 수 없어 본인확인을 못 함 — 앱 화면(IdentityVerifyStep, 위 이벤트)과 앱 WebView 안으로 열린 /app-identity
// (AppIdentity 의 inApp 모드)가 같은 문구를 쓴다.
export const IDENTITY_BROWSER_UNAVAILABLE_MSG = '브라우저를 열 수 없어 본인확인을 진행할 수 없어요. 크롬을 켜 두거나 기본 브라우저를 확인한 뒤 다시 시도해 주세요.';
// 크롬 탭: 같은 시도(state)의 등록이 30분을 넘었다(prepareAppIdentity 의 IDENTITY_START_STALE). 화면 안내와, 앱으로 돌려보내는
// 다리 주소의 message 에 같은 문구를 쓴다(앱이 같은 state 의 실패 복귀로 받아 기록을 지우고 이 문구를 띄운다 — C2).
export const IDENTITY_START_STALE_MSG = '본인확인 시간이 지났어요. 커넥트립 앱으로 돌아가 본인확인을 다시 시작해 주세요.';

// 앱 → 크롬 탭으로 여는 사이트 주소. /app-identity?v=2&state&purpose&to[&q][&resume=1] — id 는 싣지 않는다(서버가 발급).
// resume: '인증 결과 가져오기' — 크롬 탭이 PASS 를 다시 띄우지 않고 보관해 둔 결과만 다리로 보낸다.
export function appIdentityUrl({ state, purpose, returnPath, resume = false }) {
  const [to, query] = splitPath(returnPath);
  const sp = new URLSearchParams({ v: APP_IDENTITY_VERSION, state, purpose, to });
  if (query) sp.set('q', query);
  if (resume) sp.set('resume', '1');
  return `${SITE_ORIGIN}${APP_IDENTITY_PATH}?${sp.toString()}`;
}

// /app-identity 화면이 받은 값 검사.
//   v=2                         → { state, purpose, to, q, resume }
//   v 없음 + 옛 계약(id·state 형식, 허용 경로) → { legacy: true, state, to, q } — 등록·PASS 없이 업데이트 안내
//   그 밖                        → null
export function parseAppIdentityParams(search) {
  const sp = new URLSearchParams(search || '');
  const state = sp.get('state') || '';
  const to = sp.get('to') || '';
  const q = sp.get('q') || '';
  if (!sp.has('v')) {
    const legacy = ID_RE.test(sp.get('id') || '') && STATE_RE.test(state) && isAppReturnPath(to);
    return legacy ? { legacy: true, state, to, q } : null;
  }
  const purpose = sp.get('purpose') || '';
  if (sp.get('v') !== APP_IDENTITY_VERSION || !STATE_RE.test(state) || !PURPOSES.includes(purpose) || !isAppReturnPath(to)) {
    return null;
  }
  return { state, purpose, to, q, resume: sp.get('resume') === '1' };
}

// ── 크롬 쪽 결과 보관 ctAppIdResults(크롬 탭 = www 출처 localStorage, 설계 v2 §3.1) ─────────────
// { [id]: { ds, state, purpose, savedAt } } — public/app-return.html 과 같은 키·형식. to·q·이메일 같은 개인 값은 넣지 않는다(flows10).
// 최대 5건·1시간. 정리는 만료분과 5건 초과분(오래된 것부터)만 한다 — 읽었다고 지우지 않는다(다리 단추를 다시 누르거나
// '인증 결과 가져오기'에 다시 쓴다, agy v2). 모든 접근은 try/catch(사이트 데이터 차단이면 접근 자체가 던진다).
const APP_RESULTS_KEY = 'ctAppIdResults';
const APP_RESULT_TTL_MS = 60 * 60 * 1000;
const APP_RESULT_MAX = 5;

// 형식이 틀린 항목(savedAt 없음 등)은 만료로 본다 — 다리 페이지의 fresh() 와 같은 규칙
const freshResult = (r, now, maxAge) => {
  if (!r || typeof r !== 'object') return false;
  const t = Number(r.savedAt);
  return Number.isFinite(t) && now - t < maxAge;
};
// 깨진 값은 빈 보관함으로 본다(다음 저장이 덮어쓴다). 저장소 접근 오류는 부르는 쪽으로 던진다.
function readAppResults(store) {
  const raw = store.getItem(APP_RESULTS_KEY);
  let map = null;
  try { map = JSON.parse(raw || 'null'); } catch { map = null; }
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}
function tidyAppResults(map, now) {
  return Object.fromEntries(Object.entries(map)
    .filter(([, r]) => freshResult(r, now, APP_RESULT_TTL_MS))
    .sort((a, b) => Number(b[1].savedAt) - Number(a[1].savedAt))
    .slice(0, APP_RESULT_MAX));
}
// 쓸 수 있는지 미리 본다(정리한 보관함을 다시 쓴다) — 서버 등록(행·속도 제한)을 쓰기 전에
function appResultsWritable() {
  try {
    const store = window.localStorage;
    store.setItem(APP_RESULTS_KEY, JSON.stringify(tidyAppResults(readAppResults(store), Date.now())));
    return true;
  } catch {
    return false;
  }
}
function saveAppIdResult(id, { ds, state, purpose }) {
  try {
    const store = window.localStorage;
    const now = Date.now();
    const map = readAppResults(store);
    map[id] = { ds, state, purpose, savedAt: now };
    store.setItem(APP_RESULTS_KEY, JSON.stringify(tidyAppResults(map, now)));
    return true;
  } catch {
    return false;
  }
}

// 크롬 보관분 조회 — 같은 state·purpose 이고 maxAgeMs(최대 1시간) 안인 것 중 가장 최근 것 → { id, ds, savedAt } | null.
// '인증 결과 가져오기'는 1시간 안 최신, 새 PASS(새로 고침 재사용)는 30분 안 최신을 쓴다(codex v2 #4).
export function findAppIdResult(state, purpose, maxAgeMs = APP_RESULT_TTL_MS) {
  if (!STATE_RE.test(state || '') || !PURPOSES.includes(purpose)) return null;
  try {
    const map = readAppResults(window.localStorage);
    const now = Date.now();
    const maxAge = Math.min(maxAgeMs, APP_RESULT_TTL_MS);
    let best = null;
    for (const [id, r] of Object.entries(map)) {
      if (!ID_RE.test(id) || !freshResult(r, now, maxAge)) continue;
      if (r.state !== state || r.purpose !== purpose || typeof r.ds !== 'string' || !DS_RE.test(r.ds)) continue;
      const savedAt = Number(r.savedAt);
      if (!best || savedAt > best.savedAt) best = { id, ds: r.ds, savedAt };
    }
    return best;
  } catch {
    return null;
  }
}

// 같은 시도(state·용도)로 등록한 보관분이 하나라도 있는가. 기간은 보지 않는다 — 1시간이 지나 아직 정리되지 않은 것도 센다
// (그 시도는 이미 id 를 받았고, 앱 기록은 크롬 등록보다 먼저 저장되므로 그때는 앱 기록도 만료돼 새 id 로 PASS 를 해도 앱이
// 받을 수 없다). 저장소를 읽지 못하면 false — 바로 뒤의 저장소 확인(appResultsWritable)이 STORAGE_UNAVAILABLE 로 거른다.
function hasAppIdResult(state, purpose) {
  try {
    return Object.entries(readAppResults(window.localStorage)).some(([id, r]) => (
      ID_RE.test(id) && !!r && typeof r === 'object' && r.state === state && r.purpose === purpose
    ));
  } catch {
    return false;
  }
}

// 크롬 탭(/app-identity): PASS 창을 띄울 id·ds 를 준비한다 → { id, ds }.
// 같은 시도(state·purpose)의 30분 안 보관분이 있으면 다시 쓴다(새로 고침 — 후보가 여럿이면 가장 최근 것).
// 같은 시도의 보관분이 있는데 30분이 지났으면 새로 등록하지 않고 IDENTITY_START_STALE 을 던진다 — 같은 state 로는 id 를 바꾸지
// 않는다(2026-10-02 codex 코드 검토 지적 1: 사용자가 stale '앱으로 돌아가기'로 먼저 돌아가 앱 기록에 id A·ds 가 붙은 뒤 31분 만에
// 이 탭을 새로 고치면, 새 id B 로 PASS 를 마쳐도 앱은 기록의 A 와 달라 B 의 정상 결과를 거절했다). 화면은 그 사유(code)를 실어
// 앱으로 돌려보내고, 앱은 같은 state 의 실패 복귀로 받아 기록을 지운 뒤 다시 시작하게 한다(C2).
// 보관분이 아예 없을 때만(정리돼 사라진 것 포함) ds 생성 → 서버 등록 → 크롬 저장소 보관. 저장소를 못 쓰면 등록 전에
// STORAGE_UNAVAILABLE(PASS 를 열지 않는다). 같은 탭 안에서 준비가 겹치면 하나로 합친다(StrictMode 이중 실행 등 — 모듈 단위 진행 중 Promise).
let appPreparing = null;
export function prepareAppIdentity({ state, purpose }) {
  const key = `${purpose}:${state}`;
  if (appPreparing?.key === key) return appPreparing.promise;
  const promise = (async () => {
    if (!IDENTITY_ENABLED) throw disabledError();
    if (!STATE_RE.test(state || '') || !PURPOSES.includes(purpose)) {
      throw identityError('BAD_REQUEST', '본인확인 요청이 올바르지 않습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.');
    }
    const reuse = findAppIdResult(state, purpose, REUSE_MS);
    if (reuse) return { id: reuse.id, ds: reuse.ds };
    if (hasAppIdResult(state, purpose)) throw identityError('IDENTITY_START_STALE', IDENTITY_START_STALE_MSG);
    if (!appResultsWritable()) throw storageError();
    const ds = newDs();
    const id = await registerIdentityStart({ purpose, ds });
    if (!saveAppIdResult(id, { ds, state, purpose })) throw storageError();
    return { id, ds };
  })();
  const entry = { key, promise };
  appPreparing = entry;
  const done = () => { if (appPreparing === entry) appPreparing = null; };
  promise.then(done, done);
  return promise;
}

// /app-identity 화면(크롬 탭 = 모바일 웹)에서 포트원 창을 연다. 복귀는 다리 페이지 → 앱.
// redirectUrl = 다리?to&q&flow&state — ds 는 싣지 않는다(다리 페이지가 크롬 저장소에서 붙인다, 설계 v2 §0-4).
export async function launchIdentityForApp({ id, state, to, q }) {
  if (!IDENTITY_ENABLED) throw disabledError();
  if (!ID_RE.test(id || '') || !STATE_RE.test(state || '')) {
    throw identityError('BAD_REQUEST', '본인확인 요청이 올바르지 않습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.');
  }
  const PortOne = await loadSdk();
  const sp = new URLSearchParams(stripIdentityParams(q));
  sp.set('flow', IDENTITY_FLOW);
  sp.set('state', state);
  const redirectUrl = externalReturnUrl(to, sp, { native: true });
  const resp = await PortOne.requestIdentityVerification({
    storeId: IDENTITY_STORE_ID,
    channelKey: IDENTITY_CHANNEL_KEY,
    identityVerificationId: id,
    redirectUrl,
    windowType: { mobile: 'REDIRECTION' },
    forceRedirect: true,   // PC 로 열려도 결과를 다리 페이지로 보낸다(앱이 결과를 받는 곳은 다리뿐)
  });
  if (resp && resp.code !== undefined) {
    throw identityError(resp.code, resp.message || '본인확인이 취소되었거나 실패했습니다.');
  }
  return null;
}

// 크롬 탭에서 앱으로 돌려보내는 다리 페이지 주소(앱으로 돌아가는 모든 단추·결과 가져오기가 쓴다).
// 다리?to&q&flow=identity&state[&identityVerificationId=id][&code&message]. ds 는 싣지 않는다(다리가 같은 state 일 때 붙인다).
// resume 은 붙이지 않는다 — 다리를 거쳐 돌아오는 결과는 일반 성공 복귀로 처리해야 앱이 attach → confirm 을 한 번 한다(codex v2 #1).
export function appBridgeUrl({ to, q = '', state = '', id = '', code = '', message = '' } = {}) {
  const sp = new URLSearchParams(stripIdentityParams(q));
  sp.set('flow', IDENTITY_FLOW);
  if (state) sp.set('state', state);
  if (id) sp.set('identityVerificationId', id);
  if (code) {
    sp.set('code', code);
    if (message) sp.set('message', message);
  }
  return externalReturnUrl(to || '', sp, { native: true });
}
