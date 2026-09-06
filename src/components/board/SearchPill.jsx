import { Search, X } from 'lucide-react';

// 둥근 검색 입력(에어비앤비 검색 필). 값이 있으면 지우기 버튼.
const SearchPill = ({ value, onChange, placeholder = '검색', className = '', ariaLabel = '검색' }) => (
    <div className={`relative ${className}`}>
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="w-full h-11 pl-10 pr-10 rounded-full border border-hairline bg-white text-[14px] text-ink shadow-sm outline-none focus:border-ink focus:shadow-card transition-shadow placeholder:text-muted-soft [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
            <button type="button" onClick={() => onChange('')} aria-label="검색어 지우기" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted hover:bg-surface-soft">
                <X size={14} />
            </button>
        )}
    </div>
);

export default SearchPill;
