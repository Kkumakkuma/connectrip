// 장소 데이터 출처 표기.
//   · google : 공식 "Google Maps" 로고(public/planner/google-maps-logo.png, 구글 배포 자산 DarkGray 2x).
//              구글 정책 — 구글 지도가 같은 화면에 보이지 않는 곳에서 구글 장소 데이터를 보이면 로고가 필수다.
//              높이 16~19dp, 좌우·위 10dp·아래 5dp 여백을 지킨다.
//   · osm    : ODbL 표기 문구. 구글 지도로 바뀐 뒤에도 추천 명소·예전 검색으로 담긴 OSM 출처 핀이 남으므로 함께 적는다.
// 둘 다 있으면 둘 다 그린다. 아무 출처도 없으면(롱프레스·링크로 담은 핀만) 아무것도 그리지 않는다.
export default function SourceAttribution({ providers, className = '' }) {
  const set = new Set((Array.isArray(providers) ? providers : []).filter((p) => p === 'google' || p === 'osm'));
  if (set.size === 0) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${className}`}>
      {set.has('google') && (
        <span className="inline-flex px-2.5 pb-1.5 pt-2.5">
          <img
            src="/planner/google-maps-logo.png"
            alt="Google Maps"
            width={98}
            height={18}
            className="h-[18px] w-auto"
            loading="lazy"
          />
        </span>
      )}
      {set.has('osm') && <span>장소 정보 © OpenStreetMap 기여자</span>}
    </p>
  );
}
