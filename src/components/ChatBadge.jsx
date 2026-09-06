import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { chatApi, messageApi } from '../lib/db';

const POLL_MS = 60000;

// 상단 대화 아이콘 + 안 읽은 수(대화 + 쪽지). 60초 폴링, 화면이 안 보이면 멈춘다. 대화·쪽지 화면에 들어가면 바로 다시 센다.
const ChatBadge = () => {
    const { isLoggedIn, user } = useAuth();
    const location = useLocation();
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!isLoggedIn) { setCount(0); return undefined; }
        let alive = true;
        let busy = false;
        const tick = async () => {
            if (busy || document.hidden) return;
            busy = true;
            try {
                const [a, b] = await Promise.all([chatApi.unreadCount(), messageApi.unreadCount()]);
                if (alive) setCount((Number(a) || 0) + (Number(b) || 0));
            } catch { /* 배지만 */ } finally { busy = false; }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        const onVis = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
    }, [isLoggedIn, user?.id, location.pathname]);

    if (!isLoggedIn) return null;
    return (
        <Link to="/chat" className="relative p-2 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0" aria-label={count > 0 ? `대화·쪽지 ${count}개 읽지 않음` : '대화·쪽지'}>
            <MessageCircle size={22} className="text-gray-700" />
            {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {count > 99 ? '99+' : count}
                </span>
            )}
        </Link>
    );
};

export default ChatBadge;
