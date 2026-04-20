import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, User, Phone, MapPin, Gift, CheckCircle, Loader2, Plane, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { getAirlineInfo, isAirlineEmail, getAirlineList } from '../lib/airlines';

function loadDaumPostcode() {
  return new Promise((resolve, reject) => {
    if (window.daum && window.daum.Postcode) return resolve();
    const existing = document.getElementById('daum-postcode-sdk');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.id = 'daum-postcode-sdk';
    s.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Daum Postcode 로드 실패'));
    document.body.appendChild(s);
  });
}

export default function SignupEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isLoggedIn } = useAuth();

  const initialUserType = searchParams.get('type') === 'crew' ? 'crew' : 'traveler';
  const initialAirlineEmail = searchParams.get('airline') || '';
  const [userType] = useState(initialUserType);
  // 승무원은 이 페이지 안에서 항공사 이메일을 직접 입력/수정할 수 있어야 함
  const [airlineEmail, setAirlineEmail] = useState(initialAirlineEmail);
  const airlineInfo = isAirlineEmail(airlineEmail) ? getAirlineInfo(airlineEmail) : null;

  // 승무원이면 항공사 이메일이 곧 로그인 ID. 일반 여행자는 빈 칸에서 시작.
  const [email, setEmail] = useState(initialUserType === 'crew' ? initialAirlineEmail : '');

  // 승무원: 항공사 이메일 변경되면 로그인 ID(email) 자동 동기화
  useEffect(() => {
    if (userType === 'crew') {
      setEmail(airlineEmail);
    }
  }, [userType, airlineEmail]);
  const [emailStatus, setEmailStatus] = useState(null); // 'checking' | 'available' | 'taken'
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState(null);

  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [zipcode, setZipcode] = useState('');
  const [addressRoad, setAddressRoad] = useState('');
  const [addressDetail, setAddressDetail] = useState('');

  const [referrerNickname, setReferrerNickname] = useState('');
  const [referrerStatus, setReferrerStatus] = useState(null);
  const [referrerId, setReferrerId] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 이미 로그인돼 있으면 홈으로
  useEffect(() => {
    if (isLoggedIn) navigate('/');
  }, [isLoggedIn, navigate]);

  // 이메일 중복 체크 (profiles.email 조회)
  useEffect(() => {
    if (!email || !email.includes('@')) { setEmailStatus(null); return; }
    setEmailStatus('checking');
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .limit(1);
      setEmailStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 400);
    return () => clearTimeout(t);
  }, [email]);

  // 닉네임 중복
  useEffect(() => {
    if (!nickname || nickname.length < 2) { setNicknameStatus(null); return; }
    setNicknameStatus('checking');
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('nickname', nickname.trim())
        .limit(1);
      setNicknameStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 300);
    return () => clearTimeout(t);
  }, [nickname]);

  // 추천인 검증
  useEffect(() => {
    if (!referrerNickname || referrerNickname.length < 2) {
      setReferrerStatus(null); setReferrerId(null); return;
    }
    setReferrerStatus('checking');
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('nickname', referrerNickname.trim())
        .limit(1);
      if (data && data.length > 0) {
        setReferrerStatus('valid'); setReferrerId(data[0].id);
      } else {
        setReferrerStatus('invalid'); setReferrerId(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [referrerNickname]);

  const openPostcode = async () => {
    try {
      await loadDaumPostcode();
      new window.daum.Postcode({
        oncomplete: (data) => {
          setZipcode(data.zonecode);
          setAddressRoad(data.roadAddress || data.jibunAddress || '');
        },
      }).open();
    } catch (err) {
      setError(err.message || '주소 검색 오류');
    }
  };

  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneVerifying, setPhoneVerifying] = useState(false);

  const sendPhoneCode = async () => {
    setError('');
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10 || cleaned.length > 11) {
      setError('휴대폰 번호를 정확히 입력해주세요. (10~11자리 숫자)');
      return;
    }
    if (!/^01[016789]/.test(cleaned)) {
      setError('올바른 휴대폰 번호 형식이 아닙니다.');
      return;
    }
    setPhoneSending(true);
    try {
      const resp = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || '인증번호 발송에 실패했습니다.');
        return;
      }
      setPhoneSent(true);
      setPhoneCode('');
    } catch (err) {
      setError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setPhoneSending(false);
    }
  };
  const verifyPhoneCode = async () => {
    if (!phoneCode || phoneCode.length !== 6 || !/^[0-9]+$/.test(phoneCode)) {
      setError('인증번호 6자리 숫자를 입력해주세요.');
      return;
    }
    setPhoneVerifying(true);
    try {
      const cleaned = phone.replace(/[^0-9]/g, '');
      const resp = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned, code: phoneCode }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || '인증 실패');
        return;
      }
      setPhoneVerified(true);
      setError('');
    } catch (err) {
      setError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setPhoneVerifying(false);
    }
  };

  const canSubmit = () => {
    if (!email || emailStatus !== 'available') return false;
    if (!password || password.length < 6) return false;
    if (password !== passwordConfirm) return false;
    if (!name.trim()) return false;
    if (!nickname.trim() || nicknameStatus !== 'available') return false;
    if (!phoneVerified) return false;
    if (!zipcode || !addressRoad) return false;
    if (userType === 'crew' && !airlineInfo) return false;
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccessMsg('');
    if (!canSubmit()) { setError('모든 필수 정보를 채워주세요.'); return; }
    setSubmitting(true);
    try {
      // Supabase Auth 가입 + 메타데이터에 모든 필드 담기 (SQL 트리거가 profile 에 반영)
      // identity_verified=false / verification_method='sms_otp_pending' — 통신사 본인인증 도입 시 기존 유저 강제 업그레이드용 플래그
      const metadata = {
        name: name.trim(),
        nickname: nickname.trim(),
        phone,
        phone_verified: phoneVerified,
        address_zipcode: zipcode,
        address_road: addressRoad,
        address_detail: addressDetail,
        user_type: userType,
        profile_completed: true,
        identity_verified: false,
        verification_method: 'sms_otp_pending',
      };
      if (referrerId && referrerStatus === 'valid') {
        metadata.referred_by = referrerId;
      }
      if (userType === 'crew' && airlineInfo) {
        metadata.airline_email = airlineEmail;
        metadata.airline_name = airlineInfo.name;
        metadata.crew_verified = true;
      }

      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: metadata, emailRedirectTo: window.location.origin },
      });
      if (signErr) throw signErr;

      // 세션이 바로 나오면 (이메일 확인 꺼진 프로젝트) 추천인 보너스 지급
      if (data.session && referrerId) {
        await supabase.rpc('grant_referral_bonus', { p_user_id: data.user.id }).catch(() => {});
      }

      if (!data.session) {
        // Supabase 이메일 확인이 ON 인 경우
        setSuccessMsg('가입 완료! 보낸 확인 메일을 눌러 로그인하면 서비스 이용 가능합니다.');
      } else {
        // 세션 즉시 발급 — 홈으로
        navigate('/');
      }
    } catch (err) {
      if (err.message?.includes('already') || err.message?.includes('duplicate')) {
        setError('이미 가입된 이메일입니다. 로그인을 시도해주세요.');
      } else {
        setError(err.message || '가입 중 오류가 발생했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (successMsg) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
        <CheckCircle size={64} color="#16a34a" style={{ margin: '0 auto 20px' }} />
        <h1 style={{ fontSize: 22, color: '#1a365d', marginBottom: 12 }}>회원가입 완료</h1>
        <p style={{ color: '#334155', marginBottom: 20 }}>{successMsg}</p>
        <button onClick={() => navigate('/signup?mode=login')} style={{
          background: '#2563eb', color: 'white', padding: '12px 28px', borderRadius: 10,
          border: 'none', fontWeight: 600, cursor: 'pointer',
        }}>로그인 페이지로</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px' }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        style={{ background: 'white', borderRadius: 16, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        <h1 style={{ fontSize: 22, marginBottom: 6, color: '#1a365d', fontWeight: 700 }}>
          이메일로 회원가입 ({userType === 'crew' ? '승무원' : '일반 여행자'})
        </h1>
        {userType === 'crew' && airlineInfo && (
          <p style={{ color: '#6d28d9', fontSize: 13, marginBottom: 16 }}>
            {airlineInfo.logo} {airlineInfo.name} 승무원 가입 (항공사 이메일: {airlineEmail})
          </p>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" noValidate>
          {/* 브라우저 자동완성 차단 트랩 (화면에 안 보임) */}
          <input type="text" name="fake-user" autoComplete="username" style={{ display: 'none' }} />
          <input type="password" name="fake-pass" autoComplete="new-password" style={{ display: 'none' }} />

          {/* 승무원 전용: 항공사 이메일 인증 블록 (폼 최상단) */}
          {userType === 'crew' && (
            <div style={{ marginBottom: 16, padding: 16, background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Shield size={16} color="#7c3aed" />
                <strong style={{ color: '#6d28d9', fontSize: 14 }}>승무원 인증 (1단계)</strong>
              </div>
              <p style={{ fontSize: 12, color: '#6b46c1', marginBottom: 10, lineHeight: 1.5 }}>
                항공사 사내 이메일로 먼저 신원을 확인합니다. 이 이메일이 자동으로 아래 로그인 ID에 들어갑니다.
              </p>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <Plane size={14} style={{ position: 'absolute', left: 12, top: 13, color: '#a78bfa' }} />
                <input
                  type="email"
                  value={airlineEmail}
                  onChange={(e) => setAirlineEmail(e.target.value)}
                  placeholder="항공사 이메일 (예: name@koreanair.com)"
                  autoComplete="off"
                  style={{ ...inputStyle, paddingLeft: 32 }}
                />
              </div>
              {airlineInfo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8 }}>
                  <CheckCircle size={14} color="#16a34a" />
                  <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600 }}>
                    {airlineInfo.logo} {airlineInfo.name} 확인됨
                  </span>
                </div>
              )}
              {airlineEmail && !airlineInfo && airlineEmail.includes('@') && (
                <p style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                  지원되지 않는 항공사 도메인입니다.
                </p>
              )}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 11, color: '#6d28d9', cursor: 'pointer' }}>지원 항공사 목록</summary>
                <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  {getAirlineList().map(a => (
                    <div key={a.domain} style={{ fontSize: 11, color: '#64748b', padding: '2px 0' }}>
                      {a.logo} {a.name}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          <Field label={userType === 'crew' ? '아이디 (항공사 이메일 고정)' : '아이디 (이메일)'} icon={<Mail size={16} />}
            helper={
              userType === 'crew' ? '승무원 계정은 항공사 이메일이 로그인 ID 로 고정됩니다.' :
              !email ? null :
              emailStatus === 'checking' ? '확인 중...' :
              emailStatus === 'available' ? '사용 가능' :
              emailStatus === 'taken' ? '이미 가입된 이메일' : null
            }
            helperColor={
              userType === 'crew' ? '#6d28d9' :
              emailStatus === 'taken' ? '#dc2626' :
              emailStatus === 'available' ? '#16a34a' : '#64748b'
            }>
            <input type="email" value={email}
              onChange={(e) => userType === 'crew' ? null : setEmail(e.target.value)}
              readOnly={userType === 'crew'}
              placeholder="example@email.com"
              style={{ ...inputStyle, background: userType === 'crew' ? '#f8fafc' : 'white', cursor: userType === 'crew' ? 'not-allowed' : 'text' }}
              autoComplete="off" required maxLength={100} />
          </Field>

          <Field label="비밀번호 (6자 이상)" icon={<Lock size={16} />}>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호" style={inputStyle} autoComplete="new-password"
                required minLength={6} maxLength={72} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: 11, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>

          <Field label="비밀번호 확인"
            helper={
              !passwordConfirm ? null :
              password === passwordConfirm ? '일치' : '일치하지 않음'
            }
            helperColor={password === passwordConfirm ? '#16a34a' : '#dc2626'}>
            <input type={showPassword ? 'text' : 'password'}
              value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 재입력" style={inputStyle} autoComplete="new-password"
              required maxLength={72} />
          </Field>

          <Field label="이름 (실명)" icon={<User size={16} />}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="홍길동" style={inputStyle} autoComplete="off" required maxLength={30} />
          </Field>

          <Field label="닉네임 (중복 불가)"
            helper={
              !nickname || nickname.length < 2 ? '2자 이상 입력' :
              nicknameStatus === 'checking' ? '확인 중...' :
              nicknameStatus === 'taken' ? '이미 사용 중' :
              nicknameStatus === 'available' ? '사용 가능' : null
            }
            helperColor={nicknameStatus === 'taken' ? '#dc2626' : nicknameStatus === 'available' ? '#16a34a' : '#64748b'}>
            <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
              placeholder="2~20자" style={inputStyle} autoComplete="off" required maxLength={20} />
          </Field>

          <Field label="휴대폰 번호 (인증 필요)" icon={<Phone size={16} />}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="tel" value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="01012345678" style={{ ...inputStyle, flex: 1 }}
                autoComplete="off" maxLength={11} disabled={phoneVerified} />
              <button type="button" onClick={sendPhoneCode} disabled={phoneVerified || phoneSending}
                style={{ padding: '0 14px', borderRadius: 10,
                  background: phoneVerified ? '#d1fae5' : phoneSending ? '#94a3b8' : '#2563eb',
                  color: phoneVerified ? '#065f46' : 'white', border: 'none', fontWeight: 600,
                  cursor: phoneVerified ? 'default' : 'pointer' }}>
                {phoneVerified ? '인증 완료' : phoneSending ? '전송 중...' : phoneSent ? '재전송' : '인증번호 받기'}
              </button>
            </div>
            {phoneSent && !phoneVerified && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input type="text" value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="인증번호" style={{ ...inputStyle, flex: 1 }}
                  autoComplete="off" maxLength={6} />
                <button type="button" onClick={verifyPhoneCode} disabled={phoneVerifying}
                  style={{ padding: '0 14px', borderRadius: 10, background: phoneVerifying ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', fontWeight: 600, cursor: phoneVerifying ? 'wait' : 'pointer' }}>
                  {phoneVerifying ? '확인 중...' : '인증'}
                </button>
              </div>
            )}
          </Field>

          <Field label="주소" icon={<MapPin size={16} />}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="text" value={zipcode} readOnly placeholder="우편번호"
                style={{ ...inputStyle, flex: '0 0 120px' }} />
              <button type="button" onClick={openPostcode}
                style={{ padding: '0 14px', borderRadius: 10, background: '#2563eb', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                주소 검색
              </button>
            </div>
            <input type="text" value={addressRoad} readOnly placeholder="도로명 주소" style={{ ...inputStyle, marginBottom: 8 }} />
            <input type="text" value={addressDetail}
              onChange={(e) => setAddressDetail(e.target.value)}
              placeholder="상세 주소 (동/호수 등)" style={inputStyle}
              autoComplete="off" maxLength={80} />
          </Field>

          <Field label="추천인 닉네임 (선택) - 입력 시 양쪽에 3,000포인트" icon={<Gift size={16} />}
            helper={
              !referrerNickname ? null :
              referrerStatus === 'checking' ? '확인 중...' :
              referrerStatus === 'valid' ? '추천인 확인됨' :
              referrerStatus === 'invalid' ? '해당 닉네임 없음' : null
            }
            helperColor={referrerStatus === 'valid' ? '#16a34a' : referrerStatus === 'invalid' ? '#dc2626' : '#64748b'}>
            <input type="text" value={referrerNickname}
              onChange={(e) => setReferrerNickname(e.target.value)}
              placeholder="친구의 닉네임 (비워둬도 OK)"
              style={inputStyle} autoComplete="off" maxLength={20} />
          </Field>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button type="submit" disabled={submitting || !canSubmit()}
            style={{ width: '100%', padding: 14, borderRadius: 12,
              background: canSubmit() && !submitting ? '#2563eb' : '#cbd5e1',
              color: 'white', border: 'none', fontWeight: 700, fontSize: 16,
              cursor: canSubmit() && !submitting ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {submitting && <Loader2 size={16} className="spin" />}
            {submitting ? '가입 중...' : '회원가입 완료'}
          </button>

          <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#64748b' }}>
            이미 계정이 있으신가요?{' '}
            <a href="/signup?mode=login" style={{ color: '#2563eb', fontWeight: 600 }}>로그인</a>
          </p>
        </form>
      </motion.div>
      <style>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', background: 'white',
};

function Field({ label, icon, helper, helperColor, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', fontWeight: 600, marginBottom: 6 }}>
        {icon}{label}
      </label>
      {children}
      {helper && (
        <div style={{ fontSize: 12, color: helperColor || '#64748b', marginTop: 4 }}>
          {helper}
        </div>
      )}
    </div>
  );
}
