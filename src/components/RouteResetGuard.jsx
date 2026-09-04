import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// 모든 경로 변경 시 스크롤을 맨 위로 올리고,
// 동일 경로 재진입(같은 path, 다른 key)도 감지해 일관된 네비 UX 제공.
//
// 예외 = 아래 화이트리스트 경로에 뒤로가기(POP)로 돌아온 경우. 기존 게시판은 글을 모달로 열어
// 이 문제가 없었지만 /itinerary/:postId 는 코드베이스 첫 글 단위 라우트라, 목록에서 한참 내려가
// 글을 열고 뒤로 오면 맨 위로 튕긴다. 화이트리스트 밖 경로는 분기 조건이 항상 false 라 동작 불변.
const RESTORE_PATHS = ['/itinerary'];

// location.key -> scrollY. 세션 메모리에만 두고(새로고침하면 사라진다) 오래된 것부터 버린다.
const MAX_ENTRIES = 50;
const positions = new Map();

// 저장 주기. scroll 이벤트마다 Map 을 건드리지 않도록 스로틀한다.
const SAVE_THROTTLE_MS = 150;

// 복원 재시도 시점(ms). 목록 데이터가 아직 안 붙어 문서가 짧으면 한 번에 그 위치까지 못 내려간다.
// 실제 복원은 데이터 로드를 아는 목록 컴포넌트가 useScrollRestore 로 마무리한다 — 여기 재시도는
// 그 훅을 쓰지 않는 화면을 위한 최선 노력이다.
const RESTORE_ATTEMPT_DELAYS = [0, 80, 200, 420];

function isRestorePath(pathname) {
  return RESTORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function setPosition(key, y) {
  if (!key) return;
  positions.delete(key); // 다시 넣어 삽입 순서를 최근 사용 순으로 유지
  positions.set(key, y);
  while (positions.size > MAX_ENTRIES) {
    const oldest = positions.keys().next().value;
    positions.delete(oldest);
  }
}

function getPosition(key) {
  const y = positions.get(key);
  return typeof y === 'number' && y > 0 ? y : null;
}

export default function RouteResetGuard() {
  const location = useLocation();
  const navigationType = useNavigationType();

  // 위치 저장. 값을 읽는 시점이 scroll 이벤트라는 점이 핵심이다.
  // effect cleanup 에서 window.scrollY 를 읽으면 이미 다음 라우트의 DOM 이 커밋된 뒤라 0 이 저장된다.
  useEffect(() => {
    if (!isRestorePath(location.pathname)) return;
    const key = location.key;
    let pending = null;
    let lastWrite = 0;
    let timer = null;

    const flush = () => {
      timer = null;
      if (pending !== null) {
        setPosition(key, pending);
        lastWrite = Date.now();
      }
    };
    const onScroll = () => {
      pending = window.scrollY; // 값은 반드시 여기서 읽는다
      const now = Date.now();
      if (now - lastWrite >= SAVE_THROTTLE_MS) {
        setPosition(key, pending);
        lastWrite = now;
        return;
      }
      if (timer === null) timer = setTimeout(flush, SAVE_THROTTLE_MS);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer !== null) clearTimeout(timer);
      // 스로틀에 걸려 아직 못 쓴 마지막 값만 기록한다(여기서 scrollY 를 다시 읽지 않는다).
      if (pending !== null) setPosition(key, pending);
    };
  }, [location.key, location.pathname]);

  // 스크롤 리셋 또는 복원.
  useEffect(() => {
    const restorable = navigationType === 'POP' && isRestorePath(location.pathname);
    const y = restorable ? getPosition(location.key) : null;

    if (y === null) {
      // 기존 동작 그대로 — 화이트리스트 밖 라우트는 항상 이 경로로만 온다.
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      } catch {
        window.scrollTo(0, 0);
      }
      return;
    }

    const timers = [];
    const rafs = [];
    RESTORE_ATTEMPT_DELAYS.forEach((delay) => {
      timers.push(setTimeout(() => {
        rafs.push(requestAnimationFrame(() => { window.scrollTo(0, y); }));
      }, delay));
    });
    return () => {
      timers.forEach(clearTimeout);
      rafs.forEach(cancelAnimationFrame);
    };
  }, [location.key, location.pathname, navigationType]);

  return null;
}

// 목록 화면이 데이터 로드를 마친 뒤 호출한다(ready=true). 뒤로가기(POP)로 돌아온 경우에만,
// 저장해 둔 위치로 한 프레임 뒤에 되돌린다. 그 외에는 아무 일도 하지 않는다.
//   const { posts, loading } = ...;
//   useScrollRestore(!loading && posts.length > 0);
// eslint-disable-next-line react-refresh/only-export-components
export function useScrollRestore(ready) {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (!ready) return;
    if (navigationType !== 'POP') return;
    if (!isRestorePath(location.pathname)) return;
    const y = getPosition(location.key);
    if (y === null) return;
    const raf = requestAnimationFrame(() => { window.scrollTo(0, y); });
    return () => cancelAnimationFrame(raf);
  }, [ready, navigationType, location.key, location.pathname]);
}
