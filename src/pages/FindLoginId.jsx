import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IdCard } from 'lucide-react';
import { apiUrl } from '../lib/api';
import SEOHead from '../components/SEOHead';
import IdentityVerifyStep from '../components/IdentityVerifyStep';
import {
    IDENTITY_ENABLED,
    clearIdentityProof, clearIdentityStart, parseIdentityReturn, stripIdentityParams,
} from '../lib/identity';

// 아이디 찾기 — PASS 휴대폰 본인확인 하나로 끝난다(2026-09-05, 쿠마님 확정).
// 이메일·전화번호를 입력받지 않는다. 같은 사람인지는 본인확인 연계정보(CI)로만 판단하며,
// 서버(/api/find-login-id)가 그 CI 로 가입된 계정의 아이디만 돌려준다.
// 화면에는 아이디·가입 유형·가입일만 띄운다 — 휴대폰번호·이메일은 어떤 경우에도 표시하지 않는다.
//
// 본인확인 용도(purpose)는 서버가 증빙 토큰에 함께 묶는다. 가입용 증빙으로 남의 아이디를
// 조회하지 못하게 하려는 것이라, 이 화면 전용 값을 쓴다.
const IDENTITY_PURPOSE_FIND_ID = 'find_id';

const USER_TYPE_LABEL = { crew: '승무원', traveler: '여행자' };

// 가입일 YYYY.MM.DD (한국 시간 기준). 값이 이상하면 빈 문자열 — 날짜 줄을 통째로 숨긴다.
const formatJoinDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try {
        const parts = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(d);
        const get = (t) => parts.find((p) => p.type === t)?.value || '';
        const [y, m, day] = [get('year'), get('month'), get('day')];
        return y && m && day ? `${y}.${m}.${day}` : '';
    } catch {
        return '';
    }
};

const FindLoginId = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [step, setStep] = useState('identity'); // 'identity' | 'result'
    const [identityReturn, setIdentityReturn] = useState(null);
    const [proofToken, setProofToken] = useState(''); // 조회 실패 시 재시도용(세션 스토리지에는 남기지 않는다)
    const [account, setAccount] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [noAccount, setNoAccount] = useState(false);

    // 본인확인 복귀(?flow=identity&…) — 모바일·앱은 페이지 이동이라 여기로 돌아온다.
    useEffect(() => {
        if (!IDENTITY_ENABLED) return;
        const ret = parseIdentityReturn(location.search);
        if (!ret) return;
        clearIdentityStart(); // 결과를 화면 state 로 옮겼으니 시작 기록은 폐기(성공·실패 공통)
        navigate({ pathname: location.pathname, search: stripIdentityParams(location.search) }, { replace: true });
        setIdentityReturn(ret);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 본인확인 증빙으로 아이디 조회. 증빙은 쓰는 즉시 세션 스토리지에서 지운다
    // — 가입 화면과 같은 키를 쓰기 때문에 남겨두면 다음 가입 흐름이 이 증빙을 주워간다.
    const lookup = async (token) => {
        setLoading(true);
        setError('');
        setNoAccount(false);
        try {
            const resp = await fetch(apiUrl('/api/find-login-id'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identity_token: token }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.ok) {
                const code = String(data?.code || '');
                const message = data?.error || '아이디를 조회하지 못했습니다. 잠시 후 다시 시도해주세요.';
                if (code === 'NO_ACCOUNT') {
                    setProofToken(''); // 조회가 끝난 증빙은 재사용하지 않는다
                    setNoAccount(true);
                } else if (code === 'IDENTITY_PROOF_INVALID' || code === 'IDENTITY_REQUIRED') {
                    // 증빙이 만료됐거나 이미 쓰였다 → 본인확인부터 다시
                    setProofToken('');
                    setIdentityReturn(null);
                    setStep('identity');
                }
                setError(message);
                return;
            }
            setAccount({
                loginId: data.login_id || '',
                userType: data.user_type || '',
                joinedAt: formatJoinDate(data.created_at),
            });
            setProofToken('');
            setStep('result');
        } catch (err) {
            setError('네트워크 오류: ' + (err.message || '알 수 없음'));
        } finally {
            setLoading(false);
        }
    };

    const onVerified = (proof) => {
        clearIdentityProof(); // 세션 스토리지에서 즉시 제거, 토큰은 화면 state 로만 들고 간다
        setIdentityReturn(null);
        setProofToken(proof?.token || '');
        if (proof?.token) lookup(proof.token);
        else setError('본인확인 결과를 확인하지 못했습니다. 다시 시도해주세요.');
    };

    const restart = () => {
        clearIdentityProof();
        setProofToken('');
        setIdentityReturn(null);
        setAccount(null);
        setNoAccount(false);
        setError('');
        setStep('identity');
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-20">
            <SEOHead title="아이디 찾기 - ConnectTrip" description="ConnectTrip 아이디 찾기" robots="noindex, nofollow" />
            <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-gray-100" style={{ wordBreak: 'keep-all' }}>
                {/* 결과 화면에만 안내 문장이 따라붙는다. 1단계 안내는 본인확인 카드가 들고 있어
                    같은 말을 두 번 쓰지 않는다. */}
                <h1 className={`text-2xl font-bold text-gray-800 ${step === 'result' && account ? 'mb-2' : 'mb-6'}`}>
                    아이디 찾기
                </h1>

                {step === 'result' && account ? (
                    <>
                        <p className="text-gray-500 mb-6">본인확인된 휴대폰으로 가입된 계정입니다.</p>
                        <div className="p-5 bg-blue-50 border border-blue-100 rounded-2xl">
                            <div className="flex items-center gap-2 text-blue-700 mb-3">
                                <IdCard size={18} />
                                <span className="text-sm font-semibold">아이디</span>
                            </div>
                            <p className="text-2xl font-bold text-gray-800 break-all">{account.loginId}</p>
                            <dl className="mt-4 pt-4 border-t border-blue-100 space-y-2 text-sm">
                                {USER_TYPE_LABEL[account.userType] && (
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">가입 유형</dt>
                                        <dd className="text-gray-800 font-medium">{USER_TYPE_LABEL[account.userType]}</dd>
                                    </div>
                                )}
                                {account.joinedAt && (
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">가입일</dt>
                                        <dd className="text-gray-800 font-medium">{account.joinedAt}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/signup?mode=login')}
                            className="mt-6 w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all"
                        >
                            로그인하기
                        </button>
                        <div className="mt-4 text-center">
                            <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
                                비밀번호 찾기
                            </Link>
                        </div>
                    </>
                ) : (
                    <>
                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm" role="alert">
                                {error}
                            </div>
                        )}

                        {noAccount ? (
                            <>
                                <p className="text-gray-600 text-sm leading-relaxed mb-6">
                                    다른 휴대폰으로 가입했다면 그 번호로 본인확인을 다시 진행해주세요.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/signup')}
                                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all"
                                >
                                    회원가입하기
                                </button>
                                <button
                                    type="button"
                                    onClick={restart}
                                    className="mt-3 w-full text-sm text-gray-500 hover:text-blue-600 hover:underline"
                                >
                                    본인확인 다시 하기
                                </button>
                            </>
                        ) : loading ? (
                            <p className="py-6 text-center text-gray-500">아이디를 조회하는 중입니다...</p>
                        ) : proofToken ? (
                            <>
                                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                                    본인확인은 끝났습니다. 조회를 다시 시도해주세요.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => lookup(proofToken)}
                                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all"
                                >
                                    다시 시도
                                </button>
                                <button
                                    type="button"
                                    onClick={restart}
                                    className="mt-3 w-full text-sm text-gray-500 hover:text-blue-600 hover:underline"
                                >
                                    본인확인 다시 하기
                                </button>
                            </>
                        ) : (
                            <IdentityVerifyStep
                                returnPath="/find-id"
                                returnResult={identityReturn}
                                purpose={IDENTITY_PURPOSE_FIND_ID}
                                onVerified={onVerified}
                                disabled={!IDENTITY_ENABLED}
                                title="아이디 찾기"
                                description="가입할 때 본인확인한 휴대폰으로 PASS 본인확인을 하면 아이디를 알려드립니다."
                            />
                        )}
                    </>
                )}

                <div className="mt-6 text-center">
                    <Link to="/signup?mode=login" className="text-gray-500 hover:text-gray-700">
                        ← 로그인으로 돌아가기
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default FindLoginId;
