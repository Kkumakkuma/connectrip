import { useState, useEffect } from 'react';
import { UserX, Loader2, RotateCcw } from 'lucide-react';
import { userBlockApi } from '../lib/db';

// 내가 차단한 회원 목록 + 해제. 차단하면 서로 쪽지를 주고받을 수 없고,
// 상대의 글과 쪽지가 내 화면에서 숨겨진다.
const BlockedUsers = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const fetchBlocks = async () => {
        try {
            setLoading(true);
            setError(null);
            setRows(await userBlockApi.getMyBlocks());
        } catch (err) {
            console.error('차단 목록 로드 실패:', err);
            setError('차단 목록을 불러오지 못했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchBlocks(); }, []);

    const handleUnblock = async (userId, name) => {
        if (!window.confirm(`${name || '이 사용자'}님의 차단을 해제할까요?\n다시 쪽지를 주고받을 수 있게 됩니다.`)) return;
        setBusyId(userId);
        try {
            await userBlockApi.unblock(userId);
            await fetchBlocks();
        } catch (err) {
            console.error('차단 해제 실패:', err);
            alert('차단 해제에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <div className="py-12 text-center text-gray-400">
                <Loader2 size={28} className="mx-auto mb-3 animate-spin" />
                불러오는 중...
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-12 text-center">
                <p className="text-gray-500 mb-4">{error}</p>
                <button onClick={fetchBlocks} className="px-5 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-colors">
                    다시 시도
                </button>
            </div>
        );
    }

    return (
        <div>
            <p className="text-sm text-gray-500 mb-5">
                차단한 회원과는 쪽지를 주고받을 수 없고, 그 회원의 글과 쪽지가 보이지 않습니다.
            </p>

            {rows.length === 0 ? (
                <div className="py-14 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <UserX size={40} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500">차단한 회원이 없습니다.</p>
                    <p className="text-gray-400 text-sm mt-1">쪽지함에서 상대방을 차단할 수 있습니다.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map((row) => {
                        const p = row.blocked;
                        const name = p?.nickname || p?.name || '(탈퇴한 사용자)';
                        return (
                            <div key={row.blocked_id} className="flex items-center justify-between gap-3 p-4 bg-gray-50 rounded-xl">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-gray-500 font-bold">
                                        {name.charAt(0)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-gray-800 truncate">{name}</p>
                                        <p className="text-xs text-gray-400">
                                            {new Date(row.created_at).toLocaleDateString('ko-KR')} 차단
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleUnblock(row.blocked_id, name)}
                                    disabled={busyId === row.blocked_id}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-600 hover:text-blue-600 hover:border-blue-300 transition-colors flex-shrink-0 disabled:opacity-50"
                                >
                                    {busyId === row.blocked_id
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <RotateCcw size={14} />}
                                    해제
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default BlockedUsers;
