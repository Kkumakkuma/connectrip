// 가운뎃점(·) 앞 줄바꿈 막기(2026-09-27 줄바꿈 정리 — 쿠마님 "줄바꿈 전체적으로 항상 제대로").
// 크롬·안드로이드 WebView 는 한글 바로 뒤 '·' 앞에서도 줄을 나눠, 줄이 '·' 로 시작하는 일이 생긴다
// (예: '권리 / ·의무', '포트원 / ·NHN KCP'). CSS(line-break·word-break)로는 막을 수 없어서
// (폭 400가지 × 문장 5개 실험: 그대로 179회 → 이음 문자 0회), 화면 글자의 '·' 바로 앞에
// 보이지 않는 이음 문자(U+2060 WORD JOINER)를 넣는다. 입력칸·글쓰기 편집기(contenteditable)는 건드리지 않는다.
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
function onCopy(e) {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  const text = sel ? sel.toString() : '';
  if (!text.includes(WJ) || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', text.replaceAll(WJ, ''));
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
