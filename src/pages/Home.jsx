import Hero from '../components/Hero';
import CategoryBoard from '../components/CategoryBoard';
import SEOHead from '../components/SEOHead';
import PaidServices from '../components/PaidServices';
import JsonLd from '../components/JsonLd';
import { buildProductsJsonLd } from '../lib/products';
import { PAYMENTS_ENABLED } from '../lib/featureFlags';
import { ROUTE_META } from '../lib/routeMeta';

// 결제대행사 심사 요건(2026-09-02): 메인 화면에서 상품·가격·환불 정보가 보여야 한다 → PaidServices + Product JSON-LD.
const PRODUCTS_JSONLD = buildProductsJsonLd('https://www.connecttrip.co.kr');

const Home = ({ activeCategory, setActiveCategory }) => {
    return (
        <>
            {/* 홈 문구는 routeMeta.js 의 '/' 가 단일 출처(프리렌더·SEOHead 기본값과 같은 값) */}
            <SEOHead title={ROUTE_META['/'].title} description={ROUTE_META['/'].description} />
            {PAYMENTS_ENABLED && <JsonLd id="products" data={PRODUCTS_JSONLD} />}
            <Hero />
            <section id="community-boards">
                <CategoryBoard
                    activeCategory={activeCategory}
                    onCategoryChange={setActiveCategory}
                />
            </section>
            {PAYMENTS_ENABLED && <PaidServices />}
        </>
    );
};

export default Home;
