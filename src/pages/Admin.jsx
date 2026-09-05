import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, Users, FileText, BarChart3, AlertTriangle, Search,
  CheckCircle, XCircle, Ban, UserCheck, Loader2, ChevronDown,
  TrendingUp, Calendar, MessageSquare, ShoppingBag, Plane, HelpCircle,
  Map as MapIcon
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { reportApi, blockApi, adminApi, commendationApi } from '../lib/db';
import { supabase } from '../lib/supabase';
import SEOHead from '../components/SEOHead';

const STATUS_COLORS = {
  '대기': 'bg-yellow-100 text-yellow-700',
  '처리중': 'bg-blue-100 text-blue-700',
  '완료': 'bg-green-100 text-green-700',
  '반려': 'bg-gray-100 text-gray-600',
};

const Admin = () => {
  const navigate = useNavigate();
  const { isLoggedIn, isAdmin, loading: sessionLoading, profileLoading, profileError } = useAuth();
  // isAdmin 은 프로필(role)에서 나오므로 프로필 도착 전까지는 '권한 없음' 을 띄우면 안 된다.
  const authLoading = sessionLoading || (isLoggedIn && profileLoading);
  // 프로필 조회가 실패했을 뿐인데 '권한 없음' 으로 단정하면 실제 관리자가 막힌다.
  const profileUnknown = isLoggedIn && !profileLoading && profileError;
  const [activeTab, setActiveTab] = useState('reports');
  const location = useLocation();

  // 네비 드롭다운 ?tab=(reports/commendations/users/stats) 반영
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab && ['reports', 'commendations', 'users', 'stats'].includes(tab)) setActiveTab(tab);
  }, [location]);
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
        // 답례품 발송에 승객 휴대폰이 필요한데 profiles 는 PII 컬럼이 잠겨 있어 RPC 로 받는다.
        const { data, error: cErr } = await supabase.rpc('admin_get_commendation_reviews');
        if (cErr) throw cErr;
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

  // 관리자 직접 지급 — 포인트 선물
  const handleGrantPoints = async (userId) => {
    const amountStr = prompt('선물할 포인트를 입력하세요 (숫자):', '10000');
    if (amountStr === null) return;
    if (!/^\d+$/.test(amountStr.trim())) { alert('숫자만 입력하세요.'); return; }
    const amount = parseInt(amountStr, 10);
    if (!Number.isInteger(amount) || amount < 1) { alert('1 이상의 숫자를 입력하세요.'); return; }
    const reason = prompt('지급 사유 (선택 — 기록에 남습니다):', '관리자 선물') || '';
    setActionLoading(userId);
    try {
      await adminApi.grantPoints(userId, amount, reason);
      await fetchData();
      alert(`${amount.toLocaleString()}P 지급 완료`);
    } catch (err) {
      console.error('Grant points failed:', err);
      alert('포인트 지급에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  // 관리자 직접 지급 — 매칭신청권 선물
  const handleGrantVouchers = async (userId) => {
    const qtyStr = prompt('선물할 매칭신청권 수량을 입력하세요:', '1');
    if (qtyStr === null) return;
    if (!/^\d+$/.test(qtyStr.trim())) { alert('숫자만 입력하세요.'); return; }
    const qty = parseInt(qtyStr, 10);
    if (!Number.isInteger(qty) || qty < 1) { alert('1 이상의 숫자를 입력하세요.'); return; }
    const reason = prompt('지급 사유 (선택):', '관리자 선물') || '';
    setActionLoading(userId);
    try {
      await adminApi.grantVouchers(userId, qty, reason);
      await fetchData();
      alert(`매칭신청권 ${qty}장 지급 완료`);
    } catch (err) {
      console.error('Grant vouchers failed:', err);
      alert('사용권 지급에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  // 재사용 해제 — 항공사 이메일(영구 1회 사용) / 차단당한 채 탈퇴한 번호.
  // 운영 DB RPC(admin_release_airline_email / admin_release_phone)가 관리자 권한을 검사한다.
  const [releaseEmail, setReleaseEmail] = useState('');
  const [releasePhone, setReleasePhone] = useState('');
  const [releaseMsg, setReleaseMsg] = useState('');
  const [releaseLoading, setReleaseLoading] = useState(null); // 'email' | 'phone'

  const handleRelease = async (kind) => {
    const value = (kind === 'email' ? releaseEmail : releasePhone).trim();
    if (!value) return;
    setReleaseLoading(kind);
    setReleaseMsg('');
    try {
      const { data, error } = kind === 'email'
        ? await supabase.rpc('admin_release_airline_email', { p_email: value })
        : await supabase.rpc('admin_release_phone', { p_phone: value });
      if (error) throw error;
      if (data === true) {
        setReleaseMsg(`해제했습니다: ${value}`);
        if (kind === 'email') setReleaseEmail(''); else setReleasePhone('');
      } else {
        setReleaseMsg(`해제할 기록이 없습니다: ${value}`);
      }
    } catch (err) {
      console.error('Release failed:', err);
      setReleaseMsg(`해제에 실패했습니다: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setReleaseLoading(null);
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

  // Daily aggregation helper — 서비스 기준시(KST) 고정.
  // 예전에는 집계 키를 toISOString()(UTC)으로, 막대 라벨은 로컬 날짜로 만들어 두 기준이
  // 9시간 어긋났다. 그래서 KST 00~09시의 가입·게시글이 전날 막대에 들어가고, 오전 9시 이전에
  // 대시보드를 열면 라벨과 내용이 하루 어긋났다. 키와 라벨을 같은 KST 값에서 뽑아 맞춘다.
  // CommendationMatching.jsx 의 KST 고정 방식과 동일하게, 접속 지역과 무관하게 KST 로 묶는다.
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstKey = (dt) => {
    const t = dt.getTime();
    if (Number.isNaN(t)) return null;   // created_at 이 비정상이면 어느 막대에도 넣지 않는다
    return new Date(t + KST_OFFSET_MS).toISOString().split('T')[0];  // 'YYYY-MM-DD' (KST)
  };

  const aggregateByDay = (items, days = 7) => {
    const result = [];
    const nowMs = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const dateStr = kstKey(new Date(nowMs - i * 24 * 60 * 60 * 1000));
      const [, mm, dd] = dateStr.split('-');
      const label = `${Number(mm)}/${Number(dd)}`;
      const count = items.filter(item => kstKey(new Date(item.created_at)) === dateStr).length;
      result.push({ label, count });
    }
    return result;
  };

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-32">
        <SEOHead title="관리자 - ConnectTrip" robots="noindex, nofollow" />
        <Loader2 size={48} className="text-blue-500 animate-spin" />
      </div>
    );
  }

  if (profileUnknown) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-32">
        <SEOHead title="관리자 - ConnectTrip" robots="noindex, nofollow" />
        <div className="text-center max-w-md mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">계정 정보를 불러오지 못했습니다</h2>
          <p className="text-gray-500 mb-8">네트워크 상태를 확인한 뒤 다시 시도해주세요.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  if (!isLoggedIn || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-32">
        <SEOHead title="관리자 - ConnectTrip" robots="noindex, nofollow" />
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

  const formatPhone = (phone) => {
    const d = String(phone || '').replace(/[^0-9]/g, '');
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return d || '(번호 없음)';
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      alert('복사했습니다.');
    } catch {
      alert('복사에 실패했습니다. 번호를 직접 입력해주세요.');
    }
  };

  // 답례품 실제 발송은 운영자가 외부(카카오 선물하기 등)에서 하고, 여기엔 사실만 기록한다.
  const handleMarkRewardSent = async (matchId) => {
    const input = prompt('보내신 답례품 금액을 입력하세요 (원):', '10000');
    if (input === null) return;
    const amount = parseInt(String(input).replace(/[^0-9]/g, ''), 10);
    if (!amount || amount <= 0) { alert('올바른 금액을 입력해주세요.'); return; }
    const note = prompt('메모 (선택 · 예: 스타벅스 아메리카노 교환권)', '') || null;
    setActionLoading(matchId);
    try {
      const { error: rErr } = await supabase.rpc('admin_mark_reward_sent', {
        p_match_id: matchId, p_amount: amount, p_note: note,
      });
      if (rErr) throw rErr;
      await fetchData();
      alert('발송 완료로 기록했습니다.');
    } catch (err) {
      console.error('발송 기록 실패:', err);
      alert(`발송 기록에 실패했습니다.\n${err.message || ''}`);
    } finally {
      setActionLoading(null);
    }
  };

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
      console.error('칭찬 처리 실패:', err);
      alert('처리에 실패했습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const tabs = [
    { id: 'reports', label: '신고 관리', icon: AlertTriangle },
    { id: 'commendations', label: '칭찬 인증', icon: CheckCircle },
    { id: 'users', label: '회원 관리', icon: Users },
    { id: 'stats', label: '통계', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pt-32 pb-24">
      <SEOHead title="관리자 - ConnectTrip" robots="noindex, nofollow" />
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

                  {/* 재사용 해제 (항공사 이메일 / 차단 번호) */}
                  <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-gray-50">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={releaseEmail}
                          onChange={(e) => setReleaseEmail(e.target.value)}
                          placeholder="항공사 이메일"
                          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm"
                        />
                        <button
                          onClick={() => handleRelease('email')}
                          disabled={!releaseEmail.trim() || releaseLoading === 'email'}
                          className="text-xs font-bold px-3 py-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          항공사 이메일 해제
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={releasePhone}
                          onChange={(e) => setReleasePhone(e.target.value)}
                          placeholder="차단 번호"
                          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-sm"
                        />
                        <button
                          onClick={() => handleRelease('phone')}
                          disabled={!releasePhone.trim() || releaseLoading === 'phone'}
                          className="text-xs font-bold px-3 py-2 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          차단 번호 해제
                        </button>
                      </div>
                    </div>
                    {releaseMsg && (
                      <p className="mt-3 text-xs font-semibold text-gray-600">{releaseMsg}</p>
                    )}
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
                                  onClick={() => handleGrantPoints(u.id)}
                                  disabled={actionLoading === u.id}
                                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50"
                                >
                                  포인트
                                </button>
                                <button
                                  onClick={() => handleGrantVouchers(u.id)}
                                  disabled={actionLoading === u.id}
                                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
                                >
                                  사용권
                                </button>
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
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleGrantPoints(u.id)}
                            disabled={actionLoading === u.id}
                            className="flex-1 text-xs font-bold px-3 py-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50 text-center"
                          >
                            포인트 선물
                          </button>
                          <button
                            onClick={() => handleGrantVouchers(u.id)}
                            disabled={actionLoading === u.id}
                            className="flex-1 text-xs font-bold px-3 py-2 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50 text-center"
                          >
                            사용권 선물
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commendation Review Tab */}
              {activeTab === 'commendations' && (
                <div className="p-4 md:p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">칭찬 인증 검토</h2>
                  {commendations.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                      <CheckCircle size={48} className="mx-auto mb-4 opacity-30" />
                      <p className="font-semibold">검토할 칭찬 인증이 없습니다</p>
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
                                <span>승무원: <strong className="text-gray-700">{match.crew?.name || '-'}</strong> {match.crew?.airline_name && `(${match.crew.airline_name})`}</span>
                                <span>승객: <strong className="text-gray-700">{match.passenger?.name || '-'}</strong></span>
                              </div>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                              match.status === 'commendation_submitted' ? 'bg-yellow-100 text-yellow-700' :
                              match.status === 'verified' ? 'bg-green-100 text-green-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {match.status === 'commendation_submitted' ? '검토 대기' :
                               match.status === 'verified' ? '승인 완료 · 발송 대기' : '발송 완료'}
                            </span>
                          </div>

                          {match.commendation_screenshot_url && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 mb-2 font-semibold">칭찬 인증 스크린샷:</p>
                              <img
                                src={match.commendation_screenshot_url}
                                alt="칭찬 캡쳐"
                                loading="lazy"
                                decoding="async"
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

                          {/* 승인 후: 답례품은 운영자가 승객 휴대폰으로 직접 보내고, 여기엔 발송 사실만 기록한다 */}
                          {match.status === 'verified' && (
                            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                              <p className="text-sm font-bold text-green-700 mb-3">✓ 승인 완료 — 답례품을 보내주세요</p>
                              <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
                                <span className="text-gray-600">받는 분: <strong className="text-gray-900">{match.passenger?.name || '-'}</strong></span>
                                <span className="text-gray-600">
                                  휴대폰: <strong className="text-gray-900 tracking-wide">{formatPhone(match.passenger?.phone)}</strong>
                                </span>
                                {match.passenger?.phone && (
                                  <button
                                    onClick={() => copyToClipboard(match.passenger.phone)}
                                    className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:text-blue-600 hover:border-blue-300 transition-colors"
                                  >
                                    번호 복사
                                  </button>
                                )}
                              </div>
                              {/* 배송 주소. 서버가 승인 이후 상태에서만 암호문을 복호해 내려준다(admin_get_commendation_reviews). */}
                              {(match.passenger?.road || match.passenger?.zipcode) && (
                                <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
                                  <span className="text-gray-600">
                                    주소: <strong className="text-gray-900">
                                      {[match.passenger?.zipcode && `(${match.passenger.zipcode})`, match.passenger?.road, match.passenger?.detail].filter(Boolean).join(' ')}
                                    </strong>
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard([match.passenger?.zipcode, match.passenger?.road, match.passenger?.detail].filter(Boolean).join(' '))}
                                    className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:text-blue-600 hover:border-blue-300 transition-colors"
                                  >
                                    주소 복사
                                  </button>
                                </div>
                              )}
                              <button
                                onClick={() => handleMarkRewardSent(match.id)}
                                disabled={actionLoading === match.id}
                                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                              >
                                {actionLoading === match.id ? <Loader2 size={14} className="animate-spin" /> : <span>🎁</span>}
                                답례품 발송 완료 기록
                              </button>
                            </div>
                          )}
                          {match.status === 'gift_sent' && (
                            <p className="text-sm text-purple-600 font-semibold">
                              ✓ 답례품 발송 완료 ({Number(match.reward_amount || 0).toLocaleString()}원)
                              {match.reward_note && <span className="text-gray-500 font-normal"> · {match.reward_note}</span>}
                            </p>
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
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                      {[
                        { label: '동행 게시판', count: stats.boardCounts.companion, icon: Users, color: 'blue' },
                        { label: '여행 Q&A', count: stats.boardCounts.qna, icon: HelpCircle, color: 'green' },
                        { label: '장터', count: stats.boardCounts.market, icon: ShoppingBag, color: 'purple' },
                        { label: '크루 전용', count: stats.boardCounts.crew, icon: Plane, color: 'orange' },
                        { label: '여행 일정', count: stats.boardCounts.itinerary, icon: MapIcon, color: 'teal' },
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

      </div>
    </div>
  );
};

export default Admin;
