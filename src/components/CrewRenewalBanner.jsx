import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { crewVerificationStatus, isRenewBannerHidden, hideRenewBannerToday } from '../lib/crewVerification';

// 만료 30일 이내·만료된 승무원에게 모든 화면 상단에 한 줄로 안내.
// 닫으면 그날 하루만 숨고 다음 날 다시 뜬다(만료 상태도 같다).
// Navbar 가 fixed 라 상단 여백으로 그 높이를 비운다 — 배너가 없으면 이 요소 자체가 없어 기존 여백 그대로다.
const CrewRenewalBanner = () => {
    const { user, profile, isLoggedIn, profileLoading } = useAuth();
    const [dismissTick, setDismissTick] = useState(0);

    const status = useMemo(() => crewVerificationStatus(profile), [profile]);
    // 렌더 중에 바로 읽어 배너가 떴다 사라지는 깜빡임을 만들지 않는다.
    const dismissed = useMemo(
        () => isRenewBannerHidden(user?.id),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [user?.id, dismissTick]
    );

    // 탭을 켜 둔 채 자정을 넘겨도 다음 날 다시 뜨게 한다(자정 직후 재평가).
    useEffect(() => {
        const now = new Date();
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
        const timer = setTimeout(() => setDismissTick((n) => n + 1), Math.max(1000, nextMidnight.getTime() - now.getTime()));
        return () => clearTimeout(timer);
    }, [dismissTick]);

    if (!isLoggedIn || profileLoading) return null;
    if (status.state !== 'expiring' && status.state !== 'expired') return null;
    if (dismissed) return null;

    const expired = status.state === 'expired';
    const tone = expired
        ? { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' }
        : { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' };

    const dismiss = () => {
        hideRenewBannerToday(user?.id);
        setDismissTick((n) => n + 1);
    };

    return (
        <div className="pt-20 2xl:pt-24 pb-1">
            <div className="container">
                <div
                    role="status"
                    style={{
                        background: tone.bg,
                        border: `1px solid ${tone.border}`,
                        borderRadius: 12,
                        padding: '0.6rem 0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        wordBreak: 'keep-all',
                    }}
                >
                    <AlertTriangle size={16} color={tone.text} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ flex: '1 1 220px', fontSize: '0.85rem', fontWeight: 600, color: tone.text }}>
                        {expired
                            ? '승무원 인증이 만료되어 승무원 기능이 잠겼습니다.'
                            : `승무원 인증 만료 ${status.daysLeft}일 전입니다.`}
                    </span>
                    <Link
                        to="/mypage#crew-renewal"
                        style={{
                            padding: '0.35rem 0.85rem',
                            borderRadius: 999,
                            background: tone.text,
                            color: 'white',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        갱신하기
                    </Link>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="안내 닫기"
                        style={{ background: 'transparent', color: tone.text, opacity: 0.7, display: 'flex', alignItems: 'center', padding: 2 }}
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CrewRenewalBanner;
