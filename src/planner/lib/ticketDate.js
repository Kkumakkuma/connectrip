// 티켓(PDF·이미지)에서 읽어 낸 글자에서 "이 티켓이 쓰이는 날짜"를 고른다. 순수 함수만 둔다.
//
// 설계 §5.1 의 원칙을 그대로 옮겼다.
//   · "여행 기간 안에서 처음 나오는 날짜를 채택" 은 금지다. 왕복 항공권(가는 편/오는 편)과
//     호텔 확인서(체크인/체크아웃)는 두 날짜가 모두 기간 안이라, 텍스트 순서로 결정돼 버린다.
//   · 그래서 후보를 전부 모으고 **앞에 붙은 말**로 점수를 매긴다.
//   · 05/06/2026 같은 슬래시 표기는 5월 6일인지 6월 5일인지 구분할 방법이 없다.
//     둘 다 후보로 만들고 ambiguous 로 표시해 사람이 고르게 한다.
//   · 결과는 절대 자동 저장하지 않는다. 확인 시트를 반드시 한 번 거친다.

const BOOST = /(출발|탑승|승차|입장|공연|시작|체크인|Departure|Depart|Boarding|Check-?in|Entry|Start)/i;
const PENALTY = /(발권|예약일|결제|구매|도착|체크아웃|만료|Issued|Booked|Booking|Purchase|Arrival|Check-?out|Expire)/i;

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y, m, d) {
  if (!(y >= 1970 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 날짜 주변에 붙은 말로 가산·감점.
//
// 앞 30자만 보면 두 가지가 샌다(2026-09-04 교차검토).
//   · 줄 경계를 넘어가 윗줄 라벨이 아랫줄 날짜에 묻는다 —
//     "Departure 2026-10-03 / Arrival 2026-10-05" 에서 둘째 날짜가 상쇄돼 버린다.
//   · 표 형태 PDF 는 날짜 **뒤에** 라벨이 오는데 그건 아예 안 본다.
// 그래서 같은 줄 안에서만, 앞뒤 양쪽을 본다.
function contextScore(text, index, matchLen) {
  const NL = String.fromCharCode(10);   // 역슬래시 이스케이프가 도구를 거치며 먹히는 사고가 있어 코드로 만든다
  const lineStart = text.lastIndexOf(NL, index) + 1;
  let lineEnd = text.indexOf(NL, index);
  if (lineEnd === -1) lineEnd = text.length;

  const before = text.slice(Math.max(lineStart, index - 30), index);
  const after = text.slice(index + matchLen, Math.min(lineEnd, index + matchLen + 20));

  let s = 0;
  if (BOOST.test(before)) s += 3;
  if (PENALTY.test(before)) s -= 3;
  // 뒤쪽 라벨은 앞쪽보다 약하게 본다 — 다음 항목의 라벨일 수도 있다.
  if (BOOST.test(after)) s += 1;
  if (PENALTY.test(after)) s -= 1;
  return s;
}

/**
 * 텍스트에서 날짜 후보를 전부 뽑는다.
 * @returns {{date: string, score: number, ambiguous: boolean, evidence: string}[]}
 */
export function findDateCandidates(text) {
  const src = String(text || '');
  const out = [];
  const push = (date, index, ambiguous, matched) => {
    if (!date) return;
    out.push({
      date,
      score: contextScore(src, index, matched.length),
      ambiguous,
      // 사람이 판단할 근거를 그대로 보여 준다. 앞뒤를 조금씩 붙인다.
      evidence: src.slice(Math.max(0, index - 20), index + matched.length + 10).replace(/\s+/g, ' ').trim(),
    });
  };

  // 1) 2026-10-03 / 2026.10.03 / 2026년 10월 3일 — 연도가 먼저라 뒤집힐 일이 없다.
  const ymd = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g;
  let m;
  while ((m = ymd.exec(src))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (valid(y, mo, d)) push(iso(y, mo, d), m.index, false, m[0]);
  }

  // 2) 03 Oct 2026 / Oct 3, 2026 — 월 이름이 있으니 이것도 명확하다.
  const dMonY = /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})/gi;
  while ((m = dMonY.exec(src))) {
    const [d, mo, y] = [Number(m[1]), MONTH_NAMES[m[2].toLowerCase()], Number(m[3])];
    if (valid(y, mo, d)) push(iso(y, mo, d), m.index, false, m[0]);
  }
  const monDY = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})/gi;
  while ((m = monDY.exec(src))) {
    const [mo, d, y] = [MONTH_NAMES[m[1].toLowerCase()], Number(m[2]), Number(m[3])];
    if (valid(y, mo, d)) push(iso(y, mo, d), m.index, false, m[0]);
  }

  // 3) 03/10/2026 — 여기서부터가 함정이다. 12일 이하에서는 어느 쪽이 월인지 알 수 없다.
  //    두 해석을 모두 후보로 만들고 ambiguous 로 표시한다.
  const slash = /(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{4})/g;
  while ((m = slash.exec(src))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const dmy = valid(y, b, a) ? iso(y, b, a) : null;   // 앞이 일
    const mdy = valid(y, a, b) ? iso(y, a, b) : null;   // 앞이 월
    if (dmy && mdy && dmy !== mdy) {
      push(dmy, m.index, true, m[0]);
      push(mdy, m.index, true, m[0]);
    } else {
      push(dmy || mdy, m.index, false, m[0]);
    }
  }

  // 4) 10월 3일 — 연도가 없다. 호출부가 여행 기간으로 연도를 채운다.
  const mdKo = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while ((m = mdKo.exec(src))) {
    out.push({
      date: null,
      month: Number(m[1]),
      day: Number(m[2]),
      score: contextScore(src, m.index, m[0].length),
      ambiguous: false,
      evidence: src.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10).replace(/\s+/g, ' ').trim(),
    });
  }

  return out;
}

// 연도 없는 후보(10월 3일)에 여행 기간으로 연도를 채운다.
// 여행은 최대 61일(SQL CHECK)이라 그 창 안에서 월·일 조합은 유일하게 결정된다 — 연말을 넘겨도 그렇다.
function fillYear(cand, startDate, endDate) {
  if (cand.date) return cand;
  const s = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate || '');
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate || '');
  if (!s || !e) return null;
  for (let y = Number(s[1]); y <= Number(e[1]); y += 1) {
    if (!valid(y, cand.month, cand.day)) continue;
    const iso1 = iso(y, cand.month, cand.day);
    if (iso1 >= startDate && iso1 <= endDate) return { ...cand, date: iso1 };
  }
  return null;
}

/**
 * 후보를 여행 기간으로 걸러 점수순으로 세운다.
 *
 * @param {string} text 티켓에서 읽은 글자
 * @param {{start_date: string, end_date: string}} trip
 * @returns {{candidates: object[], best: object|null, ambiguous: boolean}}
 *          자동 저장 금지 — best 는 "확인 시트의 기본 선택"일 뿐이다.
 */
export function pickTicketDate(text, trip) {
  const start = trip?.start_date || null;
  const end = trip?.end_date || null;

  const filled = findDateCandidates(text)
    .map((c) => fillYear(c, start, end))
    .filter(Boolean)
    // 여행 기간 밖 날짜는 뺀다. 발권일·유효기간처럼 관계 없는 날짜가 대부분 여기서 걸러진다.
    .filter((c) => (!start || c.date >= start) && (!end || c.date <= end));

  // 같은 날짜가 여러 번 나오면 가장 높은 점수만 남기되, 등장 횟수도 점수로 친다.
  const byDate = new Map();
  filled.forEach((c) => {
    const prev = byDate.get(c.date);
    if (!prev) {
      byDate.set(c.date, { ...c, hits: 1 });
      return;
    }
    byDate.set(c.date, {
      ...prev,
      hits: prev.hits + 1,
      score: Math.max(prev.score, c.score),
      ambiguous: prev.ambiguous && c.ambiguous,
      evidence: prev.score >= c.score ? prev.evidence : c.evidence,
    });
  });

  const candidates = [...byDate.values()].sort(
    (a, b) => b.score - a.score || b.hits - a.hits || a.date.localeCompare(b.date),
  );

  const best = candidates[0] || null;
  // 애매하다 = 슬래시 표기라 뒤집힐 수 있거나, 1등과 2등을 가를 근거가 없다.
  // 정렬 기준(score → hits)과 같은 기준으로 본다 — 점수만 비교하면 등장 횟수가
  // 4:1 로 갈리는데도 애매하다고 물어보게 된다(교차검토 지적).
  const tie =
    candidates.length > 1 &&
    candidates[0].score === candidates[1].score &&
    candidates[0].hits === candidates[1].hits;
  const ambiguous = Boolean(best?.ambiguous) || tie || candidates.length === 0;

  return { candidates, best, ambiguous };
}

// IATA BCBP(탑승권 바코드) 최소 파싱. M1 로 시작하는 문자열만 다룬다.
// 연중일자(3자리)에 연도가 없지만, 여행 기간이 최대 61일이라 그 창 안에서 날짜가 유일하게 정해진다.
export function parseBcbp(text, trip) {
  const s = String(text || '');
  if (!s.startsWith('M1')) return null;
  // IATA BCBP 필수 항목은 고정 폭이다(Resolution 792).
  //   M1 · 승객명 20 · 전자항공권 표시 1 · PNR 7 · 출발 3 · 도착 3 · 항공사 3 · 편명 5 · 연중일자 3
  // 전자항공권 표시 1자를 빼먹으면 이후가 통째로 한 칸씩 밀린다.
  const m = /^M1.{20}.(.{7})([A-Z]{3})([A-Z]{3})([A-Z0-9 ]{3})([A-Z0-9 ]{5})(\d{3})/.exec(s);
  if (!m) return null;
  const dayOfYear = Number(m[6]);
  if (!(dayOfYear >= 1 && dayOfYear <= 366)) return null;

  const start = trip?.start_date || null;
  const end = trip?.end_date || null;
  let date = null;
  if (start && end) {
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y += 1) {
      const dt = new Date(Date.UTC(y, 0, dayOfYear));
      if (dt.getUTCFullYear() !== y) continue;
      const iso1 = iso(y, dt.getUTCMonth() + 1, dt.getUTCDate());
      if (iso1 >= start && iso1 <= end) {
        date = iso1;
        break;
      }
    }
  }
  return {
    pnr: m[1].trim(),
    from: m[2],
    to: m[3],
    carrier: m[4].trim(),
    flight: `${m[4].trim()}${String(m[5]).trim().replace(/^0+/, '')}`,
    date,
  };
}


/**
 * 탑승권(BCBP)에서 읽은 날짜를 후보 맨 앞에 올린다. 그래도 확인은 받는다(자동 저장 금지).
 * 후보에 이미 있거나 bcbp 가 없으면 입력을 그대로 돌려준다. 입력 객체는 바꾸지 않는다.
 */
export function mergeBcbpCandidate(detection, bcbp) {
  if (!detection || !bcbp?.date) return detection;
  const candidates = detection.candidates || [];
  if (candidates.some((c) => c.date === bcbp.date)) return detection;
  const first = { date: bcbp.date, score: 5, hits: 1, ambiguous: false, evidence: `탑승권 ${bcbp.flight || ''}`.trim() };
  return { ...detection, candidates: [first, ...candidates], best: first, ambiguous: false };
}
