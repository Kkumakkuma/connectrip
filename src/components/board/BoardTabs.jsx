// 밑줄 탭(에어비앤비식). items: [{ id, label, icon? }] — icon 은 lucide 컴포넌트.
const BoardTabs = ({ items, value, onChange, className = '' }) => (
    <div role="tablist" className={`flex gap-6 border-b border-hairline overflow-x-auto no-scrollbar mb-4 ${className}`}>
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

export default BoardTabs;
