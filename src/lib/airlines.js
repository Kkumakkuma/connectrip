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
