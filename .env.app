# 안드로이드 앱 빌드 전용 (vite build --mode app 일 때만 로드).
# 앱 WebView 오리진(https://localhost)에서는 상대경로 fetch 가 실패하므로 API 절대경로가 필수.
# 시크릿 아님(공개 URL) — 커밋 가능. 웹 빌드는 이 파일을 읽지 않는다.
VITE_API_BASE=https://www.connecttrip.co.kr
