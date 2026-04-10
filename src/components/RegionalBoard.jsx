import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Users, Calendar, MessageCircle, Edit3, ArrowLeft, X, Search, Loader2 } from 'lucide-react';
import Pagination from './Pagination';
import ReportButton from './ReportButton';
import ShareButtons from './ShareButtons';
import { useAuth } from '../lib/AuthContext';
import { companionApi } from '../lib/db';
import LoginPrompt from './LoginPrompt';

const regions = [
    { id: 'europe', name: '유럽', icon: '🏰' },
    { id: 'americas', name: '미주', icon: '🗽' },
    { id: 'africa', name: '아프리카', icon: '🦁' },
    { id: 'southeast-asia', name: '동남아', icon: '🏝️' },
    { id: 'asia', name: '아시아', icon: '🐅' },
    { id: 'oceania', name: '오세아니아', icon: '🦘' },
];

const RegionalBoard = () => {
    const { user, profile, isLoggedIn } = useAuth();
    const { regionId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const region = regions.find(r => r.id === regionId);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        country: '',
        date: '',
        members: '',
        content: ''
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
    const itemsPerPage = 6;

    // URL 변경 시 스크롤 최상단으로
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.key]);

    // Supabase에서 게시글 불러오기
    useEffect(() => {
        if (!regionId) return;
        const fetchPosts = async () => {
            setLoading(true);
            try {
                const data = await companionApi.getByRegion(regionId);
                setPosts(data || []);
            } catch (err) {
                console.error('게시글 로딩 실패:', err);
                setPosts([]);
            } finally {
                setLoading(false);
            }
        };
        fetchPosts();
    }, [regionId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        try {
            const newPost = await companionApi.create({
                region_id: regionId,
                title: formData.title,
                country: formData.country,
                travel_date: formData.date,
                members: formData.members,
                content: formData.content,
                author: profile?.name || '익명',
                user_id: user.id,
            });
            setPosts(prev => [newPost, ...prev]);
            setFormData({ title: '', country: '', date: '', members: '', content: '' });
            setShowModal(false);
        } catch (err) {
            console.error('게시글 등록 실패:', err);
            alert('게시글 등록에 실패했습니다. 다시 시도해주세요.');
        }
    };

    if (!region) {
        return <div className="py-40 text-center">지역을 찾을 수 없습니다.</div>;
    }

    return (
        <div className="pt-32 pb-24">
            <div className="max-w-6xl mx-auto px-4">
                {/* Back Button */}
                <button
                    onClick={() => navigate('/companion')}
                    className="flex items-center gap-2 text-blue-600 font-bold mb-10 hover:translate-x-[-5px] transition-transform"
                >
                    <ArrowLeft size={20} /> 지역 선택으로 돌아가기
                </button>

                <div className="bg-white rounded-2xl sm:rounded-[4rem] shadow-2xl shadow-gray-200 border border-gray-50 overflow-hidden">
                    <div className="bg-gray-50/80 px-4 py-6 sm:px-12 sm:py-10 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6">
                        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
                            <span className="text-4xl sm:text-6xl p-2 sm:p-4 bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 flex-shrink-0">{region.icon}</span>
                            <div className="min-w-0">
                                <h1 className="text-xl sm:text-4xl font-black text-gray-900 break-words">{region.name} 지역 동행자 모집</h1>
                                <p className="text-gray-500 mt-1 sm:mt-2 font-medium text-sm sm:text-base">우리와 함께 {region.name}를 여행할 소중한 인연을 만나보세요.</p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                setShowModal(true);
                            }}
                            className="flex items-center gap-2 sm:gap-3 px-5 py-3 sm:px-8 sm:py-4 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 hover:scale-105 active:scale-95 w-full sm:w-auto justify-center text-sm sm:text-base flex-shrink-0"
                        >
                            <Edit3 size={20} /> 새 글 작성하기
                        </button>
                    </div>

                    <div className="p-4 sm:p-12">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={regionId}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0 }}
                                className="grid grid-cols-1 md:grid-cols-3 gap-6"
                            >
                                {loading ? (
                                    <div className="col-span-full py-32 text-center">
                                        <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
                                        <p className="text-gray-500 text-lg">게시글을 불러오는 중...</p>
                                    </div>
                                ) : posts.length > 0 ? (
                                    <>
                                        {posts
                                            .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                            .map((post) => (
                                                <div key={post.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 cursor-pointer group">
                                                    {/* 이미지 섹션 */}
                                                    <div className="relative h-48 overflow-hidden bg-gradient-to-br from-blue-400 to-purple-500">
                                                        <img
                                                            src={`https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=800&auto=format&fit=crop`}
                                                            alt={post.title}
                                                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                        />
                                                        <div className="absolute top-3 right-3 flex items-center gap-2">
                                                            <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">ACTIVE</span>
                                                            <ReportButton postId={post.id} boardType="companion" reportedUserId={post.user_id} />
                                                        </div>
                                                    </div>

                                                    {/* 컨텐츠 섹션 */}
                                                    <div className="p-6">
                                                        <h3 className="font-bold text-xl mb-3 line-clamp-1 group-hover:text-blue-600 transition-colors">
                                                            <span className="text-blue-600">[{post.country}]</span> {post.title}
                                                        </h3>

                                                        <div className="space-y-2 mb-4 text-sm">
                                                            <div className="flex items-center gap-2 text-gray-600">
                                                                <Users size={16} className="text-blue-500" />
                                                                <span>모집 인원: <strong className="text-gray-900">{post.members}명</strong></span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-gray-600">
                                                                <Calendar size={16} className="text-blue-500" />
                                                                <span>여행 일정: <strong className="text-gray-900">{post.travel_date || post.date}</strong></span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-gray-600">
                                                                <MapPin size={16} className="text-blue-500" />
                                                                <span>작성자: <strong className="text-gray-900">{post.author}</strong></span>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            <button className="flex-1 py-3 bg-gray-50 text-gray-600 rounded-xl font-bold hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-center gap-2">
                                                                <MessageCircle size={18} /> 실시간 그룹 채팅하기
                                                            </button>
                                                            <ShareButtons title={`${post.title} - ConnectTrip 동행 모집`} description={post.content} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}

                                        {/* 페이지네이션 */}
                                        <div className="col-span-full">
                                            <Pagination
                                                currentPage={currentPage}
                                                totalPages={Math.ceil(posts.length / itemsPerPage)}
                                                onPageChange={setCurrentPage}
                                                color="blue"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="col-span-full py-16 sm:py-32 text-center border-4 border-dashed border-gray-100 rounded-2xl sm:rounded-[4rem]">
                                        <div className="text-8xl mb-10 opacity-50">🧭</div>
                                        <h4 className="text-3xl font-black text-gray-400 mb-4">등록된 모집글이 없습니다</h4>
                                        <p className="text-gray-400 text-lg mb-10">아직 아무도 {region.name}행 비행기를 예약하지 않았네요!</p>
                                        <button
                                            onClick={() => {
                                                if (!isLoggedIn) { setShowLoginPrompt(true); return; }
                                                setShowModal(true);
                                            }}
                                            className="px-10 py-5 bg-blue-50 text-blue-600 rounded-[1.5rem] font-black hover:bg-blue-600 hover:text-white transition-all shadow-md"
                                        >
                                            가장 먼저 모집글 올리기
                                        </button>
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>

                        {/* 검색 바 */}
                        <div className="mt-8">
                            <div className="relative max-w-2xl mx-auto">
                                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="제목, 국가, 작성자 등으로 검색하세요..."
                                    className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-700 font-medium"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 글 작성 모달 */}
            <AnimatePresence>
                {showModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setShowModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white sm:rounded-3xl p-6 sm:p-8 max-w-2xl w-full h-full sm:h-auto max-h-screen sm:max-h-[90vh] overflow-y-auto shadow-2xl"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl sm:text-2xl font-bold">동행자 모집글 작성</h3>
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        제목
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder="예: 3월 파리 여행 동행 구합니다!"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        국가/도시
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.country}
                                        onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                        placeholder="예: 파리, 런던, 로마 등"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            여행 일정
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            모집 인원
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.members}
                                            onChange={(e) => setFormData({ ...formData, members: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                                            placeholder="예: 2/4"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        상세 내용
                                    </label>
                                    <textarea
                                        value={formData.content}
                                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
                                        rows="6"
                                        placeholder="여행 계획, 선호하는 동행자 스타일 등을 자유롭게 작성해주세요"
                                        required
                                    />
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="flex-1 px-6 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 btn-primary"
                                    >
                                        등록하기
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <LoginPrompt isOpen={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
        </div>
    );
};

export default RegionalBoard;
