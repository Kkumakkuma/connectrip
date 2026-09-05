import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Plane, CheckCircle, Lock, AlertTriangle } from 'lucide-react';
import AirlineLogo from './AirlineLogo';
import { getAirlineInfo, isAirlineEmail, getAirlineList } from '../lib/airlines';
import { crewVerificationStatus, renewErrorMessage, formatExpiryDate } from '../lib/crewVerification';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';

// 마이페이지 '승무원 인증' 섹션 — 상태 표시 + 1년 갱신.
// 인증 절차는 가입 화면(src/pages/SignupEmail.jsx)의 회사 메일 블록과 같은 경로를 쓴다.
//   POST /api/send-email-otp {email, purpose:'airline_email'}
//   POST /api/verify-email-otp {email, code, purpose:'airline_email'} → verifyToken
//   supabase.rpc('renew_crew_verification', { p_airline_email, p_airline_name, p_airline_otp_token })
// 회사를 옮겼으면 새 회사 메일을 넣으면 된다 — RPC 가 이전 회사 메일 claim 을 풀고 항공사도 바꾼다.
const CrewVerification = ({ style }) => {
    const { user, profile, fetchProfile } = useAuth();

    const status = useMemo(() => crewVerificationStatus(profile), [profile]);

    const [airlineEmail, setAirlineEmail] = useState('');
    const [code, setCode] = useState('');
    const [sent, setSent] = useState(false);
    // 인증번호 확인으로 받아 둔 소비 토큰. RPC 가 일시적으로 실패했을 때 메일을 다시 받지 않고
    // 이 토큰으로 갱신만 재시도한다(발급 후 1시간 유효).
    const [otpToken, setOtpToken] = useState('');
    const [sending, setSending] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');
    const [done, setDone] = useState('');
    // 인증이 유효한 동안에는 폼을 접어 둔다(이직·조기 갱신 때만 펼친다).
    const [formOpen, setFormOpen] = useState(false);

    // 프로필이 도착하면 현재 회사 메일을 기본값으로 넣는다(주소는 수정할 수 있다).
    useEffect(() => {
        setAirlineEmail(profile?.airline_email || '');
    }, [profile?.airline_email]);

    // 주소가 바뀌면 받아둔 인증 상태를 버린다 — 다른 주소로 인증한 코드·토큰이 남지 않게.
    useEffect(() => {
        setSent(false);
        setCode('');
        setOtpToken('');
        setErr('');
        setDone('');
    }, [airlineEmail]);

    const airlineInfo = isAirlineEmail(airlineEmail) ? getAirlineInfo(airlineEmail) : null;
    const expired = status.state === 'expired';
    const expiring = status.state === 'expiring';
    const open = formOpen || expired || expiring;

    if (!status.applicable) return null;

    const resetOtp = () => {
        setSent(false);
        setCode('');
        setOtpToken('');
    };

    const sendCode = async () => {
        setErr('');
        setDone('');
        if (!airlineInfo) {
            setErr('지원되는 항공사 이메일을 먼저 입력해주세요.');
            return;
        }
        setSending(true);
        try {
            const resp = await fetch(apiUrl('/api/send-email-otp'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: airlineEmail.trim().toLowerCase(), purpose: 'airline_email' }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                setErr(data.error || '인증번호 발송에 실패했습니다.');
                return;
            }
            setSent(true);
            setCode('');
            setOtpToken('');
        } catch (e) {
            setErr('네트워크 오류: ' + (e.message || '알 수 없음'));
        } finally {
            setSending(false);
        }
    };

    // 인증번호 확인 → 성공하면 곧바로 갱신 RPC 까지 부른다.
    // 토큰을 이미 받아 둔 재시도라면 확인 단계를 건너뛰고 RPC 만 다시 부른다
    // (인증번호는 1회성이라 같은 코드로 다시 확인할 수 없다).
    const verifyAndRenew = async () => {
        setErr('');
        setDone('');
        const cleaned = airlineEmail.trim().toLowerCase();
        if (!otpToken && !/^[0-9]{6}$/.test(code)) {
            setErr('인증번호 6자리를 입력해주세요.');
            return;
        }
        setSubmitting(true);
        try {
            let token = otpToken;
            if (!token) {
                const resp = await fetch(apiUrl('/api/verify-email-otp'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: cleaned, code, purpose: 'airline_email' }),
                });
                const data = await resp.json();
                if (!resp.ok || !data.ok) {
                    setErr(data.error || '인증번호가 맞지 않습니다.');
                    return;
                }
                token = data.verifyToken || '';
                setOtpToken(token);
            }

            const { error } = await supabase.rpc('renew_crew_verification', {
                p_airline_email: cleaned,
                p_airline_name: getAirlineInfo(cleaned)?.name ?? null,
                p_airline_otp_token: token,
            });
            if (error) {
                const msg = String(error.message || '');
                // 이 주소로는 갱신할 수 없거나(선점·도메인) 토큰이 죽은 경우 → 처음부터 다시.
                // 그 밖의 오류(일시적 장애 등)는 토큰을 남겨 두고 '다시 시도'만 하면 된다.
                const mustRestart = /AIRLINE_EMAIL_ALREADY_CLAIMED|AIRLINE_EMAIL_PREVIOUSLY_USED|OTP_PROOF_|crew airline verification required/.test(msg);
                if (mustRestart) resetOtp();
                setErr(renewErrorMessage(msg));
                return;
            }

            // 갱신은 끝났다. 프로필 재조회가 실패해도 결과를 되돌리지 않고 안내만 달리한다.
            const refreshed = user?.id ? await fetchProfile(user.id) : null;
            resetOtp();
            setFormOpen(false);
            setDone(refreshed
                ? '인증이 1년 연장되었습니다'
                : '인증이 1년 연장되었습니다. 화면을 새로고침하면 상태가 반영됩니다.');
        } catch (e) {
            setErr('네트워크 오류: ' + (e.message || '알 수 없음'));
        } finally {
            setSubmitting(false);
        }
    };

    const cardTone = expired
        ? { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' }
        : expiring
            ? { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' }
            : { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' };

    const inputStyle = {
        width: '100%',
        padding: '0.65rem 0.9rem',
        borderRadius: '0.75rem',
        border: '1px solid #e5e7eb',
        fontSize: '0.9rem',
        outline: 'none',
        background: 'white',
    };

    return (
        <motion.div
            id="crew-renewal"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ order: 1, scrollMarginTop: '100px', ...style }}
        >
            <div style={{
                background: 'white',
                borderRadius: '1.5rem',
                padding: 'clamp(1.25rem, 4vw, 1.75rem)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: '1px solid #e5e7eb',
                wordBreak: 'keep-all',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem' }}>
                    <div style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Shield size={20} color="white" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#1f2937' }}>승무원 인증</h3>
                        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>회사 이메일 인증일로부터 1년간 유효합니다</p>
                    </div>
                </div>

                {/* 상태 */}
                <div style={{ background: cardTone.bg, border: `1px solid ${cardTone.border}`, borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '0.9rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {expired
                            ? <Lock size={16} color={cardTone.text} aria-hidden="true" />
                            : expiring
                                ? <AlertTriangle size={16} color={cardTone.text} aria-hidden="true" />
                                : <CheckCircle size={16} color={cardTone.text} aria-hidden="true" />}
                        <strong style={{ fontSize: '0.9rem', color: cardTone.text }}>
                            {expired
                                ? '승무원 인증이 만료되어 승무원 기능이 잠겼습니다'
                                : expiring
                                    ? `만료 ${status.daysLeft}일 전 — 지금 갱신하세요`
                                    : '인증 유효'}
                        </strong>
                    </div>
                    {status.expiresAt && (
                        <p style={{ fontSize: '0.8rem', color: cardTone.text, opacity: 0.85, margin: '6px 0 0' }}>
                            만료일 {formatExpiryDate(status.expiresAt)}
                            {status.daysLeft !== null ? ` · ${status.daysLeft}일 남음` : ''}
                        </p>
                    )}
                    {profile?.airline_name && (
                        <p style={{ fontSize: '0.8rem', color: '#4b5563', margin: '6px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {getAirlineInfo(profile.airline_email) && <AirlineLogo airline={getAirlineInfo(profile.airline_email)} height={14} />}
                            <span>{profile.airline_name}</span>
                            {profile.airline_email && <span style={{ color: '#9ca3af' }}>{profile.airline_email}</span>}
                        </p>
                    )}
                </div>

                {done && (
                    <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 12, padding: '0.7rem 1rem', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CheckCircle size={16} color="#16a34a" aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: '0.85rem', color: '#065f46', fontWeight: 700 }}>{done}</span>
                    </div>
                )}

                {!open ? (
                    <button
                        type="button"
                        onClick={() => { setFormOpen(true); setDone(''); }}
                        style={{ padding: '0.6rem 1.1rem', borderRadius: 12, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', fontWeight: 700, fontSize: '0.85rem' }}
                    >
                        지금 갱신하기
                    </button>
                ) : (
                    <div>
                        <p style={{ fontSize: '0.82rem', color: '#4b5563', margin: '0 0 0.6rem' }}>
                            회사 이메일로 인증번호를 받아 확인하면 인증이 1년 연장됩니다. 회사를 옮겼다면 새 회사 이메일을 입력하세요.
                        </p>

                        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
                                <Plane size={14} style={{ position: 'absolute', left: 12, top: 14, color: '#a78bfa' }} />
                                <input
                                    type="email"
                                    value={airlineEmail}
                                    onChange={(e) => setAirlineEmail(e.target.value)}
                                    placeholder="항공사 이메일 (예: name@koreanair.com)"
                                    autoComplete="off"
                                    aria-label="회사 이메일"
                                    // 요청 도중 주소를 바꾸면 이전 주소로 나간 결과와 화면이 어긋난다.
                                    readOnly={sending || submitting}
                                    style={{ ...inputStyle, paddingLeft: 32, background: sending || submitting ? '#f8fafc' : 'white' }}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={sendCode}
                                disabled={!airlineInfo || sending || submitting}
                                style={{
                                    padding: '0 14px', borderRadius: 12, whiteSpace: 'nowrap', fontWeight: 700, fontSize: '0.85rem',
                                    background: !airlineInfo || sending || submitting ? '#cbd5e1' : '#7c3aed',
                                    color: 'white', border: 'none',
                                    cursor: !airlineInfo || sending || submitting ? 'default' : 'pointer',
                                }}
                            >
                                {sending ? '전송 중...' : sent ? '재전송' : '인증번호 받기'}
                            </button>
                        </div>

                        {airlineInfo && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: '#f5f3ff', border: '1px solid #e9d5ff', borderRadius: 8, marginBottom: 8 }}>
                                <AirlineLogo airline={airlineInfo} height={14} />
                                <span style={{ fontSize: 12, color: '#6d28d9', fontWeight: 600 }}>{airlineInfo.name} 도메인</span>
                            </div>
                        )}
                        {airlineEmail && !airlineInfo && airlineEmail.includes('@') && (
                            <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 8px' }}>지원되지 않는 항공사 도메인입니다.</p>
                        )}

                        {sent && (
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                <input
                                    type="text"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="인증번호 6자리"
                                    aria-label="인증번호"
                                    maxLength={6}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    // 확인까지 끝난 코드는 다시 쓰지 않는다(재시도는 받아 둔 토큰으로 한다).
                                    readOnly={submitting || !!otpToken}
                                    style={{ ...inputStyle, flex: '1 1 200px', minWidth: 160, background: otpToken ? '#f8fafc' : 'white' }}
                                />
                                <button
                                    type="button"
                                    onClick={verifyAndRenew}
                                    disabled={submitting}
                                    style={{
                                        padding: '0 16px', borderRadius: 12, whiteSpace: 'nowrap', fontWeight: 700, fontSize: '0.85rem',
                                        background: submitting ? '#94a3b8' : '#16a34a', color: 'white', border: 'none',
                                        cursor: submitting ? 'wait' : 'pointer',
                                    }}
                                >
                                    {submitting ? '확인 중...' : otpToken ? '다시 시도' : '확인'}
                                </button>
                            </div>
                        )}

                        {err && (
                            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                                {err}
                            </div>
                        )}

                        <details style={{ marginTop: 4 }}>
                            <summary style={{ fontSize: 11, color: '#6d28d9', cursor: 'pointer' }}>지원 항공사 목록</summary>
                            <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                {getAirlineList().map(a => (
                                    <div key={a.domain} style={{ fontSize: 11, color: '#64748b', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ width: 82, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                                            <AirlineLogo airline={a} height={13} maxWidth={82} />
                                        </span>
                                        <span>{a.name}</span>
                                    </div>
                                ))}
                            </div>
                        </details>

                        {formOpen && !expired && !expiring && (
                            <button
                                type="button"
                                onClick={() => { setFormOpen(false); setErr(''); resetOtp(); }}
                                style={{ marginTop: 10, padding: '0.45rem 0.9rem', borderRadius: 10, background: 'white', color: '#6b7280', border: '1px solid #e5e7eb', fontWeight: 600, fontSize: '0.8rem' }}
                            >
                                닫기
                            </button>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default CrewVerification;
