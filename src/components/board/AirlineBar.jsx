import { AIRLINE_TAGS } from '../../lib/airlineTags';
import useScrollHint from '../../lib/useScrollHint';

// 항공사 말머리 필터 바. "전체" + 말머리 목록, 가로 스크롤, 활성은 ink 밑줄.
// 대륙 바(ContinentBar)와 같은 구조지만 항목이 많아 아이콘 없이 이름만 한 줄로 둔다.
// value: 말머리 id 또는 null(전체). onChange(id|null).
const AirlineBar = ({ value, onChange, className = '' }) => {
    const items = [{ id: null, name: '전체' }, ...AIRLINE_TAGS];
    const [scrollRef, hintStyle] = useScrollHint();
    return (
        <div ref={scrollRef} style={hintStyle} role="tablist" aria-label="항공사 말머리" className={`flex gap-1 sm:gap-2 overflow-x-auto no-scrollbar border-b border-hairline mb-5 -mx-4 px-4 sm:mx-0 sm:px-0 ${className}`}>
            {items.map((a) => {
                const active = (value || null) === a.id;
                return (
                    <button
                        key={a.id || 'all'}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(a.id)}
                        onKeyDown={(e) => {
                            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                            e.preventDefault();
                            const idx = items.findIndex((x) => x.id === a.id);
                            const next = items[(idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
                            onChange(next.id);
                            e.currentTarget.parentElement?.querySelector(`[data-airline="${next.id || 'all'}"]`)?.focus();
                        }}
                        onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
                        data-airline={a.id || 'all'}
                        className={`inline-flex items-center justify-center min-w-[64px] min-h-[44px] px-3 border-b-2 -mb-px whitespace-nowrap text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-t-md ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                    >
                        {a.name}
                    </button>
                );
            })}
        </div>
    );
};

export default AirlineBar;
