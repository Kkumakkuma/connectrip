import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';

// 비밀번호 재설정 메일 요청 — 코드 전체에 재설정 경로가 없어 비밀번호를 잊은 검증 회원이
// 영구 이탈하던 데드엔드 봉합(2026-07-20). Supabase resetPasswordForEmail 표준 플로우.
const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email) {
            setError('가입하신 이메일을 입력해주세요.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });
            // Supabase 는 미가입 이메일에도 성공을 돌려줘(존재 탐지 방지) err 는
            // rate limit·네트워크 등 '운영 실패'만 — 성공으로 위장하면 재시도가 막힘(codex 지적)
            if (err) throw err;
            setSent(true);
        } catch {
            setError('메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <SEOHead title="비밀번호 재설정 - ConnectTrip" description="ConnectTrip 비밀번호 재설정" robots="noindex, nofollow" />
            <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">비밀번호 재설정</h1>
                {sent ? (
                    <div>
                        <p className="text-gray-600 mb-6">
                            입력하신 주소로 재설정 링크를 보냈습니다.<br />
                            메일함(스팸함 포함)을 확인해주세요.
                        </p>
                        <button
                            onClick={() => setSent(false)}
                            className="mb-4 block text-sm text-gray-500 hover:text-blue-600 hover:underline"
                        >
                            메일이 안 왔나요? 다시 보내기
                        </button>
                        <Link to="/signup?mode=login" className="text-blue-600 font-semibold hover:underline">
                            로그인으로 돌아가기
                        </Link>
                    </div>
                ) : (
                    <>
                        <p className="text-gray-500 mb-6">가입하신 이메일로 재설정 링크를 보내드립니다.</p>
                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm" role="alert">
                                {error}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="relative">
                                <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="email"
                                    autoComplete="email"
                                    placeholder="이메일"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all disabled:opacity-50"
                            >
                                {loading ? '전송 중...' : '재설정 링크 보내기'}
                            </button>
                        </form>
                        <div className="mt-6 text-center">
                            <Link to="/signup?mode=login" className="text-gray-500 hover:text-gray-700">
                                ← 로그인으로 돌아가기
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ForgotPassword;
