import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, X } from 'lucide-react';
import { nextQuery } from '../lib/safeNext';

// next: 로그인·가입을 마친 뒤 돌아올 우리 사이트 안의 경로(선택).
// 넘기지 않으면 기존과 똑같이 /signup, /signup?mode=login 으로만 이동한다 — 기존 호출부 회귀 없음.
const LoginPrompt = ({ isOpen, onClose, next }) => {
  const navigate = useNavigate();
  const nextQ = nextQuery(next);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center"
        >
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn size={28} className="text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">회원만 글을 쓸 수 있어요</h3>
          <p className="text-gray-500 mb-6">가입하고 바로 글을 작성해 보세요.</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={() => {
                onClose();
                navigate(`/signup${nextQuery(next, { first: true })}`);
                window.scrollTo(0, 0);
              }}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              회원가입
            </button>
          </div>
          <button
            onClick={() => {
              onClose();
              navigate(`/signup?mode=login${nextQ}`);
              window.scrollTo(0, 0);
            }}
            className="mt-4 text-sm text-gray-500 hover:text-blue-600 transition-colors"
          >
            이미 계정이 있으신가요? <span className="font-semibold underline">로그인</span>
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default LoginPrompt;
