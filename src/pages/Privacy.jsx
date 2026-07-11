import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';

// 개인정보처리방침. ⚠️ "(기재 예정)" placeholder(보호책임자 등)는 쿠마님이 실제 정보로 교체.
function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

const Privacy = () => {
  return (
    <section className="min-h-screen bg-gray-50 py-24">
      <SEOHead
        title="개인정보처리방침 - ConnectTrip"
        description="ConnectTrip이 수집하는 개인정보 항목, 이용 목적, 처리위탁, 보관·파기, 이용자 권리에 대한 안내."
        path="/privacy"
      />
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900">개인정보처리방침</h1>
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-07-11</p>

        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          ConnectTrip(이하 “서비스”)은 「개인정보 보호법」을 준수하며, 이용자의 개인정보를 서비스 제공 목적 범위
          내에서만 수집·이용합니다. 본 방침은 「개인정보 보호법」 제30조에 따라 공개합니다.
        </p>

        <Section title="1. 수집하는 개인정보 항목">
          <ul className="ml-4 list-disc space-y-1">
            <li><strong className="text-gray-900">회원가입·본인확인</strong>: 이메일, 비밀번호, 이름, 닉네임, 휴대폰번호(SMS 인증)</li>
            <li><strong className="text-gray-900">주소</strong>: 우편번호, 도로명 주소, 상세 주소(포인트 선물 등 배송 목적)</li>
            <li><strong className="text-gray-900">승무원 회원</strong>: 항공사 이메일, 항공사명(승무원 인증용)</li>
            <li><strong className="text-gray-900">자동 수집</strong>: 접속 기록(서비스 이용·접속 로그)</li>
          </ul>
        </Section>

        <Section title="2. 개인정보의 이용 목적">
          <ul className="ml-4 list-disc space-y-1">
            <li>회원 관리 및 본인 확인</li>
            <li>커뮤니티(동행·정보공유·물품거래·후기 등) 운영</li>
            <li>승무원 칭송매칭 운영</li>
            <li>포인트 적립·이용 등 운영</li>
            <li>부정 이용 방지, 분쟁 조정, 고객 문의 대응</li>
          </ul>
        </Section>

        <Section title="3. 개인정보 처리위탁">
          <p>서비스는 안정적인 운영을 위해 아래 업무를 외부에 위탁하며, 위탁 시 개인정보가 안전하게 관리되도록 감독합니다.</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong className="text-gray-900">Supabase Inc.</strong> — 데이터베이스·회원 인증(클라우드 인프라, 해외)</li>
            <li><strong className="text-gray-900">Vercel Inc.</strong> — 웹/앱 호스팅(해외)</li>
            <li><strong className="text-gray-900">Resend</strong> — 인증·알림 이메일 발송</li>
            <li><strong className="text-gray-900">Solapi</strong> — 휴대폰 본인확인 문자(SMS) 발송</li>
          </ul>
          <p className="text-xs text-gray-400">위탁 업무 내용이나 수탁자가 변경되는 경우 본 방침을 통해 고지합니다.</p>
        </Section>

        <Section title="4. 개인정보의 국외 이전">
          <p>
            서비스는 안정적인 인프라 운영을 위해 아래와 같이 개인정보 처리를 국외에 위탁(이전)하며,
            그 내용을 본 개인정보처리방침을 통해 이용자에게 미리 공개(고지)합니다. 국외 이전을 원하지 않는
            이용자는 회원가입을 진행하지 않거나, 가입 후에는 회원탈퇴를 통해 처리 중단을 요청할 수 있습니다.
            다만 서비스가 국외 클라우드 인프라를 통해 제공되므로, 국외 이전 없이는 서비스 이용이 제한됩니다.
          </p>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[520px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-3 font-semibold">이전받는 자</th>
                  <th className="py-2 pr-3 font-semibold">이전 국가</th>
                  <th className="py-2 pr-3 font-semibold">이전 항목</th>
                  <th className="py-2 font-semibold">이용목적·보유기간</th>
                </tr>
              </thead>
              <tbody className="align-top text-gray-600">
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-3">Supabase Inc.</td>
                  <td className="py-2 pr-3">미국</td>
                  <td className="py-2 pr-3">회원가입·이용 과정에서 수집한 개인정보 전체(계정·프로필·게시물 등)</td>
                  <td className="py-2">데이터베이스·회원 인증 처리 / 회원 탈퇴 또는 위탁계약 종료 시까지</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-3">Vercel Inc.</td>
                  <td className="py-2 pr-3">미국</td>
                  <td className="py-2 pr-3">서비스 접속·이용 과정의 요청 정보(접속기록 등)</td>
                  <td className="py-2">웹/앱 호스팅·전송 / 위탁계약 종료 시까지</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Resend (Plus Five Five, Inc.)</td>
                  <td className="py-2 pr-3">미국</td>
                  <td className="py-2 pr-3">이메일 주소</td>
                  <td className="py-2">인증·알림 이메일 발송 / 발송 목적 달성 시까지</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            이전 일시 및 방법: 서비스 이용 시점에 정보통신망(HTTPS 암호화 전송)을 통해 수시로 이전됩니다.
            휴대폰 문자(SMS) 인증은 국내 사업자(Solapi)를 통해 처리되어 국외로 이전되지 않습니다.
          </p>
        </Section>

        <Section title="5. 개인정보의 제3자 제공">
          <p>
            서비스는 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관의 적법한
            요청이 있는 경우는 예외로 합니다.
          </p>
        </Section>

        <Section title="6. 보유 및 파기">
          <p>
            개인정보는 수집·이용 목적이 달성되거나 회원이 탈퇴를 요청한 때 지체 없이 파기합니다. 회원탈퇴는
            마이페이지에서 직접 신청할 수 있으며, 탈퇴 시 계정·프로필 등 회원을 식별할 수 있는 개인정보를 파기합니다.
            다만 다른 이용자와 주고받은 쪽지·매칭 등 상대방의 서비스 이용기록에 포함된 내용은 상대방의 기록 보호를
            위해 삭제하지 않고, 탈퇴 회원을 식별할 수 없도록 익명 처리(‘탈퇴한 사용자’로 표시)합니다.
          </p>
          <p>
            전자적 파일 형태의 개인정보는 재생이 불가능하도록 삭제합니다. 데이터베이스·호스팅 등 클라우드 인프라에
            자동 생성되는 백업본에 남는 개인정보는 각 백업의 보관주기가 지나면 순차적으로 삭제됩니다.
          </p>
          <p>
            다만 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관계 법령이 보존을 정한 결제·거래 기록은 해당
            법정 보존기간 동안 다른 개인정보와 분리하여 별도로 보관한 뒤 파기합니다.
          </p>
        </Section>

        <Section title="7. 이용자의 권리">
          <p>
            이용자는 언제든지 자신의 개인정보를 열람·정정·삭제·처리정지 요청할 수 있으며, 마이페이지 또는 고객
            문의를 통해 행사할 수 있습니다. 서비스는 관련 요청에 지체 없이 대응합니다.
          </p>
        </Section>

        <Section title="8. 안전성 확보 조치">
          <p>
            서비스는 개인정보의 분실·도난·유출·위변조를 방지하기 위해 전송구간 암호화(HTTPS), 데이터베이스 접근통제,
            접근권한 최소화 등의 조치를 적용합니다.
          </p>
        </Section>

        <Section title="9. 개인정보 보호책임자">
          <p>개인정보 보호책임자: (기재 예정) · 문의: goopysss0829@gmail.com</p>
          <p className="text-xs text-gray-400">
            개인정보 침해에 대한 신고·상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118)에서도 받을 수 있습니다.
          </p>
        </Section>

        <p className="mt-10 text-xs text-gray-400">
          서비스 이용에 관한 사항은{' '}
          <Link to="/terms" className="text-blue-600 underline-offset-2 hover:underline">이용약관</Link>
          을 함께 참고하세요.
        </p>
      </div>
    </section>
  );
};

export default Privacy;
