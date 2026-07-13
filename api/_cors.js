// 공유 모듈: 안드로이드 앱(Capacitor WebView)의 교차 출처 API 호출 허용.
// 앱의 WebView 오리진은 https://localhost 라 www.connecttrip.co.kr 호출 시
// 브라우저가 프리플라이트(OPTIONS)를 먼저 보낸다 — 여기서 처리하지 않으면 앱에서 모든 API가 실패.
// 웹(동일 출처)은 Origin 이 화이트리스트 밖이면 CORS 헤더를 안 붙일 뿐 기존 응답 그대로(회귀 없음).
// '*' 전면 허용은 하지 않는다(우리 앱 오리진만).

const ALLOWED_ORIGINS = new Set([
  'https://localhost', // Capacitor Android 기본 오리진
  'capacitor://localhost', // Capacitor iOS 기본 오리진(향후 대비)
]);

// true 를 반환하면 OPTIONS 프리플라이트를 여기서 종결한 것 — 핸들러는 즉시 return.
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Authorization: 향후 세션 토큰 쓰는 API 대비(가전딜 verify-business 동일 패턴)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
