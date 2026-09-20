import { useCallback, useEffect, useRef } from 'react';
import { CONTINENTS } from '../../lib/continents';
import useScrollHint from '../../lib/useScrollHint';

// 대륙 필터 바(에어비앤비 카테고리 바). "전체" + 6대륙, 가로 스크롤. 단일 선택이라 tablist/tab 으로 알린다.
// value: 대륙 id 또는 null(전체). onChange(id|null).
//
// 2026-09-20 (쿠마님 캡처: 오세아니아를 골라도 글씨만 살짝 굵어져 뭘 골랐는지 안 보였다):
// - 밑줄이 안 보이던 진짜 원인은 index.css 전역 button{border:none}(→ @layer base 로 이동). 구조도 BoardTabs 처럼
//   래퍼/스크롤 줄로 나눠 밑줄 2px 이 잘리지 않게 했다.
// - 활성은 그 대륙의 연한 배경 + 대륙색 글씨·밑줄(글쓰기 말머리 ContinentPicker 와 같은 색)로 칩처럼 보인다.
// - 390px 에서 ?region=asia 로 들어오면 활성 칩이 화면 밖에 있었다 → 값이 바뀌면 활성 탭을 스크롤 줄 안으로 끌어온다.
//   scrollIntoView 는 안 쓴다: block:'nearest' 라도 바가 세로로 화면 밖이면(아래로 내린 뒤 뒤로가기 등) 페이지를
//   위로 튀게 한다(agy 검토). 가로 스크롤 컨테이너만 scrollBy 로 움직인다.
const ContinentBar = ({ value, onChange, className = '' }) => {
    const items = [{ id: null, name: '전체', icon: '🌐', bg: 'bg-surface-soft', text: 'text-ink' }, ...CONTINENTS];
    // 360px 에서는 7개가 한 줄에 안 들어간다 — 잘린 쪽에 페이드를 줘 스크롤되는 줄임을 알린다.
    const [scrollRef, hintStyle] = useScrollHint();
    const listRef = useRef(null);
    // useScrollHint 의 ref 는 callback ref 라, 인라인 함수로 합치면 렌더마다 null→el 이 다시 들어가 옵저버가 매번
    // 해제·재등록된다(agy 검토) → 고정한다. scrollRef 자체는 훅 안에서 useCallback([]) 이라 안정적이다.
    const setListRef = useCallback((el) => { scrollRef(el); listRef.current = el; }, [scrollRef]);
    useEffect(() => {
        const list = listRef.current; const el = list?.querySelector('[aria-selected="true"]');
        if (!list || !el) return;
        const lr = list.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (er.left < lr.left) list.scrollBy({ left: er.left - lr.left - 8 });
        else if (er.right > lr.right) list.scrollBy({ left: er.right - lr.right + 8 });
    }, [value]);
    return (
        <div className={`border-b border-hairline mb-5 -mx-4 sm:mx-0 ${className}`}>
            <div ref={setListRef} style={hintStyle} role="tablist" aria-label="대륙" className="flex gap-1 sm:gap-2 overflow-x-auto no-scrollbar -mb-px px-4 sm:px-0">
                {items.map((c) => {
                    const active = (value || null) === c.id;
                    return (
                        <button
                            key={c.id || 'all'}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            onClick={() => onChange(c.id)}
                            onKeyDown={(e) => {
                                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                                e.preventDefault();
                                const idx = items.findIndex((x) => x.id === c.id);
                                const next = items[(idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
                                onChange(next.id);
                                e.currentTarget.parentElement?.querySelector(`[data-continent="${next.id || 'all'}"]`)?.focus();
                            }}
                            onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
                            data-continent={c.id || 'all'}
                            className={`flex flex-col items-center justify-center gap-1 min-w-[64px] sm:min-w-[76px] min-h-[56px] px-2 pt-2 pb-2.5 border-b-2 rounded-t-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${active ? `${c.bg} ${c.text} border-current` : 'border-transparent text-muted hover:text-ink hover:bg-surface-soft'}`}
                        >
                            <span className={`text-[22px] leading-none ${active ? '' : 'opacity-70'}`} aria-hidden="true">{c.icon}</span>
                            <span className={`text-[12px] whitespace-nowrap ${active ? 'font-bold' : 'font-semibold'}`}>{c.name}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ContinentBar;
