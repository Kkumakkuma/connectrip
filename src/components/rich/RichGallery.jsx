import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// 서식 글 안의 사진 묶음(2026-09-26 서식 편집기 1단계, 설계 plan_v3 5-2 + 쿠마님 9/26 지시 "슬라이드 네이버처럼 + 옆으로 나열").
// 작성자가 글쓸 때 세 가지 중 고른다(편집기 선택 화면은 2단계).
//  - grid(콜라주): 640px 미만(모바일)은 장수와 무관하게 2열, 640px 이상은 2~4장 2열·5장 이상 3열. 정사각 칸.
//  - slide(한 장씩): 네이버 블로그 슬라이드처럼 한 장만 보이고, 사진 양옆 화살표 + 오른쪽 위 "n / N". 손가락으로 밀어도 넘어간다.
//  - strip(옆으로 나열): 여러 장이 가로로 늘어서 있고 밀어서 본다(모바일 약 2장 반, 넓은 화면 약 3장 반).
//    화살표는 640px 이상에서만(모바일은 작은 칸을 가리고 밀기와 겹친다 — agy 9/26), 더 볼 사진이 있는 쪽만.
// 가로 넘기기는 라이브러리 없이 scroll-snap.
//   touch-action: pan-x pan-y(가로 넘기기·세로 페이지 스크롤 둘 다 브라우저가 처리),
//   overscroll-behavior-x: contain(끝에서 더 밀어도 브라우저 뒤로가기 스와이프로 이어지지 않음).
// 끝에 닿은 쪽 화살표는 숨기되 DOM 에는 남긴다(tabIndex -1·aria-hidden). 그 버튼에 포커스가 있었으면 반대쪽 화살표로 옮긴다
// (지우거나 disabled 로 바꾸면 포커스가 body 로 튄다 — codex·agy 9/26).
// items = [{ ref, url, alt }] — url 은 RichBody 가 useResolvedImages 로 한 번에 풀어 넘긴다(못 받은 사진은 null = 빈 칸).
// alt 는 문서 전체 사진 순번("… 사진 3") — 단일 사진과 번호가 겹치지 않게 RichBody 가 매긴다.

const TRACK_STYLE = { touchAction: 'pan-x pan-y', overscrollBehaviorX: 'contain' };
const TRACK_CLASS = 'flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
// 사진 위에 얹는 화살표(44px 누름 영역, 흰 반투명 원)
const ARROW_CLASS = 'absolute top-1/2 z-10 h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow-md transition-opacity hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const Photo = ({ url, alt, className }) => (
    url
        ? <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} className={className} />
        : <div className="h-full w-full bg-surface-soft" aria-hidden="true" />
);

// hidden = 끝에 닿아 더 갈 곳이 없음. display 는 호출부가 정한다(slide = 항상, strip = sm 이상).
const Arrow = ({ dir, onClick, label, hidden, btnRef, display }) => (
    <button
        ref={btnRef}
        type="button"
        onClick={hidden ? undefined : onClick}
        aria-label={label}
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
        className={`${ARROW_CLASS} ${display} ${dir < 0 ? 'left-2' : 'right-2'} ${hidden ? 'pointer-events-none opacity-0' : ''}`}
    >
        {dir < 0 ? <ChevronLeft size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
    </button>
);

// 숨겨진 화살표에 포커스가 남아 있으면 반대쪽으로 옮긴다. 둘 다 숨었으면(창을 넓혀 나열이 넘치지 않게 된 경우 등)
// 묶음 영역(section, tabIndex -1)으로 — codex 9/26
function useArrowFocus(prevHidden, nextHidden) {
    const prevRef = useRef(null);
    const nextRef = useRef(null);
    const boxRef = useRef(null);
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const active = document.activeElement;
        const onPrev = active === prevRef.current;
        const onNext = active === nextRef.current;
        if (prevHidden && onPrev) (nextHidden ? boxRef : nextRef).current?.focus();
        else if (nextHidden && onNext) (prevHidden ? boxRef : prevRef).current?.focus();
    }, [prevHidden, nextHidden]);
    return { prevRef, nextRef, boxRef };
}

function Slide({ items, altBase }) {
    const trackRef = useRef(null);
    const targetRef = useRef(null);      // 화살표로 이동 중인 목적지(부드러운 이동 도중 연타해도 목적지 기준으로 한 장씩)
    const [index, setIndex] = useState(0);
    const last = items.length - 1;
    const clamp = (i) => Math.max(0, Math.min(last, i));
    const { prevRef, nextRef, boxRef } = useArrowFocus(index === 0, index === last);

    // 번호·화살표는 실제 스크롤 위치로만 정한다(이동 도중 1 → 2 → 1 로 되돌아가 보이지 않게 — codex 9/26)
    const onScroll = () => {
        const el = trackRef.current;
        if (!el || !el.clientWidth) return;
        const pos = el.scrollLeft / el.clientWidth;
        setIndex(clamp(Math.round(pos)));
        if (targetRef.current !== null && Math.abs(pos - targetRef.current) < 0.02) targetRef.current = null;
    };
    // 사용자가 직접 밀기 시작하면(손가락·마우스·휠) 화살표 목적지는 잊는다 — 다음 화살표는 그때 위치 기준
    const release = useCallback(() => { targetRef.current = null; }, []);
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return undefined;
        el.addEventListener('scrollend', release);      // 지원 브라우저에서는 이동이 끝나면 확실히 비운다
        return () => el.removeEventListener('scrollend', release);
    }, [release]);
    const go = (delta) => {
        const el = trackRef.current;
        if (!el || !el.clientWidth) return;
        const from = targetRef.current ?? Math.round(el.scrollLeft / el.clientWidth);
        const next = clamp(from + delta);
        targetRef.current = next;
        el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    };

    return (
        <section ref={boxRef} tabIndex={-1} className="relative my-4 outline-none" aria-roledescription="carousel" aria-label={`${altBase} 사진 묶음`}>
            <div ref={trackRef} onScroll={onScroll} onPointerDown={release} onWheel={release} className={`${TRACK_CLASS} rounded-md bg-surface-soft`} style={TRACK_STYLE}>
                {items.map((it, i) => (
                    <div key={it.ref} role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${items.length}`} className="aspect-[4/3] w-full flex-shrink-0 snap-center">
                        <Photo url={it.url} alt={it.alt} className="h-full w-full object-contain" />
                    </div>
                ))}
            </div>
            <Arrow dir={-1} onClick={() => go(-1)} label="이전 사진" hidden={index === 0} btnRef={prevRef} display="inline-flex" />
            <Arrow dir={1} onClick={() => go(1)} label="다음 사진" hidden={index === last} btnRef={nextRef} display="inline-flex" />
            <span className="absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-bold tabular-nums text-white" aria-live="polite">
                {index + 1} / {items.length}
            </span>
        </section>
    );
}

function Strip({ items, altBase }) {
    const trackRef = useRef(null);
    // 재기 전에는 두 화살표 모두 숨긴다(넘치지 않는 묶음에서 '다음'이 잠깐 보였다 사라지지 않게)
    const [edge, setEdge] = useState({ start: true, end: true });
    const { prevRef, nextRef, boxRef } = useArrowFocus(edge.start, edge.end);

    const measure = useCallback(() => {
        const el = trackRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        const start = el.scrollLeft <= 2;
        const end = el.scrollLeft >= max - 2;
        setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    }, []);
    // 사진 장수가 바뀌면(트랙 박스 크기는 그대로여도) 다시 잰다 — codex 9/26
    useEffect(() => {
        measure();
        const el = trackRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure, items.length]);

    // 화살표 한 번 = 화면에 보이는 폭의 80%만큼(정착 위치는 scroll-snap 이 칸에 맞춘다)
    const go = (dir) => {
        const el = trackRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * Math.max(1, Math.round(el.clientWidth * 0.8)), behavior: 'smooth' });
    };

    return (
        <section ref={boxRef} tabIndex={-1} className="relative my-4 outline-none" aria-roledescription="carousel" aria-label={`${altBase} 사진 묶음`}>
            <div ref={trackRef} onScroll={measure} className={`${TRACK_CLASS} gap-2`} style={TRACK_STYLE}>
                {items.map((it, i) => (
                    <div key={it.ref} role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${items.length}`}
                        className="aspect-square w-[42%] flex-shrink-0 snap-start overflow-hidden rounded-md bg-surface-soft sm:w-[29%]">
                        <Photo url={it.url} alt={it.alt} className="h-full w-full object-cover" />
                    </div>
                ))}
            </div>
            <Arrow dir={-1} onClick={() => go(-1)} label="이전 사진" hidden={edge.start} btnRef={prevRef} display="hidden sm:inline-flex" />
            <Arrow dir={1} onClick={() => go(1)} label="다음 사진" hidden={edge.end} btnRef={nextRef} display="hidden sm:inline-flex" />
        </section>
    );
}

const RichGallery = ({ layout, items, altBase }) => {
    if (layout === 'slide') return <Slide items={items} altBase={altBase} />;
    if (layout === 'strip') return <Strip items={items} altBase={altBase} />;
    return (
        <div className={`my-4 grid grid-cols-2 gap-2 ${items.length >= 5 ? 'sm:grid-cols-3' : ''}`}>
            {items.map((it) => (
                <div key={it.ref} className="aspect-square overflow-hidden rounded-md bg-surface-soft">
                    <Photo url={it.url} alt={it.alt} className="h-full w-full object-cover" />
                </div>
            ))}
        </div>
    );
};

export default RichGallery;
