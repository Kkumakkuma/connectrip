// 내보내기·인쇄용 스냅샷을 클라이언트에서 조립한다 (설계 §3 형식).
//
// 서버의 planner_build_snapshot 은 anon·authenticated 에서 EXECUTE 가 회수돼 있어(SQL 1110행)
// 화면에서 직접 부를 수 없다. 게시·공유처럼 서버가 스냅샷을 쓰는 경로는 각자의 RPC 안에서
// 만들어 쓰고, 내보내기는 사용자가 이미 화면에 갖고 있는 데이터로 같은 모양을 만든다.
//
// 서버본과 다른 점을 분명히 해 둔다.
//   · generated_at 을 넣지 않는다(서버본에는 있다). 같은 일정을 두 번 내보내면 파일이 같아야 한다.
//   · legs 는 planner_days.legs 를 그대로 옮긴다. 지문(fp) 검증은 화면이 맡는다.
//   · 메모는 note_public = true 인 것만 담는다. 서버 스냅샷과 같은 기준이다.

export const SNAPSHOT_VERSION = 1;

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function placeEntry(place, order, catalog) {
  // 출처(google/osm)는 핀이 아니라 카탈로그가 안다 — 핀의 source 는 search/longpress 같은 "담은 경로"라 다른 값이다.
  // 카탈로그를 못 받았으면 null: 출처 표기만 빠지고 파일은 그대로 만들어진다.
  const entry = place?.catalog_id && catalog && typeof catalog.get === 'function' ? catalog.get(place.catalog_id) : null;
  return {
    order,
    name: place?.name || '',
    address: place?.address || '',
    lat: num(place?.lat, 0),
    lng: num(place?.lng, 0),
    provider: entry?.provider || null,
    // 제공자 식별자는 로컬 스냅샷(내보내기·기기 사본)에서 쓰는 곳이 없어 싣지 않는다(형식 호환용 빈 값).
    provider_place_id: '',
    catalog_id: place?.catalog_id || null,
    planned_time: place?.planned_time ? String(place.planned_time).slice(0, 5) : null,
    stay_min: num(place?.stay_min, null),
    cost: num(place?.cost, null),
    // 비공개 메모는 내보내기에도 담지 않는다 — 파일이 공유되는 순간 같은 문제가 된다.
    note: place?.note_public ? place?.note || '' : '',
  };
}

export function buildLocalSnapshot({ trip, days = [], places = [] } = {}, catalog = null) {
  if (!trip) return null;

  const byDay = new Map();
  const unassigned = [];
  places.forEach((p) => {
    if (!p?.day_id) {
      unassigned.push(p);
      return;
    }
    if (!byDay.has(p.day_id)) byDay.set(p.day_id, []);
    byDay.get(p.day_id).push(p);
  });

  const sortPins = (list) =>
    [...list].sort(
      (a, b) =>
        (num(a?.sort_order, 0) - num(b?.sort_order, 0)) ||
        String(a?.created_at || '').localeCompare(String(b?.created_at || '')),
    );

  let costTotal = 0;
  let placesCount = 0;

  const dayEntries = [...days]
    .sort((a, b) => num(a?.day_index, 0) - num(b?.day_index, 0))
    .map((day) => {
      const pins = sortPins(byDay.get(day.id) || []);
      placesCount += pins.length;
      pins.forEach((p) => {
        costTotal += num(p?.cost, 0) || 0;
      });
      return {
        index: num(day?.day_index, 0),
        date: day?.date || null,
        places: pins.map((p, i) => placeEntry(p, i, catalog)),
        legs: day?.legs || null,
      };
    });

  const spare = sortPins(unassigned);
  spare.forEach((p) => {
    costTotal += num(p?.cost, 0) || 0;
  });
  placesCount += spare.length;

  return {
    v: SNAPSHOT_VERSION,
    title: trip.title || '',
    start_date: trip.start_date || null,
    end_date: trip.end_date || null,
    currency: trip.currency || 'KRW',
    country: trip.country || null,
    timezone: trip.timezone || null,
    days: dayEntries,
    unassigned: spare.map((p, i) => placeEntry(p, i, catalog)),
    summary: {
      days_count: dayEntries.length,
      places_count: placesCount,
      cost_total: costTotal,
    },
  };
}
