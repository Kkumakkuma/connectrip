import { motion } from 'framer-motion';
import heroBg from '../assets/hero-bg.png';
import { ChevronDown } from 'lucide-react';

const Hero = () => {
    return (
        <section className="relative h-screen w-full overflow-hidden flex-center">
            {/* Background Image with Overlay */}
            <div
                className="absolute inset-0 z-0"
                style={{
                    backgroundImage: `url(${heroBg})`,
                    backgroundPosition: 'center',
                    backgroundSize: 'cover',
                    filter: 'brightness(0.7)'
                }}
            />

            {/* Content */}
            <div className="container relative z-10 text-center text-white">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                >
                    <h1
                        style={{
                            fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
                            marginBottom: '1.5rem',
                            textShadow: '0 4px 10px rgba(0,0,0,0.3)',
                            lineHeight: 1.2
                        }}
                    >
                        여행자와 승무원을 연결하는,<br />
                        특별한 여행 플랫폼
                    </h1>
                    <p
                        style={{
                            fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                            marginBottom: '3rem',
                            opacity: 0.9,
                            maxWidth: '900px',
                            marginLeft: 'auto',
                            marginRight: 'auto'
                        }}
                    >
                        동행 찾기부터 알짜배기 정보, 알뜰한 거래까지 여행자에게 필요한 모든 것이 준비되어 있습니다. <br />
                        현직 승무원들이 전하는 숨겨진 노하우와 함께 당신만의 특별한 여행을 완성해보세요.
                    </p>

                    <div style={{ height: '2rem' }}></div>
                </motion.div>
            </div>

            {/* Scroll Indicator */}
            <motion.div
                className="absolute bottom-10 z-10 text-white"
                animate={{ y: [0, 10, 0] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
            >
                <ChevronDown size={32} />
            </motion.div>
        </section>
    );
};

export default Hero;
