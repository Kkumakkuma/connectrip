import Hero from '../components/Hero';
import CategoryBoard from '../components/CategoryBoard';
import SEOHead from '../components/SEOHead';

const Home = ({ activeCategory, setActiveCategory }) => {
    return (
        <>
            <SEOHead
                title="ConnectTrip - 여행자와 승무원을 연결하는 여행 플랫폼"
                description="동행 찾기, 여행 Q&A, 물품거래, 승무원 추천까지. 여행자와 승무원을 연결하는 여행 정보 공유 플랫폼."
            />
            <Hero />
            <section id="community-boards">
                <CategoryBoard
                    activeCategory={activeCategory}
                    onCategoryChange={setActiveCategory}
                />
            </section>
        </>
    );
};

export default Home;
