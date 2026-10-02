// @vitest-environment jsdom
// 가운뎃점 앞 이음 문자(U+2060): 화면 글자엔 넣고, 입력칸·편집기엔 안 넣고, 나중에 붙는 글자도 고치고, 복사할 땐 뺀다.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN } from './api';
import { startKeepMiddot } from './keepMiddot';

// 복사 HTML 의 주소 기준이 웹·앱에서 다르다(앱 = 공개 사이트 주소) — 앱 여부만 바꿔 가며 본다.
const nativeFlag = vi.hoisted(() => ({ value: false }));
vi.mock('./native', () => ({ isNativeApp: () => nativeFlag.value }));

const WJ = '\u2060';
const META = '<meta charset="utf-8">';
let stop = () => {};
beforeEach(() => { nativeFlag.value = false; });
afterEach(() => { stop(); document.body.innerHTML = ''; window.history.replaceState(null, '', '/'); });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('keepMiddot', () => {
  it('화면 글자의 · 앞에만 넣고(공백 뒤·이미 들어간 곳은 그대로), 편집기·입력칸은 건드리지 않는다', () => {
    document.body.innerHTML = `
      <p id="a">회원·운영자의 권리·의무 · 끝</p>
      <div contenteditable="true"><p id="b">편집기·글자</p></div>
      <textarea id="c">입력·칸</textarea>
      <div data-keep-text><span id="d">그대로·두기</span></div>`;
    stop = startKeepMiddot(document.body);
    expect(document.getElementById('a').textContent).toBe(`회원${WJ}·운영자의 권리${WJ}·의무 · 끝`);
    expect(document.getElementById('b').textContent).toBe('편집기·글자');
    expect(document.getElementById('c').value).toBe('입력·칸');
    expect(document.getElementById('d').textContent).toBe('그대로·두기');
  });

  it('나중에 붙거나 바뀐 글자도 고친다(한 번만)', async () => {
    stop = startKeepMiddot(document.body);
    const p = document.createElement('p');
    p.textContent = '도보·차량·대중교통';
    document.body.appendChild(p);
    await tick();
    expect(p.textContent).toBe(`도보${WJ}·차량${WJ}·대중교통`);
    p.firstChild.data = '후기·Q&A';
    await tick();
    expect(p.textContent).toBe(`후기${WJ}·Q&A`);
    await tick();
    expect(p.textContent.split(WJ).length - 1).toBe(1);   // 두 번 넣지 않는다
  });

  it('· 로 시작하는 글자 조각은 화면 코드가 직접 넣는다 — 그 이음 문자와 겹쳐 두 번 넣지 않는다', () => {
    // React 는 '값을 {IDENTITY_PG_NAME}{'\u2060'}·포트원을' 을 글자 조각 여러 개로 그린다(Privacy.jsx, 2026-10-02).
    document.body.innerHTML = '<p id="a"></p>';
    const p = document.getElementById('a');
    ['값을 ', 'NHN KCP', WJ, '·포트원을'].forEach((t) => p.appendChild(document.createTextNode(t)));
    stop = startKeepMiddot(document.body);
    expect(p.textContent).toBe(`값을 NHN KCP${WJ}·포트원을`);
  });

  // 2026-10-02(codex #12): 복사 때 text/plain 만 넣어 HTML 서식이 사라지던 것을 고침 — text/html 도 같이 넣고,
  // 이음 문자가 없거나 입력칸·편집기 안이면 기본 복사에 맡긴다. text/html 은 맨 앞에 <meta charset="utf-8"> 를 붙이고
  // 상대 주소를 절대 주소로 바꾼다(P3 검토).
  it('복사하면 이음 문자를 빼되 HTML 서식은 남긴다(text/plain 은 sel.toString() 기준)', () => {
    document.body.innerHTML = '<div id="r"><p>회원·운영자</p>\n<p><b>권리·의무</b>와 <a href="/t">약관·정책</a></p></div>';
    stop = startKeepMiddot(document.body);
    const raw = select(document.getElementById('r')).toString();
    expect(raw).toContain(WJ);   // 화면 글자엔 들어가 있다
    const { ev, data } = copy();
    expect(data['text/plain']).toBe(raw.replaceAll(WJ, ''));
    expect(data['text/plain']).toBe('회원·운영자\n권리·의무와 약관·정책');   // 줄바꿈 등 나머지는 그대로
    expect(data['text/html'].startsWith(`${META}<p>회원·운영자</p>`)).toBe(true);
    expect(data['text/html']).toContain('<b>권리·의무</b>');
    expect(data['text/html']).toContain(`<a href="${window.location.origin}/t">약관·정책</a>`);
    expect(data['text/html']).not.toContain(WJ);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.getElementById('r').textContent).toContain(WJ);   // 화면 글자는 그대로(복제본만 고친다)
  });

  it('복사 HTML 에서 화면에 안 그려지는 요소(숨김·<style>)는 뺀다', () => {
    document.body.innerHTML = `<style>.hide { display: none; }</style>
      <div id="r"><p>권리·의무<span class="hide">숨김 클래스</span><span style="display:none">숨김 인라인</span></p><style>.x { color: red; }</style></div>`;
    stop = startKeepMiddot(document.body);
    select(document.getElementById('r'));
    const { data } = copy();
    expect(data['text/html']).toBe(`${META}<p>권리·의무</p>`);
  });

  // 2026-10-02 P3 검토 must-fix: 게시글 평문·댓글·채팅·장터 본문(whitespace-pre-wrap)을 복사해 우리 편집기·메일에 붙이면
  // HTML 의 '\n' 이 공백으로 합쳐져 줄이 붙었다 → 줄바꿈을 그리는 글의 '\n' 만 <br> 로.
  it('줄바꿈을 그리는 글(white-space: pre-wrap·pre-line)은 HTML 의 \\n 을 <br> 로 — text/plain 은 \\n 그대로', () => {
    // jsdom 은 white-space 를 상속하지 않아 규칙을 자식에도 건다(브라우저에선 부모 값이 상속된다).
    document.body.innerHTML = '<style>.pw, .pw * { white-space: pre-wrap; } .pl { white-space: pre-line; }</style>'
      + '<div id="r"><p class="pw">첫 줄·하나\n<b>둘째·줄\n셋째</b>\n\n다섯째</p>'
      + '<p class="pl" id="crlf"></p><p>보통 문단·글\n이어짐</p></div>';
    // '\r\n' 은 HTML 해석기가 '\n' 으로 바꾸므로 글자 노드로 직접 넣는다(React 가 그리는 DB 값엔 남아 있을 수 있다)
    document.getElementById('crlf').appendChild(document.createTextNode('윈도·줄\r\n바꿈'));
    stop = startKeepMiddot(document.body);
    const raw = select(document.getElementById('r')).toString();
    const { data } = copy();
    expect(data['text/plain']).toBe(raw.replaceAll(WJ, ''));
    expect(data['text/plain']).toBe('첫 줄·하나\n둘째·줄\n셋째\n\n다섯째윈도·줄\r\n바꿈보통 문단·글\n이어짐');
    expect(data['text/html']).toBe(`${META}<p class="pw">첫 줄·하나<br><b>둘째·줄<br>셋째</b><br><br>다섯째</p>`
      + '<p class="pl" id="crlf">윈도·줄<br>바꿈</p>'
      + '<p>보통 문단·글\n이어짐</p>');   // 줄바꿈을 그리지 않는 글은 그대로(화면에서도 공백이었다)
  });

  it('글자 노드 하나 안의 선택도 부모 요소의 white-space 를 보고 <br> 로 바꾼다', () => {
    document.body.innerHTML = '<p id="a" style="white-space: pre-wrap">앞·줄\n뒤·줄 끝</p><p id="b">보통·글\n끝</p>';
    stop = startKeepMiddot(document.body);
    // 첫 이음 문자 바로 앞부터 stopAt 앞까지 고른다 — 공통 조상이 그 글자 노드 자신이다
    const within = (id, stopAt) => {
      const t = document.getElementById(id).firstChild;
      const range = document.createRange();
      range.setStart(t, t.data.indexOf(WJ));
      range.setEnd(t, t.data.lastIndexOf(stopAt));
      expect(range.commonAncestorContainer).toBe(t);
      return selectRange(range);
    };
    let sel = within('a', ' 끝');
    let r = copy();
    expect(r.data['text/plain']).toBe(sel.toString().replaceAll(WJ, ''));
    expect(r.data['text/plain']).toBe('·줄\n뒤·줄');
    expect(r.data['text/html']).toBe(`${META}·줄<br>뒤·줄`);
    sel = within('b', '끝');
    r = copy();
    expect(r.data['text/plain']).toBe(sel.toString().replaceAll(WJ, ''));
    expect(r.data['text/plain']).toBe('·글\n');
    expect(r.data['text/html']).toBe(`${META}·글\n`);   // 줄바꿈을 그리지 않는 글은 그대로
  });

  it('복사 HTML 의 링크·그림 주소는 절대 주소로 — 웹은 지금 문서 주소, 앱은 같은 경로의 공개 사이트 주소(SVG 는 그대로)', () => {
    window.history.replaceState(null, '', '/board/7?tab=1');
    document.body.innerHTML = '<div id="r"><p>권리·의무 <a href="/terms">약관</a> <a href="#top">위로</a> <a href="https://ex.example/x">밖</a></p>'
      + '<p><img src="/i/a.png" alt=""><map name="m"><area href="map/1" alt=""></map>'
      + '<video src="v.mp4"><source src="/v.webm"></video><svg><a href="/svg-link"><text>s</text></a></svg></p></div>';
    stop = startKeepMiddot(document.body);
    const urls = () => {
      select(document.getElementById('r'));
      const t = document.createElement('template');
      t.innerHTML = copy().data['text/html'];
      return [...t.content.querySelectorAll('[href],[src]')].map((el) => `${el.localName} ${el.getAttribute('href') ?? el.getAttribute('src')}`);
    };
    const want = (origin) => [
      `a ${origin}/terms`, `a ${origin}/board/7?tab=1#top`, 'a https://ex.example/x',
      `img ${origin}/i/a.png`, `area ${origin}/board/map/1`, `video ${origin}/board/v.mp4`, `source ${origin}/v.webm`,
      'a /svg-link',   // SVG 요소는 건너뛴다
    ];
    expect(urls()).toEqual(want(window.location.origin));
    nativeFlag.value = true;   // 앱 WebView 주소(https://localhost)는 밖에서 열 수 없다 → 공개 사이트 기준
    expect(urls()).toEqual(want(SITE_ORIGIN));
    expect(document.querySelector('a[href="/terms"]')).not.toBeNull();   // 화면 쪽 주소는 그대로(복제본만 고친다)
    // 앱 경로가 '//다른호스트/…' 꼴이어도 호스트는 공개 사이트 그대로(new URL(경로, 출처) 로 풀면 그 호스트로 바뀐다)
    window.history.replaceState(null, '', '/.//evil.example/x');
    expect(window.location.pathname).toBe('//evil.example/x');
    const odd = urls();
    expect(odd.slice(0, 2)).toEqual([`a ${SITE_ORIGIN}/terms`, `a ${SITE_ORIGIN}//evil.example/x#top`]);
    expect(odd).toContain(`area ${SITE_ORIGIN}//evil.example/map/1`);
    // 주소는 <template> 조각(비활성 문서)에서 바꾼다 — 화면 문서의 요소였다면 바꾼 img 주소로 그림을 새로 내려받는다
    const set = vi.spyOn(Element.prototype, 'setAttribute');
    try {
      urls();
      const owners = set.mock.contexts.filter((el, i) => ['href', 'src'].includes(set.mock.calls[i][0])).map((el) => el.ownerDocument);
      expect(owners).toHaveLength(7);   // a 3개·img·area·video·source (SVG a 는 건너뜀)
      expect(owners.every((d) => d !== document)).toBe(true);
    } finally {
      set.mockRestore();
    }
  });

  it('부분 범위: <b> 글자 중간 ~ <i> 글자 중간 — 걸친 <b>·<i> 와 그 사이 글자는 남고, 숨김 요소는 빠진다', () => {
    document.body.innerHTML = '<style>.hide { display: none; }</style>'
      + '<div><p><b>가·나</b><span class="hide">X</span>다·라</p><p>마·바<i>사·아</i></p></div>';
    stop = startKeepMiddot(document.body);
    const range = document.createRange();
    range.setStart(document.querySelector('b').firstChild, 1);   // '가' 뒤
    range.setEnd(document.querySelector('i').firstChild, 1);     // '사' 뒤
    const sel = selectRange(range);
    const { ev, data } = copy();
    expect(data['text/html']).toBe(`${META}<p><b>·나</b>다·라</p><p>마·바<i>사</i></p>`);
    expect(data['text/html']).not.toContain('X');   // 숨김 요소(display: none)는 빠진다
    expect(data['text/plain']).toBe(sel.toString().replaceAll(WJ, ''));
    expect(ev.defaultPrevented).toBe(true);
  });

  // 2026-10-02 검토 should-fix 고정: 공통 조상 안에 범위 밖 노드가 있는 꼴. 원본 걷기가 범위 밖 노드(첫 li·둘째 p 의 글자)까지
  // 세면 복제본과 짝이 밀려 숨김 빼기·<br> 바꾸기가 엉뚱한 노드에 가거나(짝 불일치로) 통째로 꺼진다 — 그러면 안 된다.
  it('목록 꼴: 둘째 li 글자 처음 ~ 셋째 li 글자 중간 — 범위 밖 첫 li 는 짝에 안 끼고, 숨김 요소는 빠지며, \\n 은 <br> 로', () => {
    document.body.innerHTML = '<style>.pw{white-space:pre-wrap}.hide{display:none}</style>'
      + '<ul><li><p class="pw">첫·하나\n둘</p></li><li><p class="pw">둘째·셋\n넷</p><span class="hide">숨김</span></li>'
      + '<li><p class="pw">셋째·다섯\n여섯</p></li></ul>';
    stop = startKeepMiddot(document.body);
    const ps = document.querySelectorAll('p.pw');
    const range = document.createRange();
    range.setStart(ps[1].firstChild, 0);
    range.setEnd(ps[2].firstChild, ps[2].firstChild.data.indexOf('여섯') + 1);   // '여' 뒤(이음 문자가 든 글자 기준)
    expect(range.commonAncestorContainer).toBe(document.querySelector('ul'));
    const sel = selectRange(range);
    const { ev, data } = copy();
    expect(data['text/html']).toBe(`${META}<li><p class="pw">둘째·셋<br>넷</p></li><li><p class="pw">셋째·다섯<br>여</p></li>`);
    expect(data['text/html']).not.toContain('숨김');
    expect(data['text/plain']).toBe(sel.toString().replaceAll(WJ, ''));
    expect(ev.defaultPrevented).toBe(true);
  });

  it('세 번 클릭 꼴: 첫 p 글자 처음 ~ 둘째 p 의 0 — 둘째 p 는 빈 요소로만 남고, 그 글자(범위 밖)는 짝에 안 낀다', () => {
    document.body.innerHTML = '<style>.pw{white-space:pre-wrap}</style><div><p class="pw">가·나\n다</p><p>라·마\n바</p></div>';
    stop = startKeepMiddot(document.body);
    const [p1, p2] = document.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(p1.firstChild, 0);
    range.setEnd(p2, 0);   // 브라우저의 세 번 클릭(문단 선택)은 끝을 다음 블록의 처음에 둔다
    expect(range.commonAncestorContainer).toBe(document.querySelector('div'));
    const sel = selectRange(range);
    const { ev, data } = copy();
    expect(data['text/html']).toBe(`${META}<p class="pw">가·나<br>다</p><p></p>`);
    expect(data['text/plain']).toBe(sel.toString().replaceAll(WJ, ''));
    expect(data['text/plain']).toBe('가·나\n다');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('원본·복제본 짝이 어긋나면(브라우저 차이 대비) 숨김 빼기·<br> 바꾸기를 하지 않고 이음 문자만 뺀다', () => {
    document.body.innerHTML = '<style>.hide { display: none; }</style>'
      + '<div id="r"><p class="hide">숨김</p><p style="white-space: pre-wrap">보이는·글\n둘째</p></div>';
    stop = startKeepMiddot(document.body);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('r'));
    const clone = range.cloneContents.bind(range);
    range.cloneContents = () => {   // 복제본 맨 앞에 원본에 없는 요소가 하나 더 있는 것처럼
      const f = clone();
      f.insertBefore(document.createElement('span'), f.firstChild);
      return f;
    };
    selectRange(range);
    const { ev, data } = copy();
    expect(data['text/html']).toBe(`${META}<span></span><p class="hide">숨김</p><p style="white-space: pre-wrap">보이는·글\n둘째</p>`);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('이음 문자가 없는 선택은 건드리지 않는다(기본 복사가 서식을 담는다)', () => {
    document.body.innerHTML = '<p id="a">권리·의무</p><p id="b"><b>평범한</b> 글 · 공백 뒤</p>';
    stop = startKeepMiddot(document.body);
    select(document.getElementById('b'));   // 화면 다른 곳엔 이음 문자가 있어도 선택 안엔 없다
    const { ev, data } = copy();
    expect(data).toEqual({});
    expect(ev.defaultPrevented).toBe(false);
  });

  it('입력칸·편집기 안 선택은 건드리지 않는다', () => {
    document.body.innerHTML = `
      <p id="a">권리·의무</p>
      <input id="i" value="입력·칸">
      <div contenteditable="true"><p id="b">편집기${WJ}·글자</p></div>`;
    stop = startKeepMiddot(document.body);
    // 입력칸: 브라우저에선 그 칸이 copy 이벤트 대상이 된다. jsdom 은 입력칸 선택을 getSelection 에 반영하지 않아
    // 문서 선택엔 이음 문자가 든 글자를 걸어 둔다 — 건너뛴 까닭이 '이음 문자 없음'이 아니라 '입력칸'임을 확인.
    select(document.getElementById('a'));
    let r = copy(document.getElementById('i'));
    expect(r.data).toEqual({});
    expect(r.ev.defaultPrevented).toBe(false);
    // 편집기: 이음 문자가 붙여 넣어져 있어도 편집기 쪽 복사 처리에 맡긴다.
    select(document.getElementById('b'));
    r = copy();
    expect(r.data).toEqual({});
    expect(r.ev.defaultPrevented).toBe(false);
  });

  it('다른 처리가 이미 채운 복사는 덮어쓰지 않고, clipboardData 가 없으면 기본 동작', () => {
    document.body.innerHTML = '<p id="a">권리·의무</p>';
    stop = startKeepMiddot(document.body);
    select(document.getElementById('a'));
    const p = document.getElementById('a');
    const own = (e) => e.preventDefault();   // ProseMirror 자체 복사처럼 먼저 처리하는 쪽
    p.addEventListener('copy', own);
    expect(copy(p).data).toEqual({});
    p.removeEventListener('copy', own);
    const bare = new Event('copy', { bubbles: true, cancelable: true });
    expect(() => document.dispatchEvent(bare)).not.toThrow();
    expect(bare.defaultPrevented).toBe(false);
  });
});

// '·' 가 요소의 첫 글자면 keepMiddot 가 앞 글자를 못 봐 이음 문자를 못 넣는다 — 그런 곳은 화면 코드가 직접 넣는다.
// 반드시 JSX 이스케이프({'\u2060'})로 쓴다: 실제 문자는 눈에 안 보여 고치다 지워지거나 모르고 복사된다(2026-10-02 C9·P3 검토).
describe('소스의 이음 문자는 이스케이프로만 — 화면 코드가 직접 넣는 곳·keepMiddot.js', () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
  it.each([
    ['../pages/Privacy.jsx', "{IDENTITY_PG_NAME}{'\\u2060'}·포트원을"],
    ['../components/rich/RichEditor.jsx', "{'\\u2060'}· 글자 수를 넘었어요"],
    ['../components/board/DraftControls.jsx', "{'\\u2060'}· 지금 쓰는 글"],
    // keepMiddot.js 도 같다 — 실제 문자가 정규식 [^\s…] 에서 지워지면 이음 문자 뒤 '·' 에 또 넣기를 끝없이 되풀이한다
    ['./keepMiddot.js', "const WJ = '\\u2060';"],
  ])('%s', (file, snippet) => {
    const src = read(file);
    expect(src.split(snippet).length - 1).toBe(1);   // 이스케이프 표기로 1건
    expect(src.split(WJ).length - 1).toBe(0);         // 보이지 않는 실제 U+2060 은 0개
  });
});

// 노드 내용을 문서 선택으로 건다.
function select(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  return selectRange(range);
}

// 범위 하나를 문서 선택으로 건다.
function selectRange(range) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

// copy 이벤트를 쏘고 넣은 클립보드 값({형식: 값})과 이벤트를 돌려준다.
function copy(target = document) {
  const data = {};
  const ev = new Event('copy', { bubbles: true, cancelable: true });
  ev.clipboardData = { setData: (type, v) => { data[type] = v; } };
  target.dispatchEvent(ev);
  return { ev, data };
}
