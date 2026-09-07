import useScrollHint from '../../lib/useScrollHint';

// 밑줄 탭(에어비앤비식). items: [{ id, label, icon? }] — icon 은 lucide 컴포넌트.
const BoardTabs = ({ items, value, onChange, className = '' }) => {
    // 장터 탭 4개는 390/360px 에서 '공동구매'가 화면 밖으로 나간다 — 페이드로 스크롤 단서를 준다.
    const [scrollRef, hintStyle] = useScrollHint();
    return (
    <div ref={scrollRef} style={hintStyle} role="tablist" className={`flex gap-4 sm:gap-6 border-b border-hairline overflow-x-auto no-scrollbar mb-4 ${className}`}>
        {items.map(({ id, label, icon: Icon }) => {
            const active = value === id;
            return (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChange(id)}
                    className={`flex items-center gap-1.5 pb-3 pt-1 text-[15px] whitespace-nowrap border-b-2 -mb-px transition-colors ${active ? 'text-ink font-bold border-ink' : 'text-muted font-semibold border-transparent hover:text-ink'}`}
                >
                    {Icon && <Icon size={16} aria-hidden="true" />}
                    {label}
                </button>
            );
        })}
    </div>
    );
};

export default BoardTabs;
