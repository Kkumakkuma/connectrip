import NotFound from '../pages/NotFound';

// '@planner' alias 가 VITE_PLANNER_ENABLED 가 아닐 때 가리키는 스텁.
// 이 파일이 붙으면 플래너 소스·향후 지도/PDF 라이브러리가 모듈 그래프에 들어오지 못한다.
// App.jsx 의 삼항 가드가 정상 동작하면 애초에 여기까지 오지 않지만, 혹시 라우트가 살아 있어도
// 사용자에게는 커넥트립의 일반 404 화면만 보이도록 NotFound 를 그대로 렌더한다.
export default function PlannerDisabled() {
  return <NotFound />;
}
