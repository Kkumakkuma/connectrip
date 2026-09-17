# 안드로이드 앱 빌드 전용 (vite build --mode app 일 때만 로드).
# 앱 WebView 오리진(https://localhost)에서는 상대경로 fetch 가 실패하므로 API 절대경로가 필수.
# 시크릿 아님(공개 URL) — 커밋 가능. 웹 빌드는 이 파일을 읽지 않는다.
VITE_API_BASE=https://www.connecttrip.co.kr

# 2026-09-04 변경 — 쿠마님 지적: "플래너에서 사이트를 따로 띄울 거면 그게 의미가 있냐.
#   커넥트립 앱에서 다 지원을 하던가 해야지."
#   맞는 말이다. 앱에서 메뉴를 누르면 외부 브라우저가 뜨는 건 쓰다 만 것과 같다.
#   앱 번들에 플래너를 싣고 앱 안에서 그대로 쓰게 한다.
#   지도(leaflet)·PDF(pdfjs)·바코드(zxing)는 전부 필요할 때만 불러오는 조각이라
#   앱 첫 화면 무게에는 영향이 없다.
VITE_PLANNER_ENABLED=true

# 커넥트립 안의 "여행 일정" 게시판. 글이 0건이라 웹과 마찬가지로 꺼 둔다.
VITE_ITINERARY_ENABLED=true

# --- PASS 본인확인 ---
# 여기에 VITE_PORTONE_* 를 다시 쓰지 말 것. Vite 는 .env 다음에 .env.app 을 읽어 뒤가 이기므로,
# 빈 값으로 적어 두면 앱 번들의 IDENTITY_ENABLED 가 false 가 되어 PASS 버튼이 잠긴다(앱 가입 불가).
# 값은 .env 에서 그대로 상속된다 — 실키로 교체할 때도 .env 한 곳만 고친다.

# 2026-09-17: 앱 빌드는 로컬에서 도는데 이 키들이 Vercel 환경변수에만 있어서 빈 값으로 구워졌다.
# 그 결과 앱 플래너 지도가 항상 "지도를 불러올 수 없습니다"로 떨어졌다(웹은 정상).
# ⚠ 구글 콘솔에서 이 브라우저 키의 리퍼러 허용 목록에 https://localhost/* 를 넣어야 앱에서 뜬다.
VITE_GOOGLE_MAPS_BROWSER_KEY=AIzaSyBWEj7OwOm-sA5okNYl91oWrikphAf-KKg
VITE_GOOGLE_MAPS_MAP_ID=5e4eb32505aebf125162770d
