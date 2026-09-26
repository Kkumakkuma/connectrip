import { describe, expect, it } from 'vitest';
import {
    docImages, docMaps, docToPlain, imageRefOk, isDocEmpty, isPreparedDoc, jsonbTextBytes, normalizeHref, plainToDoc,
    prepareRichDoc, safeHref, sanitizeDoc, validateDoc,
} from './doc';
import { LIMITS, PUBLIC_IMAGE_PREFIX } from './schema';
import { preloadDocFonts, ensureFontCss } from './fonts';

const OWNER = '04cfb914-d208-4377-8604-732b25862018';
const OTHER = '16937867-3d9d-4638-ad13-936154697d99';
const priv = (n, o = OWNER) => `sb://post-images/${o}_17000000000${n}_a.jpg`;
const env = (content) => ({ v: 1, doc: { type: 'doc', content } });
const p = (...kids) => (kids.length ? { type: 'paragraph', content: kids } : { type: 'paragraph' });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const linkDoc = (href) => env([p(t('x', [{ type: 'link', attrs: { href } }]))]);
const styleDoc = (attrs) => env([p(t('x', [{ type: 'textStyle', attrs }]))]);
const v = (doc, mode = 'none', ownerId = OWNER) => validateDoc(doc, { mode, ownerId });

describe('validateDoc — 스크립트·주입 표본(서버와 같은 규칙)', () => {
    it('링크: http(s)·userinfo 없음·2,048자 이하만', () => {
        for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\nscript:x', 'data:text/html,<b>x</b>',
            'vbscript:msgbox', '//evil.com/x', '/relative/path', 'https://user@evil.com/', 'https://a.com:pass@evil.com',
            'HTTPS://a.com/', `https://a.com/${'a'.repeat(2049)}`, 'https://a.com/a b', 'https://ex.com./']) {
            expect(v(linkDoc(bad)).reason, bad).toBe('LINK');
        }
        expect(v(linkDoc('https://www.connecttrip.co.kr/guide?a=1#top')).ok).toBe(true);
        expect(v(linkDoc('http://localhost:5173/x')).ok).toBe(true);
    });
    it('글자 모양: 팔레트·목록 밖 값은 거부', () => {
        for (const bad of [{ color: 'red' }, { color: '#BA0000' }, { color: '#ba0000;background:url(x)' }, { backgroundColor: '#ffffff' },
            { fontFamily: 'Arial' }, { fontFamily: "myeongjo'; x" }, { fontSize: '24' }, { fontSize: 16 }, {}, { color: null }, { font: 'x' }]) {
            expect(v(styleDoc(bad)).reason, JSON.stringify(bad)).toBe('TEXT_STYLE');
        }
        expect(v(styleDoc({ fontFamily: 'pen', fontSize: 28, color: '#0078cb', backgroundColor: '#e2e2e2' })).ok).toBe(true);
    });
    it('모르는 노드·중첩 doc·위험 속성', () => {
        expect(v(env([{ type: 'script', content: [] }])).reason).toBe('NODE_TYPE');
        expect(v(env([{ type: 'iframe', attrs: { src: 'https://evil.com' } }])).reason).toBe('NODE_TYPE');
        expect(v(env([{ type: 'doc', content: [p(t('a'))] }])).reason).toBe('PLACEMENT');
        expect(v(env([{ type: 'paragraph', attrs: { onclick: 'x()' }, content: [t('a')] }])).reason).toBe('ATTRS');
        expect(v(env([{ type: 'paragraph', attrs: { style: 'color:red' } }])).reason).toBe('ATTRS');
        expect(v(env([{ type: 'paragraph', attrs: { class: 'x' } }])).reason).toBe('ATTRS');
        expect(v(JSON.parse('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","constructor":{}}]}}')).reason).toBe('KEYS');
        expect(v(JSON.parse('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","__proto__":{"x":1}}]}}')).reason).toBe('KEYS');
        expect(v(env([{ type: 'image', attrs: { src: priv(1), onerror: 'x()' } }]), 'private').reason).toBe('ATTRS');
    });
    it('텍스트: 빈 글자·제어문자·content 키 거부, HTML 모양 글자는 글자일 뿐(통과)', () => {
        expect(v(env([p(t(''))])).reason).toBe('TEXT');
        expect(v(env([p(t('a\u0007b'))])).reason).toBe('TEXT');
        expect(v(env([p({ type: 'text', text: 'a', content: [] })])).reason).toBe('KEYS');
        expect(v(env([p(t('<script>alert(1)</script><img src=x onerror=alert(1)>'))])).ok).toBe(true);
        expect(v(env([p(t('탭\t과 줄\n바꿈'))])).ok).toBe(true);
        expect(v(env([p(t('a'.repeat(LIMITS.textChars)))])).ok).toBe(true);
        expect(v(env([p(t('a'.repeat(LIMITS.textChars + 1)))])).reason).toBe('TEXT');
        // 코드포인트로 센다(서버 char_length 와 같다): 이모지 2만 개(UTF-16 4만)는 통과
        expect(v(env([p(t('😀'.repeat(LIMITS.textChars)))])).ok).toBe(true);
    });
    it('목록 문법: 항목 첫 자식은 문단, 목록은 비지 않는다', () => {
        const ul = (...items) => ({ type: 'bulletList', content: items });
        const li = (...kids) => ({ type: 'listItem', content: kids });
        expect(v(env([ul(li(p(t('a')), ul(li(p(t('b'))))))])).ok).toBe(true);
        expect(v(env([ul(li(ul(li(p(t('b'))))))])).reason).toBe('PLACEMENT');
        expect(v(env([ul()])).reason).toBe('CONTENT');
        expect(v(env([ul(p(t('a')))])).reason).toBe('PLACEMENT');
        expect(v(env([{ type: 'listItem', content: [p()] }])).reason).toBe('PLACEMENT');
    });
    it('한도: 깊이 50·노드 2만 — 중단되고, 실패 문서에는 글꼴 수집 결과가 없다', () => {
        let deep = { type: 'listItem', content: [p(t('바닥', [{ type: 'textStyle', attrs: { fontFamily: 'pen' } }]))] };
        for (let i = 0; i < 25; i += 1) deep = { type: 'listItem', content: [p(t('층', [{ type: 'textStyle', attrs: { fontFamily: 'pen' } }])), { type: 'bulletList', content: [deep] }] };
        const r1 = validateDoc(env([{ type: 'bulletList', content: [deep] }]), { collectFonts: true });
        expect(r1.reason).toBe('TOO_DEEP');
        expect(r1.fonts).toBeUndefined();
        const many = env(Array.from({ length: 20000 }, () => ({ type: 'horizontalRule' })));
        const r2 = validateDoc(many, { collectFonts: true });
        expect(r2.ok).toBe(false);
        expect(r2.fonts).toBeUndefined();
        const exact = env(Array.from({ length: LIMITS.nodes - 1 }, () => ({ type: 'horizontalRule' })));   // doc 포함 1만
        expect(v(exact).ok).toBe(true);
        const over = env(Array.from({ length: LIMITS.nodes }, () => ({ type: 'horizontalRule' })));
        expect(v(over).reason).toBe('TOO_MANY_NODES');
        const t0 = Date.now();
        v(over);
        expect(Date.now() - t0).toBeLessThan(500);
    });
    it('바이트: 524,288 초과 거부(순회 전)', () => {
        const big = env([p(t('a'.repeat(20000)))]);
        while (jsonbTextBytes(big) <= LIMITS.docBytes) big.doc.content.push(p(t('a'.repeat(20000))));
        expect(v(big).reason).toBe('TOO_LARGE');
    });
    it('사진: 게시판 규칙·작성자·중복·개수·자리', () => {
        expect(v(env([{ type: 'image', attrs: { src: priv(1) } }]), 'none').reason).toBe('MEDIA_NOT_ALLOWED');
        expect(v(env([{ type: 'image', attrs: { src: priv(1, OTHER) } }]), 'private').reason).toBe('IMAGE_REF');
        expect(v(env([{ type: 'image', attrs: { src: 'https://evil.com/x.jpg' } }]), 'private').reason).toBe('IMAGE_REF');
        const pub = `${PUBLIC_IMAGE_PREFIX}${OWNER}_1700000000001_a.webp`;
        expect(v(env([{ type: 'image', attrs: { src: pub } }]), 'public').ok).toBe(true);
        expect(v(env([{ type: 'image', attrs: { src: `${pub}?x=1` } }]), 'public').reason).toBe('IMAGE_REF');
        expect(v(env([{ type: 'image', attrs: { src: priv(1) } }]), 'public').reason).toBe('IMAGE_REF');
        const g = (images, layout = 'grid') => ({ type: 'gallery', attrs: { layout, images } });
        expect(v(env([g([priv(1)])]), 'private').reason).toBe('GALLERY');
        expect(v(env([g([priv(1), priv(2)], 'masonry')]), 'private').reason).toBe('GALLERY');
        // 세 가지 레이아웃(콜라주·한 장씩·옆으로 나열)은 모두 통과
        for (const layout of ['grid', 'slide', 'strip']) expect(v(env([g([priv(1), priv(2)], layout)]), 'private').ok).toBe(true);
        expect(v(env([g(Array.from({ length: 11 }, (_, i) => priv(10 + i)))]), 'private').reason).toBe('GALLERY');
        expect(v(env([{ type: 'image', attrs: { src: priv(1) } }, g([priv(1), priv(2)])]), 'private').reason).toBe('IMAGE_DUP');
        const twenty = [g(Array.from({ length: 10 }, (_, i) => priv(10 + i))), g(Array.from({ length: 10 }, (_, i) => priv(30 + i)))];
        expect(v(env(twenty), 'private').ok).toBe(true);
        expect(v(env([...twenty, { type: 'image', attrs: { src: priv(99) } }]), 'private').reason).toBe('TOO_MANY_IMAGES');
        expect(v(env([{ type: 'blockquote', content: [{ type: 'image', attrs: { src: priv(1) } }] }]), 'private').reason).toBe('PLACEMENT');
    });
    it('파일 노드는 1단계에서 거부', () => {
        const f = { type: 'file', attrs: { src: `sb://post-files/${OWNER}_1700000000000_${'a'.repeat(32)}.pdf`, name: 'a.pdf', size: 1 } };
        expect(v(env([f]), 'private').reason).toBe('FILE_NOT_ENABLED');
    });
    it('지도 10개까지', () => {
        const m = (i) => ({ type: 'map', attrs: { name: `곳${i}`, lat: 37.5 + i / 1000, lng: 127 } });
        expect(v(env(Array.from({ length: 10 }, (_, i) => m(i)))).ok).toBe(true);
        expect(v(env(Array.from({ length: 11 }, (_, i) => m(i)))).reason).toBe('TOO_MANY_MAPS');
    });
});

describe('prepareRichDoc — 검증된 값에만 표식', () => {
    const doc = env([
        { type: 'heading', attrs: { level: 2 }, content: [t('제목', [{ type: 'textStyle', attrs: { fontFamily: 'myeongjo' } }])] },
        p(t('펜 글씨 펜', [{ type: 'textStyle', attrs: { fontFamily: 'pen', fontSize: 24 } }])),
        { type: 'image', attrs: { src: priv(1) } },
        { type: 'map', attrs: { name: '시청', lat: 37.5665, lng: 126.978 } },
    ]);
    it('통과하면 얼린 사본 + 사진·지도·글꼴별 글자', () => {
        const r = prepareRichDoc(doc, 'review', OWNER);
        expect(isPreparedDoc(r)).toBe(true);
        expect(r.ok).toBe(true);
        expect(Object.isFrozen(r)).toBe(true);
        expect(Object.isFrozen(r.doc.content[0].content[0])).toBe(true);
        expect(r.doc).not.toBe(doc.doc);          // 원본을 얼리지 않는다
        expect(Object.isFrozen(doc.doc)).toBe(false);
        expect(r.images).toEqual([priv(1)]);
        expect(r.maps).toEqual([{ name: '시청', lat: 37.5665, lng: 126.978 }]);
        expect(r.fonts).toEqual({ myeongjo: '제목', pen: '펜글씨' });
    });
    it('게시판 규칙이 다르면 실패(Q&A 에 사진) — 표식은 있고 ok=false, 글꼴 없음', () => {
        const r = prepareRichDoc(doc, 'qna', OWNER);
        expect(isPreparedDoc(r)).toBe(true);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('MEDIA_NOT_ALLOWED');
        expect(r.fonts).toBeUndefined();
    });
    it('원본 문서·아무 객체에는 표식이 없다', () => {
        expect(isPreparedDoc(doc)).toBe(false);
        expect(isPreparedDoc({ ...prepareRichDoc(doc, 'review', OWNER) })).toBe(false);   // 복사하면 Symbol 표식은 사라진다
        expect(isPreparedDoc(null)).toBe(false);
    });
    it('글꼴 미리 받기는 표식 없는 값·실패 값을 무시한다(문서 환경 없이도 안전)', async () => {
        await expect(preloadDocFonts(doc)).resolves.toBeUndefined();
        await expect(preloadDocFonts(prepareRichDoc(doc, 'qna', OWNER))).resolves.toBeUndefined();
        await expect(ensureFontCss('pen')).resolves.toBeUndefined();
    });
});

describe('평문 파생·옛 평문 → 문서', () => {
    it('docToPlain: 문단 = 줄, 줄바꿈 노드 = \\n, 끝 줄바꿈 제거, 사진·지도·구분선은 빠진다', () => {
        const doc = env([p(t('첫')), p(), p(t('셋'), { type: 'hardBreak' }, t('넷')), { type: 'horizontalRule' },
            { type: 'image', attrs: { src: priv(1) } }, p(t('끝')), p(), p()]);
        expect(docToPlain(doc)).toBe('첫\n\n셋\n넷\n끝');
        expect(docToPlain(doc.doc)).toBe('첫\n\n셋\n넷\n끝');      // doc 노드 자체도 받는다
        expect(docToPlain(null)).toBe('');
        expect(docToPlain({ v: 1, doc: { type: 'x' } })).toBe('');
    });
    it('plainToDoc ↔ docToPlain 왕복(빈 줄 유지, \\r\\n 정리, 제어문자 제거)', () => {
        for (const s of ['한 줄', '첫\n\n셋', '  들여쓰기\n\t탭', '이모지 😀\n끝']) {
            const d = plainToDoc(s);
            expect(validateDoc(d).ok).toBe(true);
            expect(docToPlain(d)).toBe(s);
        }
        expect(docToPlain(plainToDoc('a\r\nb\rc'))).toBe('a\nb\nc');
        expect(docToPlain(plainToDoc('a\u0000b\u0007c'))).toBe('abc');
        expect(docToPlain(plainToDoc('끝 줄바꿈\n\n'))).toBe('끝 줄바꿈');
        expect(validateDoc(plainToDoc('')).ok).toBe(true);
        expect(isDocEmpty(plainToDoc(''))).toBe(true);
    });
    it('plainToDoc: 긴 줄은 텍스트 노드 한도로 나누고, 줄이 아주 많아도 노드 한도 안', () => {
        const long = '가'.repeat(LIMITS.textChars + 5);
        const d1 = plainToDoc(long);
        expect(d1.doc.content[0].content).toHaveLength(2);
        expect(docToPlain(d1)).toBe(long);
        const many = 'a\n'.repeat(9999) + 'z';        // 1만 줄, 1만 9,999자
        const d2 = plainToDoc(many);
        expect(validateDoc(d2).ok).toBe(true);
        expect(docToPlain(d2)).toBe(many);
    });
    it('isDocEmpty: 공백뿐·구분선뿐 = 빈 글, 사진만·지도만 = 글', () => {
        expect(isDocEmpty(env([p(t('  \u3000\u00a0 ')), p()]))).toBe(true);
        expect(isDocEmpty(env([{ type: 'horizontalRule' }]))).toBe(true);
        expect(isDocEmpty(env([{ type: 'image', attrs: { src: priv(1) } }]))).toBe(false);
        expect(isDocEmpty(env([{ type: 'map', attrs: { name: 'x', placeId: 'ChIJ0000000000' } }]))).toBe(false);
        expect(isDocEmpty(env([p(t('a'))]))).toBe(false);
    });
    it('docImages·docMaps: 최상위만, 문서 순서, 중복 없음', () => {
        const d = env([{ type: 'image', attrs: { src: priv(2) } }, { type: 'gallery', attrs: { layout: 'grid', images: [priv(1), priv(2), 7] } },
            { type: 'map', attrs: { name: 'm', lat: 1, lng: 1 } }]);
        expect(docImages(d)).toEqual([priv(2), priv(1)]);
        expect(docMaps(d)).toEqual([{ name: 'm', lat: 1, lng: 1 }]);
    });
});

describe('jsonbTextBytes — PostgreSQL jsonb 텍스트 바이트', () => {
    it('구분자·이스케이프·UTF-8', () => {
        expect(jsonbTextBytes({})).toBe(2);
        expect(jsonbTextBytes({ a: [1, 2] })).toBe('{"a": [1, 2]}'.length);
        expect(jsonbTextBytes('"\\\n\t')).toBe(2 + 2 * 4);
        expect(jsonbTextBytes('\u0001')).toBe(8);
        expect(jsonbTextBytes('가')).toBe(5);
        expect(jsonbTextBytes('😀')).toBe(6);
        expect(jsonbTextBytes(1e21)).toBe('1000000000000000000000'.length);
        expect(jsonbTextBytes(1e-7)).toBe('0.0000001'.length);
    });
    it('저장할 수 없는 값은 Infinity(NUL·짝 없는 서로게이트·함수)', () => {
        expect(jsonbTextBytes('a\u0000')).toBe(Infinity);
        expect(jsonbTextBytes('\ud800')).toBe(Infinity);
        expect(jsonbTextBytes({ f: () => 1 })).toBe(Infinity);
    });
    it('cap 을 넘으면 거기서 멈춘다', () => {
        expect(jsonbTextBytes(['x'.repeat(100), 'y'.repeat(100)], 50)).toBeGreaterThan(50);
    });
});

describe('링크·사진 참조 도우미', () => {
    it('safeHref / normalizeHref', () => {
        expect(safeHref('https://a.com/x')).toBe('https://a.com/x');
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(normalizeHref(' HTTPS://A.com/경로 ')).toBe('https://a.com/%EA%B2%BD%EB%A1%9C');
        expect(normalizeHref('https://u:p@a.com')).toBeNull();
        expect(normalizeHref('mailto:a@b.c')).toBeNull();
        expect(normalizeHref('a.com')).toBeNull();
    });
    it('imageRefOk', () => {
        expect(imageRefOk(priv(1), 'private', OWNER)).toBe(true);
        expect(imageRefOk(priv(1), 'private', OTHER)).toBe(false);
        expect(imageRefOk(priv(1), 'none', OWNER)).toBe(false);
        expect(imageRefOk(priv(1), 'private', null)).toBe(false);
    });
});

describe('sanitizeDoc — 편집기·원고 JSON 을 규칙 안으로', () => {
    it('모르는 속성·위험 링크 제거, 토큰 정리, 결과는 검증 통과', () => {
        const dirty = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 3, textAlign: 'justify', id: 'x' }, content: [t('제목')] },
                { type: 'paragraph', attrs: { textAlign: 'center', class: 'x' }, content: [
                    t('링크', [{ type: 'link', attrs: { href: 'https://a.com', target: '_blank', rel: 'noopener', class: 'x' } }]),
                    t('나쁜 링크', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
                    t('색', [{ type: 'textStyle', attrs: { color: '#BA0000', fontSize: 15, backgroundColor: '#123456', fontFamily: 'pen' } }]),
                    t('굵게', [{ type: 'bold' }, { type: 'bold' }, { type: 'code' }]),
                    { type: 'hardBreak', marks: [{ type: 'bold' }] },
                    t('제어\u0007문자'),
                ] },
                { type: 'blockquote', content: [{ type: 'blockquote', content: [p(t('중첩 인용'))] }, { type: 'horizontalRule' }] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('안'))] }] }] }] },
                { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p(t('하나'))] }] },
                { type: 'image', attrs: { src: priv(1), title: 'x' } },
                { type: 'image', attrs: { src: priv(2, OTHER) } },
                { type: 'gallery', attrs: { layout: 'grid', images: [priv(1), priv(3, OTHER), priv(4)] } },
                { type: 'file', attrs: { src: 'sb://post-files/x.pdf', name: 'x.pdf', size: 1 } },
                { type: 'map', attrs: { name: ' 시청\n ', lat: 37.56651234, lng: 126.978, url: 'https://evil.com/', extra: 1 } },
                { type: 'iframe', attrs: { src: 'https://evil.com' } },
            ],
        };
        const out = sanitizeDoc(dirty, 'review', OWNER);
        const r = validateDoc(out, { mode: 'private', ownerId: OWNER });
        expect(r.ok).toBe(true);
        const [h, para, quote, ul, ol, img, second] = out.doc.content;
        expect(h).toEqual({ type: 'heading', attrs: { level: 2 }, content: [t('제목')] });
        expect(para.attrs).toEqual({ textAlign: 'center' });
        expect(para.content[0].marks).toEqual([{ type: 'link', attrs: { href: 'https://a.com/' } }]);
        expect(para.content[1].marks).toBeUndefined();
        expect(para.content[2].marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: 'pen', color: '#ba0000' } }]);
        expect(para.content[3].marks).toEqual([{ type: 'bold' }]);
        expect(para.content[4]).toEqual({ type: 'hardBreak' });
        expect(para.content[5].text).toBe('제어문자');
        expect(quote).toEqual({ type: 'blockquote', content: [p(t('중첩 인용'))] });
        expect(ul.content[0].content[0]).toEqual({ type: 'paragraph' });        // 첫 자식 문단 보충
        expect(ol).toEqual({ type: 'orderedList', content: [{ type: 'listItem', content: [p(t('하나'))] }] });
        expect(img).toEqual({ type: 'image', attrs: { src: priv(1) } });
        // 남의 사진은 빠지고, 묶음은 쓸 수 있는 사진(4번 한 장)만 남아 단일 사진이 된다
        expect(second).toEqual({ type: 'image', attrs: { src: priv(4) } });
        const map = out.doc.content.find((n) => n.type === 'map');
        expect(map).toEqual({ type: 'map', attrs: { name: '시청', lat: 37.566512, lng: 126.978 } });
        expect(out.doc.content.some((n) => n.type === 'file' || n.type === 'iframe')).toBe(false);
    });
    it('사진 없는 게시판에서는 사진·묶음을 버린다, 빈 입력은 빈 문단 하나', () => {
        const out = sanitizeDoc(env([{ type: 'image', attrs: { src: priv(1) } }, p(t('글'))]), 'qna', OWNER);
        expect(out.doc.content).toEqual([p(t('글'))]);
        expect(sanitizeDoc(null, 'qna', OWNER)).toEqual({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    });
});
