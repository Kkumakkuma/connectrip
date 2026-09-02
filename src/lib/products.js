// 유료 서비스(상품) 정의 — 결제대행사 심사 요건: 비실물 서비스는 "상품 1개 이상 + 상세정보 + 결제금액 + 환불정보".
// 금액을 임의로 입력하는 형태는 카드사 입점이 어렵다고 포트원이 안내하므로(help.portone.io/content/requirements),
// 고정 금액 패키지로 상품을 정의한다. 첫 화면(PaidServices)·/points·JSON-LD 가 전부 이 파일을 쓴다.
// 금액은 결제 코드(api/payment/create-order.js 의 1,000~1,000,000원 범위, 마이페이지 프리셋)와 맞춘다.

export const POINT_PACKAGES = [10000, 30000, 50000, 100000].map((price) => ({
  id: `points-${price}`,
  name: `포인트 ${price.toLocaleString()}P`,
  price,                      // 원(KRW)
  points: price,              // 1포인트 = 1원
  desc: `${price.toLocaleString()}포인트가 즉시 적립됩니다. 매칭신청권 구매, 장터 결제 등 서비스 안에서 사용합니다.`,
}));

export const VOUCHER = {
  id: 'voucher-1',
  name: '매칭신청권 1개',
  pricePoints: 30000,         // 포인트로 결제(1포인트 = 1원 → 30,000원 상당)
  desc: '승무원 칭송매칭을 신청할 때 1회에 1개를 사용하는 이용권입니다. 보유 포인트로 구매합니다.',
};

export const REFUND_SUMMARY = [
  '충전한 포인트를 전혀 쓰지 않았다면 결제일로부터 7일 안에 전액 환불됩니다.',
  '일부를 썼다면 쓰지 않은 잔여 포인트만 환불되며, 무상으로 받은 포인트는 제외됩니다.',
  '사용하지 않은 매칭신청권은 구매일로부터 7일 안에 취소하면 포인트로 되돌려 드립니다.',
  '환불은 결제한 수단으로 처리하고, 접수일부터 영업일 3일 안에 결제대행사에 환불을 요청합니다.',
];

// schema.org Product/Offer — 검색엔진·심사 크롤러가 상품·가격을 읽을 수 있게 한다.
export function buildProductsJsonLd(baseUrl) {
  const pageUrl = `${baseUrl}/points`;
  const products = [
    ...POINT_PACKAGES.map((p) => ({
      '@type': 'Product',
      name: `ConnectTrip ${p.name}`,
      description: p.desc,
      sku: p.id,
      brand: { '@type': 'Brand', name: 'ConnectTrip' },
      offers: { '@type': 'Offer', priceCurrency: 'KRW', price: String(p.price), availability: 'https://schema.org/InStock', url: pageUrl },
    })),
    {
      '@type': 'Product',
      name: `ConnectTrip ${VOUCHER.name}`,
      description: VOUCHER.desc,
      sku: VOUCHER.id,
      brand: { '@type': 'Brand', name: 'ConnectTrip' },
      offers: { '@type': 'Offer', priceCurrency: 'KRW', price: String(VOUCHER.pricePoints), availability: 'https://schema.org/InStock', url: pageUrl },
    },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'ConnectTrip 유료 서비스',
    itemListElement: products.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
}
