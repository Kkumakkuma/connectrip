import { useCallback, useEffect, useRef, useState } from 'react';

// 가로로 스크롤되는 탭 줄에서 "옆에 더 있다"를 알리는 힌트.
//
// 360px 에서 대륙 탭('아시아'·'오세아니아')과 장터 탭('공동구매')이 화면 밖에 있는데,
// no-scrollbar 로 스크롤바를 숨겨 둬서 더 있다는 단서가 전혀 없었다(2026-09-07 실측).
// 끝에 닿은 쪽은 페이드를 끄므로, 다 본 뒤에도 잘린 것처럼 보이지는 않는다.
//
// ref 는 callback ref 다. 요소가 나중에 붙는 화면(관리자 페이지처럼 인증 로딩 뒤에야
// 탭이 렌더되는 곳)에서도 붙는 순간 바로 관찰을 시작한다 — useRef + useEffect 조합은
// 첫 렌더에 요소가 없으면 영영 연결되지 않는다(codex 지적, 2026-09-07).
//
// 반환: [ref, style] — ref 를 스크롤 컨테이너에, style 을 같은 요소에 붙인다.
export default function useScrollHint() {
    const elRef = useRef(null);
    const cleanupRef = useRef(null);
    const [edge, setEdge] = useState({ left: false, right: false });

    const measure = useCallback(() => {
        const el = elRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        const next = { left: el.scrollLeft > 4, right: max > 4 && el.scrollLeft < max - 4 };
        // 값이 같으면 새 객체를 만들지 않는다(스크롤 중 불필요한 리렌더 방지).
        setEdge((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    }, []);

    const ref = useCallback((el) => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        elRef.current = el;
        if (!el) return;
        measure();
        el.addEventListener('scroll', measure, { passive: true });
        // 컨테이너 폭(회전·창 크기)과 내용 폭(탭 추가·웹폰트 로드) 양쪽을 본다.
        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(measure);
            ro.observe(el);
            for (const child of el.children) ro.observe(child);
        }
        // 자식이 나중에 늘거나 줄어도 다시 잰다.
        let mo = null;
        if (typeof MutationObserver !== 'undefined') {
            mo = new MutationObserver(() => {
                measure();
                if (!ro) return;
                for (const child of el.children) ro.observe(child);
            });
            mo.observe(el, { childList: true, subtree: true, characterData: true });
        }
        cleanupRef.current = () => {
            el.removeEventListener('scroll', measure);
            ro?.disconnect();
            mo?.disconnect();
        };
    }, [measure]);

    useEffect(() => () => cleanupRef.current?.(), []);

    const FADE = '24px';
    let grad;
    if (edge.left && edge.right) {
        grad = `linear-gradient(to right, transparent 0, #000 ${FADE}, #000 calc(100% - ${FADE}), transparent 100%)`;
    } else if (edge.right) {
        grad = `linear-gradient(to right, #000 calc(100% - ${FADE}), transparent 100%)`;
    } else if (edge.left) {
        grad = `linear-gradient(to right, transparent 0, #000 ${FADE})`;
    }

    return [ref, grad ? { maskImage: grad, WebkitMaskImage: grad } : undefined];
}
