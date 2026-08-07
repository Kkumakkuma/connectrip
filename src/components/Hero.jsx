import { motion } from 'framer-motion';
import { ChevronDown, Plane } from 'lucide-react';

const Hero = () => {
    // min-h-screen: 짧은 화면(가로모드 등)에서 h-screen 고정 시 잘림 → 내용만큼 늘어나게
    return (
        <section className="relative min-h-screen w-full overflow-hidden flex-center py-24">
            {/* Background Image with Overlay */}
            <div
                className="absolute inset-0 z-0"
                style={{
                    backgroundImage: 'url(/hero-bg.webp)',
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
                    {/* 신뢰 배지 — 첫 화면에서 차별점(승무원 인증 커뮤니티)을 시각화 */}
                    {/* 어두운 반투명 배경 — 밝은 배경 사진 위에서도 흰 글자 대비 확보(WCAG) */}
                    <span className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-black/35 backdrop-blur-sm border border-white/30 text-sm font-semibold">
                        <Plane size={15} aria-hidden="true" /> 현직 승무원 인증 커뮤니티
                    </span>
                    <h1
                        style={{
                            fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
                            marginBottom: '1.5rem',
                            textShadow: '0 4px 10px rgba(0,0,0,0.3)',
                            lineHeight: 1.2
                        }}
                    >
                        여행자부터 승무원까지 모두를 연결하는,<br />
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
                        동행 찾기부터 알짜배기 정보, 알뜰한 거래까지 여행에 필요한 것들을 한곳에 모았습니다. <br />
                        현직 승무원들의 노하우와 함께 나만의 여행을 만들어보세요.
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
