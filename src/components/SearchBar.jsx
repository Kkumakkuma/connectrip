import { useState, useCallback, useRef, useId } from 'react';
import { applyToInput, suggestHangul } from '../lib/hangulFix';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

const SearchBar = ({ onNavigate, className = '' }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      navigate(`/search?q=${encodeURIComponent(q)}`);
      setQuery('');
      onNavigate?.();
    },
    [query, navigate, onNavigate]
  );

  const hangul = suggestHangul(query);   // 영문 자판으로 친 한글이면 한 번 눌러 되살린다(2026-09-06)
  const inputRef = useRef(null);
  const inputId = useId();

  return (
    <form onSubmit={handleSubmit} className={`relative ${className}`}>
      <Search
        size={18}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="검색..."
        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-sm font-medium text-gray-700 placeholder-gray-400"
      />
      {hangul && (
        // 모바일(세로 메뉴)에서는 흐름 안에 두어 아래 버튼과 겹치지 않게, 데스크톱(가로 바)에서는 입력 아래에 띄운다(codex·agy 9/6)
        <div role="status" aria-live="polite" className="mt-1 md:absolute md:left-3 md:top-full md:z-10 md:mt-1 md:max-w-[calc(100%-1.5rem)]">
          <button
            type="button"
            aria-controls={inputId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyToInput(inputRef.current, hangul)}
            className="inline-flex min-h-[32px] max-w-full items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-700 shadow border border-gray-200"
          >
            <span className="text-gray-500">한글로 바꾸기</span>
            <span className="truncate font-semibold">{hangul}</span>
          </button>
        </div>
      )}
    </form>
  );
};

export default SearchBar;
