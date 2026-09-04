import { describe, it, expect } from 'vitest';
import { findDateCandidates, parseBcbp, pickTicketDate } from './ticketDate';

const TRIP = { start_date: '2026-10-01', end_date: '2026-10-08' };

describe('findDateCandidates', () => {
  it('연도가 앞에 오는 표기를 읽는다', () => {
    const got = findDateCandidates('출발 2026-10-03 09:20');
    expect(got.map((c) => c.date)).toContain('2026-10-03');
  });

  it('한국식 표기를 읽는다', () => {
    expect(findDateCandidates('2026년 10월 3일').map((c) => c.date)).toContain('2026-10-03');
  });

  it('월 이름 표기를 양쪽 순서로 읽는다', () => {
    expect(findDateCandidates('03 Oct 2026').map((c) => c.date)).toContain('2026-10-03');
    expect(findDateCandidates('Oct 3, 2026').map((c) => c.date)).toContain('2026-10-03');
  });

  it('슬래시 표기는 두 해석을 모두 후보로 만들고 애매하다고 표시한다', () => {
    const got = findDateCandidates('05/06/2026');
    const dates = got.map((c) => c.date);
    expect(dates).toContain('2026-06-05');
    expect(dates).toContain('2026-05-06');
    expect(got.every((c) => c.ambiguous)).toBe(true);
  });

  it('한쪽 해석만 유효하면 애매하지 않다', () => {
    // 25 는 월이 될 수 없다
    const got = findDateCandidates('25/06/2026');
    expect(got).toHaveLength(1);
    expect(got[0].date).toBe('2026-06-25');
    expect(got[0].ambiguous).toBe(false);
  });

  it('존재하지 않는 날짜는 버린다', () => {
    expect(findDateCandidates('2026-02-30')).toHaveLength(0);
  });

  it('앞에 붙은 말로 점수를 매긴다', () => {
    const boost = findDateCandidates('출발 2026-10-03')[0];
    const penalty = findDateCandidates('발권일 2026-10-03')[0];
    expect(boost.score).toBeGreaterThan(penalty.score);
  });
});

describe('pickTicketDate', () => {
  it('왕복 항공권에서 순서가 아니라 라벨로 고른다', () => {
    // 텍스트 순서로는 도착이 먼저 나온다 — 순서로 고르면 틀린다.
    const text = '도착 2026-10-07 14:00\n출발 2026-10-02 09:20';
    const { best } = pickTicketDate(text, TRIP);
    expect(best.date).toBe('2026-10-02');
  });

  it('호텔 확인서에서 체크아웃이 아니라 체크인을 고른다', () => {
    const text = 'Check-out 2026-10-06\nCheck-in 2026-10-04';
    const { best } = pickTicketDate(text, TRIP);
    expect(best.date).toBe('2026-10-04');
  });

  it('여행 기간 밖 날짜(발권일 등)는 버린다', () => {
    const { candidates } = pickTicketDate('발권일 2026-08-20\n출발 2026-10-03', TRIP);
    expect(candidates.map((c) => c.date)).toEqual(['2026-10-03']);
  });

  it('연도 없는 표기는 여행 기간으로 연도를 채운다', () => {
    const { best } = pickTicketDate('입장 10월 5일 19:30', TRIP);
    expect(best.date).toBe('2026-10-05');
  });

  it('연말을 넘는 여행에서도 연도가 유일하게 정해진다', () => {
    const trip = { start_date: '2026-12-28', end_date: '2027-01-05' };
    expect(pickTicketDate('탑승 1월 3일', trip).best.date).toBe('2027-01-03');
    expect(pickTicketDate('탑승 12월 30일', trip).best.date).toBe('2026-12-30');
  });

  it('점수가 같으면 애매하다고 표시한다 — 사람이 고르게 한다', () => {
    const { ambiguous, candidates } = pickTicketDate('2026-10-02\n2026-10-05', TRIP);
    expect(candidates).toHaveLength(2);
    expect(ambiguous).toBe(true);
  });

  it('후보가 없으면 best 는 null 이고 애매 처리한다', () => {
    const out = pickTicketDate('바코드만 있고 날짜가 없음', TRIP);
    expect(out.best).toBeNull();
    expect(out.ambiguous).toBe(true);
  });

  it('같은 날짜가 여러 번 나오면 하나로 합치고 등장 횟수를 센다', () => {
    const { candidates } = pickTicketDate('2026-10-03 ... 2026-10-03 ... 2026-10-03', TRIP);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].hits).toBe(3);
  });

  it('근거 문장을 함께 돌려준다', () => {
    const { best } = pickTicketDate('출발 2026-10-03 09:20 인천', TRIP);
    expect(best.evidence).toContain('2026-10-03');
  });
});

describe('parseBcbp', () => {
  // 실제 BCBP 고정 폭에 맞춘 예시.
  // M1 + 승객명 20 + 전자항공권 표시 1 + PNR 7 + ICN + NRT + 'KE ' + ' 0703' + 276(10월 3일)
  const payload = `M1${'KIM/HONGGIL'.padEnd(20)}EABC1234ICNNRTKE  0703276Y028A0001 100`;

  it('탑승권에서 편명·구간·날짜를 읽는다', () => {
    const got = parseBcbp(payload, TRIP);
    expect(got.from).toBe('ICN');
    expect(got.to).toBe('NRT');
    expect(got.flight).toBe('KE703');
    expect(got.pnr).toBe('ABC1234');
    expect(got.date).toBe('2026-10-03'); // 276일차 = 10월 3일(평년)
  });

  it('M1 로 시작하지 않으면 무시한다', () => {
    expect(parseBcbp('그냥 QR 텍스트', TRIP)).toBeNull();
  });

  it('여행 기간을 모르면 날짜는 비워 둔다 — 추측하지 않는다', () => {
    const got = parseBcbp(payload, {});
    expect(got).not.toBeNull();
    expect(got.date).toBeNull();
  });
});
