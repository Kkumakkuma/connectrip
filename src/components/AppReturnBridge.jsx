import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp } from '../lib/native';
import { appReturnTarget, isAppReturnPath, notifyAppReturn } from '../lib/appReturn';
import { IDENTITY_FLOW, loadPendingIdentity } from '../lib/identity';

// 앱 복귀 딥링크 처리(네이티브 전용, 화면 없음, 2026-09-27 PASS 복귀 수정).
// · 사이트 다리 페이지(public/app-return.html)의 '앱으로 돌아가기' → connecttrip://app-return<경로>?<쿼리> 로 앱이 열리면
//   그 경로로 보낸다. 지금 그 화면이면 다시 띄우지 않고 'ct-app-return' 이벤트로 알린다(화면들의 복귀 처리는 처음 한 번만 돈다).
//   그 화면이 아직 뜨기 전일 수 있어 알림을 잠깐 맡겨 두고, 화면이 뜨면 꺼내 간다(appReturn.js notifyAppReturn, 2026-10-02).
// · 콜드 스타트(PASS·크롬에 가 있는 동안 앱 프로세스가 종료)로 첫 화면이 떴는데 10분 안에 시작한 본인확인이 남아 있으면
//   그 화면으로 돌려보낸다(resume=1 — 우리 저장소의 id·ds 만 쓴다. 결과(ds)를 아직 받지 못했으면 화면이 '인증 결과 가져오기'를
//   안내한다). 딥링크로 켜진 경우는 그 주소가 우선이다(9/27 교차검토 결정 — 2026-10-02 C6 의 이 부분은 반려, 테스트가 고정).
// · 2026-10-02 프로세스 종료 뒤 재시작(에뮬레이터 QA 2/2 재현): 태스크가 남은 채 프로세스만 종료된 앱(메모리 부족 종료와 같음)을
//   다리 딥링크가 다시 켜면, 딥링크는 원래 런치 인텐트가 아니라 새 인텐트(onNewIntent)로 온다 → getLaunchUrl 은 비고 딥링크는
//   appUrlOpen 으로만 온다. 예전에는 getLaunchUrl 을 먼저 물어 resume 이 먼저 그 화면으로 옮겼고, 뒤이어 온 같은 경로 딥링크
//   알림은 아직 뜨지 않은 화면이 듣지 못해 사라졌다. 그래서 appUrlOpen 리스너를 먼저 붙인다 — Capacitor 는 듣는 쪽이 없을 때 온
//   appUrlOpen 을 붙잡아 뒀다가 첫 리스너가 붙는 호출을 처리하며 건네고(AppPlugin retainUntilConsumed), 플러그인 호출은 한 줄로
//   차례대로 처리돼 답도 그 순서로 온다(Bridge.callPluginMethod → taskHandler). 그래서 딥링크가 getLaunchUrl 의 답보다 먼저
//   처리되고, 딥링크가 한 번이라도 왔으면 resume 하지 않는다(그 딥링크가 허용 밖이어도 — 9/27 '딥링크가 답' 과 같은 원칙).
//   이 순서가 어긋나도 위 보관함이 뒤늦게 뜬 화면에 복귀를 넘긴다.
const SEEN_KEY = 'ctAppReturnSeen';   // 처리한 딥링크 주소(정규화) → 처리 시각(세션 저장소)
const BOOT_KEY = 'ctAppBooted';
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const REPEAT_GAP_MS = 5000;

// 첫 주소 확인·콜드 스타트 복구는 이 페이지(WebView 세션)에서 한 번만 — StrictMode 이중 마운트나
// 화면 이동으로 효과가 다시 돌아도 첫 화면으로 되돌리지 않는다(교차검토 지적).
let launchChecked = false;
// 이 페이지(WebView 세션)에 딥링크(appUrlOpen)가 왔는지 — 왔으면 콜드 스타트 복구(resume)를 하지 않는다(2026-10-02)
let linkOpened = false;

// 처리 기록 키 — 주소의 ds=<값> 을 ds=1 로 바꾼다(2026-10-02, codex #9·flows8). 조회와 저장 모두 이 키 하나로 한다.
// ① 결속 비밀값을 WebView 세션 저장소에 남기지 않고 ② ds 만 다른 같은 복귀가 5초 안에 겹쳐 와도 한 번으로 친다.
const seenKey = (url) => String(url).replace(/([?&])ds=[^&#]*/g, '$1ds=1');

function seenMap() {
  try {
    const m = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}
function markSeen(key) {
  try {
    const recent = Object.entries({ ...seenMap(), [key]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 20);
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
      const key = seenKey(url);
      const at = seenMap()[key];
      if (at && (launch || Date.now() - at < REPEAT_GAP_MS)) return false;
      const target = appReturnTarget(url);
      if (!target) return false;
      markSeen(key);
      const [path, query = ''] = target.split('?');
      const search = query ? `?${query}` : '';
      if (window.location.pathname === path) {
        notifyAppReturn(path, search);   // 'ct-app-return' + 화면이 아직 뜨기 전이면 뜰 때 꺼내 가도록 맡겨 둔다
      } else {
        navigate(`${path}${search}`, { replace: true });
      }
      return true;
    };

    // 이번 WebView 세션의 첫 화면(콜드 스타트)이고 앱 아이콘 등으로 켜졌을 때만 — 새로 고침·화면 이동에는 끼어들지 않는다.
    // 딥링크로 켜졌으면(getLaunchUrl 이 비어도 appUrlOpen 이 먼저 왔으면) 하지 않는다(2026-10-02, 위 설명).
    const resumePending = (firstBoot) => {
      if (!firstBoot || linkOpened || window.location.pathname !== '/') return;
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
        // 리스너를 getLaunchUrl 보다 먼저 붙인다 — 네이티브가 붙잡고 있던 딥링크(프로세스 종료 뒤 재시작)가 getLaunchUrl 의
        // 답보다 먼저 처리되게(2026-10-02, 위 설명). 두 호출의 순서를 바꾸지 말 것(AppReturnBridge.test.jsx 가 고정).
        const listening = App.addListener('appUrlOpen', ({ url }) => {
          if (url) linkOpened = true;
          go(url);
        });
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
        return listening;
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
