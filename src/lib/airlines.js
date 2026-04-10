// 한국 항공사 이메일 도메인 목록
export const AIRLINE_DOMAINS = {
  'koreanair.com': { name: '대한항공', nameEn: 'Korean Air', logo: '🇰🇷' },
  'flyasiana.com': { name: '아시아나항공', nameEn: 'Asiana Airlines', logo: '✈️' },
  'jinair.com': { name: '진에어', nameEn: 'Jin Air', logo: '🟢' },
  'airbusan.com': { name: '에어부산', nameEn: 'Air Busan', logo: '🔵' },
  'flyairseoul.com': { name: '에어서울', nameEn: 'Air Seoul', logo: '🟡' },
  'air-incheon.com': { name: '에어인천', nameEn: 'Air Incheon', logo: '✈️' },
  'twayair.com': { name: '티웨이항공', nameEn: "T'way Air", logo: '🔴' },
  'jejuair.net': { name: '제주항공', nameEn: 'Jeju Air', logo: '🍊' },
  'airpremia.com': { name: '에어프레미아', nameEn: 'Air Premia', logo: '💜' },
  'aerok.com': { name: '에어로케이', nameEn: 'Aero K', logo: '🅰️' },
  'flyparata.com': { name: '파라타항공', nameEn: 'Parata Air', logo: '🛫' },
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
