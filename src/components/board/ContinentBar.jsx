import { CONTINENTS } from '../../lib/continents';

// 대륙 필터 바(에어비앤비 카테고리 바). "전체" + 6대륙, 가로 스크롤, 활성은 ink 밑줄.
// value: 대륙 id 또는 null(전체). onChange(id|null).
const ContinentBar = ({ value, onChange, className = '' }) => {
    const items = [{ id: null, name: '전체', icon: '🌐' }, ...CONTINENTS];
    return (
        <div role="group" aria-label="대륙" className={`flex gap-1 sm:gap-2 overflow-x-auto no-scrollbar border-b border-hairline mb-5 -mx-4 px-4 sm:mx-0 sm:px-0 ${className}`}>
            {items.map((c) => {
                const active = (value || null) === c.id;
                return (
                    <button
                        key={c.id || 'all'}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(c.id)}
                        onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
                        className={`flex flex-col items-center justify-center gap-1 min-w-[64px] sm:min-w-[76px] min-h-[56px] px-2 pt-2 pb-2.5 border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-t-md ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                    >
                        <span className={`text-[22px] leading-none ${active ? '' : 'opacity-70'}`} aria-hidden="true">{c.icon}</span>
                        <span className={`text-[12px] whitespace-nowrap ${active ? 'font-bold' : 'font-semibold'}`}>{c.name}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default ContinentBar;
