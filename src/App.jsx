import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Signup from './pages/Signup';
import SignupComplete from './pages/SignupComplete';
import ProfileCompleteGate from './components/ProfileCompleteGate';
import Destinations from './components/Destinations';
import TravelQnA from './components/TravelQnA';
import MarketBoard from './components/MarketBoard';
import CrewOnly from './components/CrewOnly';
import Promotions from './components/Promotions';
import CompanionBoard from './components/CompanionBoard';
import RegionalBoard from './components/RegionalBoard';
import MyPage from './components/MyPage';
import Footer from './components/Footer';
import Search from './pages/Search';
import Admin from './pages/Admin';
import PushPermission from './components/PushPermission';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';

function App() {
  const [activeCategory, setActiveCategory] = useState('companion');
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  // Real-time keyword monitoring disabled - causes infinite loading on page refresh
  // TODO: Re-enable when Supabase realtime-js stability is resolved
  // The subscriptions cause Maximum call stack exceeded on unsubscribe and
  // corrupt client state after auth changes, breaking all subsequent data fetches
  return (
    <Router>
      <ProfileCompleteGate />
      <div className="App">
        <Navbar />
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  activeCategory={activeCategory}
                  setActiveCategory={setActiveCategory}
                />
              }
            />
            <Route path="/signup" element={<Signup />} />
            <Route path="/signup/complete" element={<SignupComplete />} />
            <Route path="/companion" element={<CompanionBoard />} />
            <Route path="/companion/:regionId" element={<RegionalBoard />} />
            <Route path="/qna" element={<div className="py-20"><TravelQnA /></div>} />
            <Route path="/market" element={<div className="py-20"><MarketBoard /></div>} />
            <Route path="/crew" element={<div className="py-20"><CrewOnly /></div>} />
            <Route path="/search" element={<Search />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/recommend" element={<div className="py-20"><Destinations /></div>} />
            <Route path="/recommend/:regionId" element={<div className="py-20"><Destinations /></div>} />
            <Route path="/reviews" element={<div className="py-20"><Promotions /></div>} />
            <Route path="/reviews/:regionId" element={<div className="py-20"><Promotions /></div>} />
            <Route
              path="/mypage"
              element={
                <div className="py-20">
                  <MyPage />
                </div>
              }
            />
          </Routes>
        </main>
        <Footer />

        {/* Push Notification Permission Banner */}
        <PushPermission />

        {/* Global Toast Notifications */}
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full sm:w-80">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                className={`p-4 rounded-2xl shadow-2xl border flex items-start gap-3 ${toast.type === 'keyword'
                    ? 'bg-blue-600 text-white border-blue-400'
                    : 'bg-white text-gray-800 border-gray-100'
                  }`}
              >
                <div className={`p-2 rounded-xl ${toast.type === 'keyword' ? 'bg-white/20' : 'bg-blue-100 text-blue-600'}`}>
                  <Bell size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold leading-tight">{toast.message}</p>
                </div>
                <button
                  onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X size={16} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Router>
  );
}

export default App;
