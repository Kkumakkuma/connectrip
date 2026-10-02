// 가운뎃점(·) 앞 줄바꿈 막기(2026-09-27 줄바꿈 정리 — 쿠마님 "줄바꿈 전체적으로 항상 제대로").
// 크롬·안드로이드 WebView 는 한글 바로 뒤 '·' 앞에서도 줄을 나눠, 줄이 '·' 로 시작하는 일이 생긴다
// (예: '권리 / ·의무', '포트원 / ·NHN KCP'). CSS(line-break·word-break)로는 막을 수 없어서
// (폭 400가지 × 문장 5개 실험: 그대로 179회 → 이음 문자 0회), 화면 글자의 '·' 바로 앞에
// 보이지 않는 이음 문자(U+2060 WORD JOINER)를 넣는다. 입력칸·글쓰기 편집기(contenteditable)는 건드리지 않는다.
import { SITE_ORIGIN } from './api';
import { isNativeApp } from './native';

const WJ = '\u2060';
const RE = /([^\s\u2060])·/g;
const SKIP = 'textarea,input,select,option,script,style,[contenteditable],[data-keep-text]';

function fixText(node) {
  const v = node.data;
  if (!v || !v.includes('·')) return;
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const nv = v.replace(RE, `$1${WJ}·`);
  if (nv !== v) node.data = nv;
}

function fixTree(root) {
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) fixText(n);
}

// 화면 글자를 복사하면 이음 문자도 같이 복사된다 — 다른 입력칸·검색창에 붙였을 때 보이지 않는 글자가 섞이지 않게
// 복사 내용에서 빼 준다(교차검토 지적, 2026-09-27).
// 2026-10-02 고침(codex #12): text/plain 만 넣고 기본 복사를 막아, 붙여 넣을 때 굵게·링크·목록 서식(HTML)이 통째로 사라졌다.
//   · 손대지 않는 경우(브라우저 기본 복사가 서식을 그대로 담는다): 입력칸·편집기 안 선택, 이음 문자가 없는 선택,
//     다른 처리가 이미 채운 복사(글쓰기 편집기 ProseMirror 는 자체 copy 처리에서 preventDefault 후 자기 HTML 을 넣는다).
//   · 이음 문자가 있을 때만 text/plain(sel.toString() 에서 이음 문자만 뺌 — 줄바꿈 등은 그대로)과
//     text/html(선택 범위마다 복제해 이음 문자만 뺀 것)을 함께 넣는다.
//   · text/html 은 브라우저 기본 복사처럼 보이게 복제본을 손본다(2026-10-02 P3 검토). 붙여 넣는 곳(우리 편집기·메일)엔
//     우리 CSS 도, 우리 주소도 없기 때문이다.
//       - 화면에 안 그려지는 요소(md:hidden 같은 숨김, 푸터의 <style> 등)는 뺀다 — 거기선 그대로 보이게 된다.
//       - 줄바꿈을 그대로 그리는 글(white-space: pre·pre-wrap·pre-line·break-spaces)의 '\n' 은 <br> 로 바꾼다.
//         게시글 평문·댓글·채팅·장터 본문은 클래스(whitespace-pre-wrap)로 줄을 그려서, 그대로 두면 붙인 곳에서 줄이 합쳐졌다.
//       - 링크·그림 주소(a·area 의 href, img·source·video 의 src)는 절대 주소로 바꾼다('/board/1' 은 붙인 곳에서 깨진다).
//       - 맨 앞에 <meta charset="utf-8"> 를 붙인다(브라우저 기본 복사와 같게 — 받는 쪽이 한글을 다른 인코딩으로 읽지 않게).
//   · 한계(허용): 선택 범위 바깥 조상의 서식(굵은 글씨 안 일부만 고르면 그 <b>)과 클래스로만 준 색·크기는 HTML 에 안 담긴다.
//     태그로 된 서식(굵게·링크·목록·제목)만 남는다. pre 계열 글의 연속 공백도 붙인 곳의 규칙대로 하나로 줄 수 있다.
const EDITABLE = 'input,textarea,[contenteditable]:not([contenteditable="false"])';

function inEditable(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return !!el?.closest(EDITABLE);
}

// 줄바꿈('\n')을 줄바꿈으로 그리는 요소인가. 새 브라우저의 white-space 는 white-space-collapse 와 text-wrap-mode 를
// 묶은 속성이라, 옛 낱말로 못 나타내는 조합(예: preserve-breaks + nowrap)이면 '' 가 나온다 — 그래서 collapse 값도 본다.
const KEEP_NL_WHITE_SPACE = /^(pre|pre-wrap|pre-line|break-spaces)$/;
const KEEP_NL_COLLAPSE = /^(preserve|preserve-breaks|break-spaces)$/;

function keepsNewlines(el) {
  const cs = getComputedStyle(el);
  return KEEP_NL_WHITE_SPACE.test(cs.whiteSpace || '') || KEEP_NL_COLLAPSE.test(cs.whiteSpaceCollapse || '');
}

// 복제본 글자 노드의 줄바꿈을 <br> 로 바꾼다('a\nb' → a<br>b, '\r\n' 도 한 번).
function newlinesToBr(t) {
  const doc = t.ownerDocument;
  const out = doc.createDocumentFragment();
  t.data.split(/\r?\n/).forEach((line, i) => {
    if (i) out.appendChild(doc.createElement('br'));
    if (line) out.appendChild(doc.createTextNode(line));
  });
  t.parentNode.replaceChild(out, t);
}

// 복사 HTML 에서 절대 주소로 바꿀 HTML 요소의 주소 속성.
const URL_ATTR_SELECTOR = 'a[href],area[href],img[src],source[src],video[src]';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

// 상대 주소를 풀 기준. 웹 = 지금 문서 주소. 앱 = 같은 경로·쿼리의 공개 사이트 주소(api.js SITE_ORIGIN) —
// 앱 WebView 주소(https://localhost/…)는 앱 밖에서 열 수 없다. 경로까지 붙이는 건 '?page=2'·'#위치'·'map/1' 같은 주소도
// 웹에서 푼 것과 같게 풀리게 하려고다('/…' 로 시작하는 주소는 출처만 쓰는 것과 결과가 같다).
// new URL(경로, SITE_ORIGIN) 으로 풀지 않고 문자열로 잇는다 — 경로가 '//다른호스트/…' 꼴이면 호스트가 그쪽으로 바뀐다.
function copyBaseUrl() {
  const { href, pathname, search } = window.location;
  return isNativeApp() ? `${SITE_ORIGIN}${pathname}${search}` : href;
}

function rangeHTML(range, base) {
  const frag = range.cloneContents();
  const root = range.commonAncestorContainer;
  const hidden = [];   // 복제본에서 뺄 요소
  const breaks = [];   // 복제본에서 줄바꿈을 <br> 로 바꿀 글자 노드
  if (root.nodeType === 3) {
    // 글자 노드 하나 안의 선택 — 복제본도 그 글자 조각 하나다. 모양은 부모 요소의 것을 본다.
    const c = frag.firstChild;
    if (c?.nodeType === 3 && c.data.includes('\n') && root.parentElement && keepsNewlines(root.parentElement)) breaks.push(c);
  } else {
    // cloneContents 는 공통 조상 아래에서 범위에 걸친 요소·글자 노드를 문서 순서대로 복제한다(양 끝에 걸친 글자 노드는
    // 잘린 조각으로, 빈 조각이어도 남긴다). 그래서 같은 범위 필터로 원본·복제본을 나란히 걸으면 1:1 로 맞는다.
    const show = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT;
    const orig = document.createTreeWalker(root, show, {
      acceptNode: (n) => (range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const copy = document.createTreeWalker(frag, show);
    const keep = new Map();   // 부모 요소 → 줄바꿈을 그리는가(글자 노드마다 스타일을 다시 계산하지 않게)
    let o = orig.nextNode();
    let c = copy.nextNode();
    for (; o && c; o = orig.nextNode(), c = copy.nextNode()) {
      if (o.nodeName !== c.nodeName) break;
      if (o.nodeType === 1) {
        if (getComputedStyle(o).display === 'none') hidden.push(c);
      } else if (c.data.includes('\n') && o.parentElement) {
        // 글자 노드의 white-space 는 부모 요소의 계산값이다(상속 속성)
        const p = o.parentElement;
        if (!keep.has(p)) keep.set(p, keepsNewlines(p));
        if (keep.get(p)) breaks.push(c);
      }
    }
    // 짝이 어긋났거나 한쪽이 남았으면(명세상 없지만 브라우저 차이 대비) 빼지도 바꾸지도 않는다 —
    // 어긋난 짝대로 빼면 보이는 글이 사라진다. 이음 문자 빼기·주소 바꾸기는 그대로 한다.
    if (o || c) { hidden.length = 0; breaks.length = 0; }
  }
  hidden.forEach((c) => c.remove());
  breaks.forEach(newlinesToBr);
  // 주소 바꾸기·이음 문자 빼기는 <template> 조각(비활성 문서)에서 한다 — 화면 문서의 요소에서 img 주소를 바꾸면 그림을
  // 새로 내려받는다(앱은 공개 사이트 주소라 새 요청이 된다. pasteFilter.js·eslint.config.js 의 DOMParser 금지와 같은 이유).
  // 문서에 붙지 않은 조각이라 감시(MutationObserver)에도 안 걸린다.
  const box = document.createElement('template');
  box.content.appendChild(frag);
  for (const el of box.content.querySelectorAll(URL_ATTR_SELECTOR)) {
    if (el.namespaceURI !== HTML_NS) continue;   // SVG 의 <a href> 는 건너뛴다(HTML 요소만)
    const attr = el.localName === 'a' || el.localName === 'area' ? 'href' : 'src';
    try { el.setAttribute(attr, new URL(el.getAttribute(attr), base).href); } catch { /* 주소로 못 푸는 값은 그대로 둔다 */ }
  }
  const w = document.createTreeWalker(box.content, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.data.includes(WJ)) n.data = n.data.replaceAll(WJ, '');
  }
  return box.innerHTML;
}

function onCopy(e) {
  if (!e.clipboardData || e.defaultPrevented) return;
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!sel || !sel.rangeCount) return;
  // 한쪽 끝이라도 입력칸·편집기 안이면 기본 복사에 맡긴다(입력칸 복사는 그 칸이 이벤트 대상이 된다).
  if (inEditable(e.target) || inEditable(sel.anchorNode) || inEditable(sel.focusNode)) return;
  const text = sel.toString();
  if (!text.includes(WJ)) return;
  const base = copyBaseUrl();
  let html = '';
  for (let i = 0; i < sel.rangeCount; i++) html += rangeHTML(sel.getRangeAt(i), base);
  e.clipboardData.setData('text/plain', text.replaceAll(WJ, ''));
  if (html) e.clipboardData.setData('text/html', `<meta charset="utf-8">${html}`);
  e.preventDefault();
}

// 앱이 화면을 그린 뒤 한 번 불러 둔다. 이후 바뀌는 글자도 따라가며 고친다(되돌리는 함수 반환).
export function startKeepMiddot(root = typeof document !== 'undefined' ? document.body : null) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  fixTree(root);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target);
      else r.addedNodes.forEach(fixTree);
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  document.addEventListener('copy', onCopy);
  return () => { mo.disconnect(); document.removeEventListener('copy', onCopy); };
}
