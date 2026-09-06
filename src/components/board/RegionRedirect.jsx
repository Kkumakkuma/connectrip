import { Navigate, useLocation, useParams } from 'react-router-dom';
import { isContinentId } from '../../lib/continents';

// 옛 대륙 경로(/companion/europe 등) → 통합 게시판 ?region= 로. 로그인 검사 바깥에 두고 쿼리도 보존한다.
// 서버(vercel.json) 301 이 먼저 처리하고, 로컬 개발·히스토리 이동에서는 이 컴포넌트가 받는다.
const RegionRedirect = ({ basePath }) => {
    const { regionId } = useParams();
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    if (isContinentId(regionId)) params.set('region', regionId); else params.delete('region');
    const s = params.toString();
    return <Navigate to={`${basePath}${s ? `?${s}` : ''}`} replace />;
};

export default RegionRedirect;
