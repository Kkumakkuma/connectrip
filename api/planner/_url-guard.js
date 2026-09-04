// 사용자가 붙여 넣은 URL 을 서버가 대신 가져올 때의 방어벽 (설계 §4 codex-14).
//
// 이 리포지토리에서 "사용자 입력 URL 을 서버가 fetch" 하는 건 이 경로가 처음이다.
// 기존 api/*.js 6개는 전부 고정 호스트(포트원·Resend·Solapi)만 부르므로 재사용할 가드가 없다.
// 단축 URL(maps.app.goo.gl) 추적이 설계상 필수라 리다이렉트를 따라가야 하고, 그래서
// **홉마다** 정적 검사 + DNS 검사를 다시 통과시킨다. 한 번만 검사하면 302 로 사설망에 들어간다.
//
// 막는 것
//   · http, file, gopher 등 https 아닌 스킴
//   · userinfo — https://blog.naver.com@evil.example 은 실제로 evil.example 에 붙는다
//   · 비표준 포트, IP 리터럴(IPv4/IPv6), 트레일링 닷(blog.naver.com.)
//   · 화이트리스트 밖 호스트, 그리고 호스트별 경로 화이트리스트(google.com 은 /maps 만 —
//     /url 은 오픈 리다이렉트다)
//   · 사설·특수 대역으로 해석되는 이름(A/AAAA 중 하나라도 사설이면 전체 거부)
//   · DNS 리바인딩 — 검사에 쓴 IP 로만 접속하고 Host/SNI 는 원 호스트를 유지한다
//   · 본문 1MB 초과, 허용 밖 content-type, 압축 폭탄(Accept-Encoding: identity)
//
// 실패 사유는 밖으로 내보내지 않는다. 호출부는 고정 코드 하나만 사용자에게 보여 준다.

import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 1024 * 1024; // 1MB
export const DEADLINE_MS = 8000;

// 호스트 → 허용 경로 접두사. 빈 배열이면 경로 제한 없음.
const HOST_RULES = new Map([
  ['blog.naver.com', []],
  ['m.blog.naver.com', []],
  ['maps.app.goo.gl', []],
  ['goo.gl', ['/maps']],
  ['maps.google.com', []],
  ['www.google.com', ['/maps']],
  ['google.com', ['/maps']],
  ['www.google.co.kr', ['/maps']],
  ['google.co.kr', ['/maps']],
]);

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
];

export class GuardError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'GuardError';
    this.reason = reason; // 로그용. 사용자 응답에는 절대 싣지 않는다.
  }
}

// IPv4 사설·특수 대역
function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                                   // 0.0.0.0/8
  if (a === 10) return true;                                  // 10/8
  if (a === 127) return true;                                 // 루프백
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                    // 링크로컬(클라우드 메타데이터)
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12
  if (a === 192 && (b === 168 || b === 0 || b === 88)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0) return true;                      // 203.0.113/24 문서용
  if (a >= 224) return true;                                  // 멀티캐스트·예약
  return false;
}

function isPrivateV6(ip) {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  // IPv4-mapped / IPv4-compatible 는 v4 규칙으로 다시 판정한다.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateV4(mapped[1]);
  if (/^fe[89ab]/.test(v)) return true;    // fe80::/10 링크로컬
  if (/^f[cd]/.test(v)) return true;       // fc00::/7 유니크 로컬
  if (v.startsWith('2002:')) return true;  // 6to4
  if (v.startsWith('64:ff9b:')) return true;
  if (v.startsWith('100:')) return true;   // discard-only
  if (v.startsWith('ff')) return true;     // 멀티캐스트
  return false;
}

export function isPrivateAddress(ip, family) {
  if (family === 4 || net.isIPv4(ip)) return isPrivateV4(ip);
  return isPrivateV6(ip);
}

/** 정적 검사. 통과하면 URL 객체를 돌려준다. */
export function parseTarget(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new GuardError('unparsable');
  }
  if (u.protocol !== 'https:') throw new GuardError('scheme');
  if (u.username || u.password) throw new GuardError('userinfo');
  if (u.port && u.port !== '443') throw new GuardError('port');

  const host = u.hostname.toLowerCase();
  if (!host || host.endsWith('.')) throw new GuardError('trailing-dot');
  if (net.isIP(host) !== 0) throw new GuardError('ip-literal');
  if (host.startsWith('[')) throw new GuardError('ip-literal');
  // 퍼센트 인코딩이 섞인 호스트는 브라우저와 해석이 갈린다.
  if (host.includes('%')) throw new GuardError('encoded-host');

  const rules = HOST_RULES.get(host);
  if (!rules) throw new GuardError('host');
  if (rules.length && !rules.some((prefix) => u.pathname === prefix || u.pathname.startsWith(`${prefix}/`))) {
    throw new GuardError('path');
  }
  return u;
}

/** DNS 해석. A/AAAA 중 하나라도 사설이면 전체 거부. 통과하면 접속에 쓸 IP 하나를 고른다. */
export async function resolvePublic(host) {
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new GuardError('dns');
  }
  if (!addrs.length) throw new GuardError('dns-empty');
  for (const a of addrs) {
    if (isPrivateAddress(a.address, a.family)) throw new GuardError('private-ip');
  }
  return addrs[0];
}

function contentTypeAllowed(value) {
  const ct = String(value || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(ct);
}

// 해석해 둔 IP 로만 접속한다. Host 헤더와 SNI 는 원 호스트를 유지하므로 TLS 검증도 정상이다.
function requestOnce(url, pinned, deadlineAt) {
  return new Promise((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return reject(new GuardError('deadline'));

    const req = https.request(
      {
        protocol: 'https:',
        host: url.hostname,
        servername: url.hostname, // SNI
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: Math.min(remaining, DEADLINE_MS),
        headers: {
          // 압축 폭탄 차단. 본문 상한이 압축 해제 후 기준이면 의미가 없어진다.
          'Accept-Encoding': 'identity',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'ConnectTrip-Planner/1.0 (+https://www.connecttrip.co.kr)',
          'Accept-Language': 'ko,en;q=0.8',
        },
        // 이 lookup 이 DNS 리바인딩을 막는다 — 검사에 쓴 주소를 그대로 돌려준다.
        lookup: (_host, _opts, cb) => cb(null, pinned.address, pinned.family),
      },
      (resp) => {
        const status = resp.statusCode || 0;
        const location = resp.headers.location;
        if (status >= 300 && status < 400 && location) {
          resp.resume(); // 본문 버림
          return resolve({ redirect: String(location) });
        }
        if (status !== 200) {
          resp.resume();
          return reject(new GuardError(`status-${status}`));
        }
        if (!contentTypeAllowed(resp.headers['content-type'])) {
          resp.resume();
          return reject(new GuardError('content-type'));
        }
        const declared = Number(resp.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BYTES) {
          resp.resume();
          return reject(new GuardError('too-large'));
        }

        const chunks = [];
        let size = 0;
        resp.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            resp.destroy();
            reject(new GuardError('too-large'));
            return;
          }
          chunks.push(chunk);
        });
        resp.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), url: url.href }));
        resp.on('error', () => reject(new GuardError('stream')));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new GuardError('timeout'));
    });
    req.on('error', () => reject(new GuardError('network')));
    req.end();
  });
}

/**
 * 검사를 통과한 URL 만 가져온다. 리다이렉트는 홉마다 전 검사를 다시 통과해야 한다.
 * @returns {{ body: string, url: string }}
 */
export async function guardedGet(rawUrl) {
  const deadlineAt = Date.now() + DEADLINE_MS;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = parseTarget(current);          // 홉마다 정적 검사
    const pinned = await resolvePublic(url.hostname); // 홉마다 DNS 검사
    const out = await requestOnce(url, pinned, deadlineAt);
    if (!out.redirect) return out;
    // 상대 경로 Location 도 절대 URL 로 만들어 다음 홉 검사를 받게 한다.
    current = new URL(out.redirect, url).href;
  }
  throw new GuardError('too-many-redirects');
}
