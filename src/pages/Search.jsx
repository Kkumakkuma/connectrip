import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Loader2, Users, ShoppingBag, HelpCircle, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';

const BOARDS = [
  { key: 'companion_posts', label: '동행 게시판', icon: Users, color: 'blue', link: '/companion' },
  { key: 'market_listings', label: '장터 게시판', icon: ShoppingBag, color: 'green', link: '/market' },
  { key: 'qna_posts', label: 'Q&A 게시판', icon: HelpCircle, color: 'amber', link: '/qna' },
  { key: 'crew_posts', label: '승무원 전용', icon: Shield, color: 'purple', link: '/crew' },
];

const Search = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) return;

    const doSearch = async () => {
      setLoading(true);
      try {
        const searchResults = {};

        const searches = BOARDS.map(async (board) => {
          const { data, error } = await supabase
            .from(board.key)
            .select('*')
            .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
            .order('created_at', { ascending: false })
            .limit(10);

          if (!error && data?.length > 0) {
            searchResults[board.key] = data;
          }
        });

        await Promise.all(searches);
        setResults(searchResults);
      } catch (err) {
        console.error('검색 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    doSearch();
  }, [query]);

  const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <section className="py-24 bg-gray-50 min-h-screen">
      <SEOHead title="검색 결과 - ConnecTrip" description="ConnecTrip에서 동행, 장터, Q&A, 승무원 게시판을 통합 검색하세요." />
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">검색 결과</h1>
          {query && (
            <p className="text-gray-500">
              "<span className="font-semibold text-blue-600">{query}</span>" 에 대한 검색 결과
              {!loading && ` (${totalResults}건)`}
            </p>
          )}
        </div>

        {loading ? (
          <div className="py-20 text-center">
            <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
            <p className="text-gray-500">검색 중...</p>
          </div>
        ) : !query.trim() ? (
          <div className="py-20 text-center">
            <SearchIcon size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">검색어를 입력해주세요</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="py-20 text-center">
            <SearchIcon size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">검색 결과가 없습니다</p>
            <p className="text-gray-400 mt-2">다른 검색어로 시도해보세요</p>
          </div>
        ) : (
          <div className="space-y-8">
            {BOARDS.map((board) => {
              const items = results[board.key];
              if (!items || items.length === 0) return null;

              const Icon = board.icon;
              const colorMap = {
                blue: 'bg-blue-100 text-blue-600',
                green: 'bg-green-100 text-green-600',
                amber: 'bg-amber-100 text-amber-600',
                purple: 'bg-purple-100 text-purple-600',
              };

              return (
                <motion.div
                  key={board.key}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
                >
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${colorMap[board.color]}`}>
                        <Icon size={20} />
                      </div>
                      <h3 className="font-bold text-gray-900">{board.label}</h3>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">
                        {items.length}건
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(board.link)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                    >
                      게시판 이동 →
                    </button>
                  </div>

                  <div className="divide-y divide-gray-50">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigate(board.link)}
                        className="w-full text-left px-6 py-4 hover:bg-gray-50 transition-colors"
                      >
                        <h4 className="font-semibold text-gray-900 mb-1 line-clamp-1">
                          {item.title}
                        </h4>
                        {item.content && (
                          <p className="text-sm text-gray-500 line-clamp-2">{item.content}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1.5">
                          {item.author && `${item.author} · `}
                          {new Date(item.created_at).toLocaleDateString('ko-KR')}
                        </p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default Search;
