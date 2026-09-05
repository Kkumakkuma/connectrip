import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { User, Lock } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { normalizeLoginId, passwordWeak } from '../lib/loginId';
import SEOHead from '../components/SEOHead';
import IdentityVerifyStep from '../components/IdentityVerifyStep';
import {
    IDENTITY_ENABLED, IDENTITY_PROOF_TTL_MS, IDENTITY_PURPOSE_PASSWORD_RESET,
    clearIdentityProof, clearIdentityStart, parseIdentityReturn, stripIdentityParams,
} from '../lib/identity';

// 비밀번호 찾기 — 아이디 → PASS 휴대폰 본인확인 → 새 비밀번호(2026-09-05, 쿠마님 확정).
// 이메일 인증번호 경로는 쓰지 않는다. Auth 주소가 합성 주소(<login_id>@id.connecttrip.co.kr)라
// Supabase 표준 비밀번호 재설정 메일도 쓸 수 없다 — 본인 명의 휴대폰 확인이 유일한 신원 확인 수단이다.
//
// PASS 는 모바일에서 페이지 이동(REDIRECTION)이라 화면을 떠났다 돌아온다.
// 그 사이 입력한 아이디가 사라지지 않게 세션 스토리지에 1시간만 보관한다(증빙 유효기간과 동일).
const RESET_ID_KEY = 'pendingResetLoginId';

const loadResetLoginId = () => {
    try {
        const raw = sessionStorage.getItem(RESET_ID_KEY);
        if (!raw) return '';
        const p = JSON.parse(raw);
        if (!p?.loginId || Date.now() - (p.savedAt || 0) >= IDENTITY_PROOF_TTL_MS) {
            sessionStorage.removeItem(RESET_ID_KEY);
            return '';
        }
        return p.loginId;
    } catch {
        return '';
    }
};
const saveResetLoginId = (loginId) => {
    try { sessionStorage.setItem(RESET_ID_KEY, JSON.stringify({ loginId, savedAt: Date.now() })); } catch { /* 스토리지 차단 환경 */ }
};
const clearResetLoginId = () => {
    try { sessionStorage.removeItem(RESET_ID_KEY); } catch { /* noop */ }
};

const ForgotPassword = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [step, setStep] = useState('id'); // 'id' | 'identity' | 'password' | 'done'
    const [loginId, setLoginId] = useState('');
    const [identityProof, setIdentityProof] = useState(null);
    const [identityReturn, setIdentityReturn] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // 본인확인 복귀(?flow=identity&…): 보관해 둔 아이디를 되살리고 본인확인 단계로 돌아간다.
    useEffect(() => {
        const saved = loadResetLoginId();
        if (saved) setLoginId(saved);
        if (!IDENTITY_ENABLED) return;
        const ret = parseIdentityReturn(location.search);
        if (!ret) return;
        clearIdentityStart(); // 결과를 옮겼으니 시작 기록은 폐기(성공·실패 공통)
        navigate({ pathname: location.pathname, search: stripIdentityParams(location.search) }, { replace: true });
        if (!saved) {
            // 스토리지가 유실된 채 돌아온 경우 — 아이디부터 다시 받는다.
            setError('아이디를 다시 입력한 뒤 본인확인을 진행해주세요.');
            return;
        }
        setIdentityReturn(ret);
        setStep('identity');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ① 아이디 확정 → 본인확인 단계로
    const submitLoginId = (e) => {
        e?.preventDefault();
        setError('');
        const id = normalizeLoginId(loginId);
        if (!id) {
            setError('아이디 형식이 올바르지 않습니다. 영문 소문자·숫자·밑줄(_) 4~20자입니다.');
            return;
        }
        setLoginId(id);
        saveResetLoginId(id);
        // 아이디를 확정할 때마다 본인확인부터 다시 한다 — 앞서 받은 증빙은 그 아이디의 주인임을
        // 확인한 것이 아니므로 재사용하면 같은 오류(IDENTITY_MISMATCH)만 반복된다(codex 지적).
        setStep('identity');
    };

    // ③ 본인확인 증빙 + 새 비밀번호로 변경
    const submitNewPassword = async (e) => {
        e?.preventDefault();
        setError('');
        const id = normalizeLoginId(loginId);
        if (!id) {
            setError('아이디 형식이 올바르지 않습니다.');
            setStep('id');
            return;
        }
        if (!identityProof?.token) {
            setError('본인확인을 먼저 완료해주세요.');
            setStep('identity');
            return;
        }
        if (passwordWeak(newPassword)) {
            setError('비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.');
            return;
        }
        if (newPassword !== passwordConfirm) {
            setError('비밀번호가 일치하지 않습니다.');
            return;
        }
        setLoading(true);
        try {
            const resp = await fetch(apiUrl('/api/reset-password-confirm'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login_id: id, identity_token: identityProof.token, new_password: newPassword }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.ok) {
                const code = String(data?.code || '');
                const message = data?.error || '비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.';
                if (code === 'IDENTITY_PROOF_INVALID' || code === 'IDENTITY_REQUIRED') {
                    // 증빙이 만료·이미 사용됨(또는 누락) → 본인확인부터 다시
                    clearIdentityProof();
                    setIdentityProof(null);
                    setIdentityReturn(null);
                    setStep('identity');
                } else if (code === 'IDENTITY_MISMATCH') {
                    // 본인확인한 사람과 계정 주인이 다르다 → 증빙을 버리고 아이디부터 다시(codex 지적).
                    clearIdentityProof();
                    setIdentityProof(null);
                    setIdentityReturn(null);
                    setStep('id');
                }
                setError(message);
                return;
            }
            clearIdentityProof();
            clearResetLoginId();
            setIdentityProof(null);
            setStep('done');
        } catch (err) {
            setError('네트워크 오류: ' + (err.message || '알 수 없음'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-20">
            <SEOHead title="비밀번호 재설정 - ConnectTrip" description="ConnectTrip 비밀번호 재설정" robots="noindex, nofollow" />
            <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">비밀번호 재설정</h1>

                {step === 'done' ? (
                    <div>
                        <p className="text-gray-600 my-6">
                            비밀번호가 변경되었습니다. 다시 로그인해주세요.
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate('/signup?mode=login')}
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all"
                        >
                            로그인하러 가기
                        </button>
                    </div>
                ) : (
                    <>
                        <p className="text-gray-500 mb-6">
                            {step === 'id' ? '아이디를 입력하고 본인 명의 휴대폰으로 본인확인을 진행합니다.'
                                : step === 'identity' ? `아이디 ${loginId} 의 주인인지 휴대폰으로 확인합니다.`
                                    : '새로 사용할 비밀번호를 입력해주세요.'}
                        </p>

                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm" role="alert">
                                {error}
                            </div>
                        )}

                        {step === 'id' && (
                            <form onSubmit={submitLoginId} className="space-y-4">
                                <div className="relative">
                                    <User size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        name="login_id"
                                        autoComplete="username"
                                        inputMode="latin"
                                        placeholder="아이디"
                                        value={loginId}
                                        onChange={(e) => setLoginId(e.target.value.trim().toLowerCase())}
                                        maxLength={20}
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all"
                                >
                                    본인확인으로 계속
                                </button>
                            </form>
                        )}

                        {step === 'identity' && (
                            <>
                                <IdentityVerifyStep
                                    returnPath="/forgot-password"
                                    returnResult={identityReturn}
                                    purpose={IDENTITY_PURPOSE_PASSWORD_RESET}
                                    onVerified={(proof) => { setIdentityReturn(null); setIdentityProof(proof); setStep('password'); }}
                                    disabled={!IDENTITY_ENABLED}
                                    title="휴대폰 본인확인"
                                    description="계정 주인만 비밀번호를 바꿀 수 있도록, 가입할 때 확인한 본인 명의 휴대폰으로 다시 확인합니다."
                                />
                                <button
                                    type="button"
                                    onClick={() => { clearIdentityProof(); setIdentityProof(null); setIdentityReturn(null); setError(''); setStep('id'); }}
                                    className="w-full text-sm text-gray-500 hover:text-blue-600 hover:underline"
                                >
                                    아이디 다시 입력
                                </button>
                            </>
                        )}

                        {step === 'password' && (
                            <form onSubmit={submitNewPassword} className="space-y-4">
                                <div className="relative">
                                    <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="새 비밀번호 (8자 이상, 영문+숫자)"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        maxLength={72}
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                    />
                                </div>
                                <div className="relative">
                                    <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="새 비밀번호 확인"
                                        value={passwordConfirm}
                                        onChange={(e) => setPasswordConfirm(e.target.value)}
                                        maxLength={72}
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
                        )}

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
