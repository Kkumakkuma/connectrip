// 로그인·가입 후 복귀 경로(next) 처리.
//
// 커넥트립에는 원래 복귀 장치가 없었다 — LoginPrompt 는 /signup 으로만 보내고 Signup/SignupEmail/
// SignupComplete 는 성공 시 navigate('/') 가 하드코딩이라, "가져오기" 처럼 로그인이 필요한 동작에서
// 로그인을 마치면 하던 일이 끊긴다. 그래서 ?next=<경로> 를 붙여 보내고 여기서 검증·보관한다.
//
// 이 모듈은 앱 셸(Signup·SignupEmail·SignupComplete·ProfileCompleteGate·LoginPrompt)이 import 하므로
// src/planner/ 가 아니라 src/lib/ 에 둔다. planner 폴더에 두면 플래너를 끈 빌드에서도 planner 모듈
// 그래프가 딸려 들어와 번들 격리(vite.config.js 의 '@planner' alias 스텁)가 깨진다.

const MAX_NEXT_LENGTH = 512;

// 문자열에 제어문자가 섞였는지 검사한다.
// 브라우저는 URL 을 해석하기 전에 탭·개행(0x09, 0x0A, 0x0D)을 지우므로, 제어문자를 끼워 넣으면
// 아래 접두사 검사를 우회할 수 있다("/<TAB>/evil.example" -> "//evil.example"). 아예 거부한다.
function hasControlChar(s) {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// 오픈 리다이렉트 차단. 통과 조건 = "우리 사이트 안의 경로" 뿐이다.
//   '/planner/import?post=...' -> 통과
//   'https://evil.example'     -> 스킴이 있으므로 거부
//   '//evil.example'           -> 프로토콜 상대 URL, 브라우저가 외부로 나간다
//   '/\evil.example'           -> 브라우저가 역슬래시를 슬래시로 고쳐 '//evil.example' 이 된다
export function safeNext(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > MAX_NEXT_LENGTH) return null;
  if (hasControlChar(v)) return null;
  if (!v.startsWith('/')) return null;
  if (v.startsWith('//')) return null;
  if (v.startsWith('/\\')) return null;
  return v;
}

// 이메일 확인 메일을 거쳐 돌아오거나 ProfileCompleteGate 가 /signup/complete 로 튕기는 순간
// URL 의 next 가 한 번 끊긴다. 그 구간을 잇기 위해 짧게 보관한다.
// 세션 스토리지가 아니라 로컬 스토리지인 이유: 확인 메일 링크는 새 탭에서 열려 세션 스토리지가 갈린다.
// 대신 TTL 30분 + 1회용(takeNext 가 읽으면서 지운다)으로 수명을 짧게 묶는다.
const NEXT_KEY = 'ct_signup_next_v1';
export const NEXT_TTL_MS = 30 * 60 * 1000;

export function rememberNext(value) {
  const path = safeNext(value);
  if (!path) return null;
  try {
    localStorage.setItem(NEXT_KEY, JSON.stringify({ v: 1, path, ts: Date.now() }));
  } catch { /* 스토리지 차단 환경 — 복귀만 포기하고 가입 흐름은 그대로 진행 */ }
  return path;
}

export function peekNext() {
  try {
    const raw = localStorage.getItem(NEXT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1 || Date.now() - (saved.ts || 0) >= NEXT_TTL_MS) {
      localStorage.removeItem(NEXT_KEY);
      return null;
    }
    return safeNext(saved.path);
  } catch {
    return null;
  }
}

export function clearNext() {
  try { localStorage.removeItem(NEXT_KEY); } catch { /* noop */ }
}

// 읽으면서 지운다. 복귀는 한 번만 일어나야 한다.
export function takeNext() {
  const path = peekNext();
  clearNext();
  return path;
}

// 현재 URL 의 next 파라미터 -> 보관본 -> 홈 순으로 복귀 경로를 정한다.
// 한 화면에서 여러 경로(폼 제출 성공 / 이미 로그인 감지 / 재시도)가 각각 부르므로 호출부는 결과를
// 한 번만 계산해 재사용해야 한다 — takeNext 가 1회용이라 두 번째 호출은 '/' 가 된다.
export function resolveNext(searchValue) {
  const fromUrl = safeNext(searchValue);
  const stored = takeNext(); // URL 값이 있어도 항상 소비한다 — 보관본이 남아 나중에 엉뚱하게 튀지 않도록.
  return fromUrl || stored || '/';
}

// next 를 다음 화면 URL 로 이어 붙일 때 쓴다. 값이 없거나 안전하지 않으면 빈 문자열이라 URL 이 그대로다.
export function nextQuery(value, { first = false } = {}) {
  const path = safeNext(value);
  if (!path) return '';
  return `${first ? '?' : '&'}next=${encodeURIComponent(path)}`;
}
