import { Fragment } from 'react';
import { motion } from 'framer-motion';
import { Plane } from 'lucide-react';

import { HERO_BADGE, HERO_DESCRIPTION, HERO_TITLE_LINES } from '../lib/homeContent';

// 첫 화면 히어로(2026-09-07 에어비앤비 톤): 사진 위 큰 제목 하나, 여백을 넓게. 문구는 기존 그대로.
// 문구 자체는 src/lib/homeContent.js 가 단일 출처다 — 프리렌더(scripts/prerender-seo.mjs)가
// 크롤러용 홈 본문을 같은 값으로 굽기 때문에 여기에 직접 적지 않는다(2026-09-17).
const Hero = () => (
    <section className="relative w-full overflow-hidden min-h-[70vh] sm:min-h-[76vh] flex items-center pt-24 pb-16">
        <div
            className="absolute inset-0 z-0"
            style={{ backgroundImage: 'url(/hero-bg.webp)', backgroundPosition: 'center', backgroundSize: 'cover', filter: 'brightness(0.62)' }}
        />
        <div className="max-w-content mx-auto px-4 sm:px-6 relative z-10 text-white w-full">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }} className="max-w-3xl">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-5 rounded-full bg-white/15 backdrop-blur-sm border border-white/30 text-[13px] font-semibold">
                    <Plane size={14} aria-hidden="true" /> {HERO_BADGE}
                </span>
                <h1 className="text-[34px] sm:text-[48px] lg:text-[56px] font-extrabold tracking-[-0.03em] leading-[1.15] mb-5" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
                    {HERO_TITLE_LINES.map((line, i) => (
                        <Fragment key={line}>
                            {i > 0 && <br />}
                            {line}
                        </Fragment>
                    ))}
                </h1>
                <p className="text-[15px] sm:text-[18px] text-white/90 leading-relaxed max-w-2xl">
                    {HERO_DESCRIPTION}
                </p>
            </motion.div>
        </div>
    </section>
);

export default Hero;
