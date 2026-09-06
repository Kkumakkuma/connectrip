import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Calendar, CalendarDays, MapPin, Heart, CopyPlus, Loader2, Clock, Eye,
} from 'lucide-react';
import SEOHead from './SEOHead';
import ListState from './ListState';
import CrewBadge from './CrewBadge';
import AuthorActions from './AuthorActions';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import LoginPrompt from './LoginPrompt';
import ItineraryMiniMap from './ItineraryMiniMap';
import ItineraryImportNotice from './ItineraryImportNotice';
import { itineraryApi, postLikeApi } from '../lib/db';
import { useAuth } from '../lib/AuthContext';
import { dayColor } from '../lib/itineraryColors';
import { useItineraryImport } from '../lib/useItineraryImport';
import { formatRange, formatMonthDay, weekdayKo, formatTime } from '../lib/itineraryDate';

// 여행 일정 글 상세. 코드베이스에서 처음으로 글 하나가 자기 주소를 갖는 화면이다
// (다른 게시판은 목록 안에서 펼치거나 모달로 연다).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 스냅샷은 서버가 조립하지만 화면은 값이 비어 있어도 죽지 않아야 한다.
function readDays(snapshot) {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  return days
    .map((day, i) => ({
      index: Number.isFinite(Number(day?.index)) ? Number(day.index) : i,
      date: day?.date || '',
      places: (Array.isArray(day?.places) ? day.places : [])
        .slice()
        .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0)),
    }))
    .sort((a, b) => a.index - b.index);
}

const PlaceRow = ({ place, order, color }) => (
  <li className="flex gap-3">
    <span
      className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {order}
    </span>
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-gray-900">{place?.name || '이름 없는 장소'}</p>
      {place?.address && <p className="text-sm text-gray-500">{place.address}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {formatTime(place?.planned_time) && (
          <span className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden="true" />
            {formatTime(place.planned_time)}
          </span>
        )}
        {Number(place?.stay_min) > 0 && <span>체류 {Number(place.stay_min)}분</span>}
      </div>
      {place?.note && <p className="mt-1.5 text-sm text-gray-600">{place.note}</p>}
    </div>
  </li>
);

const ItineraryPost = () => {
  const { postId } = useParams();
  const { user, isLoggedIn } = useAuth();
  const [post, setPost] = useState(null);
  const [like, setLike] = useState({ count: 0, liked: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const viewedRef = useRef(null);
  const { runImport, importingId, notice, clearNotice, showLogin, setShowLogin } = useItineraryImport();

  const fetchPost = useCallback(async () => {
    if (!postId || !UUID_RE.test(postId)) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setNotFound(false);
      const data = await itineraryApi.getById(postId);
      if (!data) {
        setPost(null);
        setNotFound(true);
        return;
      }
      setPost(data);
      const map = await postLikeApi.getForBoard('itinerary_posts', [data.id], user?.id);
      if (map[data.id]) setLike(map[data.id]);
    } catch (err) {
      console.error('여행 일정 글 로딩 실패:', err);
      setPost(null);
      setError('글을 불러오지 못했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [postId, user?.id]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  // 조회수. 글 하나당 한 번만 보내고(개발 모드 이중 실행 포함), 실패해도 화면에는 영향이 없다.
  useEffect(() => {
    if (!post?.id || viewedRef.current === post.id) return;
    viewedRef.current = post.id;
    itineraryApi.bumpView(post.id).catch((err) => console.error('조회수 반영 실패:', err));
  }, [post?.id]);

  const handleToggleLike = async () => {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    if (!post?.id) return;
    try {
      const { data, error: e } = await postLikeApi.toggle('itinerary_posts', post.id);
      if (e) throw e;
      setLike({ count: data.likes_count, liked: data.liked });
    } catch (err) {
      console.error('좋아요 실패:', err);
      alert(err?.message?.includes('phone') ? '휴대폰 인증 후 좋아요할 수 있어요.' : '좋아요 처리에 실패했습니다.');
    }
  };

  const backLink = (
    <Link
      to="/itinerary"
      className="inline-flex items-center gap-2 text-blue-600 font-bold mb-8 hover:translate-x-[-5px] transition-transform"
    >
      <ArrowLeft size={20} aria-hidden="true" /> 여행 일정 목록으로
    </Link>
  );

  if (loading || error || notFound || !post) {
    return (
      <div className="pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-4">
          {backLink}
          {notFound && !loading && !error ? (
            <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
              <p className="text-gray-500 text-lg">글을 찾을 수 없습니다.</p>
            </div>
          ) : (
            <ListState
              loading={loading}
              error={error}
              onRetry={fetchPost}
              color="blue"
              loadingText="여행 일정을 불러오는 중..."
            />
          )}
        </div>
      </div>
    );
  }

  const snapshot = post.snapshot && typeof post.snapshot === 'object' ? post.snapshot : null;
  const days = readDays(snapshot);
  const daysWithPlaces = days.filter((d) => d.places.length > 0);
  const unassigned = Array.isArray(snapshot?.unassigned) ? snapshot.unassigned : [];
  const period = formatRange(post.start_date, post.end_date);
  const seoTitle = `${post.title} - ConnectTrip`;
  const seoDesc = `${period} · ${post.days_count ?? 0}일 · 장소 ${post.places_count ?? 0}곳. 커넥트립 여행 일정.`;

  return (
    <div className="pt-32 pb-24">
      <SEOHead title={seoTitle} description={seoDesc} path={`/itinerary/${post.id}`} />

      <div className="max-w-3xl mx-auto px-4">
        {backLink}

        <ItineraryImportNotice notice={notice} onClose={clearNotice} />

        <article className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <header className="px-5 sm:px-8 pt-6 sm:pt-8">
            <h1 className="text-xl sm:text-3xl font-black text-gray-900">
              {post.country && <span className="text-blue-600">[{post.country}] </span>}
              {post.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={16} className="text-blue-500" aria-hidden="true" />
                {period}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={16} className="text-blue-500" aria-hidden="true" />
                {post.days_count ?? 0}일
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={16} className="text-blue-500" aria-hidden="true" />
                핀 {post.places_count ?? 0}개
              </span>
              <span className="inline-flex items-center gap-1 min-w-0">
                <strong className="text-gray-900 truncate">{post.author_name || '익명'}</strong>
                <CrewBadge profile={post.profiles} />
                <AuthorActions userId={post.user_id} name={post.author_name || ''} size={13} />
              </span>
              <span className="inline-flex items-center gap-1.5 text-gray-400">
                <Eye size={16} aria-hidden="true" />
                {post.view_count ?? 0}
                <CopyPlus size={16} className="ml-2" aria-hidden="true" />
                {post.import_count ?? 0}
              </span>
            </div>
          </header>

          <div className="px-5 sm:px-8 mt-6">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <ItineraryMiniMap
                days={days}
                className="w-full h-56 sm:h-72"
                title={`${post.title} 동선 지도`}
              />
              {daysWithPlaces.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {daysWithPlaces.map((day) => (
                    <span key={day.index} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: dayColor(day.index) }}
                        aria-hidden="true"
                      />
                      {day.index + 1}일차
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 sm:px-8 py-6 sm:py-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">날짜별 동선</h2>

            {days.length > 0 ? (
              <div className="space-y-6">
                {days.map((day) => (
                  <section key={day.index}>
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: dayColor(day.index) }}
                        aria-hidden="true"
                      />
                      <h3 className="font-bold text-gray-900">
                        {day.index + 1}일차
                        {day.date && (
                          <span className="ml-2 font-medium text-gray-500">
                            {formatMonthDay(day.date)}
                            {weekdayKo(day.date) && ` (${weekdayKo(day.date)})`}
                          </span>
                        )}
                      </h3>
                    </div>
                    {day.places.length > 0 ? (
                      <ol className="space-y-3">
                        {day.places.map((place, i) => (
                          <PlaceRow
                            key={`${day.index}-${i}`}
                            place={place}
                            order={i + 1}
                            color={dayColor(day.index)}
                          />
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-gray-400">이 날은 비어 있습니다.</p>
                    )}
                  </section>
                ))}

                {unassigned.length > 0 && (
                  <section>
                    <h3 className="font-bold text-gray-900 mb-3">날짜를 정하지 않은 장소</h3>
                    <ul className="space-y-2 text-sm text-gray-700">
                      {unassigned.map((place, i) => (
                        <li key={`unassigned-${i}`} className="flex gap-2">
                          <MapPin size={16} className="mt-0.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
                          <span>{place?.name || '이름 없는 장소'}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              // 스냅샷을 읽지 못하면 게시글 본문(서버가 만든 동선 요약)을 그대로 보여준다.
              <p className="whitespace-pre-line text-gray-700">{post.content || '표시할 일정이 없습니다.'}</p>
            )}
          </div>

          <footer className="px-5 sm:px-8 py-5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleLike}
                className={`flex items-center gap-1 px-3 py-2.5 rounded-xl font-bold transition-colors ${
                  like.liked ? 'bg-pink-50 text-pink-500' : 'bg-gray-50 text-gray-400 hover:text-pink-500'
                }`}
                aria-pressed={like.liked}
                aria-label="좋아요"
              >
                <Heart size={18} fill={like.liked ? 'currentColor' : 'none'} aria-hidden="true" />
                {like.count || 0}
              </button>
              <ShareButtons title={`${post.title} - ConnectTrip 여행 일정`} description={post.content || ''} />
              <ReportButton postId={post.id} boardType="itinerary" reportedUserId={post.user_id} />
            </div>

            <button
              onClick={() => runImport(post.id)}
              disabled={importingId === post.id}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingId === post.id ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : (
                <CopyPlus size={18} aria-hidden="true" />
              )}
              내 플래너로 가져오기
            </button>
          </footer>
        </article>
      </div>

      <LoginPrompt
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
        next={`/itinerary/${post.id}`}
      />
    </div>
  );
};

export default ItineraryPost;
