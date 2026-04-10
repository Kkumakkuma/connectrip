import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plane, Calendar, Search, CheckCircle } from 'lucide-react';

const FlightMatching = ({ isPublicProfile, onRegister, registeredFlight }) => {
    const [flightDate, setFlightDate] = useState('');
    const [flightNumber, setFlightNumber] = useState('');

    const handleRegister = (e) => {
        e.preventDefault();
        if (!isPublicProfile) {
            alert("매칭을 위해서는 마이 페이지에서 '스케줄 매칭 공개'를 켜주세요.");
            document.getElementById('mypage').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        if (flightDate && flightNumber) {
            onRegister({ date: flightDate, flightNo: flightNumber });
        }
    };

    return (
        <section id="skylink" className="section-padding" style={{ background: 'var(--bg-light)', minHeight: '60vh' }}>
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <span style={{ color: 'var(--primary-color)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '2px' }}>
                        SkyLink
                    </span>
                    <h2 style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>나의 비행 스케줄 등록</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        탑승할 비행 스케줄을 등록하면, <br />
                        매칭되는 승무원이 나타났을 때 마이 페이지로 알려드립니다.
                    </p>
                </div>

                <div className="glass-panel" style={{ maxWidth: '600px', margin: '0 auto', borderRadius: '1.5rem', overflow: 'hidden', padding: '2rem' }}>

                    {!registeredFlight ? (
                        <motion.form
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            onSubmit={handleRegister}
                            style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
                        >
                            <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                                <label style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Calendar size={20} color="var(--primary-color)" /> 탑승 날짜
                                </label>
                                <input
                                    type="date"
                                    required
                                    value={flightDate}
                                    onChange={(e) => setFlightDate(e.target.value)}
                                    style={{ padding: '1rem', borderRadius: '10px', border: '1px solid #ddd', fontSize: '1rem' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                                <label style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Plane size={20} color="var(--primary-color)" /> 항공 편명 (예: KE081)
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="항공편명을 입력하세요"
                                    value={flightNumber}
                                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                                    style={{ padding: '1rem', borderRadius: '10px', border: '1px solid #ddd', fontSize: '1rem' }}
                                />
                            </div>

                            <button
                                type="submit"
                                className="btn-primary"
                                style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}
                            >
                                <Search size={20} /> 나의 비행 스케줄 등록하기
                            </button>
                        </motion.form>
                    ) : (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                                <div style={{
                                    width: '80px', height: '80px', background: 'var(--accent-color)', borderRadius: '50%', margin: '0 auto 1.5rem',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'
                                }}>
                                    <CheckCircle size={40} />
                                </div>
                                <h3>등록 완료!</h3>
                                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                                    <strong>{registeredFlight.date}, {registeredFlight.flightNo}</strong>편이 등록되었습니다.<br />
                                    매칭되는 승무원이 있으면 <strong>마이 페이지</strong>로 알림을 보내드립니다.
                                </p>

                                <button
                                    onClick={() => onRegister(null)}
                                    style={{ width: '100%', padding: '1rem', background: 'transparent', border: '1px solid #ddd', borderRadius: '10px', cursor: 'pointer' }}
                                >
                                    다른 스케줄 등록하기
                                </button>
                            </div>
                        </motion.div>
                    )}

                </div>
            </div>
        </section>
    );
};

export default FlightMatching;
