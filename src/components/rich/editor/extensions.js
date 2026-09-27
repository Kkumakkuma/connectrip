// 서식 편집기 스키마·동작 확장(2026-09-27 서식 편집기 2단계, 설계 plan_v3 4·6장 + plan_stage2).
// 편집기가 만들 수 있는 문서 = 서버 rich_doc_check 가 받는 문서가 되도록 노드·마크·속성을 맞춘다.
//  - 글자 모양(textStyle)·정렬(textAlign)은 토큰만 저장한다. HTML 에서 읽을 때는 style 이 아니라 붙여넣기 정리기가
//    남긴 data-ct-* 만 읽는다(6-5). 화면에 그릴 때만 토큰 → style.
//  - 인용구 = 문단·목록만, 목록 항목 = 문단 1개 + 하위 목록. 소제목은 2단계(h2) 하나.
//  - 사진·묶음·지도·영상은 문서 최상위 블록(atom). 편집기 안에서는 iframe 없이 카드로 그린다(nodeViews.jsx).
import { Extension, Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Blockquote from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import {
    ALIGNS, BG_COLORS, COLORS, DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES, FONT_TOKENS, GALLERY_LAYOUTS, LIMITS,
    VIDEO_PROVIDERS, mediaOf,
} from '../../../lib/rich/schema';
import { normalizeHref } from '../../../lib/rich/doc';
import { cleanPastedHtml, pasteRefOk } from '../../../lib/rich/pasteFilter';
import { isAndroidUA, runWhenNotComposing } from '../../../lib/rich/composition';
import { createMediaStore } from './mediaStore';
import { GalleryView, ImageView, MapView, VideoView } from './nodeViews';

// ── 글자 모양(토큰) ───────────────────────────────────────────────────
const tokenAttr = (dataName, ok, toValue = (v) => v) => ({
    default: null,
    parseHTML: (el) => {
        const raw = el.getAttribute(dataName);
        const v = raw == null ? null : toValue(raw);
        return ok(v) ? v : null;
    },
    renderHTML: () => ({}),      // 아래 renderHTML 에서 한 번에 만든다
});

export const CtTextStyle = Mark.create({
    name: 'textStyle',
    priority: 101,
    addAttributes() {
        return {
            fontFamily: tokenAttr('data-ct-font', (v) => FONT_TOKENS.includes(v)),
            fontSize: tokenAttr('data-ct-size', (v) => FONT_SIZES.includes(v) && v !== DEFAULT_FONT_SIZE, Number),
            color: tokenAttr('data-ct-color', (v) => COLORS.includes(v)),
            backgroundColor: tokenAttr('data-ct-bg', (v) => BG_COLORS.includes(v)),
        };
    },
    parseHTML() {
        return [{
            tag: 'span',
            getAttrs: (el) => (['data-ct-font', 'data-ct-size', 'data-ct-color', 'data-ct-bg'].some((a) => el.hasAttribute(a)) ? {} : false),
        }];
    },
    renderHTML({ mark }) {
        const a = mark.attrs;
        const style = [];
        const data = {};
        if (FONT_FAMILIES[a.fontFamily]) { style.push(`font-family: ${FONT_FAMILIES[a.fontFamily]}`); data['data-ct-font'] = a.fontFamily; }
        if (FONT_SIZES.includes(a.fontSize) && a.fontSize !== DEFAULT_FONT_SIZE) { style.push(`font-size: ${a.fontSize}px`); data['data-ct-size'] = String(a.fontSize); }
        if (COLORS.includes(a.color)) { style.push(`color: ${a.color}`); data['data-ct-color'] = a.color; }
        if (BG_COLORS.includes(a.backgroundColor)) { style.push(`background-color: ${a.backgroundColor}`); data['data-ct-bg'] = a.backgroundColor; }
        return ['span', { ...data, style: style.join('; ') || null }, 0];
    },
    addCommands() {
        return {
            // key: fontFamily | fontSize | color | backgroundColor, value: 토큰(null = 지우기)
            setTextToken: (key, value) => ({ chain }) => chain().setMark('textStyle', { [key]: value ?? null }).removeEmptyTextStyle().run(),
            removeEmptyTextStyle: () => ({ tr }) => {
                const { selection } = tr;
                tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                    if (!node.isInline) return true;
                    const has = node.marks.filter((m) => m.type === this.type).some((m) => Object.values(m.attrs).some((v) => v != null));
                    if (!has) tr.removeMark(pos, pos + node.nodeSize, this.type);
                    return true;
                });
                // 커서만 있을 때(빈 선택)는 저장된 마크에서도 빈 글자 모양을 뺀다
                const stored = tr.storedMarks || selection.$from.marks();
                const ts = stored.find((m) => m.type === this.type);
                if (ts && !Object.values(ts.attrs).some((v) => v != null)) tr.setStoredMarks(stored.filter((m) => m !== ts));
                return true;
            },
        };
    },
});

// ── 정렬(문단·소제목, 가운데·오른쪽만 저장) ─────────────────────────────
export const CtTextAlign = Extension.create({
    name: 'ctTextAlign',
    addGlobalAttributes() {
        return [{
            types: ['paragraph', 'heading'],
            attributes: {
                textAlign: {
                    default: null,
                    parseHTML: (el) => {
                        const a = el.getAttribute('data-ct-align');
                        return ALIGNS.includes(a) ? a : null;
                    },
                    renderHTML: (attrs) => (ALIGNS.includes(attrs.textAlign)
                        ? { style: `text-align: ${attrs.textAlign}`, 'data-ct-align': attrs.textAlign }
                        : {}),
                },
            },
        }];
    },
    addCommands() {
        return {
            setCtAlign: (align) => ({ commands }) => {
                const v = ALIGNS.includes(align) ? align : null;
                return ['paragraph', 'heading'].map((t) => commands.updateAttributes(t, { textAlign: v })).some(Boolean);
            },
        };
    },
});

// ── 사진·묶음·지도·영상 노드 ─────────────────────────────────────────
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const CtImage = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
        return { src: { default: null, parseHTML: (el) => el.getAttribute('data-ct-src'), renderHTML: () => ({}) } };
    },
    parseHTML() { return [{ tag: 'div[data-ct-node="image"]' }]; },
    renderHTML({ node }) { return ['div', { 'data-ct-node': 'image', 'data-ct-src': node.attrs.src }]; },
    addOptions() { return { nodeView: true }; },
    // 테스트(jsdom, React 없이)에서는 nodeView: false 로 칸 그리기를 끈다
    addNodeView() { return this.options.nodeView === false ? null : ReactNodeViewRenderer(ImageView); },
});

export const CtGallery = Node.create({
    name: 'gallery',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
        return {
            layout: {
                default: 'grid',
                parseHTML: (el) => (GALLERY_LAYOUTS.includes(el.getAttribute('data-ct-layout')) ? el.getAttribute('data-ct-layout') : 'grid'),
                renderHTML: () => ({}),
            },
            images: {
                default: [],
                parseHTML: (el) => {
                    const v = parseJson(el.getAttribute('data-ct-images') || '');
                    return Array.isArray(v) ? v.filter((r) => typeof r === 'string').slice(0, LIMITS.galleryMax) : [];
                },
                renderHTML: () => ({}),
            },
        };
    },
    parseHTML() { return [{ tag: 'div[data-ct-node="gallery"]' }]; },
    renderHTML({ node }) {
        return ['div', { 'data-ct-node': 'gallery', 'data-ct-layout': node.attrs.layout, 'data-ct-images': JSON.stringify(node.attrs.images || []) }];
    },
    addOptions() { return { nodeView: true }; },
    // 테스트(jsdom, React 없이)에서는 nodeView: false 로 칸 그리기를 끈다
    addNodeView() { return this.options.nodeView === false ? null : ReactNodeViewRenderer(GalleryView); },
});

const MAP_KEYS = ['placeId', 'name', 'address', 'lat', 'lng', 'url'];
const mapJsonCache = new WeakMap();
const mapJsonOf = (el) => {
    if (!mapJsonCache.has(el)) mapJsonCache.set(el, parseJson(el.getAttribute('data-ct-map') || ''));
    return mapJsonCache.get(el);
};
export const CtMap = Node.create({
    name: 'map',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
        const out = {};
        for (const k of MAP_KEYS) {
            out[k] = {
                default: null,
                parseHTML: (el) => {
                    const a = mapJsonOf(el);
                    return a && a[k] !== undefined ? a[k] : null;
                },
                renderHTML: () => ({}),
            };
        }
        return out;
    },
    parseHTML() { return [{ tag: 'div[data-ct-node="map"]' }]; },
    renderHTML({ node }) {
        const keep = {};
        for (const k of MAP_KEYS) if (node.attrs[k] !== null && node.attrs[k] !== undefined) keep[k] = node.attrs[k];
        return ['div', { 'data-ct-node': 'map', 'data-ct-map': JSON.stringify(keep) }];
    },
    addOptions() { return { nodeView: true }; },
    // 테스트(jsdom, React 없이)에서는 nodeView: false 로 칸 그리기를 끈다
    addNodeView() { return this.options.nodeView === false ? null : ReactNodeViewRenderer(MapView); },
});

export const CtVideo = Node.create({
    name: 'video',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
        return {
            provider: {
                default: null,
                parseHTML: (el) => (VIDEO_PROVIDERS.includes(el.getAttribute('data-ct-provider')) ? el.getAttribute('data-ct-provider') : null),
                renderHTML: () => ({}),
            },
            id: { default: null, parseHTML: (el) => el.getAttribute('data-ct-id'), renderHTML: () => ({}) },
        };
    },
    parseHTML() { return [{ tag: 'div[data-ct-node="video"]' }]; },
    renderHTML({ node }) {
        return ['div', { 'data-ct-node': 'video', 'data-ct-provider': node.attrs.provider, 'data-ct-id': node.attrs.id }];
    },
    addOptions() { return { nodeView: true }; },
    // 테스트(jsdom, React 없이)에서는 nodeView: false 로 칸 그리기를 끈다
    addNodeView() { return this.options.nodeView === false ? null : ReactNodeViewRenderer(VideoView); },
});

// ── 사진 저장소 + 붙여넣기·끌어 놓기 규칙 ─────────────────────────────
const mediaRefsOf = (node) => (node.type.name === 'image' ? [node.attrs.src]
    : node.type.name === 'gallery' ? (node.attrs.images || []) : []);

function docRefSet(doc) {
    const set = new Set();
    doc.forEach((n) => { for (const r of mediaRefsOf(n)) if (typeof r === 'string') set.add(r); });
    return set;
}

// 붙인 조각에서 이미 문서에 있는 사진을 뺀다(같은 사진 두 번 = 서버가 거부). 묶음은 남은 장수 규칙.
function dedupeSlice(slice, view, notice) {
    const have = docRefSet(view.state.doc);
    // 붙이면서 바뀔 선택 영역 안의 사진은 곧 사라지므로 "이미 있음"으로 치지 않는다(사진을 골라 그 위에 같은 사진을 붙이면
    // 둘 다 사라지던 경로 — agy)
    const { from, to } = view.state.selection;
    if (from !== to) {
        view.state.doc.nodesBetween(from, to, (n) => {
            for (const r of mediaRefsOf(n)) have.delete(r);
        });
    }
    let dropped = 0;
    const schema = view.state.schema;
    const mapFragment = (frag) => {
        const out = [];
        frag.forEach((n) => {
            if (n.type.name === 'image') {
                if (have.has(n.attrs.src)) { dropped += 1; return; }
                have.add(n.attrs.src);
                out.push(n);
            } else if (n.type.name === 'gallery') {
                const keep = [];
                for (const r of n.attrs.images || []) {
                    if (have.has(r)) { dropped += 1; continue; }
                    have.add(r);
                    keep.push(r);
                }
                if (keep.length >= 2) out.push(n.type.create({ ...n.attrs, images: keep }));
                else if (keep.length === 1) out.push(schema.nodes.image.create({ src: keep[0] }));
            } else if (n.content.size) {
                out.push(n.copy(mapFragment(n.content)));
            } else {
                out.push(n);
            }
        });
        return Fragment.fromArray(out);
    };
    const content = mapFragment(slice.content);
    if (!dropped) return slice;
    notice?.('같은 사진은 글에 한 번만 넣을 수 있어요.');
    if (content.size === 0) return Slice.empty;           // 다 빠지면 빈 조각(여는 깊이가 남은 빈 조각은 규칙 위반, agy)
    return new Slice(content, slice.openStart, slice.openEnd);
}

const hasFiles = (dt) => !!dt && ((dt.files && dt.files.length > 0) || [...(dt.items || [])].some((i) => i.kind === 'file'));

export const CtMedia = Extension.create({
    name: 'ctMedia',
    addOptions() {
        return { boardKey: 'qna', userId: null, maxChars: 20000, plainLength: () => 0 };
    },
    addStorage() {
        return createMediaStore({ boardKey: this.options.boardKey, userId: this.options.userId });
    },
    addProseMirrorPlugins() {
        const store = this.storage;
        const opts = this.options;
        const notice = (t) => store.notice(t);
        const mode = mediaOf(opts.boardKey);
        const refOk = pasteRefOk({ mode, ownerId: opts.userId, pendingOk: (r) => store.isPendingKey(r) });
        const photoHint = mode === 'none' ? '이 게시판에는 사진을 넣을 수 없어요.' : '사진은 사진 버튼으로 넣어 주세요.';
        return [new Plugin({
            key: new PluginKey('ctPaste'),
            props: {
                // 1) 붙인 HTML 은 <template> 조각에서만 해석하고 허용 목록 HTML 로 다시 짓는다(6-5)
                transformPastedHTML: (html) => {
                    const { html: out, droppedImages } = cleanPastedHtml(html, { refOk });
                    if (droppedImages > 0) notice(photoHint);
                    return out;
                },
                // 2) 같은 사진 중복 제거(편집기 안 이동 끌기는 원래 자리가 지워지므로 건너뛴다)
                transformPasted: (slice, view) => {
                    if (view.dragging && view.dragging.move) return slice;
                    return dedupeSlice(slice, view, notice);
                },
                // 3) 저장 중에는 아무것도 붙지 않는다. 사진 파일만 붙이면 막고 안내. 글자 수 한도를 넘기면 막고 안내.
                handlePaste: (view, event, slice) => {
                    if (store.isLocked()) return true;
                    const dt = event?.clipboardData;
                    if (hasFiles(dt) && !dt.getData('text/html') && !dt.getData('text/plain')) { notice(photoHint); return true; }
                    const add = slice.content.textBetween(0, slice.content.size, '\n', '\n').length;
                    const { from, to } = view.state.selection;
                    const removed = view.state.doc.textBetween(from, to, '\n', '\n').length;
                    const after = opts.plainLength() - removed + add;
                    if (add > 0 && after > opts.maxChars) {
                        notice(`붙여 넣으면 ${opts.maxChars.toLocaleString()}자를 넘어요. 나눠서 넣어 주세요.`);
                        return true;
                    }
                    return false;
                },
                handleDrop: (view, event) => {
                    if (store.isLocked()) return true;
                    if (hasFiles(event?.dataTransfer)) { notice(photoHint); return true; }
                    return false;
                },
                handleDOMEvents: {
                    // 4) 조합 중 붙여넣기: ProseMirror 는 안드로이드가 아니면 브라우저 기본 붙여넣기에 맡긴다(원본 HTML 이 실제
                    //    문서에 들어가 자원 요청이 날 수 있다). 여기서 막고 조합이 끝난 뒤 같은 정리 경로로 넣는다(6-5 5번).
                    paste: (view, event) => {
                        if (!view.composing || isAndroidUA()) return false;
                        event.preventDefault();
                        const dt = event.clipboardData;
                        const html = dt ? dt.getData('text/html') : '';
                        const text = dt ? (dt.getData('text/plain') || dt.getData('Text')) : '';
                        // 조합을 바로 확정한다(포커스를 빼면 입력기가 글자를 확정한다 — 더 치지 않아도 붙여넣기가 들어가게, agy)
                        try { view.dom.blur(); } catch { /* 이미 사라진 편집기 */ }
                        runWhenNotComposing(view, () => {
                            if (store.isLocked() || view.isDestroyed) return;
                            view.focus();
                            if (html) view.pasteHTML(html);
                            else if (text) view.pasteText(text);
                        }, { maxWaitMs: 1500, force: true });
                        return true;
                    },
                },
            },
        })];
    },
});

// 편집기 확장 전부. placeholder: 빈 편집기 안내 문구. nodeViews: false 면 사진·지도 칸을 React 로 그리지 않는다(테스트용).
export function buildExtensions({ boardKey, userId, maxChars, placeholder, plainLength, nodeViews = true }) {
    return [
        StarterKit.configure({
            code: false,
            codeBlock: false,
            heading: { levels: [2] },
            blockquote: false,
            listItem: false,
            link: {
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                defaultProtocol: 'https',
                HTMLAttributes: { target: null, rel: null, class: null },
                isAllowedUri: (url) => !!normalizeHref(url),
                shouldAutoLink: (url) => !!normalizeHref(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`),
            },
        }),
        Blockquote.extend({ content: '(paragraph | bulletList | orderedList)+' }),
        ListItem.extend({ content: 'paragraph (bulletList | orderedList)*' }),
        CtTextStyle,
        CtTextAlign,
        CtImage.configure({ nodeView: nodeViews }),
        CtGallery.configure({ nodeView: nodeViews }),
        CtMap.configure({ nodeView: nodeViews }),
        CtVideo.configure({ nodeView: nodeViews }),
        CtMedia.configure({ boardKey, userId, maxChars, plainLength }),
        Placeholder.configure({ placeholder }),
    ];
}
