// @vitest-environment jsdom
// 서식 편집기 확장(스키마·붙여넣기·토큰 명령)을 실제 TipTap 편집기로 확인한다(React 칸 그리기는 끄고).
// 편집기가 만들 수 있는 문서 = 서버 rich_doc_check 가 받는 문서여야 한다.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';
import { commitSaved, mediaSignature, sameDoc } from './commit';
import { galleryLimit } from './shared';
import { docToPlain, replaceDocImages, sanitizeDoc, validateDoc } from '../../../lib/rich/doc';
import { makePendingImage } from '../../../lib/pendingImages';

const OWNER = '04cfb914-d208-4377-8604-732b25862018';
const OTHER = '16937867-3d9d-4638-ad13-936154697d99';
const priv = (n, o = OWNER) => `sb://post-images/${o}_17000000000${n}_a.jpg`;
const p = (text, marks) => ({ type: 'paragraph', content: [marks ? { type: 'text', text, marks } : { type: 'text', text }] });

beforeAll(() => {
    // jsdom 은 배치(layout)를 계산하지 않는다 — ProseMirror 가 부르는 좌표 함수만 빈 값으로
    if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [];
    if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

let editor = null;
afterEach(() => { editor?.destroy(); editor = null; });

const make = (boardKey, content) => {
    editor = new Editor({
        element: document.createElement('div'),
        extensions: buildExtensions({ boardKey, userId: OWNER, maxChars: 20000, placeholder: '', plainLength: () => 0, nodeViews: false }),
        content,
    });
    return editor;
};
const envOf = (e) => sanitizeDoc(e.getJSON(), e.storage.ctMedia.getBoardKey(), OWNER, { pendingOk: e.storage.ctMedia.isPendingKey });
// 마크 순서는 규칙에서 보지 않는다(설계 4-4) — ProseMirror 는 마크를 종류 순위대로 정렬하므로 비교 전에 맞춘다
const sortMarks = (v) => JSON.parse(JSON.stringify(v), (k, x) => (k === 'marks' && Array.isArray(x) ? [...x].sort((a, b) => a.type.localeCompare(b.type)) : x));

describe('문서 왕복: 저장된 서식 문서 → 편집기 → 저장 문서가 그대로', () => {
    it('후기(사진 게시판): 모든 노드·마크·토큰', () => {
        const env = {
            v: 1,
            doc: {
                type: 'doc',
                content: [
                    { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: '소제목' }] },
                    p('굵은 빨강 큰 명조', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'myeongjo', fontSize: 24, color: '#ba0000', backgroundColor: '#fff8b2' } }]),
                    { type: 'image', attrs: { src: priv(1) } },
                    { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: '링크', marks: [{ type: 'link', attrs: { href: 'https://www.connecttrip.co.kr/' } }] }] },
                    { type: 'gallery', attrs: { layout: 'strip', images: [priv(2), priv(3)] } },
                    { type: 'blockquote', content: [p('인용'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('항목')] }] }] },
                    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p('셋')] }] },
                    { type: 'horizontalRule' },
                    { type: 'map', attrs: { name: '서울시청', lat: 37.5665, lng: 126.978 } },
                    { type: 'video', attrs: { provider: 'youtube', id: 'dQw4w9WgXcQ' } },
                    p('끝'),
                ],
            },
        };
        const e = make('review', env.doc);
        const back = envOf(e);
        expect(sortMarks(back)).toEqual(sortMarks(env));
        expect(validateDoc(back, { mode: 'private', ownerId: OWNER }).ok).toBe(true);
    });
});

describe('붙여넣기: 정리기를 거친 내용만 문서가 된다', () => {
    it('외부 사진·스크립트·스타일은 빠지고 글자·토큰·내 사진만 남는다', () => {
        const e = make('review', { type: 'doc', content: [{ type: 'paragraph' }] });
        e.view.pasteHTML(
            '<p style="color:#ba0000">빨강</p>'
            + '<img src="https://pixel.ct-test.example/a.gif">'
            + `<div data-ct-node="image" data-ct-src="${priv(1)}"></div>`
            + `<div data-ct-node="image" data-ct-src="${priv(2, OTHER)}"></div>`
            + '<script>alert(1)</script><iframe src="https://evil.example"></iframe>'
            + '<p><a href="javascript:alert(1)">나쁜</a> <a href="https://ok.example/">좋은</a></p>',
            { clipboardData: null, preventDefault() {} },
        );
        const env = envOf(e);
        expect(validateDoc(env, { mode: 'private', ownerId: OWNER }).ok).toBe(true);
        const json = JSON.stringify(env);
        expect(json).toContain('"color":"#ba0000"');
        expect(json).toContain(priv(1));
        expect(json).not.toContain(OTHER);
        expect(json).not.toContain('pixel.ct-test');
        expect(json).not.toContain('javascript');
        expect(json).toContain('"href":"https://ok.example/"');
        expect(docToPlain(env)).toContain('나쁜 좋은');
    });
    it('같은 사진을 다시 붙이면 한 번만(편집기 안 복사·붙여넣기)', () => {
        const e = make('review', { type: 'doc', content: [{ type: 'image', attrs: { src: priv(1) } }, { type: 'paragraph' }] });
        e.commands.setTextSelection(e.state.doc.content.size - 1);
        e.view.pasteHTML(`<div data-ct-node="image" data-ct-src="${priv(1)}"></div><p>글</p>`, { clipboardData: null, preventDefault() {} });
        const env = envOf(e);
        expect(env.doc.content.filter((n) => n.type === 'image')).toHaveLength(1);
        expect(docToPlain(env)).toContain('글');
    });
    it('사진을 골라 그 위에 같은 사진을 붙이면 사진이 사라지지 않는다 / 중복 사진만 붙이면 아무 일 없음(빈 조각)', () => {
        const e = make('review', { type: 'doc', content: [p('앞'), { type: 'image', attrs: { src: priv(1) } }, p('뒤')] });
        const pos = e.state.doc.child(0).nodeSize;          // 사진 칸 위치
        e.commands.setNodeSelection(pos);
        e.view.pasteHTML(`<div data-ct-node="image" data-ct-src="${priv(1)}"></div>`, { clipboardData: null, preventDefault() {} });
        let env = envOf(e);
        expect(env.doc.content.filter((n) => n.type === 'image')).toHaveLength(1);
        // 커서만 두고 이미 있는 사진만 붙이면 문서는 그대로
        e.commands.setTextSelection(2);
        const before = JSON.stringify(e.getJSON());
        expect(() => e.view.pasteHTML(`<div data-ct-node="image" data-ct-src="${priv(1)}"></div>`, { clipboardData: null, preventDefault() {} })).not.toThrow();
        expect(JSON.stringify(e.getJSON())).toBe(before);
        env = envOf(e);
        expect(validateDoc(env, { mode: 'private', ownerId: OWNER }).ok).toBe(true);
    });
    it('Q&A(사진 없는 게시판)는 사진이 전부 빠진다', () => {
        const e = make('qna', { type: 'doc', content: [{ type: 'paragraph' }] });
        e.view.pasteHTML(`<p>질문</p><div data-ct-node="image" data-ct-src="${priv(1)}"></div>`, { clipboardData: null, preventDefault() {} });
        const env = envOf(e);
        expect(env.doc.content.some((n) => n.type === 'image')).toBe(false);
        expect(validateDoc(env, { mode: 'none', ownerId: OWNER }).ok).toBe(true);
    });
});

describe('명령: 토큰만 저장된다', () => {
    it('글자색·크기(15 = 지움)·글꼴·정렬', () => {
        const e = make('qna', { type: 'doc', content: [p('가나다라')] });
        e.chain().setTextSelection({ from: 1, to: 3 }).setTextToken('color', '#0078cb').setTextToken('fontSize', 24).setTextToken('fontFamily', 'pen').run();
        e.chain().setCtAlign('center').run();
        let env = envOf(e);
        expect(env.doc.content[0].attrs).toEqual({ textAlign: 'center' });
        expect(env.doc.content[0].content[0]).toEqual({ type: 'text', text: '가나', marks: [{ type: 'textStyle', attrs: { fontFamily: 'pen', fontSize: 24, color: '#0078cb' } }] });
        e.chain().setTextSelection({ from: 1, to: 3 }).setTextToken('fontSize', null).setTextToken('color', null).setTextToken('fontFamily', null).setCtAlign(null).run();
        env = envOf(e);
        expect(env.doc.content[0]).toEqual(p('가나다라'));
        expect(validateDoc(env, { mode: 'none', ownerId: OWNER }).ok).toBe(true);
    });
    it('인용구 안에는 문단·목록만(소제목은 바깥), 목록 항목 첫 칸은 문단', () => {
        const e = make('qna', { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목' }] }] });
        e.chain().setTextSelection(2).toggleBlockquote().run();
        const env = envOf(e);
        expect(validateDoc(env, { mode: 'none', ownerId: OWNER }).ok).toBe(true);
    });
});

describe('대기 사진 키', () => {
    it('표에 있는 키만 사진 자리에 남고, 최종 검증은 키를 받지 않는다', () => {
        const e = make('review', { type: 'doc', content: [{ type: 'paragraph' }] });
        const store = e.storage.ctMedia;
        const item = makePendingImage({ name: 'a.jpg', type: 'image/jpeg', size: 1 }, 'post-images');
        store.addPending(item);
        e.chain().insertContentAt(e.state.doc.content.size, [{ type: 'image', attrs: { src: item.key } }, { type: 'image', attrs: { src: 'pending:zzz:1' } }]).run();
        const env = envOf(e);
        const srcs = env.doc.content.filter((n) => n.type === 'image').map((n) => n.attrs.src);
        expect(srcs).toEqual([item.key]);
        expect(validateDoc(env, { mode: 'private', ownerId: OWNER }).ok).toBe(false);
    });
    it('저장소는 편집기마다 따로다(TipTap 얕은 복사 — 상태는 함수로만)', () => {
        const a = make('review', { type: 'doc', content: [{ type: 'paragraph' }] });
        const sa = a.storage.ctMedia;
        const token = sa.lock();
        expect(sa.isLocked()).toBe(true);
        expect(sa.lock()).toBeNull();
        // 잠금은 그 토큰의 주인만(늦게 끝난 다른 저장이 새 저장의 잠금을 풀지 못하게 — codex m1)
        expect(sa.ownsLock(token)).toBe(true);
        expect(sa.ownsLock(Symbol('다른 저장'))).toBe(false);
        expect(sa.ownsLock(null)).toBe(false);
        sa.unlock(Symbol('다른 저장'));
        expect(sa.isLocked()).toBe(true);
        sa.unlock(token);
        expect(sa.isLocked()).toBe(false);
        expect(sa.ownsLock(token)).toBe(false);
        sa.markDead([{ bucket: 'post-images', name: `${OWNER}_170000000001_a.jpg` }]);
        expect(sa.isDead(priv(1))).toBe(true);
        a.destroy();
        editor = null;
        const b = make('review', { type: 'doc', content: [{ type: 'paragraph' }] });
        expect(b.storage.ctMedia.isDead(priv(1))).toBe(false);
    });
});

// 13자리 시각(실제 Date.now 길이)으로 서로 다른 내 사진 참조
const own = (i) => `sb://post-images/${OWNER}_17000000000${String(i).padStart(2, '0')}_a.jpg`;
const imageNodes = (from, n) => Array.from({ length: n }, (_, k) => ({ type: 'image', attrs: { src: own(from + k) } }));

describe('저장 전 정리에서 칸이 빠지면 저장을 멈춘다(editor/commit.js mediaSignature — codex B1)', () => {
    it('한도 안이면 요약이 같다(사진·묶음·지도·영상)', () => {
        const e = make('review', {
            type: 'doc',
            content: [
                p('글'),
                { type: 'image', attrs: { src: own(1) } },
                { type: 'gallery', attrs: { layout: 'grid', images: [own(2), own(3)] } },
                { type: 'map', attrs: { name: '서울시청', lat: 37.5665, lng: 126.978 } },
                { type: 'video', attrs: { provider: 'youtube', id: 'dQw4w9WgXcQ' } },
            ],
        });
        expect(mediaSignature(e.getJSON())).toBe(mediaSignature(envOf(e).doc));
    });
    it('지도 11개 → 정리에서 1개가 빠져 요약이 달라진다', () => {
        const maps = Array.from({ length: 11 }, (_, i) => ({ type: 'map', attrs: { name: `곳${i}`, lat: 37.5 + i / 100, lng: 126.97 } }));
        const e = make('review', { type: 'doc', content: [p('글'), ...maps] });
        const env = envOf(e);
        expect(env.doc.content.filter((n) => n.type === 'map')).toHaveLength(10);
        expect(mediaSignature(e.getJSON())).not.toBe(mediaSignature(env.doc));
    });
    it('영상 11개·사진 21장도 같다(붙여넣기 등으로 한도를 넘긴 경우)', () => {
        const videos = Array.from({ length: 11 }, (_, i) => ({ type: 'video', attrs: { provider: 'youtube', id: `abcdefghi${String(i).padStart(2, '0')}` } }));
        const ev = make('free', { type: 'doc', content: [p('글'), ...videos] });
        expect(mediaSignature(ev.getJSON())).not.toBe(mediaSignature(envOf(ev).doc));
        ev.destroy();
        editor = null;
        const ei = make('review', { type: 'doc', content: [p('글'), ...imageNodes(1, 21)] });
        expect(envOf(ei).doc.content.filter((n) => n.type === 'image')).toHaveLength(20);
        expect(mediaSignature(ei.getJSON())).not.toBe(mediaSignature(envOf(ei).doc));
    });
});

describe('저장 성공 뒤 화면 문서를 저장본과 맞춘다(editor/commit.js commitSaved — codex B1)', () => {
    it('대기 키 → 올린 참조: 사진 칸 속성만 바뀌고 "고친 내용"으로 세지 않는다', () => {
        const e = make('review', { type: 'doc', content: [p('앞')] });
        const store = e.storage.ctMedia;
        const item = makePendingImage({ name: 'a.jpg', type: 'image/jpeg', size: 1 }, 'post-images');
        store.addPending(item);
        e.chain().insertContentAt(e.state.doc.content.size, [{ type: 'image', attrs: { src: item.key } }, p('뒤')]).run();
        let commits = 0;
        let userChanges = 0;
        e.on('transaction', ({ transaction }) => {
            if (!transaction.docChanged) return;
            if (transaction.getMeta('ctCommit')) commits += 1;
            else userChanges += 1;
        });
        const map = new Map([[item.key, own(7)]]);
        const saved = replaceDocImages(envOf(e), map);            // saveDocWithImages 가 저장하는 문서
        expect(commitSaved(e, saved, map)).toBe(true);
        expect(sortMarks(sanitizeDoc(e.getJSON(), 'review', OWNER))).toEqual(sortMarks(saved));
        expect(commits).toBe(1);
        expect(userChanges).toBe(0);
    });
    it('저장본이 화면과 다르면(정리에서 달라짐) 문서째 저장본으로 바꾼다 — 정리 전 원문으로 비교', () => {
        // (맨 끝이 사진이면 편집기가 빈 문단을 하나 붙인다 — TipTap 3 StarterKit trailingNode. 비교가 흐려지지 않게 글로 끝낸다)
        const e = make('review', { type: 'doc', content: [p('화면 글'), ...imageNodes(1, 2), p('끝')] });
        const saved = { v: 1, doc: { type: 'doc', content: [p('저장본 글'), ...imageNodes(1, 1), p('끝')] } };
        expect(commitSaved(e, saved, new Map())).toBe(true);
        expect(sortMarks(sanitizeDoc(e.getJSON(), 'review', OWNER))).toEqual(sortMarks(saved));
    });
    it('같은 문서 판정: 기본 속성·마크 순서 차이는 같게, 내용이 다르거나 스키마에 없는 문서는 다르게', () => {
        const e = make('review', { type: 'doc', content: [p('가')] });
        const a = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '가', marks: [{ type: 'italic' }, { type: 'bold' }] }] }] };
        const b = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: '가', marks: [{ type: 'bold' }, { type: 'italic' }] }] }] };
        expect(sameDoc(e.schema, a, b)).toBe(true);
        expect(sameDoc(e.schema, a, { type: 'doc', content: [p('나')] })).toBe(false);
        expect(sameDoc(e.schema, a, { type: 'doc', content: [{ type: 'nope' }] })).toBe(false);
    });
    it('닫힌 편집기·저장본 없음은 아무것도 하지 않는다', () => {
        const e = make('review', { type: 'doc', content: [p('글')] });
        expect(commitSaved(e, null, new Map())).toBe(false);
        expect(commitSaved(null, { v: 1, doc: { type: 'doc', content: [p('x')] } }, new Map())).toBe(false);
    });
});

describe('묶음 편집 시트의 최대 장수(shared.galleryLimit — codex B2)', () => {
    const doc = (outside, gallery) => make('review', {
        type: 'doc',
        content: [p('글'), ...imageNodes(1, outside), { type: 'gallery', attrs: { layout: 'grid', images: gallery } }],
    }).state.doc;
    it('글 전체 20장 중 이 묶음 밖 사진을 뺀 만큼(묶음 10장 한도 안에서)', () => {
        const g = [own(50), own(51), own(52)];
        expect(galleryLimit(doc(4, g), g)).toBe(10);                 // 밖 4장 → 16 남지만 묶음 한도 10
    });
    it('묶음이 꽉 찬 글에서 묶음 사진을 빼면 그만큼 다시 넣을 수 있다(예전: 글 전체 남은 자리 0이라 못 넣음)', () => {
        const g = Array.from({ length: 10 }, (_, i) => own(60 + i));
        expect(galleryLimit(doc(10, g), g)).toBe(10);                // 밖 10장 + 묶음 10장 = 20장 → 이 묶음은 10장까지
    });
    it('밖에 사진이 많으면 그만큼 줄고, 0 밑으로는 안 간다', () => {
        const g = [own(70), own(71)];
        expect(galleryLimit(doc(15, g), g)).toBe(5);
        editor.destroy();
        editor = null;
        expect(galleryLimit(doc(19, g), g)).toBe(1);
    });
});
