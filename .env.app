# 안드로이드 앱 빌드 전용 (vite build --mode app 일 때만 로드).
# 앱 WebView 오리진(https://localhost)에서는 상대경로 fetch 가 실패하므로 API 절대경로가 필수.
# 시크릿 아님(공개 URL) — 커밋 가능. 웹 빌드는 이 파일을 읽지 않는다.
VITE_API_BASE=https://www.connecttrip.co.kr

# 플래너는 웹 전용이다. 앱에는 "여행 일정" 게시판과 가져오기만 들어간다.
# .env 에 true 가 있어도 .env.app 이 나중에 읽혀 이기므로, app:sync 가 플래너 포함 APK 를 만들 수 없다.
VITE_PLANNER_ENABLED=false
