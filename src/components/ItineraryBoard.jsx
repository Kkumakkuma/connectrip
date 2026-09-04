import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, CalendarDays, MapPin, Heart, CopyPlus, Loader2, Map as MapIcon } from 'lucide-react';
import SEOHead from './SEOHead';
import ListState from './ListState';
import CrewBadge from './CrewBadge';
import ReportButton from './ReportButton';
import LoginPrompt from './LoginPrompt';
import ItineraryMiniMap from './ItineraryMiniMap';
import ItineraryImportNotice from './ItineraryImportNotice';
import { useScrollRestore } from './RouteResetGuard';
import { itineraryApi, postLikeApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { useBlockedIds, filterBlocked } from '../lib/useBlockedIds';
import { useItineraryImport } from '../lib/useItineraryImport';
import { formatRange } from '../lib/itineraryDate';

// 여행 일정 게시판 목록.
// 글쓰기 버튼이 없는 게시판이다 — 글은 플래너에서 "게시판에 올리기"로만 만들어진다.
// 1차 범위는 '더보기' 없이 첫 페이지 고정(설계 §1.2).
const PAGE_SIZE = 20;

const SEO_TITLE = '여행 일정 - ConnectTrip';
const SEO_DESC = '여행자들이 직접 짠 날짜별 여행 일정을 살펴보고, 마음에 드는 일정을 내 플래너로 가져오세요.';

const ItineraryBoard = () => {
  const { user, isLoggedIn } = useAuth();
  const blockedIds = useBlockedIds();
  const [posts, setPosts] = useState([]);
  const [likes, setLikes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { runImport, importingId, notice, clearNotice, showLogin, setShowLogin } = useItineraryImport();

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await itineraryApi.getList(PAGE_SIZE);
      setPosts(data);
      if (data.length > 0) {
        // 좋아요 수·내가 누른 여부는 목록과 별개 테이블이라 한 번에 묶어 받는다.
        const map = await postLikeApi.getForBoard('itinerary_posts', data.map((p) => p.id), user?.id);
        setLikes((prev) => ({ ...prev, ...map }));
      }
    } catch (err) {
      console.error('여행 일정 목록 로딩 실패:', err);
      setPosts([]);
      setError('여행 일정을 불러오지 못했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleToggleLike = async (postId) => {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    try {
      const { data, error: e } = await postLikeApi.toggle('itinerary_posts', postId);
      if (e) throw e;
      setLikes((prev) => ({ ...prev, [postId]: { count: data.likes_count, liked: data.liked } }));
    } catch (err) {
      console.error('좋아요 실패:', err);
      alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
    }
  };

  const visible = filterBlocked(posts, blockedIds);
  const isEmpty = !loading && !error && visible.length === 0;

  // 글을 열었다가 뒤로 돌아왔을 때 보던 위치로 되돌린다.
  // 위치를 저장하는 쪽은 RouteResetGuard 이고, 목록이 다 그려진 시점을 아는 건 이 컴포넌트다.
  useScrollRestore(visible.length > 0);

  return (
    <div className="pt-32 pb-24">
      <SEOHead title={SEO_TITLE} description={SEO_DESC} path="/itinerary" />

      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-8">
          <h1 className="text-2xl sm:text-4xl font-black text-gray-900">여행 일정</h1>
          <p className="text-gray-500 mt-2 font-medium text-sm sm:text-base">
            여행자들이 직접 짠 날짜별 동선입니다. 마음에 드는 일정은 내 플래너로 가져올 수 있습니다.
          </p>
        </header>

        <ItineraryImportNotice notice={notice} onClose={clearNotice} />

        {loading || error || isEmpty ? (
          <ListState
            loading={loading}
            error={error}
            empty={isEmpty}
            onRetry={fetchPosts}
            color="blue"
            loadingText="여행 일정을 불러오는 중..."
            emptyIcon={<MapIcon size={48} className="mx-auto text-gray-300 mb-4" aria-hidden="true" />}
            emptyTitle="아직 올라온 여행 일정이 없습니다."
            emptyDesc=""
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {visible.map((post) => (
              <article
                key={post.id}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 flex flex-col"
              >
                <Link to={`/itinerary/${post.id}`} className="block group">
                  <div className="h-40 bg-gray-50 border-b border-gray-100 p-3">
                    <ItineraryMiniMap
                      days={post.days}
                      dense
                      className="w-full h-full"
                      title={`${post.title} 동선 미리보기`}
                    />
                  </div>

                  <div className="p-5">
                    <h2 className="font-bold text-lg mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">
                      {post.country && <span className="text-blue-600">[{post.country}] </span>}
                      {post.title}
                    </h2>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Calendar size={16} className="text-blue-500 flex-shrink-0" aria-hidden="true" />
                        <span>{formatRange(post.start_date, post.end_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <MapPin size={16} className="text-blue-500 flex-shrink-0" aria-hidden="true" />
                        <span>
                          핀 <strong className="text-gray-900">{post.places_count ?? 0}</strong>개
                        </span>
                        <CalendarDays size={16} className="text-blue-500 flex-shrink-0 ml-2" aria-hidden="true" />
                        <span>
                          <strong className="text-gray-900">{post.days_count ?? 0}</strong>일
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-600 min-w-0">
                        <span className="flex-shrink-0">작성자</span>
                        <strong className="text-gray-900 truncate">{post.author_name || '익명'}</strong>
                        <CrewBadge profile={post.profiles} />
                      </div>
                    </div>
                  </div>
                </Link>

                <div className="px-5 pb-5 mt-auto flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleToggleLike(post.id)}
                    className={`flex items-center gap-1 px-3 py-2.5 rounded-xl font-bold transition-colors ${
                      likes[post.id]?.liked ? 'bg-pink-50 text-pink-500' : 'bg-gray-50 text-gray-400 hover:text-pink-500'
                    }`}
                    aria-pressed={!!likes[post.id]?.liked}
                    aria-label="좋아요"
                  >
                    <Heart size={18} fill={likes[post.id]?.liked ? 'currentColor' : 'none'} aria-hidden="true" />
                    {likes[post.id]?.count || 0}
                  </button>

                  <div className="flex items-center gap-1">
                    <ReportButton postId={post.id} boardType="itinerary" reportedUserId={post.user_id} />
                    <button
                      onClick={() => runImport(post.id)}
                      disabled={importingId === post.id}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importingId === post.id ? (
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <CopyPlus size={16} aria-hidden="true" />
                      )}
                      가져오기
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </motion.div>
        )}
      </div>

      <LoginPrompt isOpen={showLogin} onClose={() => setShowLogin(false)} next="/itinerary" />
    </div>
  );
};

export default ItineraryBoard;
