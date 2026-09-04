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

function placeEntry(place, order) {
  return {
    order,
    name: place?.name || '',
    address: place?.address || '',
    lat: num(place?.lat, 0),
    lng: num(place?.lng, 0),
    provider: place?.source || null,
    provider_place_id: place?.provider_place_id || '',
    catalog_id: place?.catalog_id || null,
    planned_time: place?.planned_time ? String(place.planned_time).slice(0, 5) : null,
    stay_min: num(place?.stay_min, null),
    cost: num(place?.cost, null),
    // 비공개 메모는 내보내기에도 담지 않는다 — 파일이 공유되는 순간 같은 문제가 된다.
    note: place?.note_public ? place?.note || '' : '',
  };
}

export function buildLocalSnapshot({ trip, days = [], places = [] } = {}) {
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
        places: pins.map(placeEntry),
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
    unassigned: spare.map(placeEntry),
    summary: {
      days_count: dayEntries.length,
      places_count: placesCount,
      cost_total: costTotal,
    },
  };
}
