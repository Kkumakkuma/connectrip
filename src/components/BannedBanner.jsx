import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { BANNED_MESSAGE, useIsBanned } from '../lib/banned';

// 이용 제한(is_banned) 회원에게 모든 화면 상단에 한 줄로 안내 (2026-09-16).
// CrewRenewalBanner 와 같은 자리·같은 모양. 닫기 없음(제한이 풀릴 때까지 항상 보인다).
// Navbar 가 fixed 라 상단 여백으로 그 높이를 비운다 — 해당자가 아니면 이 요소 자체가 없어 기존 여백 그대로다.
const BannedBanner = () => {
    const { isLoggedIn, profileLoading } = useAuth();
    const isBanned = useIsBanned();

    if (!isLoggedIn || profileLoading) return null;
    if (!isBanned) return null;

    const tone = { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };

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
                        {BANNED_MESSAGE}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default BannedBanner;
