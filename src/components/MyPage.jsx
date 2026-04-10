import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Bell, CheckCircle, Heart, Send, Plane, Calendar, Search, CreditCard, Users, LogOut, Eye, EyeOff, Trash2, Settings } from 'lucide-react';
import KeywordSettings from './KeywordSettings';
import CommendationMatching from './CommendationMatching';
import FlightCompanions from './FlightCompanions';
import NotificationSettings from './NotificationSettings';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { flightApi } from '../lib/db';

const MyPage = () => {
    const { user, profile, isCrew, signOut, fetchProfile } = useAuth();
    const navigate = useNavigate();

    // Active tab for bottom sections
    const [activeTab, setActiveTab] = useState('commendation');

    // DB에서 포인트/바우처 읽기
    const [availableLikes, setAvailableLikes] = useState(profile?.available_likes || 0);
    const [totalPoints, setTotalPoints] = useState(profile?.points_balance || 0);
    const [vouchers, setVouchers] = useState(profile?.voucher_count || 0);

    // Flight registration state
    const [flightDate, setFlightDate] = useState('');
    const [flightNumber, setFlightNumber] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [myFlights, setMyFlights] = useState([]);
    const [flightsLoading, setFlightsLoading] = useState(true);
    const [editingFlight, setEditingFlight] = useState(null); // {id, flight_number, flight_date}

    // profile 변경 시 동기화
    useEffect(() => {
        if (profile) {
            setTotalPoints(profile.points_balance || 0);
            setVouchers(profile.voucher_count || 0);
            setAvailableLikes(profile.available_likes || 0);
        }
    }, [profile]);

    // Fetch flights
    const fetchFlights = useCallback(async () => {
        if (!user) {
            setFlightsLoading(false);
            return;
        }
        setFlightsLoading(true);
        try {
            const flights = await flightApi.getMyFlights(user.id);
            setMyFlights(flights || []);
        } catch (err) {
            console.error('비행 스케줄 로드 실패:', err);
        } finally {
            setFlightsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchFlights();
    }, [fetchFlights]);

    // Register flight
    const handleRegisterFlight = async (e) => {
        e.preventDefault();
        if (!flightDate || !flightNumber || !user) return;

        setRegistering(true);
        try {
            const result = await flightApi.register({
                user_id: user.id,
                flight_number: flightNumber.toUpperCase(),
                flight_date: flightDate,
                user_type: isCrew ? 'crew' : 'passenger',
                is_public: isPublic,
            });
            console.log('등록 성공:', result);
            setFlightDate('');
            setFlightNumber('');
            setIsPublic(false);
            await fetchFlights();
            alert('비행 스케줄이 등록되었습니다.');
        } catch (err) {
            console.error('등록 실패:', err);
            alert(`등록 실패: ${err.message || JSON.stringify(err)}`);
        } finally {
            setRegistering(false);
        }
    };

    // Toggle flight visibility
    const handleToggleVisibility = async (flightId, currentPublic) => {
        try {
            await flightApi.toggleVisibility(flightId, !currentPublic);
            await fetchFlights();
        } catch (err) {
            console.error('공개 설정 변경 실패:', err);
        }
    };

    // Delete flight + 연관된 칭송매칭/동행 데이터도 삭제
    const handleDeleteFlight = async (flightId) => {
        if (!window.confirm('이 스케줄을 삭제하시겠습니까?\n관련 칭송매칭 및 동행 데이터도 함께 삭제됩니다.')) return;
        try {
            // 해당 항공편 정보 가져오기
            const flight = myFlights.find(f => f.id === flightId);
            if (flight) {
                // 칭송매칭에서 대기중인 레코드 삭제
                const { data: matches } = await supabase
                    .from('commendation_matches')
                    .select('id, status')
                    .eq('flight_number', flight.flight_number)
                    .eq('flight_date', flight.flight_date)
                    .or(`crew_user_id.eq.${user.id},passenger_user_id.eq.${user.id}`);
                if (matches) {
                    for (const m of matches) {
                        if (['pending_crew', 'pending_passenger', 'matched'].includes(m.status)) {
                            // RLS blocks DELETE, use UPDATE to 'rejected' as cancellation
                            await supabase.from('commendation_matches').update({ status: 'rejected' }).eq('id', m.id);
                        }
                    }
                }
            }
            await flightApi.deleteFlight(flightId);
            await fetchFlights();
        } catch (err) {
            console.error('삭제 실패:', err);
            alert('삭제에 실패했습니다.');
        }
    };

    // Edit flight
    const handleEditFlight = async (flightId, newNumber, newDate) => {
        try {
            const flight = myFlights.find(f => f.id === flightId);
            const oldNumber = flight?.flight_number;
            const oldDate = flight?.flight_date;

            // flight_schedules 업데이트
            await supabase.from('flight_schedules').update({
                flight_number: newNumber.toUpperCase(),
                flight_date: newDate
            }).eq('id', flightId);

            // 연관 칭송매칭 업데이트 (활성 상태만)
            if (flight) {
                const { data: matches } = await supabase.from('commendation_matches')
                    .select('id, status')
                    .eq('flight_number', oldNumber).eq('flight_date', oldDate)
                    .or(`crew_user_id.eq.${user.id},passenger_user_id.eq.${user.id}`);
                for (const m of (matches || [])) {
                    if (!['rejected', 'deleted', 'gift_sent'].includes(m.status)) {
                        await supabase.from('commendation_matches').update({
                            flight_number: newNumber.toUpperCase(),
                            flight_date: newDate
                        }).eq('id', m.id);
                    }
                }
            }

            setEditingFlight(null);
            await fetchFlights();
        } catch (err) {
            console.error('수정 실패:', err);
            alert('수정에 실패했습니다.');
        }
    };

    const [showChargeModal, setShowChargeModal] = useState(false);
    const [chargeAmount, setChargeAmount] = useState(10000);
    const [customAmount, setCustomAmount] = useState('');

    const handleBuyVoucher = () => {
        const quantityStr = prompt('몇 개의 매칭신청권을 구매하시겠습니까?', '1');
        if (!quantityStr) return;

        const quantity = parseInt(quantityStr.replace(/,/g, ''));
        if (isNaN(quantity) || quantity <= 0) {
            alert('올바른 수량을 입력해주세요.');
            return;
        }

        const totalPrice = quantity * 30000;

        if (totalPoints >= totalPrice) {
            if (window.confirm(`${quantity}개의 매칭신청권을 구매하시겠습니까? (총 ${totalPrice.toLocaleString()}P 소모)`)) {
                const newPoints = Number(totalPoints) - totalPrice;
                const newVouchers = Number(vouchers) + quantity;
                setTotalPoints(newPoints);
                setVouchers(newVouchers);
                // DB 업데이트 + AuthContext 프로필 갱신
                supabase.from('profiles').update({ points_balance: newPoints, voucher_count: newVouchers }).eq('id', profile.id)
                  .then(() => fetchProfile(user.id).catch(() => {}));
                alert(`매칭신청권 ${quantity}개를 구매했습니다!`);
            }
        } else {
            if (window.confirm(`포인트가 부족합니다. (필요: ${totalPrice.toLocaleString()}P / 보유: ${totalPoints.toLocaleString()}P)\n포인트를 충전하시겠습니까?`)) {
                setShowChargeModal(true);
            }
        }
    };

    const handleConvertLikes = () => {
        const quantityStr = prompt('몇 개의 좋아요를 포인트로 전환하시겠습니까? (100개 단위)', '100');
        if (!quantityStr) return;

        const quantity = parseInt(quantityStr.replace(/,/g, ''));
        if (isNaN(quantity) || quantity <= 0 || quantity % 100 !== 0) {
            alert('100개 단위의 숫자를 입력해주세요.');
            return;
        }

        if (availableLikes >= quantity) {
            if (window.confirm(`${quantity.toLocaleString()}개의 좋아요를 ${quantity.toLocaleString()}P로 전환하시겠습니까?`)) {
                const newLikes = Number(availableLikes) - quantity;
                const newPoints = Number(totalPoints) + quantity;
                setAvailableLikes(newLikes);
                setTotalPoints(newPoints);
                supabase.from('profiles').update({ available_likes: newLikes, points_balance: newPoints }).eq('id', profile.id);
                alert(`${quantity.toLocaleString()} 좋아요가 ${quantity.toLocaleString()} 포인트로 전환되었습니다!`);
            }
        } else {
            alert('전환할 좋아요가 부족합니다.');
        }
    };

    const handleChargePoints = () => {
        const amount = customAmount ? parseInt(customAmount.replace(/,/g, '')) : chargeAmount;
        if (isNaN(amount) || amount <= 0) {
            alert('올바른 금액을 입력해주세요.');
            return;
        }
        const newPoints = totalPoints + amount;
        setTotalPoints(newPoints);
        supabase.from('profiles').update({ points_balance: newPoints }).eq('id', profile.id);
        alert(`${amount.toLocaleString()}원이 결제되어 ${amount.toLocaleString()}P가 충전되었습니다!\n(1P = 1원)`);
        setShowChargeModal(false);
        setCustomAmount('');
    };

    const tabs = [
        { id: 'commendation', label: '칭송매칭', icon: Heart },
        { id: 'companions', label: isCrew ? '듀티 동행' : '같은편 동행', icon: Users },
        { id: 'keywords', label: '키워드 알림', icon: Bell },
        { id: 'notifications', label: '알림 설정', icon: Settings },
    ];

    return (
        <section id="mypage" className="section-padding" style={{ background: '#f8f9fa' }}>
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <span style={{ color: 'var(--primary-color)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '2px' }}>
                        My Page
                    </span>
                    <h2 style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>마이 페이지</h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px', margin: '0 auto' }}>

                    {/* Traveler Point Wallet */}
                    {!isCrew && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="glass-panel"
                            style={{
                                order: 1,
                                borderRadius: '1.5rem',
                                padding: '1.5rem',
                                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                color: 'white',
                                boxShadow: '0 10px 25px rgba(37, 99, 235, 0.3)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div>
                                    <p style={{ fontSize: '0.85rem', opacity: 0.9, marginBottom: '0.2rem' }}>나의 보유 포인트</p>
                                    <p style={{ fontSize: '1.8rem', fontWeight: '800' }}>{totalPoints.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: '400' }}>P</span></p>
                                    <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.2rem' }}>1P = 1원</p>
                                </div>
                                <button
                                    onClick={() => setShowChargeModal(true)}
                                    style={{
                                        padding: '10px 20px',
                                        background: 'white',
                                        color: '#2563eb',
                                        border: 'none',
                                        borderRadius: '30px',
                                        fontSize: '0.9rem',
                                        fontWeight: '700',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                                    }}
                                >
                                    <CreditCard size={18} /> 충전하기
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* Crew Point Dashboard */}
                    {isCrew && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="glass-panel"
                            style={{
                                order: 1,
                                borderRadius: '1.5rem',
                                padding: '2rem',
                                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                                color: 'white',
                                boxShadow: '0 10px 25px rgba(99, 102, 241, 0.4)',
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                        >
                            <div style={{ position: 'relative', zIndex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                                    <div>
                                        <h4 style={{ fontSize: '1.1rem', opacity: 0.9, fontWeight: '600', marginBottom: '0.5rem' }}>CREW 포인트 대시보드</h4>
                                        <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>'승무원 추천지' 좋아요 1개 = 1P 적립</p>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '10px', borderRadius: '12px' }}>
                                        <Heart size={24} fill="white" />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div style={{ background: 'rgba(255,255,255,0.1)', padding: '1.5rem', borderRadius: '1rem', backdropFilter: 'blur(10px)', position: 'relative' }}>
                                        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.5rem' }}>전환 가능한 좋아요</p>
                                        <p style={{ fontSize: '1.8rem', fontWeight: '800' }}>{availableLikes.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: '400' }}>개</span></p>
                                        {availableLikes >= 100 && (
                                            <button
                                                onClick={handleConvertLikes}
                                                style={{
                                                    marginTop: '10px',
                                                    width: '100%',
                                                    padding: '8px',
                                                    background: 'white',
                                                    color: '#6366f1',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                포인트로 전환하기
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.1)', padding: '1.5rem', borderRadius: '1rem', backdropFilter: 'blur(10px)' }}>
                                        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.5rem' }}>보유 포인트</p>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <p style={{ fontSize: '1.8rem', fontWeight: '800' }}>{totalPoints.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: '400' }}>P</span></p>
                                            <button
                                                onClick={() => setShowChargeModal(true)}
                                                style={{ padding: '4px 12px', background: 'white', color: '#a855f7', border: 'none', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
                                            >
                                                충전하기
                                            </button>
                                        </div>
                                        <p style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '2px' }}>1P = 1원</p>
                                        <button
                                            onClick={handleBuyVoucher}
                                            style={{
                                                marginTop: '10px',
                                                width: '100%',
                                                padding: '8px',
                                                background: 'white',
                                                color: '#a855f7',
                                                border: 'none',
                                                borderRadius: '8px',
                                                fontSize: '0.75rem',
                                                fontWeight: 'bold',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            신청권 구매
                                        </button>
                                    </div>
                                    <div style={{ gridColumn: 'span 2', background: 'rgba(255,255,255,0.1)', padding: '1rem', borderRadius: '1rem', backdropFilter: 'blur(10px)', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <p style={{ fontSize: '0.9rem', fontWeight: '600' }}>나의 매칭신청권 보유량</p>
                                        <p style={{ fontSize: '1.2rem', fontWeight: '800' }}>{vouchers} <span style={{ fontSize: '0.9rem', fontWeight: '400' }}>개</span></p>
                                    </div>
                                </div>
                            </div>
                            {/* Decorative background circle */}
                            <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '150px', height: '150px', background: 'rgba(255,255,255,0.1)', borderRadius: '50%' }} />
                        </motion.div>
                    )}

                    {/* Flight Registration Form */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ order: 2 }}
                    >
                        <div style={{
                            background: 'white',
                            borderRadius: '1.5rem',
                            padding: 'clamp(1rem, 4vw, 1.5rem)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e5e7eb'
                        }}>
                            <h5 style={{ fontWeight: '800', color: '#1f2937', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem' }}>
                                <Plane size={18} style={{ color: '#3b82f6' }} />
                                비행 스케줄 등록
                            </h5>
                            <form onSubmit={handleRegisterFlight} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
                                <div style={{ flex: '1 1 160px', minWidth: '140px' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4b5563', marginBottom: '6px' }}>탑승 날짜</label>
                                    <input
                                        type="date"
                                        required
                                        value={flightDate}
                                        onChange={(e) => setFlightDate(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.9rem',
                                            borderRadius: '0.75rem',
                                            border: '1px solid #e5e7eb',
                                            fontSize: '0.9rem',
                                            outline: 'none',
                                            transition: 'border 0.2s'
                                        }}
                                    />
                                </div>
                                <div style={{ flex: '1 1 160px', minWidth: '140px' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4b5563', marginBottom: '6px' }}>항공 편명 (예: KE081)</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="KE081"
                                        value={flightNumber}
                                        onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.9rem',
                                            borderRadius: '0.75rem',
                                            border: '1px solid #e5e7eb',
                                            fontSize: '0.9rem',
                                            outline: 'none',
                                            transition: 'border 0.2s'
                                        }}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={registering}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '0.6rem 1.2rem',
                                        background: '#2563eb',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        fontWeight: '700',
                                        fontSize: '0.9rem',
                                        cursor: registering ? 'not-allowed' : 'pointer',
                                        opacity: registering ? 0.5 : 1,
                                        transition: 'background 0.2s'
                                    }}
                                >
                                    {registering ? (
                                        <div style={{ width: '16px', height: '16px', border: '2px solid white', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                    ) : (
                                        <Search size={16} />
                                    )}
                                    등록
                                </button>
                            </form>
                        </div>
                    </motion.div>

                    {/* My Registered Flights List */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        style={{ order: 3 }}
                    >
                        <div style={{
                            background: 'white',
                            borderRadius: '1.5rem',
                            padding: 'clamp(1rem, 4vw, 1.5rem)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e5e7eb'
                        }}>
                            <h5 style={{ fontWeight: '800', color: '#1f2937', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem' }}>
                                <Calendar size={18} style={{ color: '#3b82f6' }} />
                                나의 등록 스케줄 ({myFlights.length})
                            </h5>

                            {flightsLoading ? (
                                <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                                    <div style={{ width: '32px', height: '32px', border: '3px solid #3b82f6', borderTop: '3px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                                    <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.75rem' }}>로딩 중...</p>
                                </div>
                            ) : myFlights.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2.5rem 0', color: '#9ca3af' }}>
                                    <Plane size={40} style={{ margin: '0 auto 0.75rem', opacity: 0.3, display: 'block' }} />
                                    <p style={{ fontWeight: '600' }}>등록된 스케줄이 없습니다</p>
                                    <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>위에서 비행 스케줄을 등록해보세요!</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {myFlights.map((flight) => (
                                        <div
                                            key={flight.id}
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: '0.75rem',
                                                padding: '0.75rem 1rem',
                                                background: '#f9fafb',
                                                borderRadius: '0.75rem',
                                                border: '1px solid #f3f4f6'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <div style={{ padding: '6px', background: '#eff6ff', borderRadius: '8px' }}>
                                                    <Plane size={16} style={{ color: '#3b82f6' }} />
                                                </div>
                                                <div>
                                                    <span style={{ fontWeight: '800', color: '#1f2937' }}>{flight.flight_number}</span>
                                                    <span style={{ fontSize: '0.85rem', color: '#6b7280', marginLeft: '8px' }}>{flight.flight_date}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleVisibility(flight.id, flight.is_public)}
                                                        style={{
                                                            position: 'relative',
                                                            display: 'inline-flex',
                                                            height: '24px',
                                                            width: '44px',
                                                            alignItems: 'center',
                                                            borderRadius: '12px',
                                                            border: 'none',
                                                            background: flight.is_public ? '#22c55e' : '#d1d5db',
                                                            cursor: 'pointer',
                                                            transition: 'background 0.2s',
                                                            padding: 0
                                                        }}
                                                        title={flight.is_public ? '클릭하면 비공개' : '클릭하면 공개'}
                                                    >
                                                        <span style={{
                                                            display: 'inline-block',
                                                            height: '16px',
                                                            width: '16px',
                                                            borderRadius: '50%',
                                                            background: 'white',
                                                            transition: 'transform 0.2s',
                                                            transform: flight.is_public ? 'translateX(24px)' : 'translateX(4px)'
                                                        }} />
                                                    </button>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: '600', color: flight.is_public ? '#16a34a' : '#9ca3af', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                        {flight.is_public ? <Eye size={12} /> : <EyeOff size={12} />}
                                                        {flight.is_public ? '공개' : '비공개'}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingFlight({ id: flight.id, flight_number: flight.flight_number, flight_date: flight.flight_date })}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                        padding: '4px 10px', borderRadius: '8px', border: 'none',
                                                        fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer',
                                                        background: '#eff6ff', color: '#3b82f6', transition: 'all 0.2s'
                                                    }}
                                                    title="스케줄 수정"
                                                >
                                                    <Settings size={12} />
                                                    수정
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteFlight(flight.id)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                        padding: '4px 10px', borderRadius: '8px', border: 'none',
                                                        fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer',
                                                        background: '#fef2f2', color: '#ef4444', transition: 'all 0.2s'
                                                    }}
                                                    title="스케줄 삭제"
                                                >
                                                    <Trash2 size={12} />
                                                    삭제
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* Tab Navigation */}
                    <div style={{ order: 4 }}>
                        <div style={{
                            display: 'flex',
                            gap: '0.5rem',
                            marginBottom: '1rem',
                            background: 'white',
                            borderRadius: '1rem',
                            padding: '0.4rem',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                        }}>
                            {tabs.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        style={{
                                            flex: 1,
                                            padding: '0.75rem 0.5rem',
                                            borderRadius: '0.75rem',
                                            border: 'none',
                                            background: isActive ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : 'transparent',
                                            color: isActive ? 'white' : '#6b7280',
                                            fontSize: '0.85rem',
                                            fontWeight: isActive ? '700' : '500',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Icon size={16} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Tab Content */}
                        <div className="glass-panel" style={{
                            borderRadius: '1.5rem',
                            overflow: 'hidden',
                            padding: 'clamp(1rem, 5vw, 2rem)',
                            background: 'white'
                        }}>
                            {activeTab === 'commendation' && <CommendationMatching flights={myFlights} onFlightsChange={fetchFlights} />}
                            {activeTab === 'companions' && <FlightCompanions flights={myFlights} onFlightsChange={fetchFlights} />}
                            {activeTab === 'keywords' && <KeywordSettings />}
                            {activeTab === 'notifications' && <NotificationSettings />}
                        </div>
                    </div>

                    {/* End of grid container */}
                </div> {/* End of main container */}

                {/* Edit Flight Modal */}
                <AnimatePresence>
                    {editingFlight && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4"
                            onClick={(e) => e.target === e.currentTarget && setEditingFlight(null)}>
                            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                                className="bg-white rounded-2xl p-6 w-full max-w-sm relative">
                                <h3 className="text-lg font-bold text-gray-800 mb-4">스케줄 수정</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-600 mb-1">항공 편명</label>
                                        <input type="text" value={editingFlight.flight_number}
                                            onChange={(e) => setEditingFlight({ ...editingFlight, flight_number: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-600 mb-1">탑승 날짜</label>
                                        <input type="date" value={editingFlight.flight_date}
                                            onChange={(e) => setEditingFlight({ ...editingFlight, flight_date: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={() => setEditingFlight(null)}
                                            className="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50">취소</button>
                                        <button onClick={() => handleEditFlight(editingFlight.id, editingFlight.flight_number, editingFlight.flight_date)}
                                            className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">저장</button>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Point Charge Modal */}
                <AnimatePresence>
                    {showChargeModal && (
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{
                                position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                                background: 'rgba(0,0,0,0.5)', zIndex: 120, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
                            }}
                        >
                            <div style={{ background: 'white', padding: '2rem', borderRadius: '1.5rem', width: '100%', maxWidth: '400px', position: 'relative' }}>
                                <button
                                    onClick={() => { setShowChargeModal(false); setCustomAmount(''); }}
                                    style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                                >
                                    ✖
                                </button>

                                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                                    <div style={{ width: '60px', height: '60px', background: '#f8f9fa', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#a855f7' }}>
                                        <CreditCard size={30} />
                                    </div>
                                    <h3 style={{ fontSize: '1.4rem' }}>포인트 충전</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>1P = 1원 (실제 화폐 가치)</p>
                                </div>

                                {/* Current balance */}
                                <div style={{
                                    background: 'linear-gradient(135deg, #f0f9ff, #ede9fe)',
                                    padding: '1rem',
                                    borderRadius: '12px',
                                    marginBottom: '1.5rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <span style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: '600' }}>현재 잔액</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#6366f1' }}>{totalPoints.toLocaleString()}P</span>
                                </div>

                                {/* Preset amounts */}
                                <div style={{ display: 'grid', gap: '0.8rem', marginBottom: '1rem' }}>
                                    {[10000, 30000, 50000, 100000].map(amount => (
                                        <button
                                            key={amount}
                                            onClick={() => { setChargeAmount(amount); setCustomAmount(''); }}
                                            style={{
                                                padding: '1rem',
                                                borderRadius: '12px',
                                                border: chargeAmount === amount && !customAmount ? '2px solid #a855f7' : '1px solid #ddd',
                                                background: chargeAmount === amount && !customAmount ? '#f5f3ff' : 'white',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                fontWeight: chargeAmount === amount && !customAmount ? 'bold' : 'normal',
                                                transition: 'all 0.2s',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <span>{amount.toLocaleString()}원</span>
                                            <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>+ {amount.toLocaleString()}P</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Custom amount input */}
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '0.5rem' }}>
                                        직접 금액 입력
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="text"
                                            placeholder="금액 입력"
                                            value={customAmount}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^0-9]/g, '');
                                                setCustomAmount(val);
                                            }}
                                            style={{
                                                flex: 1,
                                                padding: '0.75rem 1rem',
                                                borderRadius: '12px',
                                                border: customAmount ? '2px solid #a855f7' : '1px solid #ddd',
                                                fontSize: '1rem',
                                                outline: 'none',
                                                transition: 'border 0.2s'
                                            }}
                                        />
                                        <span style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: '600' }}>원</span>
                                    </div>
                                    {customAmount && (
                                        <p style={{ fontSize: '0.75rem', color: '#a855f7', marginTop: '0.3rem' }}>
                                            = {parseInt(customAmount).toLocaleString()}P 충전
                                        </p>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button
                                        onClick={handleChargePoints}
                                        className="btn-primary"
                                        style={{ flex: 1, background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: 'none' }}
                                    >
                                        충전하기
                                    </button>
                                </div>
                                <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#999', marginTop: '1rem' }}>
                                    * 실결제 연동 준비 중입니다. 현재는 테스트 충전입니다.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 로그아웃 버튼 */}
            <div className="mt-8 text-center">
                <button
                    onClick={async () => {
                        await signOut();
                        navigate('/');
                        window.scrollTo(0, 0);
                    }}
                    className="inline-flex items-center gap-2 px-8 py-3 rounded-xl border-2 border-red-200 text-red-500 font-semibold hover:bg-red-50 transition-colors"
                >
                    <LogOut size={20} />
                    로그아웃
                </button>
            </div>
        </section>
    );
};

export default MyPage;
