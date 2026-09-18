// 내 위치 한 번 읽기. 지도를 열 때 중심을 잡고, "내 위치" 버튼이 다시 부른다.
//
// 왜 플러그인을 안 쓰나 (2026-09-17, 쿠마님 9955):
// Capacitor 브리지(BridgeWebChromeClient.onGeolocationPermissionsShowPrompt)가 WebView 의
// navigator.geolocation 요청을 받아 안드로이드 런타임 권한까지 직접 띄운다. 그래서 웹 표준 API
// 하나로 웹·앱이 같이 돈다. 대신 AndroidManifest 에 ACCESS_COARSE/FINE_LOCATION 선언이 반드시
// 있어야 한다 — 선언이 없으면 안드로이드가 요청 자체를 즉시 거부한다.
//
// 권한을 거부당하거나 못 잡아도 화면이 멈추면 안 된다. 실패는 coords: null 로 돌려주고,
// 부르는 쪽이 다음 후보(여행 목적지 → 기본값)로 넘어간다.
//
// 2026-09-18 고침 (쿠마님: "제대로 작동 안 한다") — 에뮬레이터 실측 세 가지:
//   · 첫 실행에서 권한 창이 떠 있는 동안에도 우리 쪽 8.5초 타이머가 돌아, 사용자가 창을 읽고 "허용"을
//     누르기 전에 이미 null 로 끝났다. 권한이 이미 허용된 걸 확인한 때(Permissions API 'granted')만
//     짧게(8초) 기다리고, 아직 안 물어봤거나 모르면 길게(60초) 기다린다. 거부·위치 꺼짐은 어차피 실패
//     콜백이 바로 오므로 길게 잡아도 화면이 기다리는 일은 없다. 앱 WebView 는 Permissions API 를 늘
//     'prompt' 로 준다(브리지가 결정을 보존하지 않는다) — 그래서 그 값으로 요청을 막지는 않는다.
//   · enableHighAccuracy:false(네트워크 위치만)는 15초를 줘도 영영 못 받고, true(GPS 포함 fused)는
//     3.6초에 받았다. 한 번 읽는 거라 배터리 부담은 없다.
//   · 실패 이유(denied/timeout/unavailable/unsupported)를 결과와 함께 돌려줘 버튼 안내 문구를 맞춘다.
//     (전역 lastError 로 두면 동시 요청이 서로 덮어쓴다 — codex 지적.)

const CACHE_MS = 5 * 60 * 1000; // 같은 화면에서 여러 번 부를 때 매번 GPS 를 깨우지 않는다
const QUICK_TIMEOUT_MS = 8000; // 권한 허용이 확인된 상태
const PROMPT_TIMEOUT_MS = 60000; // 권한 창이 떠 있을 수 있는 상태 — 사용자가 읽고 누를 시간까지
const GRACE_MS = 1000; // navigator 쪽 timeout 이 안 먹는 기기 대비, 우리 쪽에서 최종으로 끊는 여유

let cached = null; // { at, coords }
let inflight = null;
let lastGen = 0; // 요청 세대. 늦게 끝난 옛 요청이 새 요청의 위치를 캐시에서 지우지 않게(codex 지적)

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 브라우저·기기가 위치를 지원하는가(권한 여부는 알 수 없다). */
export const canLocate = () => typeof navigator !== 'undefined' && !!navigator.geolocation;

// 권한 상태. 모르면 'unknown'. 이 값은 대기 시간을 고르는 데만 쓰고 요청을 막는 데는 쓰지 않는다.
async function permissionState() {
  try {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms || typeof perms.query !== 'function') return 'unknown';
    const status = await perms.query({ name: 'geolocation' });
    return status?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function errorKind(err) {
  // GeolocationPositionError: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  if (err?.code === 1) return 'denied';
  if (err?.code === 3) return 'timeout';
  return 'unavailable';
}

/**
 * 현재 위치를 { coords: { lat, lng } | null, error } 로 돌려준다.
 * error 는 실패했을 때만 'denied' | 'timeout' | 'unavailable' | 'unsupported', 성공이면 null.
 * @param {{ timeoutMs?: number, maxAgeMs?: number, force?: boolean }} opts
 *   force — 캐시·진행 중 요청을 무시하고 새로 잰다("내 위치" 버튼). 이때는 브라우저 캐시도 안 쓴다.
 */
export function getMyLocation({ timeoutMs, maxAgeMs = CACHE_MS, force = false } = {}) {
  if (!canLocate()) return Promise.resolve({ coords: null, error: 'unsupported' });

  if (!force && cached && Date.now() - cached.at < maxAgeMs) {
    return Promise.resolve({ coords: cached.coords, error: null });
  }
  if (!force && inflight) return inflight;

  const gen = ++lastGen;
  const run = (async () => {
    const state = await permissionState();
    const timeout = isFiniteNum(timeoutMs)
      ? timeoutMs
      : state === 'granted'
        ? QUICK_TIMEOUT_MS
        : PROMPT_TIMEOUT_MS;

    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = (coords, error) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        // 이 요청 뒤에 시작한 요청이 있으면(버튼으로 다시 잰 경우) 이 결과로 캐시를 덮어쓰지 않는다.
        if (coords && gen === lastGen) cached = { at: Date.now(), coords };
        resolve({ coords, error: coords ? null : error || 'unavailable' });
      };

      timer = setTimeout(() => finish(null, 'timeout'), timeout + GRACE_MS);

      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos?.coords?.latitude;
            const lng = pos?.coords?.longitude;
            if (isFiniteNum(lat) && isFiniteNum(lng)) finish({ lat, lng }, null);
            else finish(null, 'unavailable');
          },
          (err) => finish(null, errorKind(err)), // 거부·실패 모두 조용히 넘어간다
          { enableHighAccuracy: true, timeout, maximumAge: force ? 0 : maxAgeMs }
        );
      } catch {
        finish(null, 'unavailable');
      }
    });
  })();

  if (!force) inflight = run;
  run.then(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/** 로그아웃·계정 전환처럼 남은 값을 지워야 할 때. */
export function clearMyLocationCache() {
  cached = null;
}
