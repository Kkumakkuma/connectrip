import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// 서식 글 안의 사진 묶음(2026-09-26 서식 편집기 1단계, 설계 plan_v3 5-2).
//  - grid: 640px 미만(모바일)은 장수와 무관하게 2열, 640px 이상은 2~4장 2열·5장 이상 3열. 정사각 칸.
//  - slide: 라이브러리 없이 가로 scroll-snap + 이전/다음 버튼 + "n / N".
//    touch-action: pan-x pan-y(가로 넘기기·세로 페이지 스크롤 둘 다 브라우저가 처리),
//    overscroll-behavior-x: contain(끝에서 더 밀어도 브라우저 뒤로가기 스와이프로 이어지지 않음).
// items = [{ ref, url, alt }] — url 은 RichBody 가 useResolvedImages 로 한 번에 풀어 넘긴다(못 받은 사진은 null = 빈 칸).
// alt 는 문서 전체 사진 순번("… 사진 3") — 단일 사진과 번호가 겹치지 않게 RichBody 가 매긴다.

const Photo = ({ url, alt, className }) => (
    url
        ? <img src={url} alt={alt} loading="lazy" decoding="async" className={className} />
        : <div className="h-full w-full bg-surface-soft" aria-hidden="true" />
);

function Slide({ items, altBase }) {
    const trackRef = useRef(null);
    const [index, setIndex] = useState(0);
    const last = items.length - 1;
    const clamp = (i) => Math.max(0, Math.min(last, i));

    const onScroll = () => {
        const el = trackRef.current;
        if (!el || !el.clientWidth) return;
        setIndex(clamp(Math.round(el.scrollLeft / el.clientWidth)));
    };
    const go = (delta) => {
        const el = trackRef.current;
        if (!el) return;
        const next = clamp(index + delta);
        el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
        setIndex(next);
    };

    return (
        <section className="my-4" aria-roledescription="carousel" aria-label={`${altBase} 사진 묶음`}>
            <div
                ref={trackRef}
                onScroll={onScroll}
                className="flex snap-x snap-mandatory overflow-x-auto rounded-md bg-surface-soft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ touchAction: 'pan-x pan-y', overscrollBehaviorX: 'contain' }}
            >
                {items.map((it, i) => (
                    <div key={it.ref} role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${items.length}`} className="aspect-[4/3] w-full flex-shrink-0 snap-center">
                        <Photo url={it.url} alt={it.alt} className="h-full w-full object-contain" />
                    </div>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-center gap-3">
                <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="이전 사진" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-hairline text-ink hover:bg-surface-soft disabled:opacity-40">
                    <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <span className="min-w-[3.5rem] text-center text-[13px] tabular-nums text-muted" aria-live="polite">{index + 1} / {items.length}</span>
                <button type="button" onClick={() => go(1)} disabled={index === last} aria-label="다음 사진" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-hairline text-ink hover:bg-surface-soft disabled:opacity-40">
                    <ChevronRight size={18} aria-hidden="true" />
                </button>
            </div>
        </section>
    );
}

const RichGallery = ({ layout, items, altBase }) => {
    if (layout === 'slide') return <Slide items={items} altBase={altBase} />;
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
