import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Mail, MessageCircle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { chatApi } from '../lib/db';
import { chatErrorMessage } from '../lib/chat';

// 글쓴이 이름 옆 버튼: 쪽지 보내기 / 1:1 대화. 본인 글·비로그인이면 아무것도 그리지 않는다.
const AuthorActions = ({ userId, name = '', size = 13, className = '' }) => {
    const { user, isLoggedIn } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (!isLoggedIn || !userId || userId === user?.id) return null;

    const goMessage = (e) => {
        e.stopPropagation();
        setOpen(false);
        navigate(`/messages?to=${encodeURIComponent(userId)}&name=${encodeURIComponent(name || '')}`);
    };
    const goChat = async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
            const roomId = await chatApi.open(userId);
            setOpen(false);
            navigate(`/chat/${roomId}`);
        } catch (err) {
            console.error('대화방 열기 실패:', err);
            alert(chatErrorMessage(err, '대화방을 열지 못했습니다.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <span ref={ref} className={`relative inline-flex flex-shrink-0 ${className}`} onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                className="p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                aria-label="쪽지·대화"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <MessageSquare size={size} />
            </button>
            {open && (
                <span role="menu" className="absolute right-0 top-full mt-1 z-30 w-32 bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-xs">
                    <button type="button" role="menuitem" onClick={goMessage} className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50">
                        <Mail size={13} className="text-blue-500" /> 쪽지 보내기
                    </button>
                    <button type="button" role="menuitem" onClick={goChat} disabled={busy} className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <MessageCircle size={13} className="text-green-600" /> 1:1 대화
                    </button>
                </span>
            )}
        </span>
    );
};

export default AuthorActions;
