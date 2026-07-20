import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';

// 재설정 메일 링크 착지 페이지 — recovery 세션 상태에서 새 비밀번호 설정(2026-07-20 신설).
// 링크의 recovery 토큰은 supabase-js(detectSessionInUrl)가 세션으로 전환하며,
// AuthContext 가 PASSWORD_RECOVERY 이벤트 시 이 페이지로 보낸다(리다이렉트 폴백 대비).
const ResetPassword = () => {
    const navigate = useNavigate();
    const [ready, setReady] = useState(false);      // recovery 세션 확인됨
    const [checked, setChecked] = useState(false);  // 세션 확인 시도 끝
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        // 복구 링크로 온 세션만 허용(sessionStorage 플래그 = AuthContext PASSWORD_RECOVERY 가 세팅).
        // 세션만 보고 허용하면 공유 기기의 일반 로그인 세션 비밀번호를 무검증 변경 가능(codex 지적).
        const hasRecoveryFlag = () => {
            try { return sessionStorage.getItem('ct_pw_recovery') === '1'; } catch { return false; }
        };
        // 이 탭에서 recovery 해시가 세션으로 바뀌기 전에 마운트될 수 있어 이벤트도 함께 구독
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY' && alive) {
                setReady(true);
                setChecked(true);
            }
        });
        const check = async () => {
            for (let i = 0; i < 10; i += 1) {
                const { data } = await supabase.auth.getSession();
                if (!alive) return;
                if (data?.session && hasRecoveryFlag()) {
                    setReady(true);
                    setChecked(true);
                    return;
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            if (alive) setChecked(true);
        };
        check();
        return () => {
            alive = false;
            subscription?.unsubscribe();
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!password || password.length < 8) {
            setError('비밀번호는 8자 이상으로 입력해주세요.');
            return;
        }
        if (password !== confirm) {
            setError('비밀번호가 서로 다릅니다.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const { error: err } = await supabase.auth.updateUser({ password });
            if (err) throw err;
            // 복구 세션을 남기지 않는다 — 공유 기기 잔존 세션 방지 + '새 비밀번호로 로그인' 안내와 일치
            try { sessionStorage.removeItem('ct_pw_recovery'); } catch { /* 무시 */ }
            await supabase.auth.signOut();
            setDone(true);
        } catch (err) {
            setError(err.message || '비밀번호 변경에 실패했습니다. 링크가 만료됐다면 다시 요청해주세요.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <SEOHead title="새 비밀번호 설정 - ConnectTrip" description="ConnectTrip 새 비밀번호 설정" robots="noindex, nofollow" />
            <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">새 비밀번호 설정</h1>
                {done ? (
                    <div>
                        <p className="text-gray-600 mb-6">비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.</p>
                        <button
                            onClick={() => navigate('/signup?mode=login')}
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 rounded-xl font-semibold"
                        >
                            로그인하러 가기
                        </button>
                    </div>
                ) : !checked ? (
                    <p className="text-gray-500">확인 중…</p>
                ) : !ready ? (
                    <div>
                        <p className="text-gray-600 mb-6">
                            재설정 링크가 만료되었거나 올바르지 않습니다.<br />
                            재설정 메일을 다시 요청해주세요.
                        </p>
                        <button
                            onClick={() => navigate('/forgot-password')}
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 rounded-xl font-semibold"
                        >
                            재설정 메일 다시 받기
                        </button>
                    </div>
                ) : (
                    <>
                        <p className="text-gray-500 mb-6">사용하실 새 비밀번호를 입력해주세요.</p>
                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm" role="alert">
                                {error}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="relative">
                                <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type={show ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    placeholder="새 비밀번호 (8자 이상)"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-12 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShow(!show)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    {show ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                            <div className="relative">
                                <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type={show ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    placeholder="새 비밀번호 확인"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all disabled:opacity-50"
                            >
                                {loading ? '변경 중...' : '비밀번호 변경'}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

export default ResetPassword;
