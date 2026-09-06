import { describe, expect, it, vi } from 'vitest';
import {
  KIND_LABEL,
  TICKET_MAX_BYTES,
  readOfflineOptIn,
  ticketLabel,
  ticketsByPlace,
  validateTicketFile,
} from './ticketFile';

const file = (type, size) => ({ type, size });

describe('validateTicketFile', () => {
  it('허용 형식·크기는 통과', () => {
    expect(validateTicketFile(file('image/jpeg', 1))).toBeNull();
    expect(validateTicketFile(file('application/pdf', TICKET_MAX_BYTES))).toBeNull();
  });
  it('형식·빈 파일·초과·없음은 사용자 문구', () => {
    expect(validateTicketFile(file('image/gif', 10))).toBe('사진(JPG·PNG·WebP)이나 PDF만 올릴 수 있습니다.');
    expect(validateTicketFile(file('image/png', 0))).toBe('빈 파일은 올릴 수 없습니다.');
    expect(validateTicketFile(file('image/png', TICKET_MAX_BYTES + 1))).toBe('15MB 이하 파일만 올릴 수 있습니다.');
    expect(validateTicketFile(null)).toBe('사진(JPG·PNG·WebP)이나 PDF만 올릴 수 있습니다.');
  });
});

describe('ticketLabel', () => {
  it('제목 우선, 없으면 파일 종류', () => {
    expect(ticketLabel({ title: '루브르 입장권', mime: 'image/jpeg' })).toBe('루브르 입장권');
    expect(ticketLabel({ title: null, mime: 'application/pdf' })).toBe('PDF 티켓');
    expect(ticketLabel({ mime: 'image/webp' })).toBe('사진 티켓');
  });
});

describe('ticketsByPlace', () => {
  it('장소별 묶음, place_id 없는 건 제외, 순서 유지', () => {
    const rows = [
      { id: 'a', place_id: 'p1' },
      { id: 'b', place_id: null },
      { id: 'c', place_id: 'p2' },
      { id: 'd', place_id: 'p1' },
    ];
    const map = ticketsByPlace(rows);
    expect([...map.keys()]).toEqual(['p1', 'p2']);
    expect(map.get('p1').map((t) => t.id)).toEqual(['a', 'd']);
    expect(map.has(null)).toBe(false);
  });
  it('빈 입력은 빈 Map', () => {
    expect(ticketsByPlace([]).size).toBe(0);
    expect(ticketsByPlace(null).size).toBe(0);
  });
});

describe('readOfflineOptIn', () => {
  it('localStorage 값 1 이면 켜짐, 그 외·예외는 꺼짐', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null });
    store.set('ct_planner_ticket_offline_t1', '1');
    expect(readOfflineOptIn('t1')).toBe(true);
    expect(readOfflineOptIn('t2')).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readOfflineOptIn('t1')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('KIND_LABEL', () => {
  it('종류 6개', () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual(['bus', 'flight', 'hotel', 'other', 'ticket', 'train']);
  });
});
