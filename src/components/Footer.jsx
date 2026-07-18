import { Link } from 'react-router-dom';
import { BUSINESS_INFO } from '../lib/businessInfo';

// 패밀리 사이트(자기 자신 커넥트립 제외). 새 탭으로 이동한다.
const FAMILY_SITES = [
    { name: 'TravelDeal', desc: '항공·호텔 특가 알림', url: 'https://traveldeal-five.vercel.app' },
    { name: '가전딜', desc: '가전 역경매 견적 비교', url: 'https://gajeondeal.vercel.app' },
    { name: 'DiskRescue', desc: '데이터 복구 프로그램', url: 'https://diskrescue.vercel.app' },
];

const Footer = () => {
    return (
        <footer style={{ background: 'var(--text-primary)', color: 'white', padding: '4rem 0 2rem' }}>
            <div className="container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', marginBottom: '3rem' }}>
                    <img
                        src="/footer-logo.png"
                        alt="ConnectTrip"
                        loading="lazy"
                        decoding="async"
                        style={{
                            height: '120px',
                            width: 'auto',
                            objectFit: 'contain',
                            filter: 'brightness(0) invert(1) drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2))'
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
                    </div>
                </div>

                <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.5, letterSpacing: '0.05em', marginBottom: '1.25rem' }}>
                        패밀리 사이트
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem 2rem', justifyContent: 'center' }}>
                        {FAMILY_SITES.map((site) => (
                            <a
                                key={site.name}
                                href={site.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link"
                                style={{ color: 'white', opacity: 0.8, transition: '0.3s', fontSize: '0.9rem', textDecoration: 'none', wordBreak: 'keep-all' }}
                            >
                                <span style={{ fontWeight: 600 }}>{site.name}</span>
                                <span style={{ opacity: 0.65, marginLeft: '0.4rem' }}>{site.desc}</span>
                            </a>
                        ))}
                    </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem', textAlign: 'center', fontSize: '0.9rem', opacity: 0.5 }}>
                    <p style={{ fontSize: '0.75rem', lineHeight: 1.7, marginBottom: '0.75rem', wordBreak: 'keep-all' }}>
                        {[
                            BUSINESS_INFO.상호,
                            `대표자 ${BUSINESS_INFO.대표자}`,
                            `사업자등록번호 ${BUSINESS_INFO.사업자등록번호}`,
                            `통신판매업신고번호 ${BUSINESS_INFO.통신판매업신고번호}`,
                            `소재지 ${BUSINESS_INFO.사업장소재지}`,
                            BUSINESS_INFO.이메일,
                        ].join(' · ')}
                    </p>
                    <p>&copy; {new Date().getFullYear()} ConnectTrip. All rights reserved.</p>
                </div>
            </div>
            <style>{`
        .footer-link:hover {
          opacity: 1 !important;
          text-decoration: underline;
        }
      `}</style>
        </footer>
    );
};

export default Footer;
