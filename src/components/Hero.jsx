import { motion } from 'framer-motion';
import { Plane } from 'lucide-react';

// 첫 화면 히어로(2026-09-07 에어비앤비 톤): 사진 위 큰 제목 하나, 여백을 넓게. 문구는 기존 그대로.
const Hero = () => (
    <section className="relative w-full overflow-hidden min-h-[70vh] sm:min-h-[76vh] flex items-center pt-24 pb-16">
        <div
            className="absolute inset-0 z-0"
            style={{ backgroundImage: 'url(/hero-bg.webp)', backgroundPosition: 'center', backgroundSize: 'cover', filter: 'brightness(0.62)' }}
        />
        <div className="max-w-content mx-auto px-4 sm:px-6 relative z-10 text-white w-full">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }} className="max-w-3xl">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-5 rounded-full bg-white/15 backdrop-blur-sm border border-white/30 text-[13px] font-semibold">
                    <Plane size={14} aria-hidden="true" /> 현직 승무원 인증 커뮤니티
                </span>
                <h1 className="text-[34px] sm:text-[48px] lg:text-[56px] font-extrabold tracking-[-0.03em] leading-[1.15] mb-5" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
                    여행자부터 승무원까지 모두를 연결하는,<br />특별한 여행 플랫폼
                </h1>
                <p className="text-[15px] sm:text-[18px] text-white/90 leading-relaxed max-w-2xl">
                    동행 찾기부터 알짜배기 정보, 알뜰한 거래까지 여행에 필요한 것들을 한곳에 모았습니다.
                    현직 승무원들의 노하우와 함께 나만의 여행을 만들어보세요.
                </p>
            </motion.div>
        </div>
    </section>
);

export default Hero;
