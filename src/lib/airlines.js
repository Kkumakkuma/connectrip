// 한국 항공사 이메일 도메인 목록
export const AIRLINE_DOMAINS = {
  'koreanair.com': { name: '대한항공', nameEn: 'Korean Air', logo: '🇰🇷', logoSrc: '/airlines/koreanair.png' },
  'flyasiana.com': { name: '아시아나항공', nameEn: 'Asiana Airlines', logo: '✈️', logoSrc: '/airlines/flyasiana.png' },
  'jinair.com': { name: '진에어', nameEn: 'Jin Air', logo: '🟢', logoSrc: '/airlines/jinair.png' },
  'airbusan.com': { name: '에어부산', nameEn: 'Air Busan', logo: '🔵', logoSrc: '/airlines/airbusan.png' },
  'flyairseoul.com': { name: '에어서울', nameEn: 'Air Seoul', logo: '🟡', logoSrc: '/airlines/flyairseoul.png' },
  'airzetacargo.com': { name: '에어제타', nameEn: 'AirZeta', logo: '✈️', logoSrc: '/airlines/airzeta.png' }, // 2025-08 에어인천에서 사명 변경(아시아나 화물 통합)
  'trinityairways.com': { name: '트리니티항공', nameEn: 'Trinity Airways', logo: '🔻', logoSrc: '/airlines/trinityairways.png' }, // 2026-09 티웨이항공에서 사명 변경
  'jejuair.net': { name: '제주항공', nameEn: 'Jeju Air', logo: '🍊', logoSrc: '/airlines/jejuair.png' },
  'airpremia.com': { name: '에어프레미아', nameEn: 'Air Premia', logo: '💜', logoSrc: '/airlines/airpremia.png' },
  'aerok.com': { name: '에어로케이', nameEn: 'Aero K', logo: '🅰️', logoSrc: '/airlines/aerok.png' },
  'flyparata.com': { name: '파라타항공', nameEn: 'Parata Air', logo: '🛫', logoSrc: '/airlines/flyparata.png' },
};

// 허용된 도메인 목록
export const ALLOWED_DOMAINS = Object.keys(AIRLINE_DOMAINS);

// 이메일에서 도메인 추출
export function getEmailDomain(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

// 항공사 이메일인지 확인
export function isAirlineEmail(email) {
  const domain = getEmailDomain(email);
  return domain ? ALLOWED_DOMAINS.includes(domain) : false;
}

// 항공사 정보 가져오기
export function getAirlineInfo(email) {
  const domain = getEmailDomain(email);
  return domain ? AIRLINE_DOMAINS[domain] || null : null;
}

// 항공사 목록 (UI 표시용)
export function getAirlineList() {
  return Object.entries(AIRLINE_DOMAINS).map(([domain, info]) => ({
    domain,
    ...info,
    example: `name@${domain}`,
  }));
}

// 목록에 없는 항공사 추가 요청 (2026-09-17, 쿠마님 9892).
// 외항사 직원 메일 도메인을 공식 출처로 확인하지 못해 추측으로 넣을 수 없다 — 수요를 먼저 받고
// 쿠마님이 확인한 뒤 위 AIRLINE_DOMAINS 와 DB airline_domains 에 넣는다.
// 가입 전 화면에서 부르므로 anon 으로 INSERT 한다(RLS 가 pending 상태만 허용).
export async function requestAirline({ airlineName, email, note } = {}) {
  const { supabase } = await import('./supabase');
  const mail = String(email || '').trim().toLowerCase();
  const domain = getEmailDomain(mail);
  const name = String(airlineName || '').trim();
  if (!name) return { ok: false, reason: '항공사 이름을 입력해주세요.' };
  if (!domain) return { ok: false, reason: '회사 이메일 주소를 정확히 입력해주세요.' };
  if (ALLOWED_DOMAINS.includes(domain)) return { ok: false, reason: '이미 인증할 수 있는 항공사입니다. 인증번호를 받아 진행해주세요.' };

  const { error } = await supabase.from('airline_requests').insert({
    airline_name: name.slice(0, 80),
    email: mail.slice(0, 100),
    domain: domain.slice(0, 80),
    note: note ? String(note).trim().slice(0, 300) : null,
  });
  // 같은 메일·도메인으로 이미 넣었으면 성공으로 본다(중복 유니크 위반) — 사용자에게는 같은 결과다
  if (error && error.code !== '23505') {
    console.error('항공사 추가 요청 실패:', error);
    return { ok: false, reason: '요청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
  return { ok: true };
}
