// ★ 사업자 등록 후 이 파일의 값만 채우면 푸터·이용약관에 자동 반영된다.
//
// 아래 '(사업자 등록 후 기재)' 부분만 실제 값으로 바꾸면 된다.
// - 상호 / 이메일은 이미 실제 값이라 그대로 두면 된다.
// - 나머지 4개(대표자·사업자등록번호·통신판매업신고번호·사업장소재지)만 채우면 끝.

// 아직 값이 없는 항목을 화면에서 숨기기 위한 표식. 값이 채워지면 자동으로 다시 표시된다.
export const BUSINESS_INFO_PLACEHOLDER = '(사업자 등록 후 기재)';

export function isBusinessValueFilled(value) {
  return Boolean(value) && value !== BUSINESS_INFO_PLACEHOLDER;
}

export const BUSINESS_INFO = {
  상호: '200kgBrothers Company',
  대표자: '박세진',
  사업자등록번호: '552-17-02943',
  통신판매업신고번호: '(사업자 등록 후 기재)',
  사업장소재지: '경기도 수원시 장안구 송원로 20, A동 1608호',
  // 유선전화 = 국내 PG 카드사 심사 요건. 결제(포인트 충전) 라이브 전 채운다.
  유선전화: '(사업자 등록 후 기재)',
  이메일: '200kgBrothers@gmail.com',
};
