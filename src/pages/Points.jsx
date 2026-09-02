import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';
import JsonLd from '../components/JsonLd';
import { BUSINESS_INFO } from '../lib/businessInfo';
import { POINT_PACKAGES, VOUCHER, REFUND_SUMMARY, buildProductsJsonLd } from '../lib/products';

// 포인트·매칭신청권 안내 — 로그인 없이 보이는 유료 서비스(상품) 설명·가격 페이지.
// 결제대행사 계약 심사 요건("상품 등록·상세 설명·가격 정보")용으로 2026-09-02 추가.
// 상품 정의·가격은 src/lib/products.js 한 곳에서만 관리한다(첫 화면 PaidServices 와 공유).
function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

const PRODUCTS_JSONLD = buildProductsJsonLd('https://www.connecttrip.co.kr');

const Points = () => {
  return (
    <section className="min-h-screen bg-gray-50 py-24">
      <SEOHead
        title="포인트·매칭신청권 안내 - ConnectTrip"
        description="ConnectTrip 포인트 충전 패키지 가격과 매칭신청권 가격, 사용처, 환불 기준 안내."
        path="/points"
      />
      <JsonLd id="products" data={PRODUCTS_JSONLD} />
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900">포인트·매칭신청권 안내</h1>
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-09-02</p>

        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          ConnectTrip에서 유료로 제공하는 서비스는 포인트 충전 패키지와 매칭신청권입니다. 결제는 결제대행사를 통해 처리되며,
          결제 전에 금액과 내용을 다시 확인하는 화면이 나옵니다.
        </p>

        <Section title="1. 포인트 충전 패키지 (1포인트 = 1원)">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 font-semibold">상품명</th>
                  <th className="py-2 font-semibold">결제 금액</th>
                  <th className="py-2 font-semibold">적립 포인트</th>
                </tr>
              </thead>
              <tbody>
                {POINT_PACKAGES.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2 font-semibold text-gray-900">{p.name}</td>
                    <td className="py-2">{p.price.toLocaleString()}원</td>
                    <td className="py-2">{p.points.toLocaleString()}P</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>충전한 포인트는 결제 즉시 적립되고, 매칭신청권 구매·장터 결제 등 서비스 안에서 사용합니다. 포인트는 현금으로 바꿀 수 없으며 회원 탈퇴 시 남은 포인트는 소멸합니다.</p>
        </Section>

        <Section title="2. 매칭신청권">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 font-semibold">상품명</th>
                  <th className="py-2 font-semibold">가격</th>
                  <th className="py-2 font-semibold">결제 방법</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 font-semibold text-gray-900">{VOUCHER.name}</td>
                  <td className="py-2">{VOUCHER.pricePoints.toLocaleString()}P ({VOUCHER.pricePoints.toLocaleString()}원 상당)</td>
                  <td className="py-2">보유 포인트로 결제</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>{VOUCHER.desc} 마이페이지에서 구매하며, 사용하지 않은 신청권은 구매일로부터 7일 안에 포인트로 되돌릴 수 있습니다.</p>
        </Section>

        <Section title="3. 결제 수단">
          <p>신용카드·체크카드 등 결제대행사가 제공하는 결제 수단으로 결제합니다. 결제 정보는 결제대행사가 처리하며 ConnectTrip은 카드번호를 보관하지 않습니다.</p>
        </Section>

        <Section title="4. 취소·환불">
          <ul className="ml-4 list-disc space-y-1">
            {REFUND_SUMMARY.map((line) => <li key={line}>{line}</li>)}
            <li>카드사 반영까지 3~7일이 더 걸릴 수 있습니다.</li>
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
