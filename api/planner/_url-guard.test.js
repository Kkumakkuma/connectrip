import { describe, it, expect } from 'vitest';
import { GuardError, isPrivateAddress, parseTarget } from './_url-guard.js';
import { extractGoogleFromUrl, extractNaver } from './extract-links.js';

function reasonOf(url) {
  try {
    parseTarget(url);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    return e.reason;
  }
}

describe('parseTarget — 정적 검사', () => {
  it('허용 호스트의 https 는 통과한다', () => {
    expect(parseTarget('https://m.blog.naver.com/PostView.naver?blogId=x&logNo=1').hostname)
      .toBe('m.blog.naver.com');
    expect(parseTarget('https://maps.app.goo.gl/abcd1234').hostname).toBe('maps.app.goo.gl');
  });

  it('http 는 거부한다', () => {
    expect(reasonOf('http://blog.naver.com/x')).toBe('scheme');
  });

  it('userinfo 로 호스트를 속이는 형태를 거부한다', () => {
    // 브라우저·서버 모두 실제로는 @ 뒤 호스트에 붙는다. 둘 다 거부돼야 하고,
    // 어느 검사에서 걸리는지는 검사 순서(userinfo 가 host 보다 먼저)를 따른다.
    expect(reasonOf('https://blog.naver.com@evil.example/x')).toBe('userinfo');
    expect(reasonOf('https://evil.example@blog.naver.com/x')).toBe('userinfo');
  });

  it('비표준 포트를 거부한다', () => {
    expect(reasonOf('https://blog.naver.com:8443/x')).toBe('port');
  });

  it('IP 리터럴을 거부한다', () => {
    // 화이트리스트보다 먼저 걸린다 — 클라우드 메타데이터 주소가 대표적인 표적이다.
    expect(reasonOf('https://169.254.169.254/latest/meta-data/')).toBe('ip-literal');
    expect(reasonOf('https://[::1]/x')).toBe('ip-literal');
  });

  it('트레일링 닷으로 화이트리스트를 우회하지 못한다', () => {
    expect(reasonOf('https://blog.naver.com./x')).toBe('trailing-dot');
  });

  it('화이트리스트 밖 호스트를 거부한다', () => {
    expect(reasonOf('https://evil.example/x')).toBe('host');
    expect(reasonOf('https://naver.com.evil.example/x')).toBe('host');
  });

  it('google.com 은 /maps 경로만 허용한다 — /url 은 오픈 리다이렉트다', () => {
    expect(parseTarget('https://www.google.com/maps/place/x').pathname).toContain('/maps');
    expect(reasonOf('https://www.google.com/url?q=https://evil.example')).toBe('path');
    // /mapsomething 처럼 접두사만 같은 경로도 막는다
    expect(reasonOf('https://www.google.com/mapsevil')).toBe('path');
  });

  it('파싱 불가한 문자열을 거부한다', () => {
    expect(reasonOf('not a url')).toBe('unparsable');
    expect(reasonOf('')).toBe('unparsable');
  });
});

describe('isPrivateAddress — 사설·특수 대역', () => {
  const priv = [
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.0.2.1', '192.88.99.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  ];
  it.each(priv)('%s 는 사설로 본다', (ip) => {
    expect(isPrivateAddress(ip, 4)).toBe(true);
  });

  const pub = ['8.8.8.8', '1.1.1.1', '223.130.200.104', '172.32.0.1', '11.0.0.1'];
  it.each(pub)('%s 는 공인으로 본다', (ip) => {
    expect(isPrivateAddress(ip, 4)).toBe(false);
  });

  it('IPv6 사설·특수 대역을 막는다', () => {
    ['::', '::1', 'fe80::1', 'fc00::1', 'fd12::1', '2002::1', '64:ff9b::1', 'ff02::1']
      .forEach((ip) => expect(isPrivateAddress(ip, 6)).toBe(true));
  });

  it('IPv4-mapped IPv6 는 v4 규칙으로 다시 판정한다', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254', 6)).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8', 6)).toBe(false);
  });

  it('공인 IPv6 는 통과시킨다', () => {
    expect(isPrivateAddress('2001:4860:4860::8888', 6)).toBe(false);
  });
});

describe('extractNaver', () => {
  it('지도 모듈의 data-linkdata 에서 좌표를 뽑는다', () => {
    const html = `<div class="se-module-map" data-linkdata="{&quot;name&quot;:&quot;경복궁&quot;,&quot;address&quot;:&quot;서울 종로구&quot;,&quot;latitude&quot;:37.5796,&quot;longitude&quot;:126.9770}"></div>`;
    expect(extractNaver(html)).toEqual([
      { name: '경복궁', address: '서울 종로구', lat: 37.5796, lng: 126.977, source: 'naver-blog' },
    ]);
  });

  it('좌표가 없는 모듈(링크 카드 등)은 건너뛴다', () => {
    const html = `<div data-linkdata="{&quot;title&quot;:&quot;그냥 링크&quot;,&quot;url&quot;:&quot;https://x&quot;}"></div>`;
    expect(extractNaver(html)).toEqual([]);
  });

  it('같은 좌표가 여러 번 나와도 하나만 담는다', () => {
    const one = `<div data-linkdata="{&quot;name&quot;:&quot;A&quot;,&quot;latitude&quot;:37.1,&quot;longitude&quot;:127.1}"></div>`;
    expect(extractNaver(one + one + one)).toHaveLength(1);
  });

  it('깨진 JSON 은 조용히 건너뛴다', () => {
    expect(extractNaver('<div data-linkdata="{not json}"></div>')).toEqual([]);
  });
});

describe('extractGoogleFromUrl', () => {
  it('!3d/!4d 핀 좌표를 우선한다', () => {
    const url = 'https://www.google.com/maps/place/x/@37.1,127.1,17z/data=!3d37.5665!4d126.9780';
    const got = extractGoogleFromUrl(url, '<title>남산타워 - Google 지도</title>');
    expect(got).toEqual([{ name: '남산타워', address: '', lat: 37.5665, lng: 126.978, source: 'google-maps' }]);
  });

  it('핀이 없으면 q= 좌표를 쓴다', () => {
    const got = extractGoogleFromUrl('https://maps.google.com/?q=37.5,127.5', '');
    expect(got[0].lat).toBe(37.5);
    expect(got[0].lng).toBe(127.5);
  });

  it('그래도 없으면 지도 중심(@)을 마지막으로 쓴다', () => {
    const got = extractGoogleFromUrl('https://www.google.com/maps/@35.5,128.5,15z', '');
    expect(got[0].lat).toBe(35.5);
  });

  it('좌표가 하나도 없으면 빈 배열', () => {
    expect(extractGoogleFromUrl('https://www.google.com/maps/place/x', '')).toEqual([]);
  });

  it('범위 밖 좌표는 버린다', () => {
    expect(extractGoogleFromUrl('https://maps.google.com/?q=99.9,200.1', '')).toEqual([]);
  });
});
