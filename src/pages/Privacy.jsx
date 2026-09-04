import { Link } from 'react-router-dom';
import { BUSINESS_INFO } from '../lib/businessInfo';
import SEOHead from '../components/SEOHead';
import { IDENTITY_PG_NAME } from '../lib/identity';

// 개인정보처리방침. 보호책임자 = 회사명 대표 표기(쿠마님 2026-07-20 확정).
// 2026-09-02 개정: 휴대폰 본인확인(PASS/SMS) 수집항목·수탁자(포트원·{IDENTITY_PG_NAME})·차단 회원 해시 보관 추가.
//   가입 화면 ConsentBox 의 요약 문구와 complete_signup_profile 의 policy_version('2026-09-02')을 같이 맞춘다.
// 2026-09-04 추가: 여행 플래너(티켓 파일·장소 검색어·OpenStreetMap 국외이전·기기 로컬 사본 보관기간).
//   플래너는 아직 꺼져 있어(VITE_PLANNER_ENABLED=false) 실제 수집이 시작되기 전 미리 고지하는 항목이다.
//   ⚠ 플래너를 켜는 시점에 '최종 개정일'과 complete_signup_profile 의 policy_version 을 같은 날짜로 함께 올린다.
//     (지금 날짜만 올리면 동의 기록의 버전과 화면 표기가 어긋난다.)
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
        <p className="mt-2 text-sm text-gray-400">최종 개정일: 2026-09-02</p>

        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          ConnectTrip(이하 “서비스”)은 「개인정보 보호법」을 준수하며, 이용자의 개인정보를 서비스 제공 목적 범위
          내에서만 수집·이용합니다. 본 방침은 「개인정보 보호법」 제30조에 따라 공개합니다.
        </p>

        <Section title="1. 수집하는 개인정보 항목">
          <ul className="ml-4 list-disc space-y-1">
            <li><strong className="text-gray-900">회원가입</strong>: 이메일, 비밀번호, 닉네임</li>
            <li><strong className="text-gray-900">휴대폰 본인확인</strong>: 이름, 생년월일, 성별, 휴대폰번호, 이동통신사, 내외국인 여부, 연계정보(CI). 본인확인기관(이동통신사)이 확인한 값을 {IDENTITY_PG_NAME}·포트원을 통해 제공받으며, 연계정보(CI)는 복원할 수 없는 해시값으로만 저장합니다.</li>
            <li><strong className="text-gray-900">주소</strong>: 우편번호, 도로명 주소, 상세 주소(포인트 선물 등 배송 목적)</li>
            <li><strong className="text-gray-900">승무원 회원</strong>: 항공사 이메일, 항공사명(승무원 인증용)</li>
            <li><strong className="text-gray-900">여행 플래너</strong>: 이용자가 올린 티켓 파일(항공권·입장권 등 이미지·PDF)과 그 파일에서 읽어낸 날짜·편명, 장소 검색어</li>
            <li><strong className="text-gray-900">자동 수집</strong>: 접속 기록(서비스 이용·접속 로그)</li>
          </ul>
        </Section>

        <Section title="2. 개인정보의 이용 목적">
          <ul className="ml-4 list-disc space-y-1">
            <li>회원 관리 및 본인 확인(실명 확인, 1인 1계정 확인, 만 14세 미만 가입 제한)</li>
            <li>커뮤니티(동행·정보공유·물품거래·후기 등) 운영</li>
            <li>승무원 칭찬매칭 운영</li>
            <li>여행 일정 작성·공유 및 티켓 보관 기능 제공</li>
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
            <li><strong className="text-gray-900">포트원(주)</strong> — 휴대폰 본인확인 연동(본인확인 요청 중계·결과 전달)</li>
            <li><strong className="text-gray-900">{IDENTITY_PG_NAME}</strong> — 휴대폰 본인확인 서비스(이동통신사 본인확인 대행, PASS 앱·문자 인증)</li>
            <li><strong className="text-gray-900">Solapi</strong> — 인증 문자(SMS) 발송</li>
            <li><strong className="text-gray-900">OpenStreetMap Foundation</strong> — 여행 플래너의 지도 표시·장소 검색(해외)</li>
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
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-3">Resend (Plus Five Five, Inc.)</td>
                  <td className="py-2 pr-3">미국</td>
                  <td className="py-2 pr-3">이메일 주소</td>
                  <td className="py-2">인증·알림 이메일 발송 / 발송 목적 달성 시까지</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">OpenStreetMap Foundation</td>
                  <td className="py-2 pr-3">영국</td>
                  <td className="py-2 pr-3">여행 플래너에서 입력한 장소 검색어, 지도 요청 정보(접속 IP 등)</td>
                  <td className="py-2">지도 표시·장소 검색 결과 제공 / 해당 재단의 로그 보관 정책에 따름</td>
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
          <p>
            여행 플래너에 올린 티켓 파일은 회원이 해당 티켓이나 여행을 삭제하면 저장소의 실제 파일까지 함께
            지우며, 회원탈퇴 시에도 같은 방식으로 삭제합니다. 바로 지워지지 않고 남은 파일은 하루 한 번 도는
            정리 작업에서 삭제합니다. 오프라인으로 보기 위해 이용자 기기에 저장한 사본은 로그아웃하거나
            보관 기간(저장 후 30일, 여행 종료 3일 뒤 중 이른 때)이 지나면 자동으로 지워집니다.
          </p>
          <p>
            본인확인 과정에서 임시로 받은 정보는 가입이 완료되면 즉시, 가입을 마치지 않으면 24시간 안에 파기합니다.
            이용약관 위반으로 이용이 제한된 상태에서 탈퇴한 회원의 경우, 재가입을 통한 제재 회피를 막기 위해
            복원할 수 없는 해시값(휴대폰번호 해시, 연계정보(CI) 해시)만 탈퇴일로부터 5년간 보관한 뒤 파기합니다.
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
          <p>개인정보 보호책임자: {BUSINESS_INFO.대표자}(대표) · 문의: {BUSINESS_INFO.이메일}</p>
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
