import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2Off, Loader2 } from 'lucide-react';
import SEOHead from '../../components/SEOHead';
import Button from '../kit/Button';
import Card from '../kit/Card';
import { getShared } from '../api';
import SnapshotView from './SnapshotView';

// /planner/s/:token — 공유 링크로 여는 읽기 전용 보기. 비로그인도 열 수 있다.
//
// robots 는 반드시 noindex, nofollow — 토큰 주소가 색인되면 비공개 일정이 검색에 노출된다.
// 서버(planner_get_shared)가 티켓과 비공개 메모를 아예 빼고 주므로 화면에서 가릴 것은 없다.
// 토큰이 틀렸든 폐기됐든 만료됐든 호출은 예외 없이 null 을 돌려준다(응답 균질화). 그래서
// 화면도 사유를 나누지 않고 한 가지 안내만 보여 준다.

const TOKEN_RE = /^[0-9a-f]{64}$/;

export default function SharedView() {
  const { token } = useParams();
  // 토큰 형식은 주소만 봐도 안다. effect 안에서 setState 로 알리면 렌더가 한 번 더 돈다.
  const validToken = TOKEN_RE.test(String(token || ''));
  const [snapshot, setSnapshot] = useState(null);
  const [state, setState] = useState(validToken ? 'loading' : 'gone'); // loading | ok | gone

  useEffect(() => {
    if (!validToken) return undefined;
    let alive = true;
    (async () => {
      try {
        const data = await getShared(token);
        if (!alive) return;
        if (!data) {
          setState('gone');
          return;
        }
        setSnapshot(data);
        setState('ok');
      } catch {
        if (alive) setState('gone');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, validToken]);

  const head = (
    <SEOHead
      title="공유받은 여행 일정 - ConnectTrip"
      description="공유 링크로 받은 여행 일정입니다."
      robots="noindex, nofollow"
    />
  );

  if (state === 'loading') {
    return (
      <>
        {head}
        <Card className="mx-auto max-w-md p-8 text-center">
          <Loader2 size={22} className="mx-auto mb-3 animate-spin text-muted" aria-hidden="true" />
          <p className="text-sm text-muted">일정을 불러오는 중입니다.</p>
        </Card>
      </>
    );
  }

  if (state === 'gone') {
    return (
      <>
        {head}
        <Card className="mx-auto max-w-md p-6 text-center">
          <Link2Off size={22} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <h1 className="mb-2 text-lg">열 수 없는 링크입니다</h1>
          <p className="mb-5 text-sm text-muted">
            링크가 만료됐거나 공유가 해제됐습니다. 보내 준 사람에게 링크를 다시 받아 주세요.
          </p>
          <Link to="/planner">
            <Button variant="secondary">내 여행 목록</Button>
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      {head}
      <SnapshotView
        snapshot={snapshot}
        headerExtra={
          <div className="mt-4">
            <Link to={`/planner/import?token=${encodeURIComponent(token)}`}>
              <Button variant="primary">내 플래너로 가져오기</Button>
            </Link>
            <p className="mt-2 text-xs text-muted">
              가져오면 내 계정에 사본이 생깁니다. 원본이 바뀌어도 사본은 그대로입니다.
            </p>
          </div>
        }
      />
    </>
  );
}
