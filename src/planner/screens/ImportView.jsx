import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import Button from '../kit/Button';
import Card from '../kit/Card';
import { importFromPost, importFromToken } from '../api';
import { savePendingImport } from '../importPending';

// 가져오기 처리 화면 (설계 §1.1).
//   /planner/import?post=<게시글 id>   게시판에서 넘어온 경우
//   /planner/import?token=<공유 토큰>  공유 링크에서 넘어온 경우
//
// 화면이라기보다 처리기다. 성공하면 새로 만들어진 여행의 일정판으로 바로 넘어가고,
// 실패했을 때만 사람이 읽을 화면이 남는다.
//
// 비로그인 처리가 이 화면의 핵심이다. 로그인 가드로 막아 버리면 "가져오려던 대상"이 사라져서
// 로그인 뒤 사용자가 처음부터 다시 찾아와야 한다. 그래서 여기서는
//   ① 대상(post/token)을 30분짜리 대기 항목으로 적어 두고
//   ② next 를 붙여 로그인으로 보낸다.
// 로그인 뒤에는 next 로 이 화면에 되돌아와 그대로 이어지고, next 가 끊긴 경우에도
// /planner 진입 시 TripList 가 대기 항목을 집어 마무리한다(이중 안전장치).

// 공유 토큰은 64자리 hex 다. 형식이 다르면 서버까지 갈 필요가 없다.
const TOKEN_RE = /^[0-9a-f]{64}$/;

export default function ImportView() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const postId = (params.get('post') || '').trim();
  const rawToken = (params.get('token') || '').trim();
  const token = TOKEN_RE.test(rawToken) ? rawToken : '';
  const hasTarget = Boolean(postId || token);

  // 대상이 없다는 건 URL 만 봐도 안다. effect 안에서 setState 로 알리면 렌더가 한 번 더 돈다.
  const [error, setError] = useState(
    hasTarget ? null : '가져올 일정을 찾지 못했습니다. 게시글이나 공유 링크에서 다시 눌러 주세요.',
  );
  const [busy, setBusy] = useState(hasTarget);
  // StrictMode 는 개발 중 effect 를 두 번 실행한다. 가져오기는 여행을 만드는 쓰기 작업이라
  // 두 번 돌면 사본이 둘 생긴다. 실행 여부를 ref 로 잠근다.
  const startedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !hasTarget) return undefined;
    if (startedRef.current) return undefined;

    // 비로그인: 대상을 적어 두고 로그인으로 보낸다. 여기서 startedRef 를 잠그지 않는 이유는
    // 로그인 뒤 같은 화면으로 돌아왔을 때 다시 처리가 시작돼야 하기 때문이다.
    if (!user) {
      savePendingImport({ post: postId || null, token: token || null });
      const next = encodeURIComponent(`/planner/import${window.location.search}`);
      navigate(`/signup?mode=login&next=${next}`, { replace: true });
      return undefined;
    }

    startedRef.current = true;
    let alive = true;
    (async () => {
      try {
        const newTripId = postId ? await importFromPost(postId) : await importFromToken(token);
        if (!alive) return;
        if (!newTripId) {
          setError('가져오기에 실패했습니다. 링크가 만료됐거나 글이 내려갔을 수 있습니다.');
          setBusy(false);
          return;
        }
        navigate(`/planner/t/${newTripId}`, { replace: true });
      } catch (e) {
        if (!alive) return;
        setError(e?.message || '가져오기에 실패했습니다.');
        setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authLoading, user, hasTarget, postId, token, navigate]);

  if (busy) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <Loader2 size={22} className="mx-auto mb-3 animate-spin text-muted" aria-hidden="true" />
        <p className="text-sm text-muted">일정을 내 플래너로 옮기는 중입니다.</p>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <TriangleAlert size={22} className="mx-auto mb-3 text-warning" aria-hidden="true" />
      <h1 className="mb-2 text-lg">가져오지 못했습니다</h1>
      <p className="mb-5 text-sm text-muted">{error}</p>
      <div className="flex justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate('/planner')}>
          내 여행 목록
        </Button>
        <Button variant="primary" onClick={() => navigate(-1)}>
          이전 화면
        </Button>
      </div>
    </Card>
  );
}
