import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Loader2, Users, ShoppingBag, HelpCircle, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';
import ListState from '../components/ListState';

// fields = 검색 대상 컬럼(모든 게시판 본문은 content 로 통일됨),
// bodyField = 결과 카드에 본문 미리보기로 보여줄 컬럼.
const BOARDS = [
  { key: 'companion_posts', label: '동행 게시판', icon: Users, color: 'blue', link: '/companion', fields: ['title', 'content'], bodyField: 'content' },
  { key: 'market_listings', label: '장터 게시판', icon: ShoppingBag, color: 'green', link: '/market', fields: ['title', 'content', 'description'], bodyField: 'content' },
  { key: 'qna_posts', label: 'Q&A 게시판', icon: HelpCircle, color: 'amber', link: '/qna', fields: ['title', 'content'], bodyField: 'content' },
  { key: 'crew_posts', label: '승무원 전용', icon: Shield, color: 'purple', link: '/crew', fields: ['title', 'content'], bodyField: 'content' },
];

const Search = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // 요청 id 로 stale 응답(이전 검색어 결과가 늦게 도착)을 무시한다.
  const requestIdRef = useRef(0);

  const doSearch = useCallback(async () => {
    // PostgREST .or() 필터에 검색어를 직접 보간하므로 특수문자를 제거해
    // 쿼리 깨짐/주입 표면을 차단한다. ( % , ( ) \ * )
    const safe = query.replace(/[%,()\\*]/g, ' ').trim();
    // 새 요청 시작: 이전 in-flight 응답은 이 시점부터 무효.
    const reqId = ++requestIdRef.current;

    if (!safe) {
      setResults({});
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const searchResults = {};
    // board 별 검색을 독립적으로 수행한다. 한 board 쿼리가 실패해도(예: 컬럼/권한)
    // 나머지 board 결과는 그대로 보여주고, "전부 실패"일 때만 error state 로 떨어뜨린다.
    const outcomes = await Promise.all(
      BOARDS.map(async (board) => {
        try {
          const orFilter = board.fields.map((f) => `${f}.ilike.%${safe}%`).join(',');
          const { data, error } = await supabase
            .from(board.key)
            .select('*')
            .or(orFilter)
            .order('created_at', { ascending: false })
            .limit(10);
          if (error) throw error;
          if (data?.length > 0) searchResults[board.key] = data;
          return true;
        } catch (err) {
          console.error(`검색 실패(${board.key}):`, err);
          return false;
        }
      })
    );

    // 더 새로운 요청이 시작됐으면 이 결과는 버린다(stale 무시).
    if (reqId !== requestIdRef.current) return;
    if (outcomes.some(Boolean)) {
      setResults(searchResults);
    } else {
      // 모든 board 쿼리가 실패한 경우에만 에러 표시.
      setResults({});
      setError('검색에 실패했습니다. 다시 시도해주세요.');
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    doSearch();
  }, [doSearch]);

  const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <section className="py-24 bg-gray-50 min-h-screen">
      <SEOHead title="검색 결과 - ConnectTrip" description="ConnectTrip에서 동행, 장터, Q&A, 승무원 게시판을 통합 검색하세요." robots="noindex, follow" />
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
        ) : error ? (
          <ListState error={error} onRetry={doSearch} color="blue" />
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
                      onClick={() => navigate(board.link + '?q=' + encodeURIComponent(query))}
                      className="text-sm text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                    >
                      게시판 이동 →
                    </button>
                  </div>

                  <div className="divide-y divide-gray-50">
                    {items.map((item) => {
                      const body = item[board.bodyField];
                      return (
                        <button
                          key={item.id}
                          onClick={() => navigate(board.link + '?q=' + encodeURIComponent(query))}
                          className="w-full text-left px-6 py-4 hover:bg-gray-50 transition-colors"
                        >
                          <h4 className="font-semibold text-gray-900 mb-1 line-clamp-1">
                            {item.title}
                          </h4>
                          {body && (
                            <p className="text-sm text-gray-500 line-clamp-2">{body}</p>
                          )}
                          <p className="text-xs text-gray-400 mt-1.5">
                            {item.author_name && `${item.author_name} · `}
                            {new Date(item.created_at).toLocaleDateString('ko-KR')}
                          </p>
                        </button>
                      );
                    })}
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
