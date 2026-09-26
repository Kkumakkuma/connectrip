// 읽기 전용 렌더러 — 서버 렌더(renderToStaticMarkup)로 만들어지는 HTML 을 검사한다(효과·네트워크 없이).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_IMAGE_PREFIX } from '../../lib/rich/schema';

vi.mock('../../lib/native', () => ({ isNativeApp: () => false }));

const OWNER = '04cfb914-d208-4377-8604-732b25862018';
const priv = (n) => `sb://post-images/${OWNER}_17000000000${n}_a.jpg`;
const env = (content) => ({ v: 1, doc: { type: 'doc', content } });
const p = (...kids) => (kids.length ? { type: 'paragraph', content: kids } : { type: 'paragraph' });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });

// 지도 키는 모듈을 읽을 때 정해지므로 키마다 모듈을 새로 읽는다. 표식(Symbol)도 모듈마다 새로 생기므로
// prepareRichDoc 도 같은 새 모듈 묶음에서 가져온다.
let prepareRichDoc;
async function load(key = '') {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', key);
    const RichBody = (await import('./RichBody')).default;
    ({ prepareRichDoc } = await import('../../lib/rich/doc'));
    return RichBody;
}
const html = (RichBody, props) => renderToStaticMarkup(<RichBody {...props} />);

afterEach(() => { vi.unstubAllEnvs(); });

describe('RichBody', () => {
    it('검증된 문서만 요소로 그린다: 소제목·마크·링크·목록·인용·구분선·정렬', async () => {
        const RichBody = await load();
        const doc = env([
            { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [t('소제목')] },
            p(
                t('굵게', [{ type: 'bold' }]), t('기울임', [{ type: 'italic' }]), t('밑줄', [{ type: 'underline' }]), t('취소', [{ type: 'strike' }]),
                t('명조 빨강', [{ type: 'textStyle', attrs: { fontFamily: 'myeongjo', fontSize: 24, color: '#ba0000', backgroundColor: '#fff8b2' } }]),
                t('링크', [{ type: 'link', attrs: { href: 'https://www.connecttrip.co.kr/x' } }]),
                { type: 'hardBreak' },
                t('<script>alert(1)</script><img src=x onerror=alert(1)>'),
            ),
            p(),
            { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('셋'))] }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('점'))] }] },
            { type: 'blockquote', content: [p(t('인용'))] },
            { type: 'horizontalRule' },
        ]);
        const out = html(RichBody, { prepared: prepareRichDoc(doc, 'qna', OWNER), fallback: 'FALLBACK', altBase: '제목' });
        expect(out).toContain('<h2 style="text-align:center"');
        expect(out).toContain('<strong>굵게</strong>');
        expect(out).toContain('<em>기울임</em>');
        expect(out).toContain('<u>밑줄</u>');
        expect(out).toContain('<s>취소</s>');
        expect(out).toMatch(/font-family:&#x27;Nanum Myeongjo&#x27;, serif;font-size:24px;color:#ba0000;background-color:#fff8b2/);
        expect(out).toContain('<a href="https://www.connecttrip.co.kr/x" target="_blank" rel="noopener noreferrer nofollow ugc"');
        expect(out).toContain('<ol start="3"');
        expect(out).toContain('<ul class="my-2 list-disc pl-6"');
        expect(out).toContain('<blockquote');
        expect(out).toContain('<hr');
        expect(out).toContain('<p class="whitespace-pre-wrap"><br/></p>');      // 빈 문단 = 빈 줄
        // 글자 속 HTML 은 글자 그대로(이스케이프)
        expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('onerror="');
        expect(out).not.toContain('FALLBACK');
    });

    it('표식 없는 원본·검증 실패 문서는 평문 칸(fallback)으로 떨어진다', async () => {
        const RichBody = await load();
        const raw = env([{ type: 'heading', attrs: { level: 2 }, content: [t('원본')] }]);
        expect(html(RichBody, { prepared: raw, fallback: '평문 본문' })).toBe(
            '<p class="whitespace-pre-wrap text-[15px] leading-[1.8] text-body break-keep sm:text-[16px]">평문 본문</p>',
        );
        const bad = prepareRichDoc(env([{ type: 'image', attrs: { src: priv(1) } }]), 'qna', OWNER);
        expect(bad.ok).toBe(false);
        expect(html(RichBody, { prepared: bad, fallback: '평문' })).not.toContain('<img');
        expect(html(RichBody, { prepared: { ...prepareRichDoc(raw, 'qna', OWNER) }, fallback: '복사본' })).toContain('복사본');
    });

    it('사진·묶음: 비공개 사진은 받기 전 빈 칸, 추천지 공개 사진은 주소 그대로, 바둑판 5장 이상은 넓은 화면 3열', async () => {
        const RichBody = await load();
        const grid = env([
            { type: 'image', attrs: { src: priv(1) } },
            { type: 'gallery', attrs: { layout: 'grid', images: [priv(2), priv(3), priv(4), priv(5), priv(6)] } },
        ]);
        const out = html(RichBody, { prepared: prepareRichDoc(grid, 'review', OWNER), altBase: '후기' });
        expect(out).not.toContain('sb://');            // 참조 문자열을 img src 로 쓰지 않는다
        expect(out).toContain('grid grid-cols-2 gap-2 sm:grid-cols-3');
        expect((out.match(/aspect-square/g) || []).length).toBe(5);

        const pub = `${PUBLIC_IMAGE_PREFIX}${OWNER}_1700000000001_a.webp`;
        const out2 = html(RichBody, { prepared: prepareRichDoc(env([{ type: 'image', attrs: { src: pub } }]), 'destination', OWNER), altBase: '추천지' });
        expect(out2).toContain(`<img src="${pub}" alt="추천지 사진 1" loading="lazy" decoding="async"`);

        const slide = env([{ type: 'gallery', attrs: { layout: 'slide', images: [priv(7), priv(8)] } }]);
        const out3 = html(RichBody, { prepared: prepareRichDoc(slide, 'review', OWNER), altBase: '후기' });
        expect(out3).toContain('aria-roledescription="carousel"');
        expect(out3).toContain('touch-action:pan-x pan-y;overscroll-behavior-x:contain');
        // 네이버식: 첫 장에서는 '이전' 화살표가 숨고(DOM 에는 남아 포커스가 튀지 않게) '다음'만, 오른쪽 위에 "1 / 2"
        expect(out3).toContain('aria-label="이전 사진" aria-hidden="true" tabindex="-1"');
        expect(out3).toMatch(/aria-label="다음 사진" class=/);
        expect(out3).toContain('1 / 2');

        // 옆으로 나열: 여러 장이 가로로(한 칸 폭 42% / 넓은 화면 29%), 밀어서 보기 + 처음엔 '다음' 화살표만
        const strip = env([{ type: 'gallery', attrs: { layout: 'strip', images: [priv(9), priv(10), priv(11), priv(12)] } }]);
        const out4 = html(RichBody, { prepared: prepareRichDoc(strip, 'review', OWNER), altBase: '후기' });
        expect(out4).toContain('aria-roledescription="carousel"');
        expect(out4).toContain('touch-action:pan-x pan-y;overscroll-behavior-x:contain');
        expect(out4).toContain('w-[42%]');
        expect(out4.match(/aria-roledescription="slide"/g)).toHaveLength(4);
        // 재기 전(서버 렌더·첫 화면)에는 두 화살표 모두 숨김, 화살표는 640px 이상에서만(hidden sm:inline-flex)
        expect(out4).toContain('aria-label="이전 사진" aria-hidden="true" tabindex="-1"');
        expect(out4).toContain('aria-label="다음 사진" aria-hidden="true" tabindex="-1"');
        expect(out4).toContain('hidden sm:inline-flex');
    });

    it('지도: 키가 없으면 카드(장소명·열기 링크·출처 표기), iframe 없음', async () => {
        const RichBody = await load('');
        const doc = env([{ type: 'map', attrs: { name: '서울시청', address: '세종대로 110', lat: 37.5665, lng: 126.978 } }]);
        const out = html(RichBody, { prepared: prepareRichDoc(doc, 'qna', OWNER) });
        expect(out).not.toContain('<iframe');
        expect(out).toContain('서울시청');
        expect(out).toContain('세종대로 110');
        expect(out).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=37.566500%2C126.978000"');
        expect(out).toContain('Google Maps');
    });

    it('지도: 키가 있으면 본문 iframe(조작 불가) + 덮개 "크게 보기", 이름은 iframe 주소에 없다', async () => {
        const RichBody = await load('TESTKEY');
        const doc = env([{ type: 'map', attrs: { name: '<b>이름</b>', lat: 37.5665, lng: 126.978 } }]);
        const out = html(RichBody, { prepared: prepareRichDoc(doc, 'qna', OWNER) });
        const iframe = /<iframe[^>]*>/.exec(out)?.[0] || '';
        expect(iframe).toContain('src="https://www.google.com/maps/embed/v1/view?key=TESTKEY&amp;center=37.566500%2C126.978000&amp;zoom=16&amp;language=ko"');
        expect(iframe).toContain('tabindex="-1"');
        expect(iframe).toContain('aria-hidden="true"');
        expect(iframe).toContain('pointer-events-none');
        expect(iframe).toContain('loading="lazy"');
        expect(iframe).toMatch(/referrerpolicy="strict-origin-when-cross-origin"/i);
        expect(iframe).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
        // 이름은 iframe 제목(title, 접근성)에만 — 주소(src)에는 들어가지 않는다
        const src = /src="([^"]*)"/.exec(iframe)?.[1] || '';
        expect(src).not.toContain('이름');
        expect(src).not.toContain(encodeURIComponent('이름'));
        expect(iframe).toContain('title="&lt;b&gt;이름&lt;/b&gt; 지도"');
        expect(out).toContain('aria-label="&lt;b&gt;이름&lt;/b&gt; 지도 크게 보기"');
        expect(out).toContain('크게 보기');
    });
});
