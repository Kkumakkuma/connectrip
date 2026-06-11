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
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-06-12</p>

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

        <Section title="4. 개인정보의 제3자 제공">
          <p>
            서비스는 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관의 적법한
            요청이 있는 경우는 예외로 합니다.
          </p>
        </Section>

        <Section title="5. 보유 및 파기">
          <p>
            개인정보는 수집·이용 목적이 달성되거나 회원이 탈퇴를 요청한 때 지체 없이 파기합니다. 다만 관계 법령이
            보존을 정한 기록은 해당 기간 동안 보관한 뒤 파기합니다. 전자적 파일은 복구 불가능한 방법으로 삭제합니다.
          </p>
        </Section>

        <Section title="6. 이용자의 권리">
          <p>
            이용자는 언제든지 자신의 개인정보를 열람·정정·삭제·처리정지 요청할 수 있으며, 마이페이지 또는 고객
            문의를 통해 행사할 수 있습니다. 서비스는 관련 요청에 지체 없이 대응합니다.
          </p>
        </Section>

        <Section title="7. 안전성 확보 조치">
          <p>
            서비스는 개인정보의 분실·도난·유출·위변조를 방지하기 위해 전송구간 암호화(HTTPS), 데이터베이스 접근통제,
            접근권한 최소화 등의 조치를 적용합니다.
          </p>
        </Section>

        <Section title="8. 개인정보 보호책임자">
          <p>개인정보 보호책임자: (기재 예정) · 문의: (기재 예정)</p>
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
