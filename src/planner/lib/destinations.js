// 목적지 목록과 도시별 추천 명소 (정적 자산).
//
// 왜 API 가 아니라 파일인가 (2026-09-04 실측)
//   런타임에 OSM Overpass 를 부르는 안을 만들었다가 재보고 버렸다. 도쿄 10.2초 / 강릉 16.9초,
//   도쿄는 결과 상한에 걸려 잘렸고, 한국어 이름은 250개 중 32개뿐이었다.
//   목적지 검색도 마찬가지다 — Nominatim 에 "도쿄"를 물으면 1등이 도쿄역, 3등이 두바이의 섬이다.
//   그래서 scripts/build_planner_data.py 가 미리 만들어 둔 파일을 읽는다. 기다림이 없고,
//   이름이 한국어이고, 외부 서비스가 느려도 화면이 멈추지 않는다.
//
// 목록에 없는 도시는 기존 장소 검색(Nominatim)으로 직접 고를 수 있다. 그 경우 dest_id 가
// 없으므로 추천 명소는 나오지 않는다 — 화면이 그 사실을 그대로 알린다.

// 데이터를 새로 만들면 이 값을 올린다. 파일 이름이 고정이라 이게 없으면 브라우저 캐시가
// 옛 파일을 계속 내준다. 서비스워커도 이 주소 그대로를 키로 캐시한다.
export const DATA_VERSION = '20260904';

const BASE = '/planner-data';

let listPromise = null;
const attrCache = new Map();

/** 비교용 정규화 — 악센트·공백·구두점을 걷어낸다(São Paulo === sao paulo). */
function fold(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')  // 결합 문자 전부(NFKD 가 만드는 악센트). 문자를 직접 쓰면 편집 중 깨진다
    .replace(/[\s\-·'’"()[\],.]+/g, '')
    .toLowerCase();
}

// 한글 초성 추출. "ㄷㅋ" 로 도쿄를 찾게 한다 — 한국 앱에서는 당연하게 쓰는 방식이다.
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function initials(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

const CHO_ONLY = /^[ㄱ-ㅎ]+$/;

/** 목적지 목록을 한 번만 받아 온다. 실패하면 빈 배열 — 화면은 그대로 동작해야 한다. */
export async function loadDestinations() {
  if (!listPromise) {
    listPromise = (async () => {
      try {
        const resp = await fetch(`${BASE}/destinations.json?v=${DATA_VERSION}`, { cache: 'force-cache' });
        if (!resp.ok) throw new Error(String(resp.status));
        const data = await resp.json();
        const rows = Array.isArray(data?.destinations) ? data.destinations : [];
        return rows.map((d) => ({
          ...d,
          _keys: [d.ko, d.en, ...(d.alias || [])].filter(Boolean).map(fold),
          _cho: initials(d.ko || ''),
        }));
      } catch {
        // 한 번 실패했다고 영원히 막지 않는다. 다음 호출에서 다시 시도한다.
        listPromise = null;
        return [];
      }
    })();
  }
  return listPromise;
}

/**
 * 목적지 검색. 네트워크를 쓰지 않는다 — 목록은 이미 받아 둔 것이다.
 * 접두 일치를 부분 일치보다 앞에 둔다("도" 로 도쿄가 도라도보다 먼저 나오게).
 */
export function searchDestinations(list, query, limit = 8) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = fold(raw);
  if (!q) return [];
  const choQuery = CHO_ONLY.test(raw) ? raw : null;

  // 낮을수록 앞. 0=완전일치 1=접두 2=초성접두 3=부분
  const MISS = 99;
  const scored = [];
  for (const d of list) {
    let best = MISS;
    if (choQuery) {
      // 초성만 입력한 경우 — 초성 문자열에서만 찾는다
      if (d._cho.startsWith(choQuery)) best = 2;
      else if (d._cho.includes(choQuery)) best = 3;
    } else {
      for (const key of d._keys) {
        if (key === q) { best = 0; break; }
        if (key.startsWith(q)) best = Math.min(best, 1);
        else if (key.includes(q)) best = Math.min(best, 3);
      }
    }
    if (best < MISS) scored.push([best, d]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].ko.length - b[1].ko.length);
  return scored.slice(0, limit).map(([, d]) => d);
}

/** 도시 하나의 추천 명소. 없거나 실패하면 빈 배열. */
export async function loadAttractions(destId) {
  const id = String(destId || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) return [];
  if (attrCache.has(id)) return attrCache.get(id);

  let failed = false;
  const promise = (async () => {
    try {
      const resp = await fetch(`${BASE}/attractions/${id}.json?v=${DATA_VERSION}`, { cache: 'force-cache' });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      const rows = Array.isArray(data?.places) ? data.places : [];
      // 화면에서 바로 담을 수 있게 장소 검색 결과와 같은 모양으로 맞춘다.
      // provider_place_id 는 api/planner/places.js 와 같은 'node123' 형식이라
      // 검색으로 담은 것과 추천으로 담은 것이 같은 카탈로그 행이 된다.
      return rows
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p?.name)
        .map((p) => ({
          provider: 'osm',
          provider_place_id: String(p.osm || ''),
          name: String(p.name),
          address: null,
          lat: p.lat,
          lng: p.lng,
          opening_hours: null,
          // planner_places.source 의 CHECK 는 search/longpress/link/import 만 받는다(실측).
          // 추천도 카탈로그를 거쳐 담기므로 검색과 같은 경로로 본다.
          source: 'search',
          _en: p.en || '',
          _cat: p.cat || '',
        }));
    } catch {
      failed = true;
      return [];
    }
  })();

  attrCache.set(id, promise);
  // 실패는 캐시에 남기지 않는다. 단 set 보다 먼저 지우면 실패한 빈 배열이 그대로 남으므로
  // 반드시 set 뒤에, 그리고 그 사이 다른 호출이 덮어쓰지 않았을 때만 지운다.
  promise.then(() => {
    if (failed && attrCache.get(id) === promise) attrCache.delete(id);
  });
  return promise;
}

/** 목적지 나라에 맞는 통화. 목록에 있는 값을 그대로 쓴다. */
export function currencyOf(dest) {
  const cur = String(dest?.cur || '').toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : 'KRW';
}
