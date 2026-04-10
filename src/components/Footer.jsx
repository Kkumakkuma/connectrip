import { Facebook, Instagram, Twitter, Mail } from 'lucide-react';

const Footer = () => {
    return (
        <footer style={{ background: 'var(--text-primary)', color: 'white', padding: '4rem 0 2rem' }}>
            <div className="container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', marginBottom: '3rem' }}>
                    <img
                        src="/footer-logo.png"
                        alt="ConnectTrip"
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
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                        <a href="#" style={{ color: 'white', opacity: 0.8, transition: '0.3s' }} className="social-icon">
                            <Instagram size={24} />
                        </a>
                        <a href="#" style={{ color: 'white', opacity: 0.8, transition: '0.3s' }} className="social-icon">
                            <Facebook size={24} />
                        </a>
                        <a href="#" style={{ color: 'white', opacity: 0.8, transition: '0.3s' }} className="social-icon">
                            <Twitter size={24} />
                        </a>
                        <a href="#" style={{ color: 'white', opacity: 0.8, transition: '0.3s' }} className="social-icon">
                            <Mail size={24} />
                        </a>
                    </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem', textAlign: 'center', fontSize: '0.9rem', opacity: 0.5 }}>
                    <p>&copy; {new Date().getFullYear()} ConnectTrip. All rights reserved.</p>
                </div>
            </div>
            <style>{`
        .social-icon:hover {
          opacity: 1 !important;
          transform: translateY(-3px);
        }
      `}</style>
        </footer>
    );
};

export default Footer;
