// 구글 Places API (New) 모듈 단위 테스트 (2026-09-05).
// 핵심은 필드마스크 완전일치 — 요금 등급(Pro)이 여기서 굳는다. 필드를 하나라도 늘리면 이 테스트가 먼저 막는다.
import { describe, it, expect, vi } from 'vitest';
import {
  AUTOCOMPLETE_FIELD_MASK,
  AUTOCOMPLETE_URL,
  BIAS_RADIUS_M,
  DETAILS_ESSENTIALS_FIELD_MASK,
  DETAILS_FIELD_MASK,
  MAX_RESULTS,
  PLACES_BASE,
  TEXT_SEARCH_FIELD_MASK,
  TEXT_SEARCH_URL,
  autocompleteGoogle,
  normalizeGooglePlace,
  normalizePrediction,
  normalizeSessionToken,
  placeDetailsGoogle,
  placeLocationGoogle,
  searchTextGoogle,
} from './_google_places.js';

const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const place = (i, extra = {}) => ({
  id: `ChIJ${i}`,
  displayName: { text: `장소 ${i}` },
  formattedAddress: `주소 ${i}`,
  location: { latitude: 37 + i * 0.001, longitude: 127.5 },
  ...extra,
});

describe('필드마스크(요금 등급 고정)', () => {
  it('텍스트 검색은 Pro 4개 필드, 상세는 4개 필드 — 완전일치', () => {
    expect(TEXT_SEARCH_FIELD_MASK).toBe('places.id,places.displayName,places.formattedAddress,places.location');
    expect(DETAILS_FIELD_MASK).toBe('id,displayName,formattedAddress,location');
  });
  it('Enterprise 등급 필드는 어느 마스크에도 없다', () => {
    const banned = ['OpeningHours', 'rating', 'websiteUri', 'PhoneNumber', 'priceLevel', 'reviews', 'photos', 'types', 'userRatingCount'];
    for (const b of banned) {
      expect(TEXT_SEARCH_FIELD_MASK).not.toContain(b);
      expect(DETAILS_FIELD_MASK).not.toContain(b);
      expect(DETAILS_ESSENTIALS_FIELD_MASK).not.toContain(b);
    }
  });
  it('자동완성 마스크 고정, 상세 Essentials 는 displayName(Pro) 없이 3개 필드', () => {
    expect(AUTOCOMPLETE_FIELD_MASK).toBe(
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat'
    );
    expect(DETAILS_ESSENTIALS_FIELD_MASK).toBe('id,location,formattedAddress');
    expect(DETAILS_ESSENTIALS_FIELD_MASK).not.toContain('displayName');
    expect(BIAS_RADIUS_M).toBe(50000);
  });
});

describe('autocompleteGoogle', () => {
  const pred = (i, extra = {}) => ({
    placePrediction: {
      placeId: `ChIJ${i}`,
      text: { text: `예측 ${i}, 도쿄` },
      structuredFormat: { mainText: { text: `예측 ${i}` }, secondaryText: { text: '도쿄, 일본' } },
      ...extra,
    },
  });
  it('요청 형식(세션·편향·ko·쿼리예측 제외) + 예측 정규화 + 불량 제거 + 8건 상한', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return resp({ suggestions: [{ queryPrediction: { text: { text: 'q' } } }, { placePrediction: { placeId: 'x' } }, ...Array.from({ length: 10 }, (_, i) => pred(i))] });
    });
    const r = await autocompleteGoogle({ q: ' 도쿄타 ', key: 'K', session: '11111111-2222-3333-4444-555555555555', bias: { lat: 35.68, lng: 139.76 }, fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.predictions).toHaveLength(MAX_RESULTS);
    expect(r.predictions[0]).toEqual({ provider: 'google', provider_place_id: 'ChIJ0', name: '예측 0', secondary: '도쿄, 일본' });
    expect(calls[0].url).toBe(AUTOCOMPLETE_URL);
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': 'K', 'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      input: '도쿄타',
      languageCode: 'ko',
      includeQueryPredictions: false,
      sessionToken: '11111111-2222-3333-4444-555555555555',
      locationBias: { circle: { center: { latitude: 35.68, longitude: 139.76 }, radius: BIAS_RADIUS_M } },
    });
  });
  it('세션 토큰이 이상하거나 편향이 없으면 본문에서 빠진다', async () => {
    const calls = [];
    await autocompleteGoogle({ q: 'x', key: 'K', session: 'bad token!', bias: { lat: 'a' }, fetchImpl: async (u, i) => { calls.push(i); return resp({ suggestions: [] }); } });
    expect(JSON.parse(calls[0].body)).toEqual({ input: 'x', languageCode: 'ko', includeQueryPredictions: false });
    expect(normalizeSessionToken('11111111-2222-3333-4444-555555555555')).toBe('11111111-2222-3333-4444-555555555555');
    expect(normalizeSessionToken('short')).toBe('');
    expect(normalizePrediction({ placeId: 'a', text: { text: '전체 텍스트' } })).toEqual({ provider: 'google', provider_place_id: 'a', name: '전체 텍스트', secondary: '' });
  });
  it('HTTP 오류·파싱 실패·네트워크 예외·키 없음은 ok:false', async () => {
    expect((await autocompleteGoogle({ q: 'x', key: '', fetchImpl: vi.fn() })).ok).toBe(false);
    expect(await autocompleteGoogle({ q: 'x', key: 'K', fetchImpl: async () => resp({}, 403) })).toEqual({ ok: false, reason: 'http', status: 403 });
    expect(await autocompleteGoogle({ q: 'x', key: 'K', fetchImpl: async () => { throw new Error('t'); } })).toEqual({ ok: false, reason: 'network' });
  });
});

describe('placeLocationGoogle (Details Essentials)', () => {
  it('세션 토큰을 URL 에 싣고 Essentials 마스크로 부른다. 좌표·주소만 돌려준다', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return resp({ id: 'ChIJ1', location: { latitude: 35.2, longitude: 139.8 }, formattedAddress: '새 주소' });
    });
    const r = await placeLocationGoogle({ placeId: 'ChIJ1', key: 'K', session: 'abcdefgh-1234', fetchImpl });
    expect(r).toEqual({ ok: true, place: { provider_place_id: 'ChIJ1', address: '새 주소', lat: 35.2, lng: 139.8 } });
    expect(calls[0].url).toBe(`${PLACES_BASE}/places/ChIJ1?languageCode=ko&sessionToken=abcdefgh-1234`);
    expect(calls[0].init.headers).toEqual({ 'X-Goog-Api-Key': 'K', 'X-Goog-FieldMask': DETAILS_ESSENTIALS_FIELD_MASK, Accept: 'application/json' });
  });
  it('세션 없으면 파라미터 생략, 404 not_found, 좌표 없음 schema, 주소 없음 null', async () => {
    const calls = [];
    const r = await placeLocationGoogle({ placeId: 'ChIJ1', key: 'K', fetchImpl: async (u) => { calls.push(u); return resp({ location: { latitude: 1, longitude: 2 } }); } });
    expect(calls[0]).toBe(`${PLACES_BASE}/places/ChIJ1?languageCode=ko`);
    expect(r.place.address).toBeNull();
    expect(await placeLocationGoogle({ placeId: 'x', key: 'K', fetchImpl: async () => resp({}, 404) })).toEqual({ ok: false, reason: 'not_found' });
    expect(await placeLocationGoogle({ placeId: 'x', key: 'K', fetchImpl: async () => resp({ id: 'x' }) })).toEqual({ ok: false, reason: 'schema' });
  });
});

describe('normalizeGooglePlace', () => {
  it('정상 응답 → 공통 형식(provider google, opening_hours null)', () => {
    expect(normalizeGooglePlace(place(1))).toEqual({
      provider: 'google',
      provider_place_id: 'ChIJ1',
      name: '장소 1',
      address: '주소 1',
      lat: 37.001,
      lng: 127.5,
      opening_hours: null,
    });
  });
  it('이름·id·좌표가 빠지거나 범위 밖이면 null, 주소가 없으면 null 주소', () => {
    expect(normalizeGooglePlace(place(1, { displayName: undefined }))).toBeNull();
    expect(normalizeGooglePlace(place(1, { id: '' }))).toBeNull();
    expect(normalizeGooglePlace(place(1, { location: { latitude: 'x', longitude: 1 } }))).toBeNull();
    expect(normalizeGooglePlace(place(1, { location: { latitude: 91, longitude: 1 } }))).toBeNull();
    expect(normalizeGooglePlace(place(1, { location: { latitude: 1, longitude: -181 } }))).toBeNull();
    expect(normalizeGooglePlace(place(1, { formattedAddress: undefined })).address).toBeNull();
    expect(normalizeGooglePlace(null)).toBeNull();
  });
  it('이름 120자·주소 300자·id 300자 상한', () => {
    const out = normalizeGooglePlace(place(1, { displayName: { text: 'a'.repeat(200) }, formattedAddress: 'b'.repeat(400) }));
    expect(out.name).toHaveLength(120);
    expect(out.address).toHaveLength(300);
    expect(normalizeGooglePlace(place(1, { id: 'c'.repeat(301) }))).toBeNull();
  });
});

describe('searchTextGoogle', () => {
  it('요청 형식(URL·헤더 완전일치·본문 ko/8건) + 정규화·불량 제거·8건 상한', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return resp({ places: [{ id: 'bad' }, ...Array.from({ length: 10 }, (_, i) => place(i))] });
    });
    const r = await searchTextGoogle({ q: '  서울 타워 ', key: 'K', fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(MAX_RESULTS);
    expect(r.results.every((p) => p.provider === 'google' && p.opening_hours === null)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TEXT_SEARCH_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'K',
      'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({ textQuery: '서울 타워', languageCode: 'ko', pageSize: 8 });
  });
  it('키 없음·빈 검색어는 호출 없이 실패, HTTP 오류·파싱 실패·네트워크 예외는 사유별 ok:false', async () => {
    const fetchImpl = vi.fn();
    expect((await searchTextGoogle({ q: 'x', key: '', fetchImpl })).ok).toBe(false);
    expect((await searchTextGoogle({ q: '  ', key: 'K', fetchImpl })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(await searchTextGoogle({ q: 'x', key: 'K', fetchImpl: async () => resp({}, 500) })).toEqual({ ok: false, reason: 'http', status: 500 });
    expect(await searchTextGoogle({ q: 'x', key: 'K', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) })).toEqual({ ok: false, reason: 'parse' });
    expect(await searchTextGoogle({ q: 'x', key: 'K', fetchImpl: async () => { throw new Error('timeout'); } })).toEqual({ ok: false, reason: 'network' });
    expect(await searchTextGoogle({ q: 'x', key: 'K', fetchImpl: async () => resp({ places: 'nope' }) })).toEqual({ ok: true, results: [] });
  });
});

describe('placeDetailsGoogle', () => {
  it('GET places/{id}?languageCode=ko, 헤더 완전일치, 정규화 결과', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return resp(place(3));
    });
    const r = await placeDetailsGoogle({ placeId: 'ChIJ3', key: 'K', fetchImpl });
    expect(r).toEqual({ ok: true, place: normalizeGooglePlace(place(3)) });
    expect(calls[0].url).toBe(`${PLACES_BASE}/places/ChIJ3?languageCode=ko`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toEqual({ 'X-Goog-Api-Key': 'K', 'X-Goog-FieldMask': DETAILS_FIELD_MASK, Accept: 'application/json' });
  });
  it('id 는 URL 인코딩, 404 는 not_found, 형식 불량은 schema, 그 외 HTTP 는 http', async () => {
    const calls = [];
    await placeDetailsGoogle({ placeId: 'a/b c', key: 'K', fetchImpl: async (url) => { calls.push(url); return resp(place(1)); } });
    expect(calls[0]).toBe(`${PLACES_BASE}/places/a%2Fb%20c?languageCode=ko`);
    expect(await placeDetailsGoogle({ placeId: 'x', key: 'K', fetchImpl: async () => resp({}, 404) })).toEqual({ ok: false, reason: 'not_found' });
    expect(await placeDetailsGoogle({ placeId: 'x', key: 'K', fetchImpl: async () => resp({ id: 'x' }) })).toEqual({ ok: false, reason: 'schema' });
    expect(await placeDetailsGoogle({ placeId: 'x', key: 'K', fetchImpl: async () => resp({}, 429) })).toEqual({ ok: false, reason: 'http', status: 429 });
    expect((await placeDetailsGoogle({ placeId: '', key: 'K', fetchImpl: vi.fn() })).ok).toBe(false);
  });
});
