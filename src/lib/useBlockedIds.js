import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { userBlockApi } from './db';

const EMPTY = new Set();

// 내가 차단한 회원 id 집합. 게시판 목록에서 그 사람 글을 감추는 데 쓴다.
// 공개 게시판이라 서버에서 지우는 게 아니라 "내 화면에서 안 보이게" 하는 것이 목적이다.
// 조회에 실패하면 빈 집합을 유지해 목록 자체가 깨지지 않게 한다.
export function useBlockedIds() {
    const { user } = useAuth();
    const [blockedIds, setBlockedIds] = useState(EMPTY);

    useEffect(() => {
        let alive = true;
        const userId = user?.id;
        (async () => {
            if (!userId) {
                if (alive) setBlockedIds(EMPTY);
                return;
            }
            try {
                const ids = await userBlockApi.getMyBlockedIds();
                if (alive) setBlockedIds(ids.length ? new Set(ids) : EMPTY);
            } catch (err) {
                console.error('차단 목록 조회 실패:', err);
                if (alive) setBlockedIds(EMPTY);
            }
        })();
        return () => { alive = false; };
    }, [user?.id]);

    return blockedIds;
}

// 차단한 작성자의 항목을 걸러낸다. user_id 가 없는 시드 데이터는 그대로 둔다.
export function filterBlocked(items, blockedIds) {
    if (!blockedIds || blockedIds.size === 0) return items || [];
    return (items || []).filter((it) => !it?.user_id || !blockedIds.has(it.user_id));
}
