import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';
import { BUSINESS_INFO } from '../lib/businessInfo';

// 포인트·매칭신청권 안내 — 로그인 없이 보이는 유료 서비스(상품) 설명·가격 페이지.
// 결제대행사 계약 심사 요건("상품 등록·상세 설명·가격 정보")용으로 2026-09-02 추가.
// 가격은 코드의 실제 값과 같아야 한다: 충전 1,000~1,000,000원(api/payment/create-order.js MIN/MAX),
// 매칭신청권 30,000P(purchase_voucher). 바꾸면 여기·이용약관 7조·마이페이지를 함께 맞춘다.
function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

const PRODUCTS = [
  {
    name: '포인트 충전',
    price: '1,000원 ~ 1,000,000원 (1회 결제 기준)',
    unit: '1포인트 = 1원',
    desc: '서비스 안에서 쓰는 포인트를 신용카드 등으로 충전합니다. 충전 금액만큼 포인트가 즉시 적립되며, 자주 쓰는 금액은 10,000원·30,000원·50,000원·100,000원으로 바로 고를 수 있습니다.',
  },
  {
    name: '매칭신청권',
    price: '1개 30,000포인트',
    unit: '포인트로만 구매',
    desc: '승무원 칭송매칭을 신청할 때 1회에 1개를 사용하는 이용권입니다. 마이페이지에서 보유 포인트로 구매하며, 사용하지 않은 신청권은 구매일로부터 7일 안에 포인트로 되돌릴 수 있습니다.',
  },
];

const Points = () => {
  return (
    <section className="min-h-screen bg-gray-50 py-24">
      <SEOHead
        title="포인트·매칭신청권 안내 - ConnectTrip"
        description="ConnectTrip 포인트 충전 금액과 매칭신청권 가격, 사용처, 환불 기준 안내."
        path="/points"
      />
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900">포인트·매칭신청권 안내</h1>
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-09-02</p>

        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          ConnectTrip에서 유료로 제공하는 서비스는 아래 두 가지입니다. 결제는 결제대행사를 통해 처리되며, 결제 전에 금액과 내용을
          다시 확인하는 화면이 나옵니다.
        </p>

        <Section title="1. 판매 상품과 가격">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 font-semibold">상품</th>
                  <th className="py-2 font-semibold">가격</th>
                  <th className="py-2 font-semibold">단위</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCTS.map((p) => (
                  <tr key={p.name} className="border-b border-gray-100 align-top">
                    <td className="py-2 font-semibold text-gray-900">{p.name}</td>
                    <td className="py-2">{p.price}</td>
                    <td className="py-2">{p.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {PRODUCTS.map((p) => (
            <p key={p.name}>
              <strong className="text-gray-900">{p.name}</strong>: {p.desc}
            </p>
          ))}
        </Section>

        <Section title="2. 포인트를 쓰는 곳">
          <ul className="ml-4 list-disc space-y-1">
            <li>매칭신청권 구매(1개 30,000포인트)</li>
            <li>장터(회원 간 물품 거래) 대금 결제</li>
            <li>승무원 칭송매칭 선물 등 서비스 안의 유료 기능</li>
          </ul>
          <p>포인트는 서비스 안에서만 사용할 수 있고 현금으로 바꿀 수 없습니다. 회원 탈퇴 시 남은 포인트는 소멸합니다.</p>
        </Section>

        <Section title="3. 결제 수단">
          <p>신용카드·체크카드 등 결제대행사가 제공하는 결제 수단으로 결제합니다. 결제 정보는 결제대행사가 처리하며 ConnectTrip은 카드번호를 보관하지 않습니다.</p>
        </Section>

        <Section title="4. 취소·환불">
          <ul className="ml-4 list-disc space-y-1">
            <li>충전한 포인트를 전혀 쓰지 않았다면 결제일로부터 7일 안에 전액 환불됩니다.</li>
            <li>일부를 썼다면 쓰지 않은 잔여 포인트만 환불되며, 무상으로 받은 포인트는 제외됩니다.</li>
            <li>사용하지 않은 매칭신청권은 구매일로부터 7일 안에 취소하면 포인트로 되돌려 드립니다.</li>
            <li>환불은 결제한 수단으로 처리하고, 접수일부터 영업일 3일 안에 결제대행사에 환불을 요청합니다. 카드사 반영까지 3~7일이 더 걸릴 수 있습니다.</li>
          </ul>
          <p>
            자세한 기준은{' '}
            <Link to="/terms#refund" className="text-blue-600 underline-offset-2 hover:underline">이용약관 7조(결제·환불 및 청약철회)</Link>
            를 참고하세요. 환불 요청은 마이페이지 또는 {BUSINESS_INFO.이메일} 로 접수합니다.
          </p>
        </Section>
      </div>
    </section>
  );
};

export default Points;
