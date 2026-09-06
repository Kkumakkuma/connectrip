import { beforeEach, describe, expect, it, vi } from 'vitest';

// api.js 는 import 시점에 supabase 클라이언트를 만들기 때문에 팩토리로 통째로 바꾼다.
vi.mock('../api', () => ({
  uploadTicket: vi.fn(),
  downloadTicket: vi.fn(),
  ticketUrl: vi.fn(),
}));
vi.mock('../lib/offlineStore', () => ({ readTicket: vi.fn() }));
vi.mock('../lib/barcode', () => ({ readBarcodeFromImage: vi.fn() }));
vi.mock('../lib/pdfText', () => ({ extractPdfText: vi.fn(), renderPdfFirstPage: vi.fn() }));

import { downloadTicket, ticketUrl, uploadTicket } from '../api';
import { readTicket } from '../lib/offlineStore';
import { readBarcodeFromImage } from '../lib/barcode';
import { extractPdfText, renderPdfFirstPage } from '../lib/pdfText';
import { resolveTicketView, uploadAndDetect } from './intake';

const TRIP = { start_date: '2026-10-01', end_date: '2026-10-08' };
const jpg = { type: 'image/jpeg', size: 1000 };
const row = { id: 't1', storage_path: 'u/t/x.jpg', mime: 'image/jpeg' };

beforeEach(() => {
  vi.clearAllMocks();
  uploadTicket.mockResolvedValue(row);
  readBarcodeFromImage.mockResolvedValue(null);
  extractPdfText.mockResolvedValue('');
});

describe('uploadAndDetect', () => {
  it('placeId 가 uploadTicket 에 전달되고 결과에 행이 담긴다', async () => {
    const r = await uploadAndDetect({ tripId: 't', userId: 'u', file: jpg, trip: TRIP, placeId: 'p1' });
    expect(uploadTicket).toHaveBeenCalledWith({ tripId: 't', userId: 'u', file: jpg, placeId: 'p1' });
    expect(r.row).toBe(row);
    expect(r.detection).toEqual({ candidates: [], best: null, ambiguous: true });
  });

  it('검증 실패면 업로드를 부르지 않고 사용자 문구로 던진다', async () => {
    await expect(uploadAndDetect({ tripId: 't', userId: 'u', file: { type: 'image/gif', size: 1 }, trip: TRIP }))
      .rejects.toThrow('사진(JPG·PNG·WebP)이나 PDF만 올릴 수 있습니다.');
    expect(uploadTicket).not.toHaveBeenCalled();
  });

  it('onUploaded 는 판독 전에 불리고, 실패해도 업로드 결과는 돌아온다', async () => {
    const order = [];
    readBarcodeFromImage.mockImplementation(async () => { order.push('detect'); return null; });
    const r = await uploadAndDetect({
      tripId: 't', userId: 'u', file: jpg, trip: TRIP,
      onUploaded: async () => { order.push('uploaded'); throw new Error('list fail'); },
    });
    expect(order).toEqual(['uploaded', 'detect']);
    expect(r.row).toBe(row);
  });

  it('판독 모듈이 던져도 빈 후보로 성공한다', async () => {
    readBarcodeFromImage.mockRejectedValue(new Error('chunk load failed'));
    const r = await uploadAndDetect({ tripId: 't', userId: 'u', file: jpg, trip: TRIP });
    expect(r.detection.candidates).toEqual([]);
    expect(r.barcode).toBeNull();
  });

  it('탑승권 바코드 날짜가 후보 맨 앞에 온다', async () => {
    // M1 + 승객명 20 + 전자항공권 1 + PNR 7 + 출발3 + 도착3 + 항공사3 + 편명5 + 연중일자 3(276 = 10월 3일)
    const bcbp = 'M1' + 'HONG/GILDONG        ' + 'E' + 'ABC1234' + 'ICN' + 'CDG' + 'KE ' + '0901 ' + '276';
    readBarcodeFromImage.mockResolvedValue({ text: bcbp, format: 'PDF417' });
    const r = await uploadAndDetect({ tripId: 't', userId: 'u', file: jpg, trip: TRIP });
    expect(r.bcbp?.date).toBe('2026-10-03');
    expect(r.detection.best?.date).toBe('2026-10-03');
    expect(r.detection.ambiguous).toBe(false);
  });

  it('PDF 는 글자를 뽑아 날짜 후보를 만든다', async () => {
    extractPdfText.mockResolvedValue('입장일 2026-10-05 10:00');
    const r = await uploadAndDetect({ tripId: 't', userId: 'u', file: { type: 'application/pdf', size: 10 }, trip: TRIP });
    expect(r.detection.candidates.map((c) => c.date)).toContain('2026-10-05');
  });
});

describe('resolveTicketView', () => {
  it('PDF: 첫 쪽 렌더 결과, 실패면 null', async () => {
    downloadTicket.mockResolvedValue(new Blob());
    renderPdfFirstPage.mockResolvedValue('data:image/png;base64,x');
    expect(await resolveTicketView({ mime: 'application/pdf', storage_path: 'a' }, 'u')).toEqual({ url: 'data:image/png;base64,x', revoke: null });
    renderPdfFirstPage.mockResolvedValue(null);
    expect(await resolveTicketView({ mime: 'application/pdf', storage_path: 'a' }, 'u')).toBeNull();
  });

  it('이미지: 기기 사본이 있으면 object URL + revoke, 없으면 서명 URL', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() });
    readTicket.mockResolvedValue(new Blob());
    const v = await resolveTicketView({ id: 't1', mime: 'image/jpeg', storage_path: 'a' }, 'u');
    expect(v.url).toBe('blob:1');
    v.revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');

    readTicket.mockResolvedValue(null);
    ticketUrl.mockResolvedValue('https://signed/x');
    expect(await resolveTicketView({ id: 't1', mime: 'image/jpeg', storage_path: 'a' }, 'u')).toEqual({ url: 'https://signed/x', revoke: null });
    vi.unstubAllGlobals();
  });
});
