// 로그인 전에 누른 "가져오기"를 로그인 뒤에 이어서 처리하기 위한 대기 항목 (설계 §1.1 agy-14).
//
// 커넥트립에는 로그인 후 원래 자리로 돌아오는 장치가 없어서, 가져오기 대상을 잠깐 로컬에 적어 두고
// 로그인 뒤 /planner 진입 시 이어서 처리한다.
//
// 보관 원칙
//   · TTL 30분. 공유 토큰이 localStorage 에 무기한 남지 않게 한다.
//   · 한 건만 보관한다(마지막에 누른 것). 큐로 쌓아 두면 오래된 항목이 엉뚱한 때 실행된다.
//   · 읽는 즉시 지운다(take). 실패해도 다시 시도하지 않는다 — 남겨 두면 매 진입마다 같은 오류를 낸다.
//   · 저장소 접근은 전부 try/catch. 사파리 비공개 모드처럼 localStorage 가 던지는 환경이 있다.

const KEY = 'ct_planner_pending_import_v1';
const VERSION = 1;
export const PENDING_TTL_MS = 30 * 60 * 1000;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRaw(value) {
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // 저장이 막힌 환경에서는 대기 처리를 포기한다. 가져오기 자체는 로그인 후 다시 누르면 된다.
  }
}

export function clearPendingImport() {
  writeRaw(null);
}

// post 또는 token 중 하나만 받는다. 둘 다 없으면 저장하지 않는다.
export function savePendingImport({ post = null, token = null } = {}) {
  const cleanPost = typeof post === 'string' && post.trim() ? post.trim() : null;
  const cleanToken = /^[0-9a-f]{64}$/.test(String(token || '')) ? String(token) : null;
  if (!cleanPost && !cleanToken) return false;
  writeRaw(JSON.stringify({ v: VERSION, post: cleanPost, token: cleanToken, ts: Date.now() }));
  return true;
}

// 대기 항목을 꺼내면서 지운다. 없거나 형식이 다르거나 만료됐으면 null.
export function takePendingImport() {
  const raw = readRaw();
  if (!raw) return null;
  clearPendingImport();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== VERSION) return null;
  if (!Number.isFinite(parsed.ts) || Date.now() - parsed.ts > PENDING_TTL_MS) return null;
  if (!parsed.post && !parsed.token) return null;

  return { post: parsed.post || null, token: parsed.token || null };
}
