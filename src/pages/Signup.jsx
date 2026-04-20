import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Plane, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import SEOHead from '../components/SEOHead';

const Signup = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const location = useLocation();
    const { signIn, isLoggedIn } = useAuth();
    const [mode, setMode] = useState(searchParams.get('mode') === 'login' ? 'login' : 'signup');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isLoggedIn && !searchParams.get('mode')) {
            navigate('/');
        }
    }, [isLoggedIn, searchParams, navigate]);

    useEffect(() => {
        setError('');
        setEmail('');
        setPassword('');
        setMode(searchParams.get('mode') === 'login' ? 'login' : 'signup');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);

    const handleLogin = async (e) => {
        e?.preventDefault();
        if (!email || !password) {
            setError('이메일과 비밀번호를 입력해주세요.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await signIn(email, password);
            navigate('/');
            window.scrollTo(0, 0);
        } catch (err) {
            if (err.message.includes('Invalid login')) {
                setError('이메일 또는 비밀번호가 올바르지 않습니다.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-20">
            <SEOHead title={mode === 'signup' ? '회원가입 - ConnectTrip' : '로그인 - ConnectTrip'} description="ConnectTrip 이메일+SMS 2중 인증 가입. 실명 기반 안전한 여행 동행 커뮤니티." />
            <div className="max-w-7xl mx-auto px-4 pt-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="max-w-4xl mx-auto"
                >
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-black text-gray-800 mb-3">
                            {mode === 'signup' ? '회원가입' : '로그인'}
                        </h1>
                        <p className="text-gray-600 text-lg">
                            {mode === 'signup'
                                ? '가입 유형을 선택해주세요 (이메일 + 휴대폰 2중 인증)'
                                : '계정에 로그인하세요'}
                        </p>
                    </div>

                    <AnimatePresence mode="wait">
                        {mode === 'signup' ? (
                            <motion.div
                                key="type-cards"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                transition={{ duration: 0.25 }}
                            >
                                <div className="grid md:grid-cols-2 gap-6">
                                    {/* 일반 여행자 카드 → 즉시 /signup/email?type=traveler */}
                                    <motion.button
                                        onClick={() => navigate('/signup/email?type=traveler')}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="bg-white rounded-3xl p-8 shadow-2xl border-2 border-gray-200 hover:border-blue-500 transition-all group text-left"
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
                                                    <ArrowRight size={16} />
                                                </div>
                                            </div>
                                        </div>
                                    </motion.button>

                                    {/* 승무원 카드 → 즉시 /signup/email?type=crew, 페이지 안에서 항공사 이메일 인증 */}
                                    <motion.button
                                        onClick={() => navigate('/signup/email?type=crew')}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="bg-white rounded-3xl p-8 shadow-2xl border-2 border-gray-200 hover:border-purple-500 transition-all group text-left"
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
                                                    <ArrowRight size={16} />
                                                </div>
                                            </div>
                                        </div>
                                    </motion.button>
                                </div>

                                {/* 2중 인증 안내 */}
                                <div className="max-w-2xl mx-auto mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                                    <p className="text-sm text-blue-800 leading-relaxed">
                                        🔒 <strong>2중 인증 안내</strong> — 범죄 예방을 위해 이메일 인증과 휴대폰 본인 인증을 모두 진행합니다.
                                        추후 통신사 본인 인증이 도입되면 기존 회원도 의무 재인증이 필요합니다.
                                    </p>
                                </div>
                            </motion.div>
                        ) : (
                            /* 로그인 폼 */
                            <motion.div
                                key="login"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.25 }}
                                className="max-w-md mx-auto"
                            >
                                <div className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                                    {error && (
                                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                                            {error}
                                        </div>
                                    )}
                                    <form className="space-y-4" autoComplete="on" onSubmit={handleLogin}>
                                        <div className="relative">
                                            <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="email"
                                                name="email"
                                                autoComplete="username"
                                                placeholder="이메일"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                            />
                                        </div>
                                        <div className="relative">
                                            <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                name="password"
                                                autoComplete="current-password"
                                                placeholder="비밀번호"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                className="w-full pl-12 pr-12 py-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-4 rounded-xl font-semibold transition-all hover:scale-105 shadow-md hover:shadow-lg disabled:opacity-50 disabled:hover:scale-100"
                                        >
                                            {loading ? '처리 중...' : '로그인'}
                                        </button>
                                    </form>

                                    <div className="mt-6 text-center text-xs text-gray-500">
                                        <p>
                                            가입하시면{' '}
                                            <a href="#" className="text-blue-600 hover:underline">이용약관</a>
                                            {' '}및{' '}
                                            <a href="#" className="text-blue-600 hover:underline">개인정보처리방침</a>
                                            에 동의하게 됩니다.
                                        </p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="mt-8 text-center">
                        <p className="text-gray-600">
                            {mode === 'signup' ? '이미 계정이 있으신가요? ' : '계정이 없으신가요? '}
                            <button
                                onClick={() => {
                                    setMode(mode === 'signup' ? 'login' : 'signup');
                                    setError('');
                                }}
                                className="text-blue-600 hover:text-blue-700 font-semibold hover:underline"
                            >
                                {mode === 'signup' ? '로그인' : '회원가입'}
                            </button>
                        </p>
                    </div>

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
