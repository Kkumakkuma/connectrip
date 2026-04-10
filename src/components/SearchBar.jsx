import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

const SearchBar = ({ onNavigate, className = '' }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

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

  return (
    <form onSubmit={handleSubmit} className={`relative ${className}`}>
      <Search
        size={18}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="검색..."
        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-sm font-medium text-gray-700 placeholder-gray-400"
      />
    </form>
  );
};

export default SearchBar;
