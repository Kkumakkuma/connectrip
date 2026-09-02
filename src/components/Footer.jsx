import { Link } from 'react-router-dom';
import { BUSINESS_INFO, isBusinessValueFilled } from '../lib/businessInfo';

// 패밀리 사이트(자기 자신 커넥트립 제외). 새 탭으로 이동한다.
const FAMILY_SITES = [
    { name: 'TravelDeal', desc: '항공·호텔 특가 알림', url: 'https://traveldeal-five.vercel.app', logo: '/family/traveldeal.jpg', color: '#D97706' },
    { name: '가전딜', desc: '가전 역경매 견적 비교', url: 'https://gajeondeal.vercel.app', logo: '/family/gajeondeal.png', color: '#1A56DB' },
    { name: 'DiskRescue', desc: '데이터 복구 프로그램', url: 'https://diskrescue.vercel.app', logo: '/family/diskrescue.svg', color: '#059669' },
];

const Footer = () => {
    return (
        <footer style={{ background: 'var(--text-primary)', color: 'white', padding: '4rem 0 2rem' }}>
            <div className="container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', marginBottom: '3rem' }}>
                    {/* 흰색을 미리 구워 넣은 440x240 webp(153kB → 8.7kB). 원본 캔버스 비율(1024:558)을 유지해
                        축소했으므로 렌더 크기는 그대로다. 이제 실루엣을 만들 필요가 없어 filter 를 통째로 뺐다 —
                        drop-shadow 도 배경이 #1B262C(거의 검정)라 검정 20% 그림자가 보이지 않아 함께 제거.
                        width/height 는 lazy 로드 전 높이 예약용(CLS 방지)이고 실제 크기는 아래 style 이 정한다. */}
                    <img
                        src="/footer-logo-white.webp"
                        alt="ConnectTrip"
                        width={220}
                        height={120}
                        loading="lazy"
                        decoding="async"
                        style={{
                            height: '120px',
                            width: 'auto',
                            objectFit: 'contain'
                        }}
                    />
                    <p style={{ opacity: 0.7, textAlign: 'center', maxWidth: '500px' }}>
                        우리는 여행을 통해 세상을 더 넓게 보고, 새로운 경험을 선물합니다.<br />
                        당신의 다음 여행을 커넥트립과 함께하세요.
                    </p>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <Link to="/terms" className="footer-link" style={{ color: 'white', opacity: 0.8, transition: '0.3s', fontSize: '0.9rem' }}>
                            이용약관
                        </Link>
                        <Link to="/privacy" className="footer-link" style={{ color: 'white', opacity: 0.8, transition: '0.3s', fontSize: '0.9rem' }}>
                            개인정보처리방침
                        </Link>
                        <Link to="/terms#refund" className="footer-link" style={{ color: 'white', opacity: 0.8, transition: '0.3s', fontSize: '0.9rem' }}>
                            환불 정책
                        </Link>
                        <Link to="/points" className="footer-link" style={{ color: 'white', opacity: 0.8, transition: '0.3s', fontSize: '0.9rem' }}>
                            포인트·상품 안내
                        </Link>
                    </div>
                </div>

                <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, opacity: 0.95, marginBottom: '0.35rem' }}>
                        패밀리 사이트
                    </h3>
                    <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: '1.5rem' }}>
                        함께 운영하는 다른 서비스도 둘러보세요
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.85rem', maxWidth: '760px', margin: '0 auto' }}>
                        {FAMILY_SITES.map((site) => (
                            <a
                                key={site.name}
                                href={site.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="family-card"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.9rem 1rem', borderRadius: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', textDecoration: 'none', color: 'white', transition: '0.2s' }}
                            >
                                <span aria-hidden style={{ display: 'flex', width: '44px', height: '44px', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: '11px', background: '#fff' }}><img src={site.logo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '5px' }} /></span>
                                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                    <span style={{ display: 'block', fontWeight: 700, wordBreak: 'keep-all' }}>{site.name}</span>
                                    <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.7, wordBreak: 'keep-all' }}>{site.desc}</span>
                                </span>
                                <span aria-hidden className="fc-arrow" style={{ flexShrink: 0, fontSize: '1.2rem', fontWeight: 700, color: site.color }}>→</span>
                            </a>
                        ))}
                    </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem', textAlign: 'center', fontSize: '0.9rem', opacity: 0.5 }}>
                    <p style={{ fontSize: '0.75rem', lineHeight: 1.7, marginBottom: '0.75rem', wordBreak: 'keep-all' }}>
                        {[
                            BUSINESS_INFO.상호,
                            isBusinessValueFilled(BUSINESS_INFO.대표자) && `대표자 ${BUSINESS_INFO.대표자}`,
                            isBusinessValueFilled(BUSINESS_INFO.사업자등록번호) && `사업자등록번호 ${BUSINESS_INFO.사업자등록번호}`,
                            isBusinessValueFilled(BUSINESS_INFO.통신판매업신고번호) && `통신판매업신고번호 ${BUSINESS_INFO.통신판매업신고번호}`,
                            isBusinessValueFilled(BUSINESS_INFO.사업장소재지) && `소재지 ${BUSINESS_INFO.사업장소재지}`,
                            isBusinessValueFilled(BUSINESS_INFO.유선전화) && `전화 ${BUSINESS_INFO.유선전화}`,
                            BUSINESS_INFO.이메일,
                        ].filter(Boolean).join(' · ')}
                    </p>
                    <p>&copy; {new Date().getFullYear()} ConnectTrip. All rights reserved.</p>
                </div>
            </div>
            <style>{`
        .footer-link:hover {
          opacity: 1 !important;
          text-decoration: underline;
        }
        .family-card:hover {
          transform: translateY(-3px);
          background: rgba(255,255,255,0.12) !important;
          border-color: rgba(255,255,255,0.28) !important;
        }
        .fc-arrow { display: inline-block; transition: transform 0.2s; }
        .family-card:hover .fc-arrow { transform: translateX(4px); }
      `}</style>
        </footer>
    );
};

export default Footer;
