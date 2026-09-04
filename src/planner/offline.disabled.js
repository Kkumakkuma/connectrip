// '@planner-offline' alias 가 플래너를 끈 빌드에서 가리키는 스텁.
//
// AuthContext 는 세션이 생기거나 끊길 때 기기에 남은 플래너 사본을 정리해야 하는데,
// 그 모듈을 경로로 직접 import 하면 플래너를 끈 앱 빌드에도 청크가 생긴다(2026-09-04 실측:
// dist/assets/planner-*.js 가 앱 번들에 남았다). alias 로 갈라서 앱에서는 아무 일도 안 하게 한다.
export async function sweep() {}
export async function purgeAll() {}
export async function purgeTrip() {}
export async function purgeTicket() {}
