import Hero from '../components/Hero';
import CategoryBoard from '../components/CategoryBoard';
import SEOHead from '../components/SEOHead';
import PaidServices from '../components/PaidServices';
import JsonLd from '../components/JsonLd';
import { buildProductsJsonLd } from '../lib/products';

// 결제대행사 심사 요건(2026-09-02): 메인 화면에서 상품·가격·환불 정보가 보여야 한다 → PaidServices + Product JSON-LD.
const PRODUCTS_JSONLD = buildProductsJsonLd('https://www.connecttrip.co.kr');

const Home = ({ activeCategory, setActiveCategory }) => {
    return (
        <>
            <SEOHead
                title="ConnectTrip - 여행자부터 승무원까지 모두를 연결하는 여행 플랫폼"
                description="동행 찾기, 여행 Q&A, 물품거래, 승무원 추천까지. 여행자부터 승무원까지 모두를 연결하는 여행 정보 공유 플랫폼."
            />
            <JsonLd id="products" data={PRODUCTS_JSONLD} />
            <Hero />
            <section id="community-boards">
                <CategoryBoard
                    activeCategory={activeCategory}
                    onCategoryChange={setActiveCategory}
                />
            </section>
            <PaidServices />
        </>
    );
};

export default Home;
