import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import SEOHead from './SEOHead';

const regions = [
    {
        id: 'europe',
        name: '유럽',
        icon: '🏰',
        desc: '파리, 런던, 로마 등 유럽 전역 동행 찾기',
        image: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'americas',
        name: '미주',
        icon: '🗽',
        desc: '뉴욕, LA, 캐나다 등 북미/남미 여행 메이트',
        image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'africa',
        name: '아프리카',
        icon: '🦁',
        desc: '이집트, 남아공, 모로코 이색 여행 동행',
        image: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'southeast-asia',
        name: '동남아',
        icon: '🏝️',
        desc: '다낭, 방콕, 발리 등 휴양지 동행 찾기',
        image: 'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'asia',
        name: '아시아',
        icon: '🐅',
        desc: '일본, 중국, 홍콩 등 가까운 아시아 여행',
        image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=800&auto=format&fit=crop'
    },
    {
        id: 'oceania',
        name: '오세아니아',
        icon: '🦘',
        desc: '호주, 뉴질랜드 등 남태평양 모험',
        image: 'https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?q=80&w=800&auto=format&fit=crop'
    },
];

const CompanionBoard = () => {
    const navigate = useNavigate();

    return (
        <>
            <SEOHead title="여행 동행자 모집 - ConnectTrip" description="함께 여행할 동행자를 찾아보세요. 지역별 여행 동행 모집 게시판." />
            <div className="max-w-7xl mx-auto px-4 py-24 pt-32">
                <div className="max-w-4xl mx-auto text-center mb-20 animate-fade-in">
                    <span className="text-blue-600 font-black tracking-widest uppercase mb-4 block">Regional Companion Search</span>
                    <h1 className="text-5xl md:text-6xl font-black text-gray-900 mb-8 leading-tight">여행 동행자 모집</h1>
                    <p className="text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
                        함께 떠날 믿을 수 있는 동행자를 지역별로 선택 보세요.<br />
                        전 세계 여행 전문가와 승무원들이 당신을 기다리고 있습니다.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {regions.map((region) => (
                        <motion.div
                            key={region.id}
                            whileHover={{ y: -10, scale: 1.02 }}
                            onClick={() => navigate(`/companion/${region.id}`)}
                            className="group relative h-[280px] rounded-[2.5rem] overflow-hidden cursor-pointer shadow-xl shadow-gray-200 hover:shadow-2xl transition-shadow"
                        >
                            {/* Background Image */}
                            <img
                                src={region.image}
                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                alt={region.name}
                            />
                            {/* Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                            {/* Content */}
                            <div className="absolute inset-0 p-7 flex flex-col justify-end text-white">
                                <div className="mb-3 text-4xl">{region.icon}</div>
                                <h3 className="text-2xl font-black mb-2">{region.name}</h3>
                                <p className="text-white/80 font-medium leading-relaxed text-sm">
                                    {region.desc}
                                </p>

                                <div className="mt-6 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-4 group-hover:translate-y-0 duration-300">
                                    <span className="text-xs font-bold bg-white/20 backdrop-blur-md px-4 py-2 rounded-full ring-1 ring-white/30">게시판 보러가기 →</span>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </>
    );
};

export default CompanionBoard;
