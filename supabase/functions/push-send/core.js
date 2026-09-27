// push-send 발송기의 순수 로직(네트워크·환경변수 없음) — Deno 실행부(index.js)와 vitest(core.test.js)가 같이 쓴다.
// SQL 짝: src/lib/push_worker_20260927.sql

export const SECRET_RE = /^[0-9a-f]{64}$/;
// 기기가 꺼져 있으면 FCM 이 하루까지만 보관한다(기본값 4주 — codex 검토). 하루 = push_purge 의 미발송 보관 기한과 같다.
export const TTL_SECONDS = 86400;
export const ACCENT = '#124A64';   // 앱 아이콘 남색 = AndroidManifest default_notification_color 와 같은 값

// 비밀 비교는 길이가 같으면 끝까지 다 본다(앞자리 일치 여부로 시간이 달라지지 않게).
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 앱(src/lib/push.js isSafeInternalLink)과 같은 기준 — 사이트 내부 경로만 data.link 로 싣는다.
export function isInternalLink(link) {
  return typeof link === 'string' && link.length <= 500 && link.startsWith('/') && !link.startsWith('//') && !link.includes('\\');
}

// FCM HTTP v1 의 message 본체(요청 본문은 { message } 로 감싼다). data 값은 전부 문자열이어야 한다.
// tag = 같은 알림이 두 번 접수돼도(최소 1회 발송이라 드물게 생김) 알림창에서 덮어써 한 개로 보이게 한다.
export function buildMessage(row, token, nowMs = Date.now()) {
  const created = Date.parse(row.created_at);
  const ageSec = Number.isFinite(created) ? Math.max(0, Math.floor((nowMs - created) / 1000)) : 0;
  const data = { outbox_id: String(row.id) };
  if (isInternalLink(row.link)) data.link = row.link;
  return {
    token,
    notification: { title: String(row.title ?? ''), body: String(row.body ?? '') },
    data,
    android: {
      priority: 'HIGH',
      ttl: `${Math.max(60, TTL_SECONDS - ageSec)}s`,
      notification: { channel_id: 'default', icon: 'ic_stat_notify', color: ACCENT, tag: `ct-${row.id}` },
    },
  };
}

// Retry-After 는 초 숫자 또는 HTTP 날짜 둘 다 올 수 있다(codex 검토). 최대 1시간 — 그보다 길면 알림 유효기간(1시간)이 먼저 끝난다.
export function parseRetryAfter(header, nowMs = Date.now()) {
  if (header === null || header === undefined) return 0;
  const s = String(header).trim();
  if (s === '') return 0;
  if (/^\d+$/.test(s)) return Math.min(Number(s), 3600);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return 0;
  return Math.min(Math.max(0, Math.ceil((t - nowMs) / 1000)), 3600);
}

// FCM 오류 분류 (https://firebase.google.com/docs/cloud-messaging/error-codes)
//  dead  = 그 토큰은 앞으로도 못 받는다(UNREGISTERED: 앱 삭제·로그아웃 unregister) → push_tokens 에서 지운다
//  retry = 잠시 뒤 다시(429·5xx·401 토큰 만료·네트워크) → next_attempt_at 백오프
//  그 외(400 INVALID_ARGUMENT·403 SENDER_ID_MISMATCH 등) = 이 알림은 이 기기에 포기하되 토큰은 지우지 않는다
//    — 페이로드 버그 하나로 모든 기기 토큰을 지우는 사고를 막는다(codex 검토). 진짜 죽은 토큰은 90일 정리가 거둔다.
export function classifyFcmError(httpStatus, bodyText, retryAfterHeader, nowMs = Date.now()) {
  let status = '';
  let code = '';
  let message = '';
  try {
    const e = JSON.parse(bodyText)?.error;
    status = String(e?.status ?? '');
    message = String(e?.message ?? '');
    const d = Array.isArray(e?.details) ? e.details.find((x) => typeof x?.errorCode === 'string') : null;
    code = d ? d.errorCode : '';
  } catch {
    /* 비JSON 응답 */
  }
  let retryAfter = parseRetryAfter(retryAfterHeader, nowMs);
  // 429(할당량 초과)는 최소 1분 뒤에 다시 — FCM 권고(https://firebase.google.com/docs/cloud-messaging/error-codes)
  if (httpStatus === 429) retryAfter = Math.max(retryAfter, 60);
  const dead = code === 'UNREGISTERED';
  const retry = !dead && (httpStatus === 0 || httpStatus === 401 || httpStatus === 429 || httpStatus >= 500);
  const error = `${httpStatus} ${code || status || 'ERROR'} ${message}`.trim().slice(0, 300);
  return { dead, retry, retryAfter, error };
}

// 알림 1건의 기기별 결과 → push_outbox_finish 에 넘길 값.
//  sent_tokens     = 이번에 성공한 기기(통계용)
//  finished_tokens = 이 알림에 대해 끝난 기기(성공 + 영구 실패) — done_tokens 에 쌓여 다음 재시도 때 빠진다.
//                    한 기기 성공·다른 기기 일시 실패면 실패한 기기만 다시 보내고, 400 같은 영구 실패 기기는 다시 안 보낸다(codex 검토).
//  done = 다시 보낼 기기가 없으면 true(성공이든 영구 실패든 처리 끝)
//  결과가 없는 기기(시간이 모자라 못 보낸 경우)는 재시도로 본다.
export function summarizeRow(row, outcomes) {
  const tokens = Array.isArray(row.tokens) ? row.tokens : [];
  const deadTokens = [];
  if (tokens.length === 0) {
    return { result: { id: row.id, sent_tokens: [], finished_tokens: [], done: true, error: 'no_tokens', retry_after: 0 }, deadTokens };
  }
  const sentTokens = [];
  const closedTokens = [];
  let retryable = false;
  let retryAfter = 0;
  let error = null;
  for (const token of tokens) {
    const o = outcomes?.get(token) ?? { ok: false, dead: false, retry: true, retryAfter: 0, error: 'not_sent' };
    if (o.ok) {
      sentTokens.push(token);
      continue;
    }
    if (error === null) error = o.error;
    if (o.dead) deadTokens.push(token);
    else if (o.retry) {
      retryable = true;
      retryAfter = Math.max(retryAfter, o.retryAfter || 0);
    } else closedTokens.push(token);
  }
  return {
    result: { id: row.id, sent_tokens: sentTokens, finished_tokens: [...sentTokens, ...closedTokens], done: !retryable, error, retry_after: retryAfter },
    deadTokens,
  };
}
