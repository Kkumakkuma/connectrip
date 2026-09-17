// 내 위치 한 번 읽기. 지도를 열 때 중심을 잡고, "내 위치" 버튼이 다시 부른다.
//
// 왜 플러그인을 안 쓰나 (2026-09-17, 쿠마님 9955):
// Capacitor 브리지(BridgeWebChromeClient.onGeolocationPermissionsShowPrompt)가 WebView 의
// navigator.geolocation 요청을 받아 안드로이드 런타임 권한까지 직접 띄운다. 그래서 웹 표준 API
// 하나로 웹·앱이 같이 돈다. 대신 AndroidManifest 에 ACCESS_COARSE/FINE_LOCATION 선언이 반드시
// 있어야 한다 — 선언이 없으면 안드로이드가 요청 자체를 즉시 거부한다.
//
// 권한을 거부당하거나 못 잡아도 화면이 멈추면 안 된다. 실패는 전부 null 로 돌려주고,
// 부르는 쪽이 다음 후보(여행 목적지 → 기본값)로 넘어간다.

const CACHE_MS = 5 * 60 * 1000; // 같은 화면에서 여러 번 부를 때 매번 GPS 를 깨우지 않는다
let cached = null; // { at, coords }
let inflight = null;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 브라우저·기기가 위치를 지원하는가(권한 여부는 알 수 없다). */
export const canLocate = () => typeof navigator !== 'undefined' && !!navigator.geolocation;

/**
 * 현재 위치를 { lat, lng } 로 돌려준다. 권한 거부·시간초과·미지원이면 null.
 * @param {{ timeoutMs?: number, maxAgeMs?: number, force?: boolean }} opts
 */
export function getMyLocation({ timeoutMs = 8000, maxAgeMs = CACHE_MS, force = false } = {}) {
  if (!canLocate()) return Promise.resolve(null);

  if (!force && cached && Date.now() - cached.at < maxAgeMs) {
    return Promise.resolve(cached.coords);
  }
  if (!force && inflight) return inflight;

  inflight = new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      inflight = null;
      if (value) cached = { at: Date.now(), coords: value };
      resolve(value);
    };

    // navigator 쪽 timeout 이 안 먹는 기기가 있어 우리 쪽에서도 끊는다
    const timer = setTimeout(() => finish(null), timeoutMs + 500);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          finish(isFiniteNum(lat) && isFiniteNum(lng) ? { lat, lng } : null);
        },
        () => {
          clearTimeout(timer);
          finish(null); // 거부·실패 모두 조용히 넘어간다
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maxAgeMs }
      );
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });

  return inflight;
}

/** 로그아웃·계정 전환처럼 남은 값을 지워야 할 때. */
export function clearMyLocationCache() {
  cached = null;
}
