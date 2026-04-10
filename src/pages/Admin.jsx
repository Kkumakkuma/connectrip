import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, Users, FileText, BarChart3, AlertTriangle, Search,
  CheckCircle, XCircle, Ban, UserCheck, Loader2, ChevronDown,
  TrendingUp, Calendar, MessageSquare, ShoppingBag, Plane, HelpCircle
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { reportApi, blockApi, adminApi, commendationApi } from '../lib/db';
import { supabase } from '../lib/supabase';

const STATUS_COLORS = {
  '대기': 'bg-yellow-100 text-yellow-700',
  '처리중': 'bg-blue-100 text-blue-700',
  '완료': 'bg-green-100 text-green-700',
  '반려': 'bg-gray-100 text-gray-600',
};

const Admin = () => {
  const navigate = useNavigate();
  const { isLoggedIn, isAdmin, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('reports');
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [commendations, setCommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn || !isAdmin) return;
    fetchData();
  }, [activeTab, authLoading, isLoggedIn, isAdmin]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'reports') {
        const data = await reportApi.getAll();
        setReports(data || []);
      } else if (activeTab === 'users') {
        const data = await adminApi.getAllProfiles();
        setUsers(data || []);
      } else if (activeTab === 'stats') {
        const data = await adminApi.getStats();
        setStats(data);
      } else if (activeTab === 'commendations') {
        const { data, error } = await supabase
          .from('commendation_matches')
          .select('*, crew:profiles!commendation_matches_crew_user_id_fkey(id, name, user_type, avatar_url, airline), passenger:profiles!commendation_matches_passenger_user_id_fkey(id, name, user_type, avatar_url)')
          .in('status', ['commendation_submitted', 'verified', 'gift_sent'])
          .order('updated_at', { ascending: false });
        setCommendations(data || []);
      }
    } catch (err) {
      console.error('Admin data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Stats summary (always fetch for header cards)
  const [headerStats, setHeaderStats] = useState(null);
  useEffect(() => {
    if (authLoading || !isLoggedIn || !isAdmin) return;
    adminApi.getStats().then(setHeaderStats).catch(console.error);
  }, [authLoading, isLoggedIn, isAdmin]);

  const handleReportAction = async (reportId, status, reportedUserId = null) => {
    setActionLoading(reportId);
    try {
      const note = status === '완료' ? '관리자 처리 완료' : status === '반려' ? '관리자 반려' : '';
      await reportApi.updateStatus(reportId, status, note);
      if (status === '차단' && reportedUserId) {
        await blockApi.banUser(reportedUserId);
        await reportApi.updateStatus(reportId, '완료', '사용자 차단 처리');
      }
      await fetchData();
    } catch (err) {
      console.error('Report action failed:', err);
      alert('처리에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBanToggle = async (userId, isBanned) => {
    setActionLoading(userId);
    try {
      if (isBanned) {
        await blockApi.unbanUser(userId);
      } else {
        await blockApi.banUser(userId);
      }
      await fetchData();
    } catch (err) {
      console.error('Ban toggle failed:', err);
      alert('처리에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setActionLoading(userId);
    try {
      await adminApi.updateUserRole(userId, newRole);
      await fetchData();
    } catch (err) {
      console.error('Role change failed:', err);
      alert('역할 변경에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  // Daily aggregation helper
  const aggregateByDay = (items, days = 7) => {
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const count = items.filter(item => {
        const itemDate = new Date(item.created_at).toISOString().split('T')[0];
        return itemDate === dateStr;
      }).length;
      result.push({ label, count });
    }
    return result;
  };

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-32">
        <Loader2 size={48} className="text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-32">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Shield size={40} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">접근 권한이 없습니다</h2>
          <p className="text-gray-500 mb-8">관리자 계정으로 로그인해주세요.</p>
          <button
            onClick={() => navigate('/')}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const handleCommendationAction = async (matchId, action) => {
    setActionLoading(matchId);
    try {
      if (action === 'approve') {
        await commendationApi.verifyCommendation(matchId);
      } else if (action === 'reject') {
        await commendationApi.rejectCommendation(matchId);
      }
      await fetchData();
    } catch (err) {
      console.error('칭송 처리 실패:', err);
      alert('처리에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const tabs = [
    { id: 'reports', label: '신고 관리', icon: AlertTriangle },
    { id: 'commendations', label: '칭송 인증', icon: CheckCircle },
    { id: 'users', label: '회원 관리', icon: Users },
    { id: 'stats', label: '통계', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
            <Shield size={32} className="text-blue-600" />
            관리자 대시보드
          </h1>
          <p className="text-gray-500 mt-2">서비스 운영 현황을 한눈에 확인하세요.</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-100 rounded-xl text-blue-600"><Users size={20} /></div>
              <span className="text-sm font-medium text-gray-500">총 회원 수</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{headerStats?.totalUsers || 0}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 rounded-xl text-green-600"><TrendingUp size={20} /></div>
              <span className="text-sm font-medium text-gray-500">신규 가입 (오늘)</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{headerStats?.newUsersToday || 0}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-red-100 rounded-xl text-red-600"><AlertTriangle size={20} /></div>
              <span className="text-sm font-medium text-gray-500">신고 접수 (미처리)</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{headerStats?.pendingReports || 0}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-100 rounded-xl text-purple-600"><FileText size={20} /></div>
              <span className="text-sm font-medium text-gray-500">총 게시글 수</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{headerStats?.totalPosts || 0}</p>
          </motion.div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-20 text-center">
              <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
              <p className="text-gray-500">불러오는 중...</p>
            </div>
          ) : (
            <>
              {/* Reports Tab */}
              {activeTab === 'reports' && (
                <div className="p-4 md:p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">신고 목록</h2>
                  {reports.length === 0 ? (
                    <div className="py-16 text-center">
                      <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />
                      <p className="text-gray-500 text-lg">접수된 신고가 없습니다.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {reports.map((report) => (
                        <motion.div
                          key={report.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="border border-gray-100 rounded-xl p-4 md:p-5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_COLORS[report.status] || STATUS_COLORS['대기']}`}>
                                  {report.status}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {new Date(report.created_at).toLocaleDateString('ko-KR')} {new Date(report.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                                  {report.board_type}
                                </span>
                              </div>
                              <p className="text-sm text-gray-900 font-medium mb-1">
                                사유: <span className="text-red-600">{report.reason}</span>
                              </p>
                              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                                <span>신고자: <strong>{report.reporter?.name || '알 수 없음'}</strong></span>
                                <span>대상자: <strong className="text-red-600">{report.reported?.name || '알 수 없음'}</strong></span>
                                {report.post_id && <span>게시글 ID: {report.post_id}</span>}
                              </div>
                              {report.admin_note && (
                                <p className="text-xs text-gray-400 mt-1">관리자 메모: {report.admin_note}</p>
                              )}
                            </div>
                            {report.status === '대기' && (
                              <div className="flex flex-wrap gap-2 flex-shrink-0">
                                <button
                                  onClick={() => handleReportAction(report.id, '완료')}
                                  disabled={actionLoading === report.id}
                                  className="flex items-center gap-1 px-3 py-2 bg-green-100 text-green-700 rounded-lg text-xs font-bold hover:bg-green-200 transition-colors disabled:opacity-50"
                                >
                                  {actionLoading === report.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                                  처리완료
                                </button>
                                <button
                                  onClick={() => handleReportAction(report.id, '반려')}
                                  disabled={actionLoading === report.id}
                                  className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
                                >
                                  <XCircle size={14} /> 반려
                                </button>
                                <button
                                  onClick={() => handleReportAction(report.id, '차단', report.reported_user_id)}
                                  disabled={actionLoading === report.id}
                                  className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition-colors disabled:opacity-50"
                                >
                                  <Ban size={14} /> 사용자 차단
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Users Tab */}
              {activeTab === 'users' && (
                <div className="p-4 md:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-bold text-gray-900">회원 목록 ({filteredUsers.length}명)</h2>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                      <input
                        type="text"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="이름, 이메일로 검색..."
                        className="pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm w-full sm:w-64"
                      />
                    </div>
                  </div>

                  {/* Mobile card layout + Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-3 px-4 font-bold text-gray-500">이름</th>
                          <th className="text-left py-3 px-4 font-bold text-gray-500">이메일</th>
                          <th className="text-left py-3 px-4 font-bold text-gray-500">유형</th>
                          <th className="text-left py-3 px-4 font-bold text-gray-500">포인트</th>
                          <th className="text-left py-3 px-4 font-bold text-gray-500">가입일</th>
                          <th className="text-left py-3 px-4 font-bold text-gray-500">상태</th>
                          <th className="text-right py-3 px-4 font-bold text-gray-500">액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-4 font-medium text-gray-900">{u.name || '-'}</td>
                            <td className="py-3 px-4 text-gray-500">{u.email || '-'}</td>
                            <td className="py-3 px-4">
                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                u.user_type === 'crew' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {u.user_type === 'crew' ? '승무원' : '여행자'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-600">{u.points_balance || 0}P</td>
                            <td className="py-3 px-4 text-gray-500 text-xs">
                              {u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}
                            </td>
                            <td className="py-3 px-4">
                              {u.is_banned ? (
                                <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">차단됨</span>
                              ) : u.role === 'admin' ? (
                                <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">관리자</span>
                              ) : (
                                <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">정상</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleBanToggle(u.id, u.is_banned)}
                                  disabled={actionLoading === u.id}
                                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                                    u.is_banned
                                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                                  }`}
                                >
                                  {actionLoading === u.id ? <Loader2 size={12} className="animate-spin" /> : u.is_banned ? '해제' : '차단'}
                                </button>
                                <select
                                  value={u.role || 'user'}
                                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                  disabled={actionLoading === u.id}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500 disabled:opacity-50"
                                >
                                  <option value="user">일반</option>
                                  <option value="admin">관리자</option>
                                </select>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden space-y-3">
                    {filteredUsers.map((u) => (
                      <div key={u.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-bold text-gray-900">{u.name || '-'}</p>
                            <p className="text-xs text-gray-500">{u.email || '-'}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                              u.user_type === 'crew' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {u.user_type === 'crew' ? '승무원' : '여행자'}
                            </span>
                            {u.is_banned ? (
                              <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">차단됨</span>
                            ) : u.role === 'admin' ? (
                              <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">관리자</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                          <span>{u.points_balance || 0}P</span>
                          <span>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleBanToggle(u.id, u.is_banned)}
                            disabled={actionLoading === u.id}
                            className={`flex-1 text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 text-center ${
                              u.is_banned
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                          >
                            {u.is_banned ? '차단 해제' : '차단'}
                          </button>
                          <select
                            value={u.role || 'user'}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            disabled={actionLoading === u.id}
                            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
                          >
                            <option value="user">일반</option>
                            <option value="admin">관리자</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commendation Review Tab */}
              {activeTab === 'commendations' && (
                <div className="p-4 md:p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">칭송 인증 검토</h2>
                  {commendations.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                      <CheckCircle size={48} className="mx-auto mb-4 opacity-30" />
                      <p className="font-semibold">검토할 칭송 인증이 없습니다</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {commendations.map((match) => (
                        <div key={match.id} className="bg-white rounded-xl border border-gray-200 p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Plane size={16} className="text-blue-500" />
                                <span className="font-bold text-gray-800">{match.flight_number}</span>
                                <span className="text-sm text-gray-500">{match.flight_date}</span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span>승무원: <strong className="text-gray-700">{match.crew?.name || '-'}</strong> {match.crew?.airline && `(${match.crew.airline})`}</span>
                                <span>승객: <strong className="text-gray-700">{match.passenger?.name || '-'}</strong></span>
                              </div>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                              match.status === 'commendation_submitted' ? 'bg-yellow-100 text-yellow-700' :
                              match.status === 'verified' ? 'bg-green-100 text-green-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {match.status === 'commendation_submitted' ? '검토 대기' :
                               match.status === 'verified' ? '승인 완료' : '선물 발송'}
                            </span>
                          </div>

                          {match.commendation_screenshot_url && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 mb-2 font-semibold">칭송 인증 스크린샷:</p>
                              <img
                                src={match.commendation_screenshot_url}
                                alt="칭송 캡쳐"
                                className="max-w-full max-h-64 rounded-lg border border-gray-200 object-contain"
                              />
                            </div>
                          )}

                          {match.status === 'commendation_submitted' && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleCommendationAction(match.id, 'approve')}
                                disabled={actionLoading === match.id}
                                className="flex items-center gap-1.5 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                              >
                                {actionLoading === match.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                                승인
                              </button>
                              <button
                                onClick={() => handleCommendationAction(match.id, 'reject')}
                                disabled={actionLoading === match.id}
                                className="flex items-center gap-1.5 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                              >
                                <XCircle size={14} />
                                반려
                              </button>
                            </div>
                          )}

                          {match.status === 'verified' && (
                            <div className="flex items-center gap-3">
                              <p className="text-sm text-green-600 font-semibold">✓ 승인 완료</p>
                              <button
                                onClick={async () => {
                                  const pts = prompt('승객에게 보낼 선물 포인트를 입력하세요:', '5000');
                                  if (!pts) return;
                                  const amount = parseInt(pts);
                                  if (isNaN(amount) || amount <= 0) { alert('올바른 금액을 입력하세요.'); return; }
                                  setActionLoading(match.id);
                                  try {
                                    await commendationApi.sendGift(match.id, amount, '관리자 발송: 칭송 감사 선물');
                                    const { pointsApi } = await import('../lib/db');
                                    await pointsApi.addTransaction(match.passenger_user_id, amount, 'gift_received', `칭송 감사 선물 (${match.flight_number})`);
                                    await fetchData();
                                    alert(`승객에게 ${amount.toLocaleString()}P 선물 발송 완료!`);
                                  } catch (err) {
                                    console.error('선물 발송 실패:', err);
                                    alert('선물 발송에 실패했습니다.');
                                  } finally { setActionLoading(null); }
                                }}
                                disabled={actionLoading === match.id}
                                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                              >
                                {actionLoading === match.id ? <Loader2 size={14} className="animate-spin" /> : <span>🎁</span>}
                                선물 발송
                              </button>
                            </div>
                          )}
                          {match.status === 'gift_sent' && (
                            <p className="text-sm text-purple-600 font-semibold">✓ 선물 발송 완료 ({match.gift_points?.toLocaleString()}P)</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Stats Tab */}
              {activeTab === 'stats' && stats && (
                <div className="p-4 md:p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">통계</h2>

                  {/* Board post counts */}
                  <div className="mb-8">
                    <h3 className="text-sm font-bold text-gray-500 mb-4">게시판별 글 수</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: '동행 게시판', count: stats.boardCounts.companion, icon: Users, color: 'blue' },
                        { label: '여행 Q&A', count: stats.boardCounts.qna, icon: HelpCircle, color: 'green' },
                        { label: '장터', count: stats.boardCounts.market, icon: ShoppingBag, color: 'purple' },
                        { label: '크루 전용', count: stats.boardCounts.crew, icon: Plane, color: 'orange' },
                      ].map((item) => (
                        <div key={item.label} className={`bg-${item.color}-50 rounded-xl p-4 border border-${item.color}-100`}>
                          <div className="flex items-center gap-2 mb-2">
                            <item.icon size={16} className={`text-${item.color}-600`} />
                            <span className="text-xs font-medium text-gray-500">{item.label}</span>
                          </div>
                          <p className="text-2xl font-black text-gray-900">{item.count}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Daily signups chart */}
                  <div className="mb-8">
                    <h3 className="text-sm font-bold text-gray-500 mb-4">일별 가입자 수 (최근 7일)</h3>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-end gap-2 h-32">
                        {aggregateByDay(stats.recentUsers).map((day, i) => {
                          const maxCount = Math.max(...aggregateByDay(stats.recentUsers).map(d => d.count), 1);
                          const height = (day.count / maxCount) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-xs font-bold text-gray-600">{day.count}</span>
                              <div
                                className="w-full bg-blue-500 rounded-t-lg transition-all"
                                style={{ height: `${Math.max(height, 4)}%` }}
                              />
                              <span className="text-xs text-gray-400">{day.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Daily posts chart */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-500 mb-4">일별 글 수 (최근 7일)</h3>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-end gap-2 h-32">
                        {aggregateByDay(stats.recentPosts).map((day, i) => {
                          const maxCount = Math.max(...aggregateByDay(stats.recentPosts).map(d => d.count), 1);
                          const height = (day.count / maxCount) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-xs font-bold text-gray-600">{day.count}</span>
                              <div
                                className="w-full bg-purple-500 rounded-t-lg transition-all"
                                style={{ height: `${Math.max(height, 4)}%` }}
                              />
                              <span className="text-xs text-gray-400">{day.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* RLS Note */}
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <p className="text-xs text-yellow-700">
            <strong>NOTE:</strong> 관리자가 모든 신고를 조회하려면 Supabase RLS 정책 업데이트가 필요합니다.
            reports 테이블에 <code className="bg-yellow-100 px-1 rounded">auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')</code> 조건의 SELECT 정책을 추가해주세요.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Admin;
