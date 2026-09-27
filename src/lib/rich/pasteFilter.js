// 붙여넣기 HTML 정리(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-5).
//
// 원칙: 믿을 수 없는 HTML 은 자원을 요청하지 않는 곳에서만 해석하고, 편집기(ProseMirror)에는 자원을 부르는 속성이
// 하나도 없는 HTML 만 넘긴다. CSP 에 기대지 않는다.
//  1. 해석은 <template> 요소의 내용물(t.content)에서만 한다 — 문서에 붙지 않은 조각이라 렌더링·자원 요청이 없다.
//     DOMParser 는 쓰지 않는다(MDN: 비활성 문서라도 iframe·img 자원을 내려받을 수 있다). ESLint 로 막아 두었다.
//  2. 원본 요소를 고치지 않고, 허용 목록에 있는 것만 **새 HTML 문자열로 다시 짓는다**. 속성은 a[href](http·https 만),
//     ol[start], 우리 data-ct-* 만 — 값은 검증한 뒤 새로 적는다(원본 값을 그대로 옮기지 않는다).
//     src·srcset·poster·background·style·class·id·on*·xlink:href·action·formaction·남의 data-* 는 한 글자도 나가지 않는다.
//  3. 글자 모양은 인라인 style 에서 읽어 토큰(data-ct-*)으로만 옮긴다: 색·배경색은 팔레트에 정확히 있을 때만,
//     크기는 가장 가까운 단계, 글꼴은 이름 대응표, 정렬은 가운데·오른쪽. 굵게·기울임·밑줄·취소선은 태그로.
//     부모(묶음 div·span·b …)가 정한 모양·정렬은 안쪽으로 물려주고, 글자 조각마다 한 벌로 감싼다 — 겹친 span 을
//     편집기가 하나만 남기며 바깥 모양을 잃는 일이 없게(agy C).
//  4. <img> 는 그 게시판 규칙(4-7)과 지금 사용자 기준으로 통과하는 사진 참조일 때만 우리 사진 노드
//     (div[data-ct-node=image])로 바꾼다 — 요소 이름이 img 가 아니어서 두 번째 해석에서도 요청이 생기지 않는다.
//     남의 참조·외부 주소·data:·blob: 은 버리고 그 수를 알려 준다(안내 문구는 편집기가 띄운다).
//  5. 우리 노드(사진·묶음·지도·영상)는 data-ct-* 로만 오가며, 규칙(4장)을 다시 통과해야 남는다.
import { BG_COLORS, COLORS, DEFAULT_FONT_SIZE, FONT_SIZES, GALLERY_LAYOUTS, LIMITS } from './schema';
import { imageRefOk, normalizeHref } from './doc';
import { mapAttrsError } from './mapLink';
import { videoAttrsError } from './videoLink';

// 요소째(안의 글자까지) 버린다
const DROP = new Set([
    'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'video', 'audio',
    'source', 'track', 'picture', 'svg', 'math', 'canvas', 'input', 'select', 'textarea', 'button', 'option', 'optgroup',
    'datalist', 'head', 'title', 'meta', 'link', 'base', 'map', 'area', 'param', 'dialog', 'slot',
]);
// 블록 묶음(div 로) — 안에 블록이 없으면 문단(p)으로
const BLOCKISH = new Set([
    'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address',
    'dl', 'dd', 'dt', 'center', 'details', 'summary', 'fieldset', 'legend', 'form', 'table', 'thead', 'tbody', 'tfoot',
    'tr', 'caption', 'hgroup', 'body', 'html',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_CHILD = new Set([...BLOCKISH, ...HEADINGS, 'p', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'img']);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const attr = (name, value) => ` ${name}="${escAttr(value)}"`;

// ── 인라인 style → 토큰 ─────────────────────────────────────────────
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// CSS 색 값(#rgb·#rrggbb·rgb()·rgba(불투명)) → 소문자 #rrggbb, 그 밖은 null
export function cssColorHex(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    let m = /^#([0-9a-f]{3})$/.exec(v);
    if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
    m = /^#([0-9a-f]{6})$/.exec(v);
    if (m) return `#${m[1]}`;
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
    if (m) {
        if (m[4] !== undefined && Number(m[4]) < 1) return null;
        return `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
    }
    return null;
}

// CSS 글자 크기(px·pt) → 가장 가까운 단계(15 = 기본이면 null)
export function cssFontSizeToken(value) {
    const m = /^([\d.]+)(px|pt)$/.exec(String(value || '').trim().toLowerCase());
    if (!m) return null;
    const px = m[2] === 'pt' ? Number(m[1]) * (4 / 3) : Number(m[1]);
    if (!Number.isFinite(px) || px <= 0) return null;
    let best = FONT_SIZES[0];
    for (const s of FONT_SIZES) if (Math.abs(s - px) < Math.abs(best - px)) best = s;
    return best === DEFAULT_FONT_SIZE ? null : best;
}

// 글꼴 이름 → 토큰(나눔명조·나눔손글씨 펜·고운돋움), 그 밖은 null(기본 글꼴)
export function cssFontToken(value) {
    const v = String(value || '').toLowerCase().replace(/["'\s_-]/g, '');
    if (!v) return null;
    if (v.includes('nanummyeongjo') || v.includes('나눔명조')) return 'myeongjo';
    if (v.includes('nanumpen') || v.includes('나눔손글씨펜') || v.includes('나눔펜')) return 'pen';
    if (v.includes('gowundodum') || v.includes('고운돋움')) return 'dodum';
    return null;
}

const readStyle = (el) => {
    const s = el.style;
    if (!s) return null;
    return {
        color: s.color, backgroundColor: s.backgroundColor, fontSize: s.fontSize, fontFamily: s.fontFamily,
        fontWeight: s.fontWeight, fontStyle: s.fontStyle, textDecoration: `${s.textDecorationLine || ''} ${s.textDecoration || ''}`,
        textAlign: s.textAlign,
    };
};

// 요소 자신이 정한 글자 모양. 정하지 않은 항목은 넣지 않는다(부모 것을 물려받는다).
function ownTokens(el, tag) {
    const st = el.hasAttribute('style') ? readStyle(el) : null;
    const out = {};
    const color = cssColorHex(st?.color || (tag === 'font' ? el.getAttribute('color') : ''));
    if (color && COLORS.includes(color)) out.color = color;
    const bg = cssColorHex(st?.backgroundColor);
    if (bg && BG_COLORS.includes(bg)) out.bg = bg;
    const size = cssFontSizeToken(st?.fontSize);
    if (size) out.size = size;
    const font = cssFontToken(st?.fontFamily || (tag === 'font' ? el.getAttribute('face') : ''));
    if (font) out.font = font;
    const w = String(st?.fontWeight || '').trim().toLowerCase();
    const n = Number(w);
    if (w === 'bold' || w === 'bolder' || (Number.isFinite(n) && n >= 600)) out.bold = true;
    // 구글 문서는 글 전체를 <b style="font-weight:normal"> 로 감싼다 — 굵게가 아니다
    else if (w === 'normal' || w === 'lighter' || (Number.isFinite(n) && n > 0 && n < 600)) out.bold = false;
    else if (tag === 'strong' || tag === 'b') out.bold = true;
    if (/italic|oblique/.test(String(st?.fontStyle || '').toLowerCase()) || tag === 'em' || tag === 'i') out.italic = true;
    const deco = String(st?.textDecoration || '').toLowerCase();
    if (deco.includes('underline') || tag === 'u' || tag === 'ins') out.underline = true;
    if (deco.includes('line-through') || tag === 's' || tag === 'strike' || tag === 'del') out.strike = true;
    return out;
}

const EMPTY_TK = Object.freeze({});
const mergeTk = (parent, own) => (Object.keys(own).length ? { ...parent, ...own } : parent);

function alignOf(el) {
    const a = String((el.hasAttribute('style') ? el.style?.textAlign : '') || el.getAttribute('align') || '').trim().toLowerCase();
    return a === 'center' || a === 'right' ? a : null;
}

// ── 우리 노드(data-ct-node) ───────────────────────────────────────────
function parseJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}

// ctx.refOk(ref) — 이 게시판·사용자 기준으로 받아 줄 사진 참조인가(대기 키 포함, 편집기가 정한다)
function ourNode(el, ctx) {
    const kind = el.getAttribute('data-ct-node');
    if (kind === 'image') {
        const src = el.getAttribute('data-ct-src') || '';
        if (!ctx.refOk(src)) { ctx.droppedImages += 1; return ''; }
        return `<div${attr('data-ct-node', 'image')}${attr('data-ct-src', src)}></div>`;
    }
    if (kind === 'gallery') {
        const list = parseJson(el.getAttribute('data-ct-images') || '');
        const seen = new Set();
        const refs = [];
        for (const r of Array.isArray(list) ? list : []) {
            if (typeof r !== 'string' || seen.has(r)) continue;
            if (refs.length >= LIMITS.galleryMax) { ctx.droppedImages += 1; continue; }
            if (!ctx.refOk(r)) { ctx.droppedImages += 1; continue; }
            seen.add(r);
            refs.push(r);
        }
        if (refs.length === 0) return '';
        if (refs.length === 1) return `<div${attr('data-ct-node', 'image')}${attr('data-ct-src', refs[0])}></div>`;
        const layout = GALLERY_LAYOUTS.includes(el.getAttribute('data-ct-layout')) ? el.getAttribute('data-ct-layout') : 'grid';
        return `<div${attr('data-ct-node', 'gallery')}${attr('data-ct-layout', layout)}${attr('data-ct-images', JSON.stringify(refs))}></div>`;
    }
    if (kind === 'map') {
        const a = parseJson(el.getAttribute('data-ct-map') || '');
        if (mapAttrsError(a)) return '';
        const keep = {};
        for (const k of ['placeId', 'name', 'address', 'lat', 'lng', 'url']) if (a[k] !== undefined && a[k] !== null) keep[k] = a[k];
        return `<div${attr('data-ct-node', 'map')}${attr('data-ct-map', JSON.stringify(keep))}></div>`;
    }
    if (kind === 'video') {
        const a = { provider: el.getAttribute('data-ct-provider'), id: el.getAttribute('data-ct-id') };
        if (videoAttrsError(a)) return '';
        return `<div${attr('data-ct-node', 'video')}${attr('data-ct-provider', a.provider)}${attr('data-ct-id', a.id)}></div>`;
    }
    return null;   // 모르는 표식 — 일반 요소로 처리
}

// ── 다시 짓기 ──────────────────────────────────────────────────────
// inh = { tk: 물려받은 글자 모양, align: 물려받은 정렬 } — 부모(묶음 div·span·b …)가 정한 모양이 안쪽 글자까지 간다.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const ROOT = Object.freeze({ tk: EMPTY_TK, align: null });

function kids(el, ctx, pre, inh) {
    let out = '';
    for (const c of el.childNodes) out += build(c, ctx, pre, inh);
    return out;
}

function hasBlockChild(el) {
    for (const c of el.children || []) {
        if (BLOCK_CHILD.has(c.tagName.toLowerCase())) return true;
    }
    return false;
}

// 글자 한 조각을 모양대로 감싼다(한 조각 = 한 벌의 표식 → 편집기에서 글자 모양 하나로 합쳐진다)
function wrapText(inner, tk) {
    if (!inner) return '';
    let s = inner;
    const data = [];
    if (tk.font) data.push(attr('data-ct-font', tk.font));
    if (tk.size) data.push(attr('data-ct-size', String(tk.size)));
    if (tk.color) data.push(attr('data-ct-color', tk.color));
    if (tk.bg) data.push(attr('data-ct-bg', tk.bg));
    if (data.length) s = `<span${data.join('')}>${s}</span>`;
    if (tk.strike) s = `<s>${s}</s>`;
    if (tk.underline) s = `<u>${s}</u>`;
    if (tk.italic) s = `<em>${s}</em>`;
    if (tk.bold) s = `<strong>${s}</strong>`;
    return s;
}

function build(node, ctx, pre, inh) {
    if (node.nodeType === TEXT_NODE) {
        const t = node.nodeValue || '';
        if (!t) return '';
        if (!pre) return wrapText(esc(t), inh.tk);
        return t.split('\n').map((line) => wrapText(esc(line), inh.tk)).join('<br>');
    }
    if (node.nodeType !== ELEMENT_NODE) return '';     // 주석·처리 지시 등
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) {
        if (tag === 'picture') ctx.droppedImages += 1;      // 안에 든 사진 한 장으로 센다
        return '';
    }
    if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        if (ctx.refOk(src)) return `<div${attr('data-ct-node', 'image')}${attr('data-ct-src', src)}></div>`;
        ctx.droppedImages += 1;
        return '';
    }
    if (tag === 'div' && el.hasAttribute('data-ct-node')) {
        const r = ourNode(el, ctx);
        if (r !== null) return r;
    }
    if (tag === 'br') return '<br>';
    if (tag === 'hr') return '<hr>';

    const tk = mergeTk(inh.tk, ownTokens(el, tag));
    const align = alignOf(el) || inh.align;
    const alignAttr = align ? attr('data-ct-align', align) : '';
    const next = { tk, align };

    if (tag === 'p') return `<p${alignAttr}>${kids(el, ctx, pre, next)}</p>`;
    if (HEADINGS.has(tag)) return `<h2${alignAttr}>${kids(el, ctx, pre, next)}</h2>`;
    if (tag === 'pre') return `<p${alignAttr}>${kids(el, ctx, true, next)}</p>`;
    if (tag === 'blockquote') return `<blockquote>${kids(el, ctx, pre, next)}</blockquote>`;
    if (tag === 'ul') return `<ul>${kids(el, ctx, pre, next)}</ul>`;
    if (tag === 'ol') {
        const start = Number(el.getAttribute('start'));
        const s = Number.isInteger(start) && start > 1 && start <= LIMITS.orderedStartMax ? attr('start', String(start)) : '';
        return `<ol${s}>${kids(el, ctx, pre, next)}</ol>`;
    }
    if (tag === 'li') return `<li>${kids(el, ctx, pre, next)}</li>`;
    if (BLOCKISH.has(tag)) {
        // 안에 블록이 없으면 문단 하나(정렬이 문단에 남는다), 있으면 묶음 div — 정렬·모양은 안쪽 블록·글자로 물려준다
        if (!hasBlockChild(el)) return `<p${alignAttr}>${kids(el, ctx, pre, next)}</p>`;
        return `<div>${kids(el, ctx, pre, next)}</div>`;
    }
    if (tag === 'td' || tag === 'th') return `${kids(el, ctx, pre, next)} `;
    if (tag === 'a') {
        const inner = kids(el, ctx, pre, next);
        const href = normalizeHref(el.getAttribute('href') || '');
        return href ? `<a${attr('href', href)}>${inner}</a>` : inner;
    }
    // strong·b·em·u·s·span·font 와 그 밖의 인라인(sub·sup·small·mark·code …)·모르는 요소: 모양만 물려주고 요소는 없앤다
    return kids(el, ctx, pre, next);
}

// html: 붙여넣은 HTML 문자열. opts.refOk(ref): 사진 참조를 받아 줄지(편집기가 게시판 규칙·대기 키로 정한다).
// 반환: { html: 다시 지은 안전한 HTML, droppedImages: 버린 사진 수 }
export function cleanPastedHtml(html, { refOk = () => false } = {}) {
    const ctx = { refOk, droppedImages: 0 };
    if (typeof document === 'undefined' || typeof html !== 'string' || !html) return { html: '', droppedImages: 0 };
    const t = document.createElement('template');
    t.innerHTML = html;
    let out = '';
    for (const c of t.content.childNodes) out += build(c, ctx, false, ROOT);
    return { html: out, droppedImages: ctx.droppedImages };
}

// 게시판 규칙에 맞는 사진 참조인가 + 편집기의 대기 키(pendingOk). 붙여넣기·끌어 놓기 공용.
// 사진 없는 게시판(mode none — Q&A·자유·동행)은 무엇이든 거부한다(대기 키 포함).
export const pasteRefOk = ({ mode, ownerId, pendingOk }) => (ref) => (
    (mode === 'private' || mode === 'public')
    && typeof ref === 'string' && ref.length > 0
    && (imageRefOk(ref, mode, ownerId) || (typeof pendingOk === 'function' && pendingOk(ref) === true))
);
