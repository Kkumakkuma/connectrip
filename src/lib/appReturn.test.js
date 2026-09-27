// 앱 밖에서 끝나는 외부 흐름(PASS 본인확인·결제)의 복귀 주소(2026-09-27 PASS 복귀 실패 수정).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
