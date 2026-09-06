import { Navigate, useLocation, useParams } from 'react-router-dom';
import { isContinentId } from '../../lib/continents';
import NotFound from '../../pages/NotFound';

// 옛 대륙 경로(/companion/europe 등) → 통합 게시판 ?region= 로. 로그인 검사 바깥에 두고 쿼리도 보존한다.
// 서버(vercel.json) 308 이 먼저 처리하고, 로컬 개발·히스토리 이동에서는 이 컴포넌트가 받는다.
// 모르는 대륙 id 는 게시판으로 흘려보내지 않고 404 를 그대로 보여 준다(잘못된 주소가 정상 화면으로 둔갑하지 않게).
const RegionRedirect = ({ basePath }) => {
    const { regionId } = useParams();
    const location = useLocation();
    if (!isContinentId(regionId)) return <NotFound />;
    const params = new URLSearchParams(location.search);
    params.set('region', regionId);
    return <Navigate to={`${basePath}?${params.toString()}`} replace />;
};

export default RegionRedirect;
