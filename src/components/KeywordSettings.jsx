import { useState, useEffect } from 'react';
import { Bell, X, Plus, Hash, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import { keywordsApi } from '../lib/db';

const KeywordSettings = () => {
    const { user, isLoggedIn } = useAuth();
    const [keywords, setKeywords] = useState([]);
    const [newKeyword, setNewKeyword] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isLoggedIn || !user) {
            setKeywords([]);
            setLoading(false);
            return;
        }
        const fetchKeywords = async () => {
            setLoading(true);
            try {
                const data = await keywordsApi.getMyKeywords(user.id);
                setKeywords(data || []);
            } catch (err) {
                console.error('키워드 로딩 실패:', err);
                setKeywords([]);
            } finally {
                setLoading(false);
            }
        };
        fetchKeywords();
    }, [user, isLoggedIn]);

    const addKeyword = async (e) => {
        e.preventDefault();
        if (!isLoggedIn) {
            alert('로그인 후 키워드를 등록할 수 있습니다.');
            return;
        }
        const trimmed = newKeyword.trim();
        if (trimmed && !keywords.find(k => k.keyword === trimmed)) {
            try {
                const newItem = await keywordsApi.add(user.id, trimmed);
                setKeywords(prev => [newItem, ...prev]);
                setNewKeyword('');
            } catch (err) {
                console.error('키워드 추가 실패:', err);
                alert('키워드 추가에 실패했습니다.');
            }
        }
    };

    const removeKeyword = async (keywordObj) => {
        try {
            await keywordsApi.remove(keywordObj.id);
            setKeywords(prev => prev.filter(k => k.id !== keywordObj.id));
        } catch (err) {
            console.error('키워드 삭제 실패:', err);
            alert('키워드 삭제에 실패했습니다.');
        }
    };

    return (
        <div className="keyword-settings">
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', fontSize: '1.2rem', fontWeight: '800' }}>
                <Bell size={20} className="text-blue-600" /> 키워드 알림 설정
            </h4>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1.5rem' }}>
                관심 있는 키워드를 등록하면 관련 게시글이 올라올 때 알림을 보내드려요. (최대 10개)
            </p>

            <form onSubmit={addKeyword} style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Hash size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
                    <input
                        type="text"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        placeholder="예: 스탠리, 파리, 동행"
                        style={{
                            width: '100%',
                            padding: '0.8rem 0.8rem 0.8rem 2.2rem',
                            borderRadius: '12px',
                            border: '2px solid #eee',
                            outline: 'none',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary-color)'}
                        onBlur={(e) => e.target.style.borderColor = '#eee'}
                    />
                </div>
                <button
                    type="submit"
                    disabled={keywords.length >= 10}
                    style={{
                        padding: '0 1.2rem',
                        background: keywords.length >= 10 ? '#ccc' : 'var(--primary-color)',
                        color: 'white',
                        borderRadius: '12px',
                        fontWeight: 'bold',
                        border: 'none',
                        cursor: keywords.length >= 10 ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Plus size={20} />
                </button>
            </form>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {loading ? (
                    <div style={{ width: '100%', textAlign: 'center', padding: '1rem' }}>
                        <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto', color: 'var(--primary-color)' }} />
                    </div>
                ) : (
                    <>
                        <AnimatePresence>
                            {keywords.map(kw => (
                                <motion.span
                                    key={kw.id}
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.8, opacity: 0 }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 14px',
                                        background: '#f0f7ff',
                                        color: 'var(--primary-color)',
                                        borderRadius: '100px',
                                        fontSize: '0.9rem',
                                        fontWeight: '700',
                                        border: '1px solid #d0e5ff'
                                    }}
                                >
                                    #{kw.keyword}
                                    <X
                                        size={14}
                                        style={{ cursor: 'pointer', opacity: 0.6 }}
                                        onClick={() => removeKeyword(kw)}
                                    />
                                </motion.span>
                            ))}
                        </AnimatePresence>
                        {keywords.length === 0 && (
                            <p style={{ width: '100%', textAlign: 'center', padding: '1rem', color: '#aaa', fontSize: '0.85rem', border: '1px dashed #eee', borderRadius: '12px' }}>
                                {isLoggedIn ? '등록된 키워드가 없습니다.' : '로그인 후 키워드를 등록할 수 있습니다.'}
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default KeywordSettings;
