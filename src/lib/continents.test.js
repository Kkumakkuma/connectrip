import { describe, it, expect } from 'vitest';
import { CONTINENTS, CONTINENT_IDS, continentOf, isContinentId, regionFromSearch, withRegionParam, searchTerm } from './continents';

describe('continents', () => {
  it('6대륙, id·색이 서로 다르다', () => {
    expect(CONTINENTS).toHaveLength(6);
    expect(new Set(CONTINENT_IDS).size).toBe(6);
    expect(new Set(CONTINENTS.map((c) => c.text)).size).toBe(6);
    expect(new Set(CONTINENTS.map((c) => c.hex)).size).toBe(6);
    expect(CONTINENT_IDS).toEqual(['europe', 'americas', 'africa', 'southeast-asia', 'asia', 'oceania']);
  });
  it('continentOf 는 모르는 값에 undefined', () => {
    expect(continentOf('europe').name).toBe('유럽');
    expect(continentOf(null)).toBeUndefined();
    expect(continentOf('mars')).toBeUndefined();
    expect(isContinentId('asia')).toBe(true);
    expect(isContinentId('')).toBe(false);
  });
  it('URL region 파라미터 읽기/쓰기', () => {
    expect(regionFromSearch('?region=asia')).toBe('asia');
    expect(regionFromSearch('?region=nope')).toBeNull();
    expect(regionFromSearch('')).toBeNull();
    expect(withRegionParam('?q=x', 'europe')).toBe('?q=x&region=europe');
    expect(withRegionParam('?q=x&region=europe', null)).toBe('?q=x');
    expect(withRegionParam('?region=asia', null)).toBe('');
    expect(withRegionParam('', 'bad')).toBe('');
  });
  it('searchTerm 은 or() 구분자를 지운다', () => {
    expect(searchTerm(' 파리,(런던) ')).toBe('파리  런던');
    expect(searchTerm('a'.repeat(100))).toHaveLength(60);
    expect(searchTerm(null)).toBe('');
  });
});
