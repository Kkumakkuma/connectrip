import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { itineraryApi } from './db';
import { isNativeApp } from './native';
import { PLANNER_ENABLED } from './featureFlags';

// "가져오기" 공통 동작. 목록 카드와 글 상세가 같은 흐름을 쓴다.
//
// 앱(Capacitor WebView)은 플래너 화면을 싣지 않는다. 그렇다고 브라우저를 먼저 열어서
// 가져오기를 시키면, WebView origin(https://localhost)과 브라우저 origin(www.connecttrip.co.kr)이
// 달라 로그인 세션이 이어지지 않아 사용자가 다시 로그인해야 한다. 그래서 순서를 뒤집는다 —
// 가져오기는 앱에서 RPC 로 끝내고(= 서버에 이미 반영, 유실 0건) 링크만 안내한다.
const SITE_ORIGIN = 'https://www.connecttrip.co.kr';

// planner_import 가 올리는 예외 메시지를 사용자 문구로 옮긴다.
// 서버 문구를 그대로 보여주지 않는다(영문 + 내부 용어).
function importErrorText(message) {
  const m = String(message || '');
  if (m.includes('auth required')) return '로그인 후 가져올 수 있습니다.';
  if (m.includes('not found')) return '글을 찾을 수 없습니다. 삭제된 글일 수 있습니다.';
  if (m.includes('too many trips')) return '저장된 여행이 100개라 더 가져올 수 없습니다. 플래너에서 정리한 뒤 다시 시도해 주세요.';
  if (m.includes('too many places') || m.includes('too many days')) return '일정이 너무 커서 가져오지 못했습니다.';
  if (m.includes('unsupported snapshot')) return '이 일정은 지금 버전에서 가져올 수 없습니다.';
  return '가져오기에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export function useItineraryImport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [importingId, setImportingId] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  // { kind: 'saved' | 'error', text, url? }
  const [notice, setNotice] = useState(null);

  const clearNotice = useCallback(() => setNotice(null), []);

  const runImport = useCallback(
    async (postId) => {
      if (!user) {
        setShowLogin(true);
        return;
      }
      if (!postId || importingId) return;
      setNotice(null);
      setImportingId(postId);
      try {
        const tripId = await itineraryApi.importPost(postId);
        // 플래너 라우트가 이 빌드에 없으면(앱 빌드, 또는 웹 플래그 off) 이동시키지 않는다 —
        // 이동해 봐야 NotFound 다. 저장은 끝났으므로 주소만 안내한다.
        if (isNativeApp() || !PLANNER_ENABLED) {
          setNotice({
            kind: 'saved',
            text: '내 플래너에 저장했습니다.',
            url: `${SITE_ORIGIN}/planner/t/${tripId}`,
          });
        } else {
          navigate(`/planner/t/${tripId}`);
        }
      } catch (err) {
        console.error('일정 가져오기 실패:', err);
        setNotice({ kind: 'error', text: importErrorText(err?.message) });
      } finally {
        setImportingId(null);
      }
    },
    [user, importingId, navigate]
  );

  return { runImport, importingId, notice, clearNotice, showLogin, setShowLogin };
}

export default useItineraryImport;
