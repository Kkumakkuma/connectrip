import { describe, expect, it } from 'vitest';
import { ACCENT, SECRET_RE, TTL_SECONDS, buildMessage, classifyFcmError, isInternalLink, parseRetryAfter, safeEqual, summarizeRow } from './core.js';

const T0 = Date.parse('2026-09-27T03:00:00Z');
const row = (over = {}) => ({ id: 42, claim_id: 'c1', title: '커넥트립', body: '새 쪽지가 도착했습니다', link: '/messages', created_at: '2026-09-27T03:00:00Z', tokens: ['tA', 'tB'], ...over });
const fcmErr = (status, code, message = 'x') => JSON.stringify({
  error: { code: 0, status, message, details: code ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] : [] },
});

describe('push-send core', () => {
  it('비밀 비교: 같은 값만 참, 길이 다름·빈 값·문자열 아님은 거짓', () => {
    const s = 'a'.repeat(64);
    expect(safeEqual(s, s)).toBe(true);
    expect(safeEqual(s, `${'a'.repeat(63)}b`)).toBe(false);
    expect(safeEqual(s, 'a'.repeat(63))).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, s)).toBe(false);
    expect(SECRET_RE.test('0123456789abcdef'.repeat(4))).toBe(true);
    expect(SECRET_RE.test('0123456789ABCDEF'.repeat(4))).toBe(false);
    expect(SECRET_RE.test('abc')).toBe(false);
  });

  it('내부 링크만 싣는다 — 앱 isSafeInternalLink 와 같은 기준', () => {
    expect(isInternalLink('/chat/123')).toBe(true);
    expect(isInternalLink('https://evil.example')).toBe(false);
    expect(isInternalLink('//evil.example')).toBe(false);
    expect(isInternalLink('/\\evil.example')).toBe(false);
    expect(isInternalLink(null)).toBe(false);
    expect(isInternalLink(`/${'a'.repeat(600)}`)).toBe(false);
  });

  it('FCM 메시지: 문구·채널·아이콘·색·중복 덮어쓰기 tag·HIGH·TTL, data 는 전부 문자열', () => {
    const m = buildMessage(row(), 'tA', T0);
    expect(m.token).toBe('tA');
    expect(m.notification).toEqual({ title: '커넥트립', body: '새 쪽지가 도착했습니다' });
    expect(m.data).toEqual({ outbox_id: '42', link: '/messages' });
    expect(m.android.priority).toBe('HIGH');
    expect(m.android.ttl).toBe(`${TTL_SECONDS}s`);
    expect(m.android.notification).toEqual({ channel_id: 'default', icon: 'ic_stat_notify', color: ACCENT, tag: 'ct-42' });
    for (const v of Object.values(m.data)) expect(typeof v).toBe('string');
  });

  it('링크가 없거나 외부면 data.link 를 빼고(null 금지), 오래된 알림은 TTL 을 줄인다(최소 60초)', () => {
    expect(buildMessage(row({ link: null }), 'tA', T0).data).toEqual({ outbox_id: '42' });
    expect(buildMessage(row({ link: 'https://x.example' }), 'tA', T0).data).toEqual({ outbox_id: '42' });
    expect(buildMessage(row(), 'tA', T0 + 1000 * 1000).android.ttl).toBe(`${TTL_SECONDS - 1000}s`);
    expect(buildMessage(row(), 'tA', T0 + 1000 * 1000 * 1000).android.ttl).toBe('60s');
    expect(buildMessage(row({ created_at: 'garbage' }), 'tA', T0).android.ttl).toBe(`${TTL_SECONDS}s`);
  });

  it('오류 분류: UNREGISTERED 만 토큰 삭제, 429·5xx·401·네트워크는 재시도, 400·403 은 포기(토큰 유지)', () => {
    expect(classifyFcmError(404, fcmErr('NOT_FOUND', 'UNREGISTERED'), null)).toMatchObject({ dead: true, retry: false });
    expect(classifyFcmError(404, fcmErr('NOT_FOUND', ''), null)).toMatchObject({ dead: false, retry: false });
    expect(classifyFcmError(400, fcmErr('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'), null))
      .toMatchObject({ dead: false, retry: false });
    expect(classifyFcmError(403, fcmErr('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), null)).toMatchObject({ dead: false, retry: false });
    expect(classifyFcmError(429, fcmErr('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), '30')).toMatchObject({ dead: false, retry: true, retryAfter: 60 });
    expect(classifyFcmError(429, fcmErr('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), '120')).toMatchObject({ retryAfter: 120 });
    expect(classifyFcmError(503, fcmErr('UNAVAILABLE', 'UNAVAILABLE'), '99999')).toMatchObject({ retry: true, retryAfter: 3600 });
    expect(classifyFcmError(401, fcmErr('UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR'), null)).toMatchObject({ retry: true });
    expect(classifyFcmError(500, '<html>oops</html>', 'garbage')).toMatchObject({ dead: false, retry: true, retryAfter: 0 });
    expect(classifyFcmError(0, '', null)).toMatchObject({ retry: true });
    expect(classifyFcmError(404, fcmErr('NOT_FOUND', 'UNREGISTERED', 'Requested entity was not found.'), null).error)
      .toBe('404 UNREGISTERED Requested entity was not found.');
  });

  it('Retry-After: 초 숫자·HTTP 날짜 둘 다 읽고, 지난 날짜·쓰레기 값은 0, 최대 1시간', () => {
    expect(parseRetryAfter('45', T0)).toBe(45);
    expect(parseRetryAfter(new Date(T0 + 90 * 1000).toUTCString(), T0)).toBe(90);
    expect(parseRetryAfter(new Date(T0 - 90 * 1000).toUTCString(), T0)).toBe(0);
    expect(parseRetryAfter(new Date(T0 + 5 * 3600 * 1000).toUTCString(), T0)).toBe(3600);
    expect(parseRetryAfter('soon', T0)).toBe(0);
    expect(parseRetryAfter(null, T0)).toBe(0);
    expect(classifyFcmError(503, fcmErr('UNAVAILABLE', 'UNAVAILABLE'), new Date(T0 + 30 * 1000).toUTCString(), T0).retryAfter).toBe(30);
  });

  it('행 결과: 토큰 없음 → 끝(no_tokens)', () => {
    expect(summarizeRow(row({ tokens: [] }), new Map()).result)
      .toEqual({ id: 42, sent_tokens: [], finished_tokens: [], done: true, error: 'no_tokens', retry_after: 0 });
  });

  it('행 결과: 한 기기 성공 + 다른 기기 일시 실패 → 성공 기기는 끝난 목록에, 실패 기기만 재시도', () => {
    const o = new Map([['tA', { ok: true }], ['tB', { ok: false, dead: false, retry: true, retryAfter: 20, error: '503 UNAVAILABLE' }]]);
    const { result, deadTokens } = summarizeRow(row(), o);
    expect(result).toEqual({ id: 42, sent_tokens: ['tA'], finished_tokens: ['tA'], done: false, error: '503 UNAVAILABLE', retry_after: 20 });
    expect(deadTokens).toEqual([]);
  });

  it('행 결과: 영구 실패(400) 기기 + 일시 실패 기기 → 영구 실패 기기는 끝난 목록에 넣어 다시 안 보낸다', () => {
    const o = new Map([
      ['tA', { ok: false, dead: false, retry: false, retryAfter: 0, error: '400 INVALID_ARGUMENT' }],
      ['tB', { ok: false, dead: false, retry: true, retryAfter: 0, error: '503 UNAVAILABLE' }],
    ]);
    expect(summarizeRow(row(), o).result).toMatchObject({ sent_tokens: [], finished_tokens: ['tA'], done: false, error: '400 INVALID_ARGUMENT' });
  });

  it('행 결과: 성공 + 죽은 토큰 → 끝, 죽은 토큰은 삭제 목록 / 전부 영구 실패 → 끝(오류 기록)', () => {
    const a = summarizeRow(row(), new Map([['tA', { ok: true }], ['tB', { ok: false, dead: true, retry: false, retryAfter: 0, error: '404 UNREGISTERED' }]]));
    expect(a.result).toMatchObject({ sent_tokens: ['tA'], finished_tokens: ['tA'], done: true, error: '404 UNREGISTERED' });
    expect(a.deadTokens).toEqual(['tB']);
    const bad = { ok: false, dead: false, retry: false, retryAfter: 0, error: '400 INVALID_ARGUMENT' };
    const b = summarizeRow(row(), new Map([['tA', bad], ['tB', bad]]));
    expect(b.result).toMatchObject({ sent_tokens: [], finished_tokens: ['tA', 'tB'], done: true, error: '400 INVALID_ARGUMENT' });
    expect(b.deadTokens).toEqual([]);
  });

  it('행 결과: 시간이 모자라 못 보낸 기기는 재시도로 남긴다', () => {
    const { result } = summarizeRow(row(), new Map([['tA', { ok: true }]]));
    expect(result).toMatchObject({ sent_tokens: ['tA'], finished_tokens: ['tA'], done: false, error: 'not_sent' });
  });
});
