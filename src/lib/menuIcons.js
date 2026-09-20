// 메뉴·게시판 탭 공용 컬러 아이콘 표 (2026-09-20, 쿠마님 지시 "이쁜 이모티콘 새로 찾아서 칼라로 넣고 통일").
//
// 네비 드롭다운은 이모지(컬러), 게시판 탭은 lucide 라인(흑백)이라 같은 메뉴가 서로 다르게 보였다.
// Microsoft Fluent Emoji(Flat, MIT) SVG 를 public/icons/menu/ 에 두고 양쪽(Navbar·BoardTabs·Admin)이 이 표를 읽는다.
// 텍스트 이모지는 OS(Windows/iOS/안드로이드)마다 다르게 그려져 통일이 안 된다.
// 로컬 파일이라 앱(Capacitor) 번들에도 그대로 들어간다(외부 URL 이면 앱에서 깨진다 — reference_capacitor_app_build).
// (컴포넌트 파일과 분리한 이유: react-refresh 규칙 — 컴포넌트 파일은 컴포넌트만 export.)
export const MENU_ICONS = {
  review: '/icons/menu/review.svg',       // 📝 여행 후기
  qna: '/icons/menu/qna.svg',             // ❓ Q&A
  free: '/icons/menu/free.svg',           // ✨ 자유게시판 (Fluent 말풍선 💬 은 회색 외곽선뿐이라 흰 배경에서 안 보여 반짝임으로)
  sell: '/icons/menu/sell.svg',           // 🛍️ 물품팔아요
  buy: '/icons/menu/buy.svg',             // 🔍 물품구해요
  share: '/icons/menu/share.svg',         // 🎁 무료 나눔
  groupbuy: '/icons/menu/groupbuy.svg',   // 👥 공동구매
  planner: '/icons/menu/planner.svg',     // 🗺️ 내 여행
  itinerary: '/icons/menu/itinerary.svg', // 📋 여행 일정 게시판
  promo: '/icons/menu/promo.svg',         // 📢 홍보 게시판
  layover: '/icons/menu/layover.svg',     // ✈️ 레이오버 정보
  airlines: '/icons/menu/layover.svg',    // ✈️ 관리자 · 항공사 요청 (같은 비행기)
  deals: '/icons/menu/deals.svg',         // 🏷️ 할인 혜택
  reports: '/icons/menu/reports.svg',     // 🚨 신고 관리
  commend: '/icons/menu/commend.svg',     // ✅ 칭찬 인증
  users: '/icons/menu/users.svg',         // 👥 회원 관리
  stats: '/icons/menu/stats.svg',         // 📊 통계
};
