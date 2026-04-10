import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Plane, Mail, Lock, Eye, EyeOff, Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { isAirlineEmail, getAirlineInfo, getAirlineList } from '../lib/airlines';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';

const Signup = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { signUp, signIn, signInWithProvider, updateProfile, isLoggedIn } = useAuth();
    const [userType, setUserType] = useState(null);
    const [mode, setMode] = useState(searchParams.get('mode') === 'login' ? 'login' : 'signup');

    // 이미 로그인된 유저는 홈으로 (useEffect로 안전하게 처리)
    useEffect(() => {
        if (isLoggedIn && !searchParams.get('mode')) {
            navigate('/');
        }
    }, [isLoggedIn, searchParams, navigate]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // 승무원 인증용
    const [airlineEmail, setAirlineEmail] = useState('');
    const [crewStep, setCrewStep] = useState('form'); // 'form', 'verify', 'done'
    const [airlineInfo, setAirlineInfo] = useState(null);

    const handleEmailAuth = async () => {
        if (!email || !password) {
            setError('이메일과 비밀번호를 입력해주세요.');
            return;
        }
        if (password.length < 6) {
            setError('비밀번호는 6자 이상이어야 합니다.');
            return;
        }

        // 승무원 가입 시 항공사 이메일 검증
        if (mode === 'signup' && userType === 'crew') {
            if (!airlineEmail) {
                setError('항공사 이메일을 입력해주세요.');
                return;
            }
            if (!isAirlineEmail(airlineEmail)) {
                setError('유효한 항공사 이메일이 아닙니다. 아래 항공사 이메일만 가능합니다.');
                return;
            }
        }

        setLoading(true);
        setError('');

        try {
            if (mode === 'signup') {
                const data = await signUp(email, password, userType);
                if (userType === 'crew' && data?.user) {
                    const info = getAirlineInfo(airlineEmail);
                    await supabase.from('profiles').update({
                        airline_email: airlineEmail,
                        airline_name: info?.name || '',
                        crew_verified: true,
                        crew_verified_at: new Date().toISOString(),
                    }).eq('id', data.user.id);
                }
                alert(`${userType === 'traveler' ? '일반 여행자' : '승무원 (' + (getAirlineInfo(airlineEmail)?.name || '') + ')'} 계정으로 가입이 완료되었습니다!`);
            } else {
                await signIn(email, password);
            }
            navigate('/');
            window.scrollTo(0, 0);
        } catch (err) {
            if (err.message.includes('already registered')) {
                setError('이미 가입된 이메일입니다. 로그인해주세요.');
            } else if (err.message.includes('Invalid login')) {
                setError('이메일 또는 비밀번호가 올바르지 않습니다.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSocialLogin = async (provider) => {
        setLoading(true);
        setError('');
        try {
            await signInWithProvider(provider);
        } catch (err) {
            setError(`${provider} 로그인 실패: ${err.message}`);
            setLoading(false);
        }
    };

    const handleBack = () => {
        setUserType(null);
        setError('');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-20">
            <SEOHead title="회원가입 - ConnectTrip" description="ConnectTrip에 가입하고 여행자와 승무원 커뮤니티에 참여하세요." />
            <div className="max-w-7xl mx-auto px-4 pt-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="max-w-4xl mx-auto"
                >
                    {/* Header */}
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-black text-gray-800 mb-3">
                            {mode === 'signup' ? '회원가입' : '로그인'}
                        </h1>
                        <p className="text-gray-600 text-lg">
                            {!userType && mode === 'signup' ? '가입 유형을 선택해주세요' :
                             mode === 'login' ? '계정에 로그인하세요' :
                             '간편하게 가입하고 다양한 서비스를 이용하세요'}
                        </p>
                    </div>

                    <AnimatePresence mode="wait">
                        {!userType && mode === 'signup' ? (
                            // Step 1: User Type Selection
                            <motion.div
                                key="type-selection"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.3 }}
                                className="grid md:grid-cols-2 gap-6"
                            >
                                {/* Traveler Card */}
                                <motion.button
                                    onClick={() => setUserType('traveler')}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="bg-white rounded-3xl p-8 shadow-2xl border-2 border-gray-200 hover:border-blue-500 transition-all group"
                                >
                                    <div className="flex flex-col items-center text-center space-y-4">
                                        <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <User size={40} className="text-white" />
                                        </div>
                                        <h2 className="text-2xl font-bold text-gray-800">일반 여행자</h2>
                                        <p className="text-gray-600 leading-relaxed">
                                            여행 동행자를 찾고, 여행 정보를 공유하며, 다양한 여행 관련 서비스를 이용할 수 있습니다.
                                        </p>
                                        <div className="pt-4">
                                            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">
                                                <span>일반 회원으로 가입</span>
                                                <span>→</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.button>

                                {/* Flight Attendant Card */}
                                <motion.button
                                    onClick={() => setUserType('crew')}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="bg-white rounded-3xl p-8 shadow-2xl border-2 border-gray-200 hover:border-purple-500 transition-all group"
                                >
                                    <div className="flex flex-col items-center text-center space-y-4">
                                        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <Plane size={40} className="text-white" />
                                        </div>
                                        <h2 className="text-2xl font-bold text-gray-800">승무원</h2>
                                        <p className="text-gray-600 leading-relaxed">
                                            승무원 전용 커뮤니티, 여행지 추천, CREW 전용 소통 공간을 이용할 수 있습니다.
                                        </p>
                                        <div className="pt-4">
                                            <div className="inline-flex items-center gap-2 bg-purple-50 text-purple-600 px-4 py-2 rounded-full font-semibold">
                                                <span>승무원으로 가입</span>
                                                <span>→</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.button>
                            </motion.div>
                        ) : (
                            // Step 2: Auth Form
                            <motion.div
                                key="auth-form"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                                className="max-w-md mx-auto"
                            >
                                {/* Selected Type Badge */}
                                {userType && mode === 'signup' && (
                                    <div className="mb-6 text-center">
                                        <div className={`inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold ${userType === 'traveler'
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-purple-100 text-purple-700'
                                            }`}>
                                            {userType === 'traveler' ? <User size={20} /> : <Plane size={20} />}
                                            <span>{userType === 'traveler' ? '일반 여행자' : '승무원'} 가입</span>
                                        </div>
                                    </div>
                                )}

                                <div className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                                    {/* Error Message */}
                                    {error && (
                                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                                            {error}
                                        </div>
                                    )}

                                    {/* Crew Airline Email Verification */}
                                    {mode === 'signup' && userType === 'crew' && (
                                        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Shield size={20} className="text-purple-600" />
                                                <span className="font-bold text-purple-800">승무원 인증</span>
                                            </div>
                                            <p className="text-sm text-purple-700 mb-3">
                                                항공사 사내 이메일로 인증이 필요합니다.
                                            </p>
                                            <div className="relative mb-3">
                                                <Plane size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" />
                                                <input
                                                    type="email"
                                                    placeholder="항공사 이메일 (예: name@koreanair.com)"
                                                    value={airlineEmail}
                                                    onChange={(e) => {
                                                        setAirlineEmail(e.target.value);
                                                        setAirlineInfo(getAirlineInfo(e.target.value));
                                                    }}
                                                    className="w-full pl-12 pr-4 py-3 bg-white rounded-xl border border-purple-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none transition-all text-gray-800 text-sm"
                                                />
                                            </div>
                                            {airlineInfo && (
                                                <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                                                    <CheckCircle size={16} className="text-green-600" />
                                                    <span className="text-sm text-green-700 font-semibold">
                                                        {airlineInfo.logo} {airlineInfo.name} 확인됨
                                                    </span>
                                                </div>
                                            )}
                                            {airlineEmail && !airlineInfo && airlineEmail.includes('@') && (
                                                <div className="text-xs text-red-500 mt-1">
                                                    지원되지 않는 항공사 도메인입니다.
                                                </div>
                                            )}
                                            <details className="mt-3">
                                                <summary className="text-xs text-purple-600 cursor-pointer">지원 항공사 목록 보기</summary>
                                                <div className="mt-2 grid grid-cols-2 gap-1">
                                                    {getAirlineList().map(a => (
                                                        <div key={a.domain} className="text-xs text-gray-600 py-1">
                                                            {a.logo} {a.name}
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        </div>
                                    )}

                                    {/* Email/Password Form */}
                                    <div className="space-y-4 mb-6">
                                        <div className="relative">
                                            <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="email"
                                                placeholder={mode === 'signup' && userType === 'crew' ? '개인 이메일 (로그인용)' : '이메일'}
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                                onKeyDown={(e) => e.key === 'Enter' && handleEmailAuth()}
                                            />
                                        </div>
                                        <div className="relative">
                                            <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                placeholder="비밀번호 (6자 이상)"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                className="w-full pl-12 pr-12 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                                onKeyDown={(e) => e.key === 'Enter' && handleEmailAuth()}
                                            />
                                            <button
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                        <button
                                            onClick={handleEmailAuth}
                                            disabled={loading}
                                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all hover:scale-105 shadow-md hover:shadow-lg disabled:opacity-50 disabled:hover:scale-100"
                                        >
                                            {loading ? '처리 중...' : mode === 'signup' ? '이메일로 가입하기' : '로그인'}
                                        </button>
                                    </div>

                                    {/* Divider */}
                                    <div className="flex items-center gap-3 my-6">
                                        <div className="flex-1 h-px bg-gray-300"></div>
                                        <span className="text-gray-500 text-sm font-medium">또는</span>
                                        <div className="flex-1 h-px bg-gray-300"></div>
                                    </div>

                                    <div className="space-y-3">
                                        {/* Google */}
                                        <button
                                            onClick={() => handleSocialLogin('google')}
                                            disabled={loading}
                                            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 px-6 py-4 rounded-xl font-semibold transition-all hover:scale-105 border-2 border-gray-300 shadow-md hover:shadow-lg disabled:opacity-50"
                                        >
                                            <span className="text-2xl">🔍</span>
                                            <span>구글 계정으로 계속하기</span>
                                        </button>

                                        {/* Kakao */}
                                        <button
                                            onClick={() => handleSocialLogin('kakao')}
                                            disabled={loading}
                                            className="w-full flex items-center justify-center gap-3 bg-yellow-400 hover:bg-yellow-500 text-gray-800 px-6 py-4 rounded-xl font-semibold transition-all hover:scale-105 shadow-md hover:shadow-lg disabled:opacity-50"
                                        >
                                            <span className="text-2xl">💬</span>
                                            <span>카카오 계정으로 계속하기</span>
                                        </button>
                                    </div>

                                    {/* Terms */}
                                    <div className="mt-6 text-center text-sm text-gray-500">
                                        <p>
                                            가입하시면{' '}
                                            <a href="#" className="text-blue-600 hover:underline">이용약관</a>
                                            {' '}및{' '}
                                            <a href="#" className="text-blue-600 hover:underline">개인정보처리방침</a>
                                            에 동의하게 됩니다.
                                        </p>
                                    </div>

                                    {/* Back Button */}
                                    {mode === 'signup' && (
                                        <button
                                            onClick={handleBack}
                                            className="mt-6 w-full text-gray-500 hover:text-gray-700 font-medium transition-colors"
                                        >
                                            ← 가입 유형 다시 선택
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Toggle Login/Signup */}
                    <div className="mt-8 text-center">
                        <p className="text-gray-600">
                            {mode === 'signup' ? '이미 계정이 있으신가요? ' : '계정이 없으신가요? '}
                            <button
                                onClick={() => {
                                    setMode(mode === 'signup' ? 'login' : 'signup');
                                    setError('');
                                    setUserType(mode === 'login' ? null : 'traveler');
                                }}
                                className="text-blue-600 hover:text-blue-700 font-semibold hover:underline"
                            >
                                {mode === 'signup' ? '로그인' : '회원가입'}
                            </button>
                        </p>
                    </div>

                    {/* Back to Home */}
                    <div className="mt-6 text-center">
                        <button
                            onClick={() => { navigate('/'); window.scrollTo(0, 0); }}
                            className="text-gray-500 hover:text-gray-700 font-medium transition-colors"
                        >
                            ← 홈으로 돌아가기
                        </button>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Signup;
