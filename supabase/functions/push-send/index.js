// 앱 푸시 발송기 (Supabase Edge Function, 2026-09-27) — push_outbox 대기열을 FCM HTTP v1 으로 보낸다.
// 부르는 곳: DB push_kick()(pg_net, 트랜잭션당 1번) · 매분 push-sweep(cron). 배포는 verify_jwt=false —
//   대신 x-push-secret 헤더를 Vault 의 push_worker_secret 과 비교해 인증한다(형식이 틀리면 DB 도 안 건드리고 거절).
// 순수 로직은 core.js(단위 테스트 core.test.js). SQL 짝: src/lib/push_worker_20260927.sql
import { SECRET_RE, buildMessage, classifyFcmError, safeEqual, summarizeRow } from './core.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// 서비스 계정 JSON 의 token_uri 는 쓰지 않고 목적지를 고정한다(codex 검토).
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const RUN_BUDGET_MS = 25000;   // 한 번 호출이 일하는 최대 시간 — 점유 기한(120초)보다 충분히 짧게
const FINISH_RESERVE_MS = 5000;   // 결과 기록(finish)할 시간은 남겨 둔다 — 그 뒤로는 새 발송을 시작하지 않는다(codex 검토)
const CLAIM_BATCH = 20;
const LEASE_SECONDS = 120;
const SEND_TIMEOUT_MS = 8000;
const CONCURRENCY = 8;
const MAX_TOKENS_PER_ROW = 10;   // 한 번에 한 회원 기기 10대까지 — 나머지는 '못 보냄'으로 남아 다음 차례에 보낸다
const CONFIG_TTL_MS = 60000;   // 비밀을 바꾸면 최대 1분 뒤 반영

let cfgCache = null;     // { at, secret, sa }
let oauthCache = null;   // { token, exp, email }

function restHeaders() {
  const h = { apikey: SERVICE_KEY, 'Content-Type': 'application/json' };
  if (SERVICE_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SERVICE_KEY}`;   // 옛 JWT 형식 키만 Bearer 로 붙인다
  return h;
}

function timeLeft(deadline, cap) {
  return Math.max(1000, Math.min(cap, deadline - Date.now()));
}

async function rpc(name, args, deadline) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(timeLeft(deadline, 10000)),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function loadConfig() {
  if (cfgCache && Date.now() - cfgCache.at < CONFIG_TTL_MS) return cfgCache;
  const c = await rpc('push_worker_config', {}, Date.now() + 10000);
  let sa = null;
  try {
    const j = c?.fcm_sa ? JSON.parse(c.fcm_sa) : null;
    if (j && typeof j.project_id === 'string' && typeof j.client_email === 'string' && typeof j.private_key === 'string') sa = j;
  } catch {
    sa = null;
  }
  cfgCache = { at: Date.now(), secret: typeof c?.secret === 'string' ? c.secret : '', sa };
  return cfgCache;
}

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 서비스 계정 키로 서명한 JWT 를 구글 OAuth 토큰(1시간)으로 바꾼다. 만료 2분 전까지 재사용.
async function accessToken(sa, deadline) {
  const now = Math.floor(Date.now() / 1000);
  if (oauthCache && oauthCache.email === sa.client_email && oauthCache.exp - 120 > now) return oauthCache.token;
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600 })));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claim}`)));
  const r = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(timeLeft(deadline, 10000)),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || typeof j?.access_token !== 'string') throw new Error(`oauth ${r.status} ${String(j?.error ?? '')}`);
  oauthCache = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600), email: sa.client_email };
  return j.access_token;
}

async function sendOne(sa, at, row, token, deadline) {
  let r;
  try {
    r = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: buildMessage(row, token) }),
      signal: AbortSignal.timeout(timeLeft(deadline, SEND_TIMEOUT_MS)),
    });
  } catch (e) {
    return { ok: false, ...classifyFcmError(0, '', null), error: `network ${String(e?.name ?? e)}`.slice(0, 120) };
  }
  if (r.ok) {
    await r.body?.cancel();
    return { ok: true };
  }
  const text = await r.text().catch(() => '');
  if (r.status === 401) oauthCache = null;   // OAuth 토큰 만료 — 다음 시도에 새로 받는다
  return { ok: false, ...classifyFcmError(r.status, text, r.headers.get('retry-after')) };
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function drain(sa) {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const stats = { claimed: 0, finished: 0, retry_later: 0, delivered: 0, dead_tokens: 0 };
  // OAuth 를 못 받으면 아무것도 점유하지 않고 끝난다(점유만 하고 실패해 시도 횟수를 날리지 않게).
  const at = await accessToken(sa, deadline);
  // 한 묶음(보내기 + 기록)을 끝낼 여유가 있을 때만 새로 점유한다.
  while (deadline - Date.now() > SEND_TIMEOUT_MS + FINISH_RESERVE_MS) {
    const rows = await rpc('push_outbox_claim', { p_limit: CLAIM_BATCH, p_lease_seconds: LEASE_SECONDS }, deadline);
    if (!Array.isArray(rows) || rows.length === 0) break;
    stats.claimed += rows.length;
    const outcomes = new Map(rows.map((row) => [row.id, new Map()]));
    const jobs = rows.flatMap((row) => (Array.isArray(row.tokens) ? row.tokens.slice(0, MAX_TOKENS_PER_ROW) : []).map((token) => ({ row, token })));
    await pool(jobs, CONCURRENCY, async ({ row, token }) => {
      // 마감이 가까우면 새 발송을 시작하지 않는다 — 결과가 없는 기기는 summarizeRow 가 '못 보냄(재시도)'으로 남긴다.
      if (deadline - Date.now() < FINISH_RESERVE_MS) return;
      outcomes.get(row.id).set(token, await sendOne(sa, at, row, token, deadline));
    });
    const results = [];
    const dead = new Set();
    for (const row of rows) {
      const { result, deadTokens } = summarizeRow(row, outcomes.get(row.id));
      results.push(result);
      for (const t of deadTokens) dead.add(t);
      if (result.done) stats.finished += 1;
      else stats.retry_later += 1;
      if (result.sent_tokens.length > 0) stats.delivered += 1;
    }
    stats.dead_tokens += dead.size;
    const recorded = await rpc('push_outbox_finish', { p_claim: rows[0].claim_id, p_results: results, p_dead_tokens: [...dead] }, Date.now() + 10000);
    // 기록된 행이 모자라면 점유 기한이 지나 다른 호출이 가져간 것 — 그 행은 그쪽이 처리한다(중복은 tag 로 알림창에서 덮어씀).
    if (recorded !== rows.length) console.warn('push-send finish mismatch', JSON.stringify({ recorded, claimed: rows.length }));
    if (rows.length < CLAIM_BATCH) break;
  }
  return stats;
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const got = req.headers.get('x-push-secret') ?? '';
  if (!SECRET_RE.test(got)) return json({ error: 'unauthorized' }, 401);
  let cfg;
  try {
    cfg = await loadConfig();
  } catch (e) {
    console.error('push-send config', String(e).slice(0, 200));
    return json({ error: 'config_unavailable' }, 503);
  }
  if (!safeEqual(got, cfg.secret)) return json({ error: 'unauthorized' }, 401);
  if (!cfg.sa) return json({ error: 'not_configured' }, 503);
  const work = drain(cfg.sa)
    .then((s) => {
      console.log('push-send', JSON.stringify(s));
      return s;
    })
    .catch((e) => {
      console.error('push-send drain', String(e).slice(0, 300));
      return { error: 'drain_failed' };
    });
  // 점검용(?wait=1): 끝까지 기다려 결과를 돌려준다. 평소엔 바로 202 로 답하고 뒤에서 마저 보낸다(pg_net 은 응답을 기다리지 않는다).
  if (new URL(req.url).searchParams.get('wait') === '1') return json(await work, 200);
  EdgeRuntime.waitUntil(work);
  return json({ accepted: true }, 202);
});
