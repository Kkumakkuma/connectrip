import SEOHead from '../../components/SEOHead';
import Placeholder from './Placeholder';

// /planner/s/:token — 공유 링크로 여는 읽기 전용 보기. 비로그인도 열 수 있다.
// robots 는 반드시 noindex, nofollow — 토큰 주소가 색인되면 비공개 일정이 검색에 노출된다.
export default function SharedView() {
  return (
    <>
      <SEOHead title="공유받은 여행 일정 - ConnectTrip" robots="noindex, nofollow" />
      <Placeholder title="공유받은 일정" description="링크를 받은 사람만 볼 수 있는 읽기 전용 화면입니다." />
    </>
  );
}
