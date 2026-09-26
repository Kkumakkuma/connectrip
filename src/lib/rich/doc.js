// 게시판 서식 문서 다루기(2026-09-26 서식 편집기 1단계, 설계 plan_v3 4·5·7·8장).
//
// - validateDoc   : 서버 rich_doc_check 와 같은 규칙으로 검증(한 번 순회, 재귀 없음). 받아 주는 문서·거부하는 문서가 같아야 한다.
// - prepareRichDoc: 상세 화면 진입점에서 한 번 검증하고, 통과한 문서만 표식(Symbol)을 달아 돌려준다.
//                   렌더러(RichBody)·글꼴 미리 받기(fonts.js)는 이 표식이 있는 값만 쓴다.
// - docToPlain    : 평문 파생. 서버 rich_doc_plain 과 같은 결과(__fixtures__ 표본으로 대조).
// - plainToDoc    : 옛 평문 글 → 문서(줄마다 문단, 빈 줄 유지).
// - sanitizeDoc   : 편집기·원고에서 온 문서를 규칙 안의 모양으로 다시 짓는다(모르는 속성·노드는 버린다).
// - jsonbTextBytes: PostgreSQL jsonb 텍스트(octet_length(doc::text))와 같은 바이트 수.
import {
    ALIGNS, ATTR_KEYS, BG_COLORS, COLORS, DEFAULT_FONT_SIZE, DOC_VERSION, FONT_SIZES, FONT_TOKENS,
    GALLERY_LAYOUTS, LIMITS, MEDIA_NODES, NODE_KEYS, PLAIN_MARKS, PRIVATE_REF_PREFIX, PUBLIC_IMAGE_PREFIX, RE,
    TEXT_STYLE_KEYS, mediaOf,
} from './schema';
import { mapAttrsError, placeIdOk } from './mapLink';

// ── 작은 도구 ───────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
// JSON 으로 저장되면 undefined 값은 사라지므로 키로 치지 않는다
const ownKeys = (o) => Object.keys(o).filter((k) => o[k] !== undefined);
const onlyKeys = (o, allowed) => ownKeys(o).every((k) => allowed.includes(k));
const present = (o, k) => o[k] !== undefined && o[k] !== null;
// 코드포인트 수가 max 를 넘는가(SQL char_length 와 같은 단위)
const cpOver = (s, max) => {
    if (s.length <= max) return false;
    let n = 0;
    for (const _ of s) { if (++n > max) return true; }
    return false;
};
const fail = (reason) => ({ ok: false, reason });

// ── jsonb 텍스트 바이트 ─────────────────────────────────────────────
// PostgreSQL jsonb 출력: 객체 {"k": v, "k2": v2}, 배열 [a, b] (쉼표·콜론 뒤 공백 하나), 문자열은 " \ \b \f \n \r \t 를
// 두 글자로, 그 밖의 0x20 미만은 \u00XX(여섯 글자)로 적고 나머지는 UTF-8 그대로.
// NUL·짝 없는 서로게이트는 jsonb 에 들어갈 수 없으므로 Infinity(= 저장 불가)로 돌려준다.
function stringBytes(s) {
    let n = 2;
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c === 0) return Infinity;
        if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x0c || c === 0x0a || c === 0x0d || c === 0x09) n += 2;
        else if (c < 0x20) n += 6;
        else if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            const d = s.charCodeAt(i + 1);
            if (!(d >= 0xdc00 && d <= 0xdfff)) return Infinity;
            n += 4; i += 1;
        } else if (c >= 0xdc00 && c <= 0xdfff) return Infinity;
        else n += 3;
    }
    return n;
}

// numeric 출력과 같은 숫자 표기(지수 표기는 소수로 편다)
function numberText(x) {
    if (!Number.isFinite(x)) return null;
    if (Object.is(x, -0)) return '0';
    const s = String(x);
    const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
    if (!m) return s;
    const [, sign, int, frac = '', expS] = m;
    const digits = int + frac;
    const point = 1 + Number(expS);
    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

// cap 을 넘는 순간 멈추고 그때까지의 값을 돌려준다(한도 비교용). 반복문(스택)이라 깊은 값에도 호출 스택이 넘치지 않는다.
export function jsonbTextBytes(value, cap = Infinity) {
    let total = 0;
    const stack = [value];
    while (stack.length) {
        const v = stack.pop();
        if (v === null || v === undefined) total += 4;
        else if (typeof v === 'boolean') total += v ? 4 : 5;
        else if (typeof v === 'number') {
            const t = numberText(v);
            if (t === null) return Infinity;
            total += t.length;
        } else if (typeof v === 'string') total += stringBytes(v);
        else if (Array.isArray(v)) {
            total += 2 + Math.max(0, v.length - 1) * 2;
            for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
        } else if (typeof v === 'object') {
            const keys = ownKeys(v);
            total += 2 + Math.max(0, keys.length - 1) * 2;
            for (const k of keys) {
                total += stringBytes(k) + 2;          // "키": 의 콜론·공백
                stack.push(v[k]);
            }
        } else return Infinity;                       // 함수·심볼·bigint 는 JSON 이 아니다
        if (total > cap) return total;
    }
    return total;
}

// ── 사진 참조(4-7) ─────────────────────────────────────────────────
// private: sb://post-images/<작성자 uuid>_… (서버 post_image_ref_ok(ref,'private',owner) 와 같다)
// public : <우리 Supabase>/storage/v1/object/public/images/<작성자 uuid>_… (서버 post_public_image_ok)
export function imageRefOk(ref, mode, ownerId) {
    if (typeof ref !== 'string' || !ownerId || ref.length > LIMITS.refMax) return false;
    if (mode === 'private') {
        return RE.privateRef.test(ref) && ref.startsWith(`${PRIVATE_REF_PREFIX}${ownerId}_`);
    }
    if (mode === 'public') {
        return ref.startsWith(`${PUBLIC_IMAGE_PREFIX}${ownerId}_`) && RE.fileName.test(ref.slice(PUBLIC_IMAGE_PREFIX.length));
    }
    return false;
}

// 링크 주소(4-6): 서버와 같은 정규식 + 렌더 직전 new URL 재검증. 통과하면 그 주소, 아니면 null.
export function safeHref(href) {
    if (typeof href !== 'string' || cpOver(href, LIMITS.hrefMax) || !RE.href.test(href)) return null;
    try {
        const u = new URL(href);
        if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) return null;
        return href;
    } catch {
        return null;
    }
}

// ── 검증 ───────────────────────────────────────────────────────────
const alignOk = (a) => !present(a, 'textAlign') || (typeof a.textAlign === 'string' && ALIGNS.includes(a.textAlign));
const inListItemFirst = (ptype, idx) => ptype === 'listItem' && idx === 0;
const listPlacementOk = (ptype, idx) => ptype === 'doc' || ptype === 'blockquote' || (ptype === 'listItem' && idx > 0);

function addFontChars(fonts, token, text) {
    let set = fonts.get(token);
    if (!set) { set = new Set(); fonts.set(token, set); }
    if (set.size >= LIMITS.fontCharsMax) return;
    for (const ch of text) {
        if (/\s/.test(ch)) continue;
        set.add(ch);
        if (set.size >= LIMITS.fontCharsMax) return;
    }
}

function checkMarks(marks) {
    if (!Array.isArray(marks) || marks.length > LIMITS.marks) return { error: 'MARKS' };
    const seen = new Set();
    let font = null;
    for (const m of marks) {
        if (!isObj(m) || !onlyKeys(m, ['type', 'attrs']) || typeof m.type !== 'string') return { error: 'MARK' };
        if (seen.has(m.type)) return { error: 'MARK_DUP' };
        seen.add(m.type);
        const a = m.attrs;
        if (PLAIN_MARKS.includes(m.type)) {
            if (a !== undefined && a !== null && !(isObj(a) && ownKeys(a).length === 0)) return { error: 'MARK_ATTRS' };
        } else if (m.type === 'link') {
            if (!isObj(a) || !onlyKeys(a, ['href']) || typeof a.href !== 'string'
                || cpOver(a.href, LIMITS.hrefMax) || !RE.href.test(a.href)) return { error: 'LINK' };
        } else if (m.type === 'textStyle') {
            if (!isObj(a) || !onlyKeys(a, TEXT_STYLE_KEYS)) return { error: 'TEXT_STYLE' };
            let any = false;
            if (present(a, 'fontFamily')) {
                if (typeof a.fontFamily !== 'string' || !FONT_TOKENS.includes(a.fontFamily)) return { error: 'TEXT_STYLE' };
                any = true; font = a.fontFamily;
            }
            if (present(a, 'fontSize')) {
                if (typeof a.fontSize !== 'number' || !FONT_SIZES.includes(a.fontSize)) return { error: 'TEXT_STYLE' };
                any = true;
            }
            if (present(a, 'color')) {
                if (typeof a.color !== 'string' || !COLORS.includes(a.color)) return { error: 'TEXT_STYLE' };
                any = true;
            }
            if (present(a, 'backgroundColor')) {
                if (typeof a.backgroundColor !== 'string' || !BG_COLORS.includes(a.backgroundColor)) return { error: 'TEXT_STYLE' };
                any = true;
            }
            if (!any) return { error: 'TEXT_STYLE' };
        } else return { error: 'MARK_TYPE' };
    }
    return { font };
}

// opts.mode: 'private' | 'public' | 'none', opts.ownerId: 작성자 uuid, opts.collectFonts: 글꼴별 사용 글자 수집
// 통과: { ok: true, images, maps, media, fonts? } / 거부: { ok: false, reason }
// 글꼴은 끝까지 통과한 문서에서만 돌려준다(검증 실패 문서의 글꼴은 받지 않는다 — 설계 5-1).
export function validateDoc(env, { mode = 'none', ownerId = null, collectFonts = false } = {}) {
    if (!isObj(env)) return fail('ENVELOPE');
    if (jsonbTextBytes(env, LIMITS.docBytes) > LIMITS.docBytes) return fail('TOO_LARGE');
    if (!hasOwn(env, 'v') || !hasOwn(env, 'doc') || !onlyKeys(env, ['v', 'doc'])) return fail('ENVELOPE');
    if (env.v !== DOC_VERSION) return fail('VERSION');

    const images = [];
    const imageSet = new Set();
    const maps = [];
    let media = 0;
    const fonts = collectFonts ? new Map() : null;
    const addImage = (ref) => {
        if (!imageRefOk(ref, mode, ownerId)) return 'IMAGE_REF';
        if (imageSet.has(ref)) return 'IMAGE_DUP';
        imageSet.add(ref);
        images.push(ref);
        return images.length > LIMITS.images ? 'TOO_MANY_IMAGES' : null;
    };

    // [노드, 부모 종류, 부모 안 순서, 깊이]
    const stack = [[env.doc, '', 0, 0]];
    let count = 1;
    while (stack.length) {
        const [node, ptype, idx, depth] = stack.pop();
        if (!isObj(node)) return fail('NODE');
        const t = typeof node.type === 'string' ? node.type : null;
        let push = false;
        let min = 0;
        switch (t) {
            case 'doc':
                if (ptype !== '') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.doc)) return fail('KEYS');
                push = true; min = 1;
                break;
            case 'paragraph':
                if (!(ptype === 'doc' || ptype === 'blockquote' || inListItemFirst(ptype, idx))) return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.paragraph)) return fail('KEYS');
                if (present(node, 'attrs')) {
                    if (!isObj(node.attrs) || !onlyKeys(node.attrs, ATTR_KEYS.paragraph)) return fail('ATTRS');
                    if (!alignOk(node.attrs)) return fail('ALIGN');
                }
                push = true;
                break;
            case 'heading': {
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.heading)) return fail('KEYS');
                const a = node.attrs;
                if (!isObj(a) || !onlyKeys(a, ATTR_KEYS.heading) || a.level !== 2) return fail('HEADING');
                if (!alignOk(a)) return fail('ALIGN');
                push = true;
                break;
            }
            case 'blockquote':
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.blockquote)) return fail('KEYS');
                push = true; min = 1;
                break;
            case 'bulletList':
                if (!listPlacementOk(ptype, idx)) return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.bulletList)) return fail('KEYS');
                push = true; min = 1;
                break;
            case 'orderedList':
                if (!listPlacementOk(ptype, idx)) return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.orderedList)) return fail('KEYS');
                if (present(node, 'attrs')) {
                    const a = node.attrs;
                    if (!isObj(a) || !onlyKeys(a, ATTR_KEYS.orderedList)) return fail('ATTRS');
                    if (present(a, 'start') && !(Number.isInteger(a.start) && a.start >= 1 && a.start <= LIMITS.orderedStartMax)) return fail('LIST_START');
                    if (present(a, 'type')) return fail('ATTRS');
                }
                push = true; min = 1;
                break;
            case 'listItem':
                if (ptype !== 'bulletList' && ptype !== 'orderedList') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.listItem)) return fail('KEYS');
                push = true; min = 1;
                break;
            case 'horizontalRule':
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.horizontalRule)) return fail('KEYS');
                break;
            case 'hardBreak':
                if (ptype !== 'paragraph' && ptype !== 'heading') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.hardBreak)) return fail('KEYS');
                break;
            case 'text': {
                if (ptype !== 'paragraph' && ptype !== 'heading') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.text)) return fail('KEYS');
                const s = node.text;
                if (typeof s !== 'string' || s === '' || cpOver(s, LIMITS.textChars) || RE.ctrl.test(s)) return fail('TEXT');
                if (hasOwn(node, 'marks')) {
                    const r = checkMarks(node.marks);
                    if (r.error) return fail(r.error);
                    if (fonts && r.font) addFontChars(fonts, r.font, s);
                }
                break;
            }
            case 'image': {
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (mode !== 'private' && mode !== 'public') return fail('MEDIA_NOT_ALLOWED');
                if (!onlyKeys(node, NODE_KEYS.image)) return fail('KEYS');
                const a = node.attrs;
                if (!isObj(a) || !onlyKeys(a, ATTR_KEYS.image) || typeof a.src !== 'string') return fail('ATTRS');
                const e = addImage(a.src);
                if (e) return fail(e);
                media += 1;
                break;
            }
            case 'gallery': {
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (mode !== 'private' && mode !== 'public') return fail('MEDIA_NOT_ALLOWED');
                if (!onlyKeys(node, NODE_KEYS.gallery)) return fail('KEYS');
                const a = node.attrs;
                if (!isObj(a) || !onlyKeys(a, ATTR_KEYS.gallery) || typeof a.layout !== 'string' || !GALLERY_LAYOUTS.includes(a.layout)
                    || !Array.isArray(a.images) || a.images.length < LIMITS.galleryMin || a.images.length > LIMITS.galleryMax) return fail('GALLERY');
                for (const ref of a.images) {
                    if (typeof ref !== 'string') return fail('IMAGE_REF');
                    const e = addImage(ref);
                    if (e) return fail(e);
                }
                media += 1;
                break;
            }
            case 'map': {
                if (ptype !== 'doc') return fail('PLACEMENT');
                if (!onlyKeys(node, NODE_KEYS.map)) return fail('KEYS');
                const e = mapAttrsError(node.attrs);
                if (e) return fail(e);
                maps.push(node.attrs);
                if (maps.length > LIMITS.maps) return fail('TOO_MANY_MAPS');
                media += 1;
                break;
            }
            case 'file':
                // PDF 첨부는 4단계(post-files 버킷·검증)에서 서버 검증과 함께 연다. 그 전까지는 화면·서버 모두 거부한다
                // (schema.js FILES_ENABLED = false, ALLOWED_NODES 에 없음).
                return fail('FILE_NOT_ENABLED');
            default:
                return fail('NODE_TYPE');
        }
        if (push) {
            const c = node.content;
            if (c === undefined) {
                if (min > 0) return fail('CONTENT');
            } else {
                if (!Array.isArray(c) || c.length < min) return fail('CONTENT');
                if (c.length > 0) {
                    // 자식을 스택에 넣기 전에 깊이·누계 노드 수를 본다(넘으면 그 자리에서 중단)
                    if (depth + 1 > LIMITS.depth) return fail('TOO_DEEP');
                    count += c.length;
                    if (count > LIMITS.nodes) return fail('TOO_MANY_NODES');
                    for (let i = c.length - 1; i >= 0; i -= 1) stack.push([c[i], t, i, depth + 1]);
                }
            }
        }
    }
    const out = { ok: true, images, maps, media };
    if (fonts) out.fonts = Object.fromEntries([...fonts].map(([k, set]) => [k, [...set].join('')]));
    return out;
}

// ── 상세 화면 진입점 ─────────────────────────────────────────────────
const PREPARED = Symbol('ct.richPrepared');

function deepFreeze(root) {
    const stack = [root];
    while (stack.length) {
        const v = stack.pop();
        if (v && typeof v === 'object' && !Object.isFrozen(v)) {
            Object.freeze(v);
            for (const k of Object.keys(v)) stack.push(v[k]);
        }
    }
    return root;
}

// 표식은 열거되지 않는 Symbol 속성 — 객체를 펼쳐 복사({ ...prepared })하면 따라가지 않는다
const mark = (o) => Object.freeze(Object.defineProperty(o, PREPARED, { value: true }));

// 게시판 규칙(boardKey → 사진 규칙)과 작성자 id 로 한 번 검증한다. 반환은 얼린 객체이고 모듈 전용 표식을 단다.
//   통과 { ok: true, doc, images, files, maps, fonts } / 실패 { ok: false, reason }
export function prepareRichDoc(raw, boardKey, ownerId) {
    const r = validateDoc(raw, { mode: mediaOf(boardKey), ownerId, collectFonts: true });
    if (!r.ok) return mark({ ok: false, reason: r.reason });
    let doc;
    try {
        doc = deepFreeze(JSON.parse(JSON.stringify(raw.doc)));
    } catch {
        return mark({ ok: false, reason: 'CLONE' });
    }
    return mark({
        ok: true,
        doc,
        images: Object.freeze([...r.images]),
        files: Object.freeze([]),
        maps: Object.freeze(docMaps({ doc })),
        fonts: Object.freeze({ ...r.fonts }),
    });
}

export const isPreparedDoc = (v) => !!v && v[PREPARED] === true;

// ── 파생(검증 없이도 안전하게 동작 — 원고·옛 데이터용) ─────────────────────
// 봉투({v, doc}) 또는 doc 노드 자체를 받는다
const rootOf = (input) => {
    if (!isObj(input)) return null;
    const r = input.type === 'doc' ? input : input.doc;
    return isObj(r) && r.type === 'doc' ? r : null;
};
const CONTAINERS = ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'];
const TEXT_BLOCKS = ['paragraph', 'heading'];

// 평문 파생(4-10, 서버 rich_doc_plain 과 같은 결과):
// 문단·소제목마다 한 줄(글 이어 붙임, 줄바꿈 노드 = \n), 줄들을 \n 으로 잇고 끝의 \n 을 지운다.
// 인용구·목록은 안의 문단들을 같은 방식으로 잇는다(기호·번호 없음). 사진·묶음·파일·지도·구분선은 아무것도 내지 않는다.
export function docToPlain(input) {
    const root = rootOf(input);
    if (!root) return '';
    const lines = [];
    const stack = [root];
    while (stack.length) {
        const node = stack.pop();
        if (TEXT_BLOCKS.includes(node.type)) {
            const kids = Array.isArray(node.content) ? node.content : [];
            let line = '';
            for (const k of kids) {
                if (!isObj(k)) continue;
                if (k.type === 'text' && typeof k.text === 'string') line += k.text;
                else if (k.type === 'hardBreak') line += '\n';
            }
            lines.push(line);
            continue;
        }
        const kids = Array.isArray(node.content) ? node.content : [];
        for (let i = kids.length - 1; i >= 0; i -= 1) {
            const k = kids[i];
            if (isObj(k) && (CONTAINERS.includes(k.type) || TEXT_BLOCKS.includes(k.type)) && k.type !== 'doc') stack.push(k);
        }
    }
    return lines.join('\n').replace(/\n+$/, '');
}

// 문서 최상위의 사진 참조(단일 사진 + 묶음, 문서 순서, 중복 없음). 서버 rich_doc_images 와 같다.
export function docImages(input) {
    const root = rootOf(input);
    const out = [];
    const seen = new Set();
    const add = (v) => { if (typeof v === 'string' && !seen.has(v)) { seen.add(v); out.push(v); } };
    for (const n of Array.isArray(root?.content) ? root.content : []) {
        if (!isObj(n) || !isObj(n.attrs)) continue;
        if (n.type === 'image') add(n.attrs.src);
        else if (n.type === 'gallery' && Array.isArray(n.attrs.images)) n.attrs.images.forEach(add);
    }
    return out;
}

// 문서 최상위의 지도 속성 목록
export function docMaps(input) {
    const root = rootOf(input);
    return (Array.isArray(root?.content) ? root.content : [])
        .filter((n) => isObj(n) && n.type === 'map' && isObj(n.attrs))
        .map((n) => n.attrs);
}

// 빈 글(4-10): 평문이 공백뿐이고 사진·묶음·파일·지도가 없으면 빈 글. 구분선만 = 빈 글. 사진만·지도만 = 허용.
export function isDocEmpty(input) {
    const root = rootOf(input);
    const hasMedia = (Array.isArray(root?.content) ? root.content : [])
        .some((n) => isObj(n) && MEDIA_NODES.includes(n.type));
    return !hasMedia && RE.wsOnly.test(docToPlain(input));
}

// ── 옛 평문 → 문서 ─────────────────────────────────────────────────
const CTRL_ALL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;   // eslint-disable-line no-control-regex

// 짝 없는 서로게이트를 U+FFFD 로(jsonb 가 거부한다). 정규식 뒤돌아보기는 옛 사파리가 못 읽어 쓰지 않는다.
function wellFormed(s) {
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i += 1; } else out += '\ufffd';
        } else if (c >= 0xdc00 && c <= 0xdfff) out += '\ufffd';
        else out += s[i];
    }
    return out;
}
const cleanText = (s) => (typeof s === 'string' ? wellFormed(s.replace(CTRL_ALL, '')) : '');

// 코드포인트 기준으로 max 씩 자른다(텍스트 노드 한도)
function splitCp(s, max) {
    if (!cpOver(s, max)) return [s];
    const cps = Array.from(s);
    const out = [];
    for (let i = 0; i < cps.length; i += max) out.push(cps.slice(i, i + max).join(''));
    return out;
}

const textNodes = (s) => (s ? splitCp(s, LIMITS.textChars).map((text) => ({ type: 'text', text })) : []);
// 줄마다 문단(노드 2개)으로 만들 수 있는 최대 줄 수. 넘는 나머지 줄은 마지막 문단 하나에 \n 째로 담는다
// (텍스트 노드는 \n 을 담을 수 있고 평문 파생 결과가 같다). 노드 한도(1만)를 넘지 않게.
const PLAIN_LINE_PARAGRAPHS = 4000;

export function plainToDoc(text) {
    const s = cleanText(String(text ?? '').replace(/\r\n?/g, '\n'));
    const lines = s.split('\n');
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const head = lines.slice(0, PLAIN_LINE_PARAGRAPHS);
    const rest = lines.slice(PLAIN_LINE_PARAGRAPHS);
    const content = head.map((line) => {
        const kids = textNodes(line);
        return kids.length ? { type: 'paragraph', content: kids } : { type: 'paragraph' };
    });
    if (rest.length) {
        const kids = textNodes(rest.join('\n'));
        content.push(kids.length ? { type: 'paragraph', content: kids } : { type: 'paragraph' });
    }
    return { v: DOC_VERSION, doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] } };
}

// ── 정규화 ─────────────────────────────────────────────────────────
// new URL 로 해석해 http(s)·userinfo 없음·호스트 있음이면 정규화한 주소, 아니면 null
export function normalizeHref(input) {
    if (typeof input !== 'string') return null;
    const raw = input.trim();
    if (!raw) return null;
    try {
        const u = new URL(raw);
        if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) return null;
        return safeHref(u.href);
    } catch {
        return null;
    }
}

function cleanTextStyle(a) {
    if (!isObj(a)) return null;
    const out = {};
    if (typeof a.fontFamily === 'string' && FONT_TOKENS.includes(a.fontFamily)) out.fontFamily = a.fontFamily;
    if (typeof a.fontSize === 'number' && FONT_SIZES.includes(a.fontSize) && a.fontSize !== DEFAULT_FONT_SIZE) out.fontSize = a.fontSize;
    const color = typeof a.color === 'string' ? a.color.toLowerCase() : '';
    if (COLORS.includes(color)) out.color = color;
    const bg = typeof a.backgroundColor === 'string' ? a.backgroundColor.toLowerCase() : '';
    if (BG_COLORS.includes(bg)) out.backgroundColor = bg;
    return Object.keys(out).length ? out : null;
}

function cleanMarks(marks) {
    if (!Array.isArray(marks)) return [];
    const out = [];
    const seen = new Set();
    for (const m of marks) {
        if (out.length >= LIMITS.marks) break;
        if (!isObj(m) || typeof m.type !== 'string' || seen.has(m.type)) continue;
        if (PLAIN_MARKS.includes(m.type)) {
            out.push({ type: m.type });
        } else if (m.type === 'link') {
            const href = normalizeHref(isObj(m.attrs) ? m.attrs.href : null);
            if (!href) continue;
            out.push({ type: 'link', attrs: { href } });
        } else if (m.type === 'textStyle') {
            const attrs = cleanTextStyle(m.attrs);
            if (!attrs) continue;
            out.push({ type: 'textStyle', attrs });
        } else continue;
        seen.add(m.type);
    }
    return out;
}

function cleanInline(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const n of list) {
        if (!isObj(n)) continue;
        if (n.type === 'text') {
            const text = cleanText(n.text);
            if (!text) continue;
            const marks = cleanMarks(n.marks);
            for (const chunk of splitCp(text, LIMITS.textChars)) {
                out.push(marks.length ? { type: 'text', text: chunk, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text: chunk });
            }
        } else if (n.type === 'hardBreak') {
            out.push({ type: 'hardBreak' });
        }
    }
    return out;
}

function cleanTextBlock(n, type, depth) {
    const align = isObj(n.attrs) && ALIGNS.includes(n.attrs.textAlign) ? n.attrs.textAlign : null;
    const node = { type };
    if (type === 'heading') node.attrs = align ? { level: 2, textAlign: align } : { level: 2 };
    else if (align) node.attrs = { textAlign: align };
    const inline = depth + 1 <= LIMITS.depth ? cleanInline(n.content) : [];
    if (inline.length) node.content = inline;
    return node;
}

const cleanLine = (s, max) => {
    const t = cleanText(s).replace(/[\t\n\r]/g, ' ').trim();
    return cpOver(t, max) ? Array.from(t).slice(0, max).join('') : t;
};

function cleanMap(a, st) {
    if (!isObj(a) || st.maps >= LIMITS.maps) return null;
    const out = { name: cleanLine(a.name, LIMITS.mapNameMax) };
    if (placeIdOk(a.placeId)) out.placeId = a.placeId;
    if (typeof a.address === 'string') {
        const addr = cleanLine(a.address, LIMITS.mapAddressMax);
        if (addr) out.address = addr;
    }
    if (typeof a.lat === 'number' && typeof a.lng === 'number' && Number.isFinite(a.lat) && Number.isFinite(a.lng)) {
        out.lat = Math.round(a.lat * 1e6) / 1e6;
        out.lng = Math.round(a.lng * 1e6) / 1e6;
    }
    if (typeof a.url === 'string' && RE.mapUrl.test(a.url) && !cpOver(a.url, LIMITS.mapUrlMax)) out.url = a.url;
    if (mapAttrsError(out)) return null;
    st.maps += 1;
    return { type: 'map', attrs: out };
}

function cleanMedia(n, st) {
    if (n.type === 'map') return cleanMap(n.attrs, st);
    if (st.mode !== 'private' && st.mode !== 'public') return null;
    const a = isObj(n.attrs) ? n.attrs : {};
    const take = (ref) => {
        if (!imageRefOk(ref, st.mode, st.ownerId) || st.seen.has(ref) || st.seen.size >= LIMITS.images) return false;
        st.seen.add(ref);
        return true;
    };
    if (n.type === 'image') return take(a.src) ? { type: 'image', attrs: { src: a.src } } : null;
    // gallery: 쓸 수 있는 사진만 남긴다. 2장 이상 = 묶음, 1장 = 단일 사진, 0장 = 버림
    const list = [];
    for (const ref of Array.isArray(a.images) ? a.images : []) {
        if (list.length >= LIMITS.galleryMax) break;
        if (take(ref)) list.push(ref);
    }
    if (list.length === 0) return null;
    if (list.length === 1) return { type: 'image', attrs: { src: list[0] } };
    const layout = GALLERY_LAYOUTS.includes(a.layout) ? a.layout : 'grid';
    return { type: 'gallery', attrs: { layout, images: list } };
}

const isList = (n) => n.type === 'bulletList' || n.type === 'orderedList';

function cleanList(n, depth, st) {
    // 목록(depth) → 항목(depth+1) → 첫 문단(depth+2). 문단이 들어갈 깊이가 없으면 목록을 버린다.
    if (depth + 2 > LIMITS.depth || !Array.isArray(n.content)) return null;
    const items = [];
    for (const it of n.content) {
        if (!isObj(it) || it.type !== 'listItem') continue;
        const kids = cleanBlocks(it.content, 'listItem', depth + 2, st);
        if (!kids.length || kids[0].type !== 'paragraph') kids.unshift({ type: 'paragraph' });
        items.push({ type: 'listItem', content: kids });
    }
    if (!items.length) return null;
    if (n.type === 'orderedList') {
        const start = isObj(n.attrs) ? n.attrs.start : undefined;
        const node = { type: 'orderedList' };
        if (Number.isInteger(start) && start > 1 && start <= LIMITS.orderedStartMax) node.attrs = { start };
        node.content = items;
        return node;
    }
    return { type: 'bulletList', content: items };
}

// parent: 'doc' | 'blockquote' | 'listItem'. 그 자리에 올 수 없는 노드는 버리거나(사진·지도·구분선) 풀어서(중첩 인용구) 옮긴다.
function cleanBlocks(list, parent, depth, st) {
    const out = [];
    if (!Array.isArray(list) || depth > LIMITS.depth) return out;
    for (const n of list) {
        if (!isObj(n)) continue;
        switch (n.type) {
            case 'paragraph':
                out.push(cleanTextBlock(n, 'paragraph', depth));
                break;
            case 'heading':
                out.push(cleanTextBlock(n, parent === 'doc' ? 'heading' : 'paragraph', depth));
                break;
            case 'blockquote':
                if (parent === 'doc') {
                    const kids = cleanBlocks(n.content, 'blockquote', depth + 1, st).filter((k) => k.type === 'paragraph' || isList(k));
                    if (kids.length) out.push({ type: 'blockquote', content: kids });
                } else {
                    out.push(...cleanBlocks(n.content, parent, depth, st));
                }
                break;
            case 'bulletList':
            case 'orderedList': {
                const l = cleanList(n, depth, st);
                if (l) out.push(l);
                break;
            }
            case 'horizontalRule':
                if (parent === 'doc') out.push({ type: 'horizontalRule' });
                break;
            case 'image':
            case 'gallery':
            case 'map':
                if (parent === 'doc') {
                    const m = cleanMedia(n, st);
                    if (m) out.push(m);
                }
                break;
            default:
                break;      // file(4단계 전)·떠돌이 listItem·모르는 노드
        }
    }
    return out;
}

// 편집기 JSON(doc 노드) 또는 봉투를 받아 규칙 안의 봉투로 다시 짓는다. 한도(노드 수·바이트)는 validateDoc 이 본다.
export function sanitizeDoc(input, boardKey, ownerId) {
    const root = rootOf(input);
    const st = { mode: mediaOf(boardKey), ownerId, seen: new Set(), maps: 0 };
    const content = root ? cleanBlocks(root.content, 'doc', 1, st) : [];
    return { v: DOC_VERSION, doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] } };
}
