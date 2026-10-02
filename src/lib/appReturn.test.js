// 앱 밖에서 끝나는 외부 흐름(PASS 본인확인·결제)의 복귀 주소(2026-09-27 PASS 복귀 실패 수정).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN } from './api';
import { APP_RETURN_PATH_RE, appReturnTarget, externalReturnUrl, isAppReturnPath } from './appReturn';

describe('externalReturnUrl', () => {
  it('웹은 지금처럼 자기 주소로 돌아온다', () => {
    const sp = new URLSearchParams({ flow: 'identity', state: 'abc' });
    expect(externalReturnUrl('/find-id', sp, { native: false, origin: 'https://www.connecttrip.co.kr' }))
      .toBe('https://www.connecttrip.co.kr/find-id?flow=identity&state=abc');
  });
  it('앱은 localhost 가 아니라 사이트 다리 페이지로 — 경로는 to, 나머지 쿼리는 그대로', () => {
    const sp = new URLSearchParams({ type: 'crew', flow: 'identity', state: 'abc' });
    const url = externalReturnUrl('/signup', sp, { native: true });
    expect(url.startsWith('https://www.connecttrip.co.kr/app-return.html?')).toBe(true);
    expect(url).not.toContain('localhost');
    const u = new URL(url);
    expect(u.searchParams.get('to')).toBe('/signup');
    expect(u.searchParams.get('type')).toBe('crew');
    expect(u.searchParams.get('state')).toBe('abc');
  });

  // 2026-10-02 C8(codex #11): 앱인데 허용 목록 밖 경로면 다리(to 를 버린다) 대신 공개 사이트 주소.
  // 앱 WebView 의 window.location.origin(https://localhost)을 흉내 내 그 값이 새어 나오지 않는지 본다.
  describe('앱 + 허용 목록 밖 경로', () => {
    beforeEach(() => {
      vi.stubGlobal('window', { location: { origin: 'https://localhost', href: 'https://localhost/__paytest' } });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('공개 사이트 주소(SITE_ORIGIN + 경로 + 쿼리) — localhost 도 다리 주소도 아니다', () => {
      expect(SITE_ORIGIN).toBe('https://www.connecttrip.co.kr');
      // 흉내가 실제로 먹혔는지: 웹 분기는 그대로 window.location.origin 을 쓴다
      expect(externalReturnUrl('/__paytest', 'flow=charge', { native: false })).toBe('https://localhost/__paytest?flow=charge');

      const sp = new URLSearchParams({ flow: 'charge' });
      const url = externalReturnUrl('/__paytest', sp, { native: true });
      expect(url).toBe('https://www.connecttrip.co.kr/__paytest?flow=charge');
      expect(url).not.toContain('localhost');
      expect(externalReturnUrl('/__paytest', null, { native: true })).toBe('https://www.connecttrip.co.kr/__paytest');
      expect(externalReturnUrl('/admin', { a: '1', b: '/x y' }, { native: true })).toBe('https://www.connecttrip.co.kr/admin?a=1&b=%2Fx+y');
    });
    it('허용 경로는 지금처럼 다리 주소', () => {
      expect(externalReturnUrl('/mypage', new URLSearchParams({ flow: 'charge' }), { native: true }))
        .toBe('https://www.connecttrip.co.kr/app-return.html?to=%2Fmypage&flow=charge');
      for (const p of ['/find-id', '/forgot-password', '/signup', '/signup/complete', '/points']) {
        const u = new URL(externalReturnUrl(p, 'flow=identity&state=abc', { native: true }));
        expect(u.origin + u.pathname).toBe('https://www.connecttrip.co.kr/app-return.html');
        expect(u.searchParams.get('to')).toBe(p);
        expect(u.searchParams.get('state')).toBe('abc');
      }
    });
    it("'/' 로 시작하지 않는 값은 호스트를 못 바꾼다 — 예전처럼 다리 주소(다리가 to 를 버린다)", () => {
      for (const p of ['@evil.example', '.evil.example', ':443@evil.example', 'evil.example/x', '', undefined]) {
        const u = new URL(externalReturnUrl(p, 'x=1', { native: true }));
        expect(u.host).toBe('www.connecttrip.co.kr');
        expect(u.pathname).toBe('/app-return.html');
        expect(appReturnTarget(u.href)).toBeNull();
      }
      // '/' 로 시작하면 '//'·'/\' 라도 호스트는 그대로다(경로로 읽힌다)
      for (const p of ['//evil.example', '/\\evil.example']) {
        expect(new URL(externalReturnUrl(p, '', { native: true })).host).toBe('www.connecttrip.co.kr');
      }
    });
  });
});

describe('appReturnTarget', () => {
  it('다리 페이지 주소(포트원이 붙인 결과 쿼리 포함) → 앱 안 주소', () => {
    const bridge = 'https://www.connecttrip.co.kr/app-return.html?to=%2Ffind-id&flow=identity&state=s1'
      + '&identityVerificationId=ct123&identityVerificationTxId=tx-1&transactionType=IDENTITY_VERIFICATION';
    expect(appReturnTarget(bridge)).toBe('/find-id?flow=identity&state=s1&identityVerificationId=ct123'
      + '&identityVerificationTxId=tx-1&transactionType=IDENTITY_VERIFICATION');
  });
  it('connecttrip://app-return 딥링크 → 앱 안 주소', () => {
    expect(appReturnTarget('connecttrip://app-return/forgot-password?flow=identity&state=x'))
      .toBe('/forgot-password?flow=identity&state=x');
    expect(appReturnTarget('connecttrip://app-return/signup/complete')).toBe('/signup/complete');
  });
  it('허용 밖 경로·다른 도메인·다른 호스트는 거부', () => {
    expect(appReturnTarget('connecttrip://app-return/admin')).toBeNull();
    expect(appReturnTarget('connecttrip://evil/find-id')).toBeNull();
    expect(appReturnTarget('https://evil.example/app-return.html?to=/find-id')).toBeNull();
    expect(appReturnTarget('https://www.connecttrip.co.kr/app-return.html?to=https://evil.example')).toBeNull();
    expect(appReturnTarget('https://www.connecttrip.co.kr/app-return.html?to=//evil.example')).toBeNull();
    expect(appReturnTarget('https://www.connecttrip.co.kr/find-id?to=/find-id')).toBeNull();
    expect(appReturnTarget('not a url')).toBeNull();
    expect(appReturnTarget('')).toBeNull();
  });
  it('허용 경로 목록', () => {
    for (const p of ['/find-id', '/forgot-password', '/signup', '/signup/complete', '/signup/email', '/mypage', '/points']) {
      expect(isAppReturnPath(p)).toBe(true);
    }
    for (const p of ['/', '/find-id/', '/signup/../admin', '/admin', 'find-id', '/find-id?x=1']) {
      expect(isAppReturnPath(p)).toBe(false);
    }
  });
});

describe('허용 경로 목록이 세 곳(앱 JS·다리 페이지·안드로이드)에서 같다', () => {
  const src = APP_RETURN_PATH_RE.source;
  it('public/app-return.html', () => {
    const html = readFileSync(new URL('../../public/app-return.html', import.meta.url), 'utf8');
    const m = html.match(/var PATH_RE = \/(.+)\/;/);
    expect(m && m[1]).toBe(src);
  });
  it('IntentUrlPlugin.java', () => {
    const java = readFileSync(new URL('../../android/app/src/main/java/com/connecttrip/app/IntentUrlPlugin.java', import.meta.url), 'utf8');
    const m = java.match(/RETURN_PATH = Pattern\.compile\("(.+)"\);/);
    // 자바 문자열의 정규식은 슬래시를 이스케이프하지 않는다
    expect(m && m[1]).toBe(src.replace(/\\\//g, '/'));
  });
});
