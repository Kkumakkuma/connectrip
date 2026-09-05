// 구글 Places API (New) 모듈 단위 테스트 (2026-09-05).
// 핵심은 필드마스크 완전일치 — 요금 등급(Pro)이 여기서 굳는다. 필드를 하나라도 늘리면 이 테스트가 먼저 막는다.
import { describe, it, expect, vi } from 'vitest';
import {
  DETAILS_FIELD_MASK,
  MAX_RESULTS,
  PLACES_BASE,
  TEXT_SEARCH_FIELD_MASK,
  TEXT_SEARCH_URL,
  normalizeGooglePlace,
  placeDetailsGoogle,
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
    }
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
