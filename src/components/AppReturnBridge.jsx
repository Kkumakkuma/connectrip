import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp } from '../lib/native';
import { appReturnTarget, isAppReturnPath } from '../lib/appReturn';
import { IDENTITY_FLOW, loadPendingIdentity } from '../lib/identity';

// 앱 복귀 딥링크 처리(네이티브 전용, 화면 없음, 2026-09-27 PASS 복귀 수정).
// · 사이트 다리 페이지(public/app-return.html)의 '앱으로 돌아가기' → connecttrip://app-return<경로>?<쿼리> 로 앱이 열리면
//   그 경로로 보낸다. 지금 그 화면이면 다시 띄우지 않고 'ct-app-return' 이벤트로 알린다(화면들의 복귀 처리는 처음 한 번만 돈다).
// · 콜드 스타트(PASS·크롬에 가 있는 동안 앱 프로세스가 종료)로 첫 화면이 떴는데 10분 안에 시작한 본인확인이 남아 있으면
//   그 화면으로 돌려보내 결과를 확인한다(resume=1 — 우리 저장소의 id 만 쓴다). 딥링크로 켜진 경우는 그 주소가 우선이다.
const SEEN_KEY = 'ctAppReturnSeen';   // 처리한 딥링크 주소 → 처리 시각(세션 저장소)
const BOOT_KEY = 'ctAppBooted';
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const REPEAT_GAP_MS = 5000;

// 첫 주소 확인·콜드 스타트 복구는 이 페이지(WebView 세션)에서 한 번만 — StrictMode 이중 마운트나
// 화면 이동으로 효과가 다시 돌아도 첫 화면으로 되돌리지 않는다(교차검토 지적).
let launchChecked = false;

function seenMap() {
  try {
    const m = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}
function markSeen(url) {
  try {
    const recent = Object.entries({ ...seenMap(), [url]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 20);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* noop */ }
}

export default function AppReturnBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let cancelled = false;
    let handle = null;

    // launch: 앱을 연 첫 주소(getLaunchUrl) — 화면을 새로 고쳐도 같은 값이 다시 오므로 한 번만 처리한다.
    // 딥링크(appUrlOpen)는 사용자가 다리 페이지 단추를 다시 누른 것일 수 있어 다시 처리하되, 콜드 스타트 때
    // getLaunchUrl 과 겹쳐 같은 주소가 잇달아 오는 경우(5초 안)만 한 번으로 친다(교차검토 지적: 재클릭 무반응).
    const go = (url, { launch = false } = {}) => {
      if (!url) return false;
      const at = seenMap()[url];
      if (at && (launch || Date.now() - at < REPEAT_GAP_MS)) return false;
      const target = appReturnTarget(url);
      if (!target) return false;
      markSeen(url);
      const [path, query = ''] = target.split('?');
      const search = query ? `?${query}` : '';
      if (window.location.pathname === path) {
        window.dispatchEvent(new CustomEvent('ct-app-return', { detail: { path, search } }));
      } else {
        navigate(`${path}${search}`, { replace: true });
      }
      return true;
    };

    // 이번 WebView 세션의 첫 화면(콜드 스타트)이고 앱 아이콘 등으로 켜졌을 때만 — 새로 고침·화면 이동에는 끼어들지 않는다
    const resumePending = (firstBoot) => {
      if (!firstBoot || window.location.pathname !== '/') return;
      const p = loadPendingIdentity();
      if (!p || !p.returnPath || Date.now() - p.savedAt > RESUME_WINDOW_MS) return;
      const [path, query = ''] = p.returnPath.split('?');
      if (!isAppReturnPath(path)) return;
      const sp = new URLSearchParams(query);
      sp.set('flow', IDENTITY_FLOW);
      sp.set('resume', '1');
      navigate(`${path}?${sp.toString()}`);   // 첫 화면을 남겨 뒤로 가기로 돌아올 수 있게
    };

    import('@capacitor/app')
      .then(({ App }) => {
        if (cancelled) return null;
        if (!launchChecked) {
          launchChecked = true;
          let firstBoot = false;
          try {
            firstBoot = !sessionStorage.getItem(BOOT_KEY);
            sessionStorage.setItem(BOOT_KEY, '1');
          } catch { /* noop */ }
          App.getLaunchUrl()
            .then((r) => {
              // 딥링크로 켜졌으면 그 주소가 답이다 — appUrlOpen 으로 먼저 처리됐어도 resume 으로 덮지 않는다(교차검토 지적)
              if (r?.url) go(r.url, { launch: true });
              else resumePending(firstBoot);
            })
            .catch(() => resumePending(firstBoot));
        }
        return App.addListener('appUrlOpen', ({ url }) => { go(url); });
      })
      .then((h) => {
        if (!h) return;
        if (cancelled) Promise.resolve(h.remove()).catch(() => {});
        else handle = h;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (handle) Promise.resolve(handle.remove()).catch(() => {});
    };
  }, [navigate]);

  return null;
}
