// 공항 코드(IATA 3자) → IANA 타임존. 캘린더 내보내기에서 항공권 출발 시각을 절대 시각으로 바꿀 때만 쓴다.
//
// 왜 필요한가 (2026-09-27)
//   티켓의 event_time 은 "티켓에 적힌 현지 시각"이고, 항공권이면 출발 공항의 현지 시각이다.
//   여행 타임존(목적지)으로 해석하면 인천 10:00 출발 파리행이 파리 10:00(= 서울 17:00)으로 들어간다.
//   티켓 테이블에는 공항 칸이 없어서 탑승권 바코드(BCBP)나 제목("KE81 ICN→CDG")에서 출발 공항을 읽고,
//   이 표에 있으면 그 공항의 타임존을 쓴다. 표에 없으면 호출부가 여행 타임존으로 되돌아간다.
//
// 표는 한국 출발 공항 전부 + 한국인이 많이 가는 노선의 주요 공항만 둔다. 공항 타임존 DB 전체(수 MB)는 싣지 않는다.
// 같은 나라라도 타임존이 갈리는 곳(미국·호주·인도네시아·말레이시아 사바)은 공항별로 적었다.

export const AIRPORT_ZONES = {
  'Asia/Seoul': ['ICN', 'GMP', 'PUS', 'CJU', 'TAE', 'CJJ', 'MWX', 'KWJ', 'RSU', 'USN', 'YNY', 'KPO', 'WJU', 'HIN', 'KUV'],
  'Asia/Tokyo': [
    'NRT', 'HND', 'KIX', 'ITM', 'UKB', 'NGO', 'FUK', 'CTS', 'OKA', 'KOJ', 'KMJ', 'KMI', 'HIJ', 'SDJ', 'KIJ',
    'TAK', 'MYJ', 'OIT', 'NGS', 'KMQ', 'AOJ', 'AKJ', 'OKJ', 'FSZ', 'IBR', 'ISG', 'MMY', 'TOY', 'HKD', 'AXT',
  ],
  'Asia/Shanghai': [
    'PEK', 'PKX', 'PVG', 'SHA', 'CAN', 'SZX', 'TAO', 'DLC', 'SHE', 'YNJ', 'CKG', 'CTU', 'TFU', 'XIY', 'HGH',
    'NKG', 'TSN', 'WEH', 'YNT', 'HRB', 'KMG', 'SYX', 'XMN', 'CGO', 'WUH', 'CSX',
  ],
  'Asia/Hong_Kong': ['HKG'],
  'Asia/Macau': ['MFM'],
  'Asia/Taipei': ['TPE', 'TSA', 'KHH', 'RMQ'],
  'Asia/Bangkok': ['BKK', 'DMK', 'HKT', 'CNX', 'USM', 'KBV'],
  'Asia/Ho_Chi_Minh': ['SGN', 'HAN', 'DAD', 'CXR', 'PQC', 'HPH', 'DLI'],
  'Asia/Manila': ['MNL', 'CEB', 'CRK', 'KLO', 'MPH', 'TAG', 'PPS'],
  'Asia/Singapore': ['SIN'],
  'Asia/Kuala_Lumpur': ['KUL', 'PEN', 'LGK'],
  'Asia/Kuching': ['BKI', 'KCH'],
  'Asia/Jakarta': ['CGK'],
  'Asia/Makassar': ['DPS'],
  'Asia/Vientiane': ['VTE'],
  'Asia/Phnom_Penh': ['PNH', 'SAI'],
  'Asia/Ulaanbaatar': ['UBN'],
  'Asia/Kolkata': ['DEL', 'BOM'],
  'Asia/Kathmandu': ['KTM'],
  'Asia/Dubai': ['DXB', 'AUH'],
  'Asia/Qatar': ['DOH'],
  'Asia/Vladivostok': ['VVO'],
  'Europe/Istanbul': ['IST'],
  'Pacific/Guam': ['GUM'],
  'Pacific/Saipan': ['SPN'],
  'Pacific/Honolulu': ['HNL'],
  'Pacific/Auckland': ['AKL'],
  'Australia/Sydney': ['SYD'],
  'Australia/Melbourne': ['MEL'],
  'Australia/Brisbane': ['BNE'],
  'Australia/Perth': ['PER'],
  'America/Los_Angeles': ['LAX', 'SFO', 'SEA', 'LAS'],
  'America/Denver': ['DEN'],
  'America/Chicago': ['ORD', 'DFW'],
  'America/New_York': ['JFK', 'EWR', 'BOS', 'IAD', 'ATL'],
  'America/Anchorage': ['ANC'],
  'America/Vancouver': ['YVR'],
  'America/Toronto': ['YYZ'],
  'Europe/London': ['LHR', 'LGW'],
  'Europe/Paris': ['CDG', 'ORY'],
  'Europe/Berlin': ['FRA', 'MUC'],
  'Europe/Rome': ['FCO', 'MXP'],
  'Europe/Madrid': ['MAD', 'BCN'],
  'Europe/Amsterdam': ['AMS'],
  'Europe/Zurich': ['ZRH'],
  'Europe/Vienna': ['VIE'],
  'Europe/Prague': ['PRG'],
  'Europe/Budapest': ['BUD'],
  'Europe/Warsaw': ['WAW'],
  'Europe/Helsinki': ['HEL'],
  'Europe/Copenhagen': ['CPH'],
  'Europe/Lisbon': ['LIS'],
  'Europe/Athens': ['ATH'],
  'Europe/Zagreb': ['ZAG'],
};

const BY_CODE = new Map();
Object.entries(AIRPORT_ZONES).forEach(([zone, codes]) => {
  codes.forEach((code) => BY_CODE.set(code, zone));
});

/** 'icn' · 'ICN' → 'Asia/Seoul'. 표에 없거나 형식이 아니면 null. */
export function zoneForAirport(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(key)) return null;
  return BY_CODE.get(key) || null;
}

/** 표에 있는 공항 수(테스트용). */
export function airportCount() {
  return BY_CODE.size;
}
