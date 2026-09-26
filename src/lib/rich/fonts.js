// 서식 글 글꼴(2026-09-26 서식 편집기 1단계, 설계 plan_v3 10장).
// 글꼴 CSS 는 전역에 넣지 않는다. 글을 그리기 전에 그 글이 쓰는 글꼴만, 쓰인 글자로 미리 받는다.
// 입력은 prepareRichDoc 이 검증하면서 모은 글꼴별 글자(prepared.fonts)뿐이다 — 검증 안 된 문서는 받지 않는다.
// 전부 SIL OFL 1.1(구글 폰트): 나눔명조 · 나눔손글씨 펜 · 고운돋움. 기본 글꼴(Pretendard)은 index.html 이 이미 받는다.
import { useEffect, useState } from 'react';
import { isPreparedDoc } from './doc';

const CSS_URL = Object.freeze({
    myeongjo: 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap',
    pen: 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap',
    dodum: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap',
});
const FAMILY = Object.freeze({ myeongjo: 'Nanum Myeongjo', pen: 'Nanum Pen Script', dodum: 'Gowun Dodum' });
export const FONT_WAIT_MS = 800;

const cssLoads = new Map();   // token -> Promise (한 번만 넣는다)

// 글꼴 CSS <link> 를 한 번만 넣고, 그 CSS 가 도착(또는 실패)하면 끝나는 약속을 돌려준다.
export function ensureFontCss(token) {
    if (!CSS_URL[token] || typeof document === 'undefined') return Promise.resolve();
    if (cssLoads.has(token)) return cssLoads.get(token);
    const p = new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_URL[token];
        link.dataset.ctFont = token;
        link.onload = () => resolve();
        link.onerror = () => resolve();      // 못 받아도 기본 글꼴로 그린다
        document.head.appendChild(link);
    });
    cssLoads.set(token, p);
    return p;
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// 검증된 문서(prepareRichDoc 결과)가 쓰는 글꼴을 최대 timeoutMs 까지 기다린다. 늦으면 그냥 그린다(CSS 가 display=swap).
export async function preloadDocFonts(prepared, timeoutMs = FONT_WAIT_MS) {
    if (!isPreparedDoc(prepared) || !prepared.ok || typeof document === 'undefined') return;
    const tokens = Object.keys(prepared.fonts || {}).filter((t) => CSS_URL[t]);
    if (!tokens.length) return;
    const loads = tokens.map(async (t) => {
        await ensureFontCss(t);
        if (!document.fonts || typeof document.fonts.load !== 'function') return;
        try {
            await document.fonts.load(`1em "${FAMILY[t]}"`, prepared.fonts[t] || undefined);
        } catch {
            /* 글꼴을 못 받아도 본문은 기본 글꼴로 보인다 */
        }
    });
    await Promise.race([Promise.all(loads), wait(timeoutMs)]);
}

const needsFonts = (p) => isPreparedDoc(p) && p.ok && Object.keys(p.fonts || {}).some((t) => CSS_URL[t]);

// 상세 화면용(본문 문서 a, 추천지 꿀팁 문서 b): 글꼴을 쓰지 않으면 바로 true, 쓰면 받거나 800ms 가 지나면 true.
// 넘기는 값은 useMemo 로 고정된 prepareRichDoc 결과여야 한다(같은 글이면 같은 객체).
export function useDocFonts(a, b = null) {
    const needA = needsFonts(a);
    const needB = needsFonts(b);
    const [done, setDone] = useState({ a: null, b: null });
    useEffect(() => {
        if (!needA && !needB) return undefined;
        let alive = true;
        Promise.all([needA ? preloadDocFonts(a) : null, needB ? preloadDocFonts(b) : null])
            .then(() => { if (alive) setDone({ a, b }); });
        return () => { alive = false; };
    }, [a, b, needA, needB]);
    if (!needA && !needB) return true;
    return done.a === a && done.b === b;
}
