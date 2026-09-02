import { Link } from 'react-router-dom';
import { POINT_PACKAGES, VOUCHER, REFUND_SUMMARY } from '../lib/products';

// 첫 화면 "유료 서비스 안내" — 결제대행사 심사 요건(메인 화면에서 상품·가격·환불 정보 확인 가능)용.
// 상품 정의는 src/lib/products.js 한 곳에서만 관리한다.
const PaidServices = () => {
  return (
    <section id="paid-services" className="bg-white py-16" aria-labelledby="paid-services-title">
      <div className="container mx-auto px-4 max-w-5xl">
        <h2 id="paid-services-title" className="text-2xl font-bold text-gray-900 text-center">유료 서비스 안내</h2>
        <p className="mt-2 text-center text-sm text-gray-500">
          포인트를 충전해 매칭신청권 구매·장터 결제 등에 사용합니다. 1포인트 = 1원, 결제는 신용카드 등 결제대행사 결제수단으로 진행됩니다.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {POINT_PACKAGES.map((p) => (
            <div key={p.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-center">
              <div className="text-sm font-semibold text-gray-500">{p.name}</div>
              <div className="mt-2 text-2xl font-extrabold text-gray-900">{p.price.toLocaleString()}원</div>
              <div className="mt-1 text-xs text-blue-600 font-semibold">{p.points.toLocaleString()}P 적립</div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{p.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-5 sm:flex sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-purple-700">{VOUCHER.name}</div>
            <p className="mt-1 text-xs leading-relaxed text-purple-900/80">{VOUCHER.desc}</p>
          </div>
          <div className="mt-3 sm:mt-0 text-right">
            <div className="text-2xl font-extrabold text-purple-800">{VOUCHER.pricePoints.toLocaleString()}P</div>
            <div className="text-xs text-purple-700">({VOUCHER.pricePoints.toLocaleString()}원 상당 · 포인트로 결제)</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 p-5">
          <div className="text-sm font-bold text-gray-900">취소·환불</div>
          <ul className="mt-2 ml-4 list-disc space-y-1 text-xs leading-relaxed text-gray-600">
            {REFUND_SUMMARY.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            자세한 내용은{' '}
            <Link to="/points" className="text-blue-600 underline-offset-2 hover:underline">포인트·매칭신청권 안내</Link>
            {' '}와{' '}
            <Link to="/terms#refund" className="text-blue-600 underline-offset-2 hover:underline">이용약관 7조(결제·환불 및 청약철회)</Link>
            를 참고하세요. 구매는 로그인 후 마이페이지에서 할 수 있습니다.
          </p>
        </div>
      </div>
    </section>
  );
};

export default PaidServices;
