// 여행 일정의 날짜별 선·점 색. 미니맵과 상세 화면의 범례가 같은 값을 써야 해서 여기에 둔다.
// (컴포넌트 파일에서 함께 내보내면 fast refresh 가 깨진다 — react-refresh/only-export-components)
// 커넥트립이 이미 쓰는 계열에서 골랐고, 날짜가 6개를 넘으면 처음부터 다시 돈다.
const DAY_COLORS = ['#2563eb', '#0d9488', '#7c3aed', '#ea580c', '#db2777', '#0891b2'];

export function dayColor(index) {
  const n = Number(index);
  const i = Number.isFinite(n) ? Math.trunc(n) : 0;
  return DAY_COLORS[((i % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];
}

export default dayColor;
