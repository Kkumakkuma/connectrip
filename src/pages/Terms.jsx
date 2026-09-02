import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';
import { BUSINESS_INFO } from '../lib/businessInfo';

// 이용약관. ⚠️ 사업자 정보(상호·대표자·사업자등록번호·통신판매업신고번호·소재지·연락처)는
// src/lib/businessInfo.js 한 곳에서만 관리한다. 값이 바뀌면 여기와 푸터에 자동 반영된다.
const OPERATOR_INFO = [
  ['서비스명', 'ConnectTrip (커넥트립)'],
  ['상호', BUSINESS_INFO.상호],
  ['대표자', BUSINESS_INFO.대표자],
  ['사업자등록번호', BUSINESS_INFO.사업자등록번호],
  ['통신판매업신고번호', BUSINESS_INFO.통신판매업신고번호],
  ['사업장소재지', BUSINESS_INFO.사업장소재지],
  ['연락처(고객문의)', BUSINESS_INFO.이메일],
  ['호스팅 제공자', 'Vercel Inc.'],
];

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

const Terms = () => {
  return (
    <section className="min-h-screen bg-gray-50 py-24">
      <SEOHead
        title="이용약관 - ConnectTrip"
        description="ConnectTrip 이용약관 — 서비스 성격, 회원의 의무, 금지행위, 포인트, 면책에 관한 안내."
        path="/terms"
      />
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900">이용약관</h1>
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-09-02</p>

        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          본 약관은 ConnectTrip(이하 “서비스”)이 제공하는 여행 커뮤니티 서비스의 이용 조건과
          회원·운영자의 권리·의무를 정합니다. 회원으로 가입하면 본 약관에 동의한 것으로 봅니다.
        </p>

        <Section title="1. 운영자 정보">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {OPERATOR_INFO.map(([k, v]) => (
                  <tr key={k} className="border-b border-gray-100 last:border-b-0">
                    <th className="w-44 bg-gray-50 px-4 py-2.5 text-left font-medium text-gray-700">{k}</th>
                    <td className="px-4 py-2.5 text-gray-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="2. 서비스의 성격">
          <p>
            ConnectTrip은 여행자와 승무원이 동행 모집, 여행 정보·후기 공유, 물품 거래·나눔, 승무원 칭송 등을
            나누는 <strong className="text-gray-900">커뮤니티 플랫폼</strong>입니다. 서비스는 통신판매중개자가 아니며,
            회원 간 물품 거래·나눔·동행 등은 <strong className="text-gray-900">회원이 직접 진행하는 거래</strong>입니다.
          </p>
          <p>
            서비스는 회원 간 거래·동행의 당사자가 아니며, 회원이 게시한 정보의 정확성이나 거래·만남의 결과에 대해
            책임을 지지 않습니다. 다만 운영자의 고의·중과실로 인한 손해 등 관련 법령상 책임이 인정되는 경우는
            그러하지 아니합니다.
          </p>
        </Section>

        <Section title="3. 회원가입 및 본인확인">
          <p>
            서비스는 오프라인 만남이 동반될 수 있는 특성상 안전을 위해 가입 시 이메일 인증과 이동통신사 휴대폰
            본인확인(PASS 앱 또는 문자 인증)을 요구하며, 본인확인으로 확인된 이름·생년월일·휴대폰번호로 가입합니다.
            한 사람은 하나의 계정만 만들 수 있습니다. 회원은 가입 시 정확한 정보를 제공해야 하며, 타인의 명의나
            정보를 도용해서는 안 됩니다.
          </p>
        </Section>

        <Section title="4. 회원의 금지행위">
          <p>회원은 다음 행위를 해서는 안 되며, 위반 시 게시물 삭제·이용 제한·계정 정지 등의 조치가 이루어질 수 있습니다.</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>타인 사칭, 본인확인 정보·신분 위조</li>
            <li>직거래 사기, 금전 편취, 허위 매물·정보 게시</li>
            <li>불법·음란·폭력·혐오 표현, 타인에 대한 명예훼손·모욕·스토킹</li>
            <li>무단 광고·스팸, 서비스 운영을 방해하는 행위</li>
            <li>관련 법령 또는 본 약관을 위반하는 일체의 행위</li>
          </ul>
        </Section>

        <Section title="5. 회원 간 거래·동행 시 유의">
          <p>
            물품 거래·나눔·동행은 회원 간 직접 거래·약속이므로, 회원은 거래 상대와 거래 조건을 신중히 확인할 책임이
            있습니다. 사기·범죄가 의심되는 경우 즉시 신고 기능을 이용하시고, 필요한 경우 수사기관에 신고하시기 바랍니다.
            오프라인 만남 시 공공장소 이용 등 안전 수칙을 지켜 주시기 바랍니다.
          </p>
        </Section>

        <Section title="6. 포인트">
          <p>
            서비스 이용·활동에 따라 제공되는 포인트는 서비스 내에서만 사용할 수 있는 혜택이며,
            <strong className="text-gray-900"> 현금으로 환급되지 않습니다.</strong> 부정한 방법으로 적립된 포인트는 회수될 수 있습니다.
          </p>
        </Section>

        <Section title="7. 게시물의 관리">
          <p>
            회원이 작성한 게시물의 권리와 책임은 작성자에게 있습니다. 운영자는 본 약관 또는 법령을 위반하거나 신고된
            게시물에 대해 사전 통지 없이 삭제·이동·노출 제한을 할 수 있습니다.
          </p>
        </Section>

        <Section title="8. 면책">
          <p>
            서비스는 천재지변, 회원 또는 제3자의 귀책 사유로 인한 손해에 대해 책임을 지지 않습니다. 또한 회원 간
            거래·동행·만남의 과정과 결과에 대해 보증하지 않으며, 그로 인해 발생한 분쟁은 당사자 간에 해결하는 것을
            원칙으로 합니다. 운영자는 분쟁 발생 시 사실관계 확인에 협조할 수 있습니다.
          </p>
        </Section>

        <Section title="9. 약관의 변경">
          <p>
            운영자는 관련 법령을 위반하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 서비스 내 공지를 통해
            적용일자와 변경 내용을 안내합니다.
          </p>
        </Section>

        <p className="mt-10 text-xs text-gray-400">
          개인정보의 수집·이용에 관한 사항은{' '}
          <Link to="/privacy" className="text-blue-600 underline-offset-2 hover:underline">개인정보처리방침</Link>
          을 함께 참고하세요.
        </p>
      </div>
    </section>
  );
};

export default Terms;
