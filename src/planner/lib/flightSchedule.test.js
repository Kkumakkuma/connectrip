import { describe, it, expect, vi } from 'vitest';
import { extractFlightNumber, isDuplicateFlight, offerFlightSchedule, canonFlight } from './flightSchedule';

describe('flightSchedule — 항공권 티켓에서 마이페이지 비행 스케줄 등록 제안', () => {
  it('편명은 바코드 우선, 없으면 제목에서 찾는다', () => {
    expect(extractFlightNumber({ bcbp: { flight: 'KE81' }, title: 'OZ102 ICN→NRT' })).toBe('KE81');
    expect(extractFlightNumber({ bcbp: null, title: 'KE081 ICN→JFK' })).toBe('KE081');
    expect(extractFlightNumber({ title: 'ke 123 인천→도쿄' })).toBe('KE123');
    expect(extractFlightNumber({ title: '7C1234 제주항공' })).toBe('7C1234');
    expect(extractFlightNumber({ title: '호텔 바우처 2026' })).toBeNull();
    expect(extractFlightNumber({})).toBeNull();
  });

  it('같은 편·같은 날짜가 이미 있으면 중복', () => {
    const list = [{ flight_number: 'ke081', flight_date: '2026-10-01' }];
    expect(isDuplicateFlight(list, 'KE081', '2026-10-01')).toBe(true);
    expect(isDuplicateFlight(list, 'KE081', '2026-10-02')).toBe(false);
    expect(isDuplicateFlight(list, 'KE81', '2026-10-01')).toBe(true);
    expect(canonFlight('ke 081')).toBe('KE81');
  });

  const api = (mine = []) => ({ getMyFlights: vi.fn(async () => mine), register: vi.fn(async () => ({})) });

  it('항공권이 아니거나 편명이 없으면 묻지 않는다', async () => {
    const a = api();
    const confirm = vi.fn(() => true);
    expect((await offerFlightSchedule({ userId: 'u', values: { kind: 'hotel', event_date: '2026-10-01', title: 'KE081' }, confirm, api: a })).status).toBe('skip');
    expect((await offerFlightSchedule({ userId: 'u', values: { kind: 'flight', event_date: '2026-10-01', title: '바우처' }, confirm, api: a })).status).toBe('skip');
    expect(confirm).not.toHaveBeenCalled();
    expect(a.register).not.toHaveBeenCalled();
  });

  it('이미 등록된 편이면 묻지 않고 exists', async () => {
    const a = api([{ flight_number: 'KE081', flight_date: '2026-10-01' }]);
    const confirm = vi.fn(() => true);
    const r = await offerFlightSchedule({ userId: 'u', values: { kind: 'flight', event_date: '2026-10-01', title: 'KE081 ICN→JFK' }, confirm, api: a });
    expect(r.status).toBe('exists');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('예를 누르면 등록, 아니오면 등록 안 함', async () => {
    const a = api();
    const yes = await offerFlightSchedule({ userId: 'u', userType: 'crew', values: { kind: 'flight', event_date: '2026-10-01' }, bcbp: { flight: 'OZ102' }, confirm: () => true, api: a });
    expect(yes.status).toBe('registered');
    expect(a.register).toHaveBeenCalledWith({ user_id: 'u', flight_number: 'OZ102', flight_date: '2026-10-01', user_type: 'crew' });
    const b = api();
    const no = await offerFlightSchedule({ userId: 'u', values: { kind: 'flight', event_date: '2026-10-01', title: 'KE081' }, confirm: () => false, api: b });
    expect(no.status).toBe('declined');
    expect(b.register).not.toHaveBeenCalled();
  });
});
