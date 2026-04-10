import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, User, LogOut, Plane, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import NotificationBell from './NotificationBell';
import SearchBar from './SearchBar';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { isLoggedIn, isCrew, isAdmin, signOut, profile } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleAuthClick = () => {
    if (isLoggedIn) {
      navigate('/mypage');
    } else {
      navigate('/signup');
      window.scrollTo(0, 0);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
    window.scrollTo(0, 0);
  };

  const navLinks = [
    { name: '여행 동행자 모집', to: '/companion', sub: [
      { name: '🏰 유럽', to: '/companion/europe' },
      { name: '🗽 미주', to: '/companion/americas' },
      { name: '🦁 아프리카', to: '/companion/africa' },
      { name: '🏝️ 동남아', to: '/companion/southeast-asia' },
      { name: '🐅 아시아', to: '/companion/asia' },
      { name: '🦘 오세아니아', to: '/companion/oceania' },
    ]},
    { name: '여행후기 및 Q&A', to: '/qna', sub: [
      { name: '📝 여행 후기', to: '/qna?tab=review' },
      { name: '❓ Q&A 게시판', to: '/qna?tab=qna' },
    ]},
    { name: '물품거래 및 나눔', to: '/market', sub: [
      { name: '🛍️ 물품팔아요', to: '/market?tab=sell' },
      { name: '🔍 물품구해요', to: '/market?tab=buy' },
      { name: '💝 무료 나눔', to: '/market?tab=share' },
      { name: '👥 공동구매', to: '/market?tab=groupbuy' },
    ]},
    { name: '여행상품 홍보 및 후기', to: '/reviews', sub: [
      { name: '📢 홍보 게시판', to: '/reviews?tab=promo' },
      { name: '💬 후기 게시판', to: '/reviews?tab=review' },
    ]},
    { name: '승무원 추천지', to: '/recommend', sub: [
      { name: '🏰 유럽', to: '/recommend/europe' },
      { name: '🗽 미주', to: '/recommend/americas' },
      { name: '🦁 아프리카', to: '/recommend/africa' },
      { name: '🏝️ 동남아', to: '/recommend/southeast-asia' },
      { name: '🐅 아시아', to: '/recommend/asia' },
      { name: '🦘 오세아니아', to: '/recommend/oceania' },
    ]},
    ...(isCrew ? [{ name: 'CREW 전용', to: '/crew', sub: [
      { name: '💬 자유게시판', to: '/crew?tab=free' },
      { name: '✈️ 레이오버 정보', to: '/crew?tab=layover' },
      { name: '🏷️ 할인 혜택', to: '/crew?tab=deals' },
    ]}] : []),
    ...(isAdmin ? [{ name: '관리자', to: '/admin', sub: [
      { name: '🚨 신고 관리', to: '/admin?tab=reports' },
      { name: '✅ 칭송 인증', to: '/admin?tab=commendations' },
      { name: '👥 회원 관리', to: '/admin?tab=users' },
      { name: '📊 통계', to: '/admin?tab=stats' },
    ]}] : [])
  ];

  const [hoveredMenu, setHoveredMenu] = useState(null);

  return (
    <nav
      className="fixed top-0 left-0 w-full z-50 bg-white/95 backdrop-blur-md shadow-md transition-all duration-300"
      style={{
        padding: isScrolled ? '0.6rem 0' : '0.85rem 0',
      }}
    >
      <div className="w-full mx-auto px-6 flex items-center justify-between gap-6">
        {/* Section 1: Logo - Left */}
        <a
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
            window.scrollTo(0, 0);
          }}
          className="cursor-pointer group flex-shrink-0"
          style={{ isolation: 'isolate' }}
        >
          <img
            src="/connectrip-logo.png"
            alt="ConnectTrip"
            className="h-14 w-auto object-contain transition-transform group-hover:scale-105"
            style={{
              filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))'
            }}
          />
        </a>

        {/* Section 2: Navigation Menu - Center */}
        <div className="hidden lg:flex items-center gap-8 flex-1 justify-center min-w-0">
          {navLinks.map((link, idx) => (
            <div
              key={link.name}
              className="relative"
              onMouseEnter={() => setHoveredMenu(idx)}
              onMouseLeave={() => setHoveredMenu(null)}
            >
              <button
                onClick={() => {
                  navigate(link.to);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  setHoveredMenu(null);
                }}
                className="text-[16px] text-gray-700 hover:text-blue-600 font-semibold transition-colors cursor-pointer whitespace-nowrap bg-transparent border-none py-2"
              >
                {link.name}
              </button>
              {link.sub && hoveredMenu === idx && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 z-50">
                  <div className="bg-white rounded-xl shadow-xl border border-gray-100 py-2 min-w-[180px]">
                    {link.sub.map((sub) => (
                      <button
                        key={sub.name}
                        onClick={() => {
                          navigate(sub.to);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                          setHoveredMenu(null);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-600 font-medium transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap"
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <SearchBar className="w-36" />
        </div>

        {/* Section 3: Auth Buttons - Right */}
        <div className="hidden lg:flex items-center flex-shrink-0">
          {!isLoggedIn ? (
            <div className="flex items-center gap-4">
              <button
                onClick={() => { navigate('/signup'); window.scrollTo(0, 0); }}
                className="text-[15px] text-gray-700 hover:text-blue-600 font-semibold transition-colors whitespace-nowrap"
              >
                회원가입
              </button>
              <button
                onClick={() => { navigate('/signup?mode=login'); window.scrollTo(0, 0); }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-full text-[15px] font-semibold transition-all hover:scale-105 shadow-md whitespace-nowrap"
              >
                <User size={17} />
                로그인
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <NotificationBell />
              {isCrew && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full font-bold">CREW</span>
              )}
              <button
                onClick={() => navigate('/mypage')}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-full text-[14px] font-semibold transition-all hover:scale-105 shadow-md whitespace-nowrap"
              >
                <User size={16} />
                {profile?.name || '마이페이지'}
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-gray-500 hover:text-red-600 text-[14px] font-medium transition-colors whitespace-nowrap"
              >
                <LogOut size={16} />
                로그아웃
              </button>
            </div>
          )}
        </div>

        {/* Mobile Toggle */}
        <button
          className="lg:hidden text-gray-700"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="lg:hidden absolute top-full left-0 w-full bg-white shadow-lg"
          >
            <div className="flex flex-col items-center gap-4 p-6">
              {navLinks.map((link) => (
                <button
                  key={link.name}
                  onClick={() => {
                    navigate(link.to);
                    setIsMobileMenuOpen(false);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="text-lg font-semibold text-gray-700 hover:text-blue-600 cursor-pointer bg-transparent border-none w-full"
                >
                  {link.name}
                </button>
              ))}
              <SearchBar
                className="w-full"
                onNavigate={() => setIsMobileMenuOpen(false)}
              />
              <div className="w-full flex flex-col gap-3">
                <button
                  onClick={() => {
                    handleAuthClick('traveler');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl font-semibold transition-all shadow-md"
                >
                  <User size={18} />
                  {isLoggedIn ? '마이페이지' : '일반 로그인'}
                </button>
                {!isLoggedIn && (
                  <button
                    onClick={() => {
                      handleAuthClick('crew');
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 rounded-xl font-semibold transition-all shadow-md"
                  >
                    <Plane size={18} />
                    승무원 로그인
                  </button>
                )}
              </div>
              {isLoggedIn && (
                <button
                  onClick={() => {
                    handleLogout();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 py-3 rounded-xl font-semibold transition-colors"
                >
                  <LogOut size={18} />
                  로그아웃
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
