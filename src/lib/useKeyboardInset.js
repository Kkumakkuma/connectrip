import { useEffect, useState } from 'react';

// 모바일 화면 키보드(2026-09-27 서식 편집기 2단계, 설계 plan_v3 6-9).
// 키보드가 올라오면 보이는 영역(visualViewport)이 창 높이의 75% 아래로 줄어든다. 그때 글쓰기 창을 보이는 영역에 맞추고
// 하단 등록 줄을 숨기면, 도구막대·편집 중인 줄이 키보드에 가리지 않는다. @capacitor/keyboard·interactive-widget 은 쓰지 않는다.
// 반환 { open, height, top } — open 이 아니면 쓰는 쪽은 아무것도 바꾸지 않는다.
const CLOSED = { open: false, height: 0, top: 0 };

export function useKeyboardInset(enabled) {
    const [st, setSt] = useState(CLOSED);
    useEffect(() => {
        if (!enabled || typeof window === 'undefined' || !window.visualViewport) return undefined;
        const vv = window.visualViewport;
        const update = () => {
            const open = vv.height < window.innerHeight * 0.75;
            const height = Math.round(vv.height);
            const top = Math.round(vv.offsetTop);
            setSt((p) => (p.open === open && p.height === height && p.top === top ? p : { open, height, top }));
        };
        // 효과 안에서 곧바로 상태를 바꾸지 않는다(react-hooks/set-state-in-effect) — 다음 그리기 때 한 번 잰다
        const raf = requestAnimationFrame(update);
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        return () => {
            cancelAnimationFrame(raf);
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
        };
    }, [enabled]);
    return enabled ? st : CLOSED;
}
