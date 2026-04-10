import { motion } from 'framer-motion';
import { Plane, Camera, CreditCard, Backpack, Lock } from 'lucide-react';

const tips = [
    {
        icon: <Plane size={32} />,
        title: '저렴한 항공권 예약',
        desc: '출발 3~4개월 전 예약 및 가격 알림 설정을 통해 최저가 항공권을 확보하세요.',
        type: 'traveler',
        tag: '기본 팁'
    },
    {
        icon: <Lock size={32} />,
        title: '비행기 좌석 승급 팁',
        desc: '체크인 마감 직전에 카운터에 문의하면 승급 확률이 올라갑니다. (복장 단정 필수!)',
        type: 'crew',
        tag: '승무원 시크릿'
    },
    {
        icon: <CreditCard size={32} />,
        title: '트래블 월렛 활용',
        desc: '현지 ATM 사용 및 트래블 월렛 카드를 활용하여 수수료를 절약하세요.',
        type: 'traveler',
        tag: '기본 팁'
    },
    {
        icon: <Backpack size={32} />,
        title: '승무원의 짐싸기 노하우',
        desc: '파우치를 활용해 용도별로 분류하고, 신발 안쪽 공간을 양말 수납으로 활용하세요.',
        type: 'crew',
        tag: '승무원 시크릿'
    }
];

const TravelTips = () => {
    return (
        <section id="tips" className="section-padding" style={{ background: 'white' }}>
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <span style={{ color: 'var(--secondary-color)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        Travel Tips
                    </span>
                    <h2 style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>여행자 필수 팁 & 승무원 시크릿</h2>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                        gap: '2rem'
                    }}
                >
                    {tips.map((tip, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            viewport={{ once: true }}
                            style={{
                                padding: '2rem',
                                borderRadius: '1rem',
                                background: tip.type === 'crew' ? '#FFFBE6' : 'var(--bg-light)', // diff background for crew tips
                                textAlign: 'center',
                                border: tip.type === 'crew' ? '1px solid var(--accent-color)' : '1px solid rgba(0,0,0,0.05)',
                                position: 'relative'
                            }}
                        >
                            {tip.type === 'crew' && (
                                <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'var(--accent-color)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                    Crew Only
                                </div>
                            )}

                            <div
                                style={{
                                    width: '70px',
                                    height: '70px',
                                    background: 'white',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 1.5rem',
                                    boxShadow: '0 4px 10px rgba(0,0,0,0.05)',
                                    color: 'var(--primary-color)'
                                }}
                            >
                                {tip.icon}
                            </div>
                            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{tip.title}</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{tip.desc}</p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default TravelTips;
