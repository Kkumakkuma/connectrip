import { describe, expect, it } from 'vitest';
import { buildLocalSnapshot } from './snapshot';

// 티켓은 개인 자격증명(탑승권 바코드 = 성 + 예약번호)이다. 기기 사본·내보내기 스냅샷에 절대 섞이지 않아야 한다.
describe('buildLocalSnapshot 은 티켓·비공개 메모를 싣지 않는다', () => {
  const data = {
    trip: { id: 't1', title: '도쿄', start_date: '2026-10-01', end_date: '2026-10-03', tickets: [{ storage_path: 'u/t/x.jpg' }] },
    days: [{ id: 'd1', day_index: 0, legs: null, tickets: [{ barcode_text: 'M1SECRET' }] }],
    places: [
      { id: 'p1', day_id: 'd1', name: '루브르', lat: 1, lng: 2, sort_order: 0, note: '예약번호 ABC', note_public: false,
        tickets: [{ storage_path: 'u/t/y.pdf', barcode_text: 'M1SECRET' }] },
    ],
  };

  it('결과 JSON 에 tickets·storage_path·barcode·비공개 메모가 없다', () => {
    const json = JSON.stringify(buildLocalSnapshot(data, null));
    expect(json).not.toMatch(/tickets/);
    expect(json).not.toMatch(/storage_path/);
    expect(json).not.toMatch(/barcode/);
    expect(json).not.toMatch(/M1SECRET/);
    expect(json).not.toMatch(/예약번호 ABC/);
    // provider_place_id 는 형식상 항상 있으므로 단순 place_id 단언은 쓰지 않는다
    expect(json).not.toMatch(/(^|[^_])place_id/);
  });
});
