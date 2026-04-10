import { useState } from 'react';
import { Flag, X, CheckCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import { reportApi } from '../lib/db';

const REPORT_REASONS = [
  '스팸',
  '부적절한 콘텐츠',
  '사기/허위',
  '개인정보 노출',
  '기타',
];

const ReportButton = ({ postId, boardType, reportedUserId }) => {
  const { user, isLoggedIn } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleOpen = (e) => {
    e.stopPropagation();
    if (!isLoggedIn) {
      alert('로그인 후 신고할 수 있습니다.');
      return;
    }
    if (user?.id === reportedUserId) {
      alert('자신의 게시글은 신고할 수 없습니다.');
      return;
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) {
      alert('신고 사유를 선택해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await reportApi.create({
        reporter_id: user.id,
        reported_user_id: reportedUserId,
        post_id: postId,
        board_type: boardType,
        reason: reason + (note ? ` - ${note}` : ''),
        status: '대기',
      });
      setSubmitted(true);
      setTimeout(() => {
        setShowModal(false);
        setSubmitted(false);
        setReason('');
        setNote('');
      }, 1500);
    } catch (err) {
      console.error('신고 실패:', err);
      alert('신고 접수에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
        title="신고하기"
      >
        <Flag size={14} />
      </button>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              {submitted ? (
                <div className="py-8 text-center">
                  <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
                  <p className="text-lg font-bold text-gray-900">신고가 접수되었습니다</p>
                  <p className="text-gray-500 text-sm mt-2">관리자가 검토 후 조치하겠습니다.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <Flag size={20} className="text-red-500" />
                      게시글 신고
                    </h3>
                    <button
                      onClick={() => setShowModal(false)}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        신고 사유
                      </label>
                      <select
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all text-gray-700"
                        required
                      >
                        <option value="">사유를 선택해주세요</option>
                        {REPORT_REASONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        추가 설명 (선택)
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all resize-none text-gray-700"
                        rows="3"
                        placeholder="신고 사유를 자세히 적어주세요..."
                      />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowModal(false)}
                        className="flex-1 px-4 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 px-4 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Flag size={18} />}
                        신고하기
                      </button>
                    </div>
                  </form>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ReportButton;
