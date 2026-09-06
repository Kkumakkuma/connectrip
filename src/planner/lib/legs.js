// 저장된 이동시간(legs) 정규화 — 서버 스냅샷은 `day.legs = items 배열`, 로컬 스냅샷·보드는 `{v, mode, fp, items}` 봉투를 쓴다
// (codex 9/6: 공유 응답의 배열형이 SnapshotView 에서 통째로 사라지던 문제). 순수 함수(vitest).

export const LEGS_VERSION = 2;   // 2 = 대중교통 구간에 steps(노선·정류장 요약) 포함(2026-09-06)

/** 배열형·봉투형 모두 items 배열로. 아니면 빈 배열. */
export function legItems(legs) {
  if (Array.isArray(legs)) return legs;
  if (legs && typeof legs === 'object' && Array.isArray(legs.items)) return legs.items;
  return [];
}

/** items 가 핀 수와 맞고 0→1, 1→2 … 순서로 이어져 있는가. */
export function legsValid(items, n) {
  return (
    Array.isArray(items) &&
    items.length === n &&
    items.every((it, i) => Number(it?.from) === i && Number(it?.to) === i + 1)
  );
}

/**
 * 스냅샷·공유 화면용: { items, stale }. 개수·연속성이 안 맞으면 stale(잘못 이어진 경로를 보여 주지 않는다).
 * 핀이 1개 이하면 구간이 없으니 stale 아님.
 */
export function normalizeLegs(legs, placeCount) {
  const items = legItems(legs);
  const n = Math.max(0, (Number(placeCount) || 0) - 1);
  if (items.length === 0) return { items: [], stale: false };
  return legsValid(items, n) ? { items, stale: false } : { items, stale: true };
}

/** 저장된 legs 가 최신 형식인가. v2 미만인데 구글이 준 대중교통 구간이 있으면 한 번 다시 계산할 대상(추정·도보만이면 그대로). */
export function legsCurrent(legs) {
  if (!legs || typeof legs !== 'object' || Array.isArray(legs)) return false;
  if (Number(legs.v) >= LEGS_VERSION) return true;
  const items = legItems(legs);
  return !items.some((it) => it?.mode === 'TRANSIT' && it?.source && it.source !== 'estimate');
}

/** 구간 출처에 구글이 있는가(지도 없는 화면의 출처 표시용). */
export function legsUseGoogle(legs) {
  return legItems(legs).some((it) => it?.source === 'google' || it?.source === 'cache');
}
