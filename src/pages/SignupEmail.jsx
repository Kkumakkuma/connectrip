import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, User, Phone, MapPin, Gift, CheckCircle, Loader2, Plane, Shield, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { getAirlineInfo, isAirlineEmail, getAirlineList } from '../lib/airlines';
import AirlineLogo from '../components/AirlineLogo';
import { isUnder14 } from '../lib/age';
import { apiUrl } from '../lib/api';
import SEOHead from '../components/SEOHead';

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

  // 로그인 아이디(이메일)는 개인 이메일로 자유롭게 사용. 회사(항공사) 이메일은 아래에서 별도 인증한다.
  const [email, setEmail] = useState('');

  // 회사(항공사) 이메일 별도 인증 상태 — 로그인 이메일과 완전 분리
  const [airlineEmailCode, setAirlineEmailCode] = useState('');
  const [airlineEmailSent, setAirlineEmailSent] = useState(false);
  const [airlineEmailVerified, setAirlineEmailVerified] = useState(false);
  const [airlineEmailSending, setAirlineEmailSending] = useState(false);
  const [airlineEmailVerifying, setAirlineEmailVerifying] = useState(false);
  const [airlineEmailError, setAirlineEmailError] = useState('');
  // 인증에 성공한 회사 이메일(정규화값)을 기록 — 늦은 응답 레이스/입력변경으로 잘못 통과되지 않게 canSubmit 에서 대조
  const [verifiedAirlineEmail, setVerifiedAirlineEmail] = useState('');

  const [emailStatus, setEmailStatus] = useState(null); // 'checking' | 'available' | 'taken'
  const [emailCode, setEmailCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState(null);
  const [birthdate, setBirthdate] = useState('');

  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  // OTP 인증에 성공한 클라이언트만 가입을 완성할 수 있도록 서버가 준 일회성 소비 토큰
  const [phoneOtpToken, setPhoneOtpToken] = useState('');
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [airlineOtpToken, setAirlineOtpToken] = useState('');

  const [zipcode, setZipcode] = useState('');
  const [addressRoad, setAddressRoad] = useState('');
  const [addressDetail, setAddressDetail] = useState('');

  // 초대링크(?ref=코드)로 들어오면 추천인 칸을 자동 채운다.
  const [referrerAccountId, setReferrerAccountId] = useState(searchParams.get('ref') || '');
  const [referrerStatus, setReferrerStatus] = useState(null);
  const [referrerId, setReferrerId] = useState(null);
  const referrerFromLink = !!searchParams.get('ref');

  // 개인정보보호법 제15조·제22조 — 개인정보를 수집하기 전에 필수 동의를 명시적으로 받는다.
  // 이 페이지는 supabase.auth.signUp 메타데이터로 개인정보가 먼저 서버에 들어가므로,
  // 동의를 canSubmit 에서 막아 '수집 전 동의' 요건을 만족시킨다.
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);
  // 동의한 순간(제출 시각이 아니라)을 기록해 complete_signup_profile RPC 로 넘긴다 — 분쟁 시 입증자료.
  const [termsAgreedAt, setTermsAgreedAt] = useState(null);
  const [privacyAgreedAt, setPrivacyAgreedAt] = useState(null);

  const toggleTerms = (checked) => {
    setAgreeTerms(checked);
    setTermsAgreedAt(checked ? new Date().toISOString() : null);
  };
  const togglePrivacy = (checked) => {
    setAgreePrivacy(checked);
    setPrivacyAgreedAt(checked ? new Date().toISOString() : null);
  };
  const toggleAllAgree = (checked) => {
    toggleTerms(checked);
    togglePrivacy(checked);
    setAgreeAge(checked);
  };

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
      const cleaned = email.trim().toLowerCase();
      // check_email_taken RPC 우선 (profiles SELECT 컬럼 잠금 대비).
      // 전환기 폴백: profiles 잠금 SQL 적용 후 select 폴백은 제거 가능.
      try {
        const { data: taken, error: rpcError } = await supabase
          .rpc('check_email_taken', { p_email: cleaned });
        if (!rpcError && taken !== null && taken !== undefined) {
          setEmailStatus(taken ? 'taken' : 'available');
          return;
        }
      } catch { /* RPC 미존재(SQL 미적용)면 폴백 */ }
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', cleaned)
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
      const trimmed = nickname.trim();
      // check_nickname_taken RPC 우선 (profiles SELECT 컬럼 잠금 대비).
      // 전환기 폴백: profiles 잠금 SQL 적용 후 select 폴백은 제거 가능.
      try {
        const { data: taken, error: rpcError } = await supabase
          .rpc('check_nickname_taken', { p_nickname: trimmed });
        if (!rpcError && taken !== null && taken !== undefined) {
          setNicknameStatus(taken ? 'taken' : 'available');
          return;
        }
      } catch { /* RPC 미존재(SQL 미적용)면 폴백 */ }
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('nickname', trimmed)
        .limit(1);
      setNicknameStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 300);
    return () => clearTimeout(t);
  }, [nickname]);

  // 추천 승무원 ID(로그인 이메일) 검증 — email 컬럼은 PII 잠금이라 RPC 로 확인
  useEffect(() => {
    if (!referrerAccountId || referrerAccountId.trim().length < 5) {
      setReferrerStatus(null); setReferrerId(null); return;
    }
    setReferrerStatus('checking');
    const t = setTimeout(async () => {
      const { data, error: refErr } = await supabase
        .rpc('find_crew_referrer', { p_login_id: referrerAccountId.trim() });
      if (!refErr && data) {
        setReferrerStatus('valid'); setReferrerId(data);
      } else {
        setReferrerStatus('invalid'); setReferrerId(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [referrerAccountId]);

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

  // 이메일 값 바뀌면 인증 상태 리셋
  useEffect(() => {
    setEmailVerified(false);
    setEmailSent(false);
    setEmailCode('');
  }, [email]);

  // 회사(항공사) 이메일 값 바뀌면 회사 인증 상태 리셋 (발급받은 소비 토큰도 함께 버린다)
  useEffect(() => {
    setAirlineEmailVerified(false);
    setAirlineEmailSent(false);
    setAirlineEmailCode('');
    setVerifiedAirlineEmail('');
    setAirlineOtpToken('');
  }, [airlineEmail]);

  // 휴대폰 번호가 바뀌면 인증 상태·토큰 리셋 (인증 후 번호만 바꿔 제출하는 상태 불일치 방지)
  useEffect(() => {
    setPhoneVerified(false);
    setPhoneSent(false);
    setPhoneCode('');
    setVerifiedPhone('');
    setPhoneOtpToken('');
  }, [phone]);

  const sendEmailCode = async () => {
    setError('');
    setEmailError('');
    const cleaned = email.trim().toLowerCase();
    if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(cleaned)) {
      setEmailError('이메일 형식이 올바르지 않습니다.');
      return;
    }
    if (emailStatus === 'taken') {
      setEmailError('이미 가입된 이메일입니다.');
      return;
    }
    setEmailSending(true);
    try {
      const resp = await fetch(apiUrl('/api/send-email-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setEmailError(data.error || '이메일 발송 실패');
        return;
      }
      setEmailSent(true);
      setEmailCode('');
    } catch (err) {
      setEmailError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setEmailSending(false);
    }
  };

  const verifyEmailCode = async () => {
    setEmailError('');
    if (!emailCode || emailCode.length !== 6 || !/^[0-9]+$/.test(emailCode)) {
      setEmailError('이메일 인증번호 6자리를 입력해주세요.');
      return;
    }
    setEmailVerifying(true);
    try {
      const cleaned = email.trim().toLowerCase();
      const resp = await fetch(apiUrl('/api/verify-email-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned, code: emailCode }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setEmailError(data.error || '이메일 인증 실패');
        return;
      }
      setEmailVerified(true);
      setEmailError('');
    } catch (err) {
      setEmailError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setEmailVerifying(false);
    }
  };

  // 회사(항공사) 이메일 인증번호 발송 — 로그인 이메일과 별개의 주소로 발송
  const sendAirlineEmailCode = async () => {
    setError('');
    setAirlineEmailError('');
    if (!airlineInfo) {
      setAirlineEmailError('지원되는 항공사 이메일을 먼저 입력해주세요.');
      return;
    }
    const cleaned = airlineEmail.trim().toLowerCase();
    setAirlineEmailSending(true);
    try {
      const resp = await fetch(apiUrl('/api/send-email-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setAirlineEmailError(data.error || '회사 이메일 발송 실패');
        return;
      }
      setAirlineEmailSent(true);
      setAirlineEmailCode('');
    } catch (err) {
      setAirlineEmailError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setAirlineEmailSending(false);
    }
  };

  const verifyAirlineEmailCode = async () => {
    setAirlineEmailError('');
    if (!airlineEmailCode || airlineEmailCode.length !== 6 || !/^[0-9]+$/.test(airlineEmailCode)) {
      setAirlineEmailError('회사 이메일 인증번호 6자리를 입력해주세요.');
      return;
    }
    setAirlineEmailVerifying(true);
    try {
      const cleaned = airlineEmail.trim().toLowerCase();
      const resp = await fetch(apiUrl('/api/verify-email-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned, code: airlineEmailCode, purpose: 'airline_email' }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setAirlineEmailError(data.error || '회사 이메일 인증 실패');
        return;
      }
      setAirlineEmailVerified(true);
      setVerifiedAirlineEmail(cleaned); // 인증 성공한 정규화 이메일 기록
      setAirlineOtpToken(data.verifyToken || '');
      setAirlineEmailError('');
    } catch (err) {
      setAirlineEmailError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setAirlineEmailVerifying(false);
    }
  };

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
      const resp = await fetch(apiUrl('/api/send-otp'), {
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
      const resp = await fetch(apiUrl('/api/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned, code: phoneCode, purpose: 'signup_phone' }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || '인증 실패');
        return;
      }
      setPhoneVerified(true);
      setVerifiedPhone(cleaned);
      setPhoneOtpToken(data.verifyToken || '');
      setError('');
    } catch (err) {
      setError('네트워크 오류: ' + (err.message || '알 수 없음'));
    } finally {
      setPhoneVerifying(false);
    }
  };

  const canSubmit = () => {
    if (!email || emailStatus !== 'available') return false;
    if (!emailVerified) return false;
    if (!password || password.length < 6) return false;
    if (password !== passwordConfirm) return false;
    if (!name.trim()) return false;
    if (!nickname.trim() || nicknameStatus !== 'available') return false;
    if (!birthdate || isUnder14(birthdate)) return false;
    if (!phoneVerified || !phoneOtpToken) return false;
    if (verifiedPhone !== phone.replace(/[^0-9]/g, '')) return false;
    if (!zipcode || !addressRoad) return false;
    if (userType === 'crew' && (!airlineInfo || !airlineEmailVerified || !airlineOtpToken
        || verifiedAirlineEmail !== airlineEmail.trim().toLowerCase())) return false;
    // 필수 동의 3종을 모두 체크해야 제출 가능 (signUp 호출 자체를 막는 게 목적)
    if (!agreeTerms || !agreePrivacy || !agreeAge) return false;
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
      // 보호컬럼(user_type/phone_verified/crew_verified 등)은 metadata 로 넣어도 서버 트리거가 무시한다.
      // 일반 필드만 전달하고, 가입 직후 complete_signup_profile RPC 가 서버검증(휴대폰 재인증·승무원 도메인) 후 보호컬럼을 설정.
      // 추천인 최종 확정 — 디바운스 검증이 아직 안 끝났거나 ?ref= 자동입력 직후 빠른 제출에도
      // 보너스가 유실되지 않도록, 입력값이 있으면 제출 시점에 서버로 한 번 더 확정 해석한다.
      let resolvedReferrer = (referrerId && referrerStatus === 'valid') ? referrerId : null;
      if (!resolvedReferrer && referrerAccountId.trim().length >= 3) {
        const { data: rid } = await supabase.rpc('find_crew_referrer', { p_login_id: referrerAccountId.trim() });
        if (rid) resolvedReferrer = rid;
      }

      const metadata = {
        name: name.trim(),
        nickname: nickname.trim(),
        phone,
        birthdate,
        address_zipcode: zipcode,
        address_road: addressRoad,
        address_detail: addressDetail,
      };

      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: metadata, emailRedirectTo: window.location.origin },
      });
      if (signErr) throw signErr;

      if (data.session) {
        // 세션 즉시 발급(이메일확인 OFF) → 서버가 휴대폰 재검증·승무원 도메인검증·추천보너스 처리 후 프로필 완성
        const { error: compErr } = await supabase.rpc('complete_signup_profile', {
          p_name: name.trim(), p_nickname: nickname.trim(), p_phone: phone,
          p_zipcode: zipcode, p_road: addressRoad, p_detail: addressDetail,
          p_user_type: userType,
          p_airline_email: (userType === 'crew' && airlineInfo) ? (verifiedAirlineEmail || airlineEmail.trim().toLowerCase()) : null,
          p_airline_name: (userType === 'crew' && airlineInfo) ? airlineInfo.name : null,
          p_referred_by: resolvedReferrer,
          p_birthdate: birthdate,
          p_phone_otp_token: phoneOtpToken,
          p_airline_otp_token: (userType === 'crew') ? airlineOtpToken : null,
          // 동의 시각 기록. 인자를 추가한 SQL 을 먼저 배포해야 한다(구버전 함수에는 이 인자가 없어 '함수 없음' 에러가 난다).
          p_terms_agreed_at: termsAgreedAt,
          p_privacy_agreed_at: privacyAgreedAt,
        });
        if (compErr) throw compErr;
        navigate('/');
      } else {
        // 이메일 확인 ON: 여기서 페이지를 떠나므로 소비 토큰이 state 와 함께 사라진다.
        // /signup/complete 에서 이어서 가입을 마칠 수 있도록 세션 스토리지로 넘긴다(서버 유효기간과 같은 1시간).
        try {
          sessionStorage.setItem('pendingOtpProof', JSON.stringify({
            phone: verifiedPhone,
            phoneToken: phoneOtpToken,
            airlineEmail: verifiedAirlineEmail,
            airlineToken: userType === 'crew' ? airlineOtpToken : '',
            savedAt: Date.now(),
          }));
        } catch { /* 스토리지 차단 환경이면 /signup/complete 에서 재인증 */ }
        setSuccessMsg('가입 완료! 보낸 확인 메일을 눌러 로그인하면 서비스 이용 가능합니다.');
      }
    } catch (err) {
      if (err.message?.includes('OTP_PROOF')) {
        setError('인증 확인 시간이 지났습니다. 페이지를 새로고침한 뒤 휴대폰·회사 이메일 인증을 다시 받아주세요.');
      } else if (err.message?.includes('PHONE_BLOCKED')) {
        setError('이용이 제한된 번호입니다. 문의가 필요하면 고객센터로 연락해주세요.');
      } else if (err.message?.includes('PHONE_ALREADY_CLAIMED')) {
        setError('이미 가입에 사용된 휴대폰 번호입니다. 번호 하나로 계정 하나만 만들 수 있습니다.');
      } else if (err.message?.includes('AIRLINE_EMAIL_PREVIOUSLY_USED')) {
        setError('이미 가입에 사용된 회사 이메일입니다. 다시 사용할 수 없습니다.');
      } else if (err.message?.includes('AIRLINE_EMAIL_ALREADY_CLAIMED')) {
        setError('이미 다른 계정에 등록된 회사 이메일입니다.');
      } else if (err.message?.includes('already') || err.message?.includes('duplicate')) {
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
    <div style={{ maxWidth: 560, margin: '120px auto 40px', padding: '0 20px' }}>
      <SEOHead
        title="이메일로 회원가입 - ConnectTrip"
        description="ConnectTrip 회원가입. 휴대폰 인증 기반 여행 동행 커뮤니티를 시작하세요."
        path="/signup/email"
        robots="noindex, follow"
      />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        style={{ background: 'white', borderRadius: 16, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        <h1 style={{ fontSize: 22, marginBottom: 6, color: '#1a365d', fontWeight: 700 }}>
          이메일로 회원가입 ({userType === 'crew' ? '승무원' : '일반 여행자'})
        </h1>
        {userType === 'crew' && airlineInfo && (
          <p style={{ color: '#6d28d9', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <AirlineLogo airline={airlineInfo} height={16} />
            <span>{airlineInfo.name} 승무원 가입 (항공사 이메일: {airlineEmail})</span>
          </p>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" noValidate>
          {/* 브라우저 자동완성 차단 트랩 (화면에 안 보임) */}
          <input type="text" name="fake-user" autoComplete="username" style={{ display: 'none' }} />
          <input type="password" name="fake-pass" autoComplete="new-password" style={{ display: 'none' }} />

          {/* 승무원 전용: 회사(항공사) 이메일 별도 인증 블록 (폼 최상단) */}
          {userType === 'crew' && (
            <div style={{ marginBottom: 16, padding: 16, background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Shield size={16} color="#7c3aed" />
                <strong style={{ color: '#6d28d9', fontSize: 14 }}>승무원 인증 · 회사 이메일</strong>
              </div>
              <p style={{ fontSize: 12, color: '#6b46c1', marginBottom: 10, lineHeight: 1.5 }}>
                회사(항공사) 이메일로 인증번호를 받아 신원을 확인합니다. 로그인 아이디(이메일)와는 별개이며, 아래에는 개인 이메일로 자유롭게 가입할 수 있습니다.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Plane size={14} style={{ position: 'absolute', left: 12, top: 13, color: '#a78bfa' }} />
                  <input
                    type="email"
                    value={airlineEmail}
                    onChange={(e) => setAirlineEmail(e.target.value)}
                    readOnly={airlineEmailVerified}
                    placeholder="항공사 이메일 (예: name@koreanair.com)"
                    autoComplete="off"
                    style={{ ...inputStyle, paddingLeft: 32, background: airlineEmailVerified ? '#f8fafc' : 'white' }}
                  />
                </div>
                <button type="button" onClick={sendAirlineEmailCode}
                  disabled={!airlineInfo || airlineEmailVerified || airlineEmailSending}
                  style={{ padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap',
                    background: airlineEmailVerified ? '#d1fae5' : airlineEmailSending ? '#94a3b8' : !airlineInfo ? '#cbd5e1' : '#7c3aed',
                    color: airlineEmailVerified ? '#065f46' : 'white', border: 'none', fontWeight: 600,
                    cursor: airlineEmailVerified || airlineEmailSending || !airlineInfo ? 'default' : 'pointer' }}>
                  {airlineEmailVerified ? '인증 완료' : airlineEmailSending ? '전송 중...' : airlineEmailSent ? '재전송' : '인증번호 받기'}
                </button>
              </div>
              {airlineInfo && !airlineEmailVerified && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8 }}>
                  <CheckCircle size={14} color="#16a34a" />
                  <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AirlineLogo airline={airlineInfo} height={14} />
                    <span>{airlineInfo.name} 도메인 확인됨 — 인증번호를 받아 회사 이메일을 인증하세요.</span>
                  </span>
                </div>
              )}
              {airlineEmail && !airlineInfo && airlineEmail.includes('@') && (
                <p style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                  지원되지 않는 항공사 도메인입니다.
                </p>
              )}
              {airlineEmailError && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.5 }}>
                  ⚠️ {airlineEmailError}
                </div>
              )}
              {airlineEmailSent && !airlineEmailVerified && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input type="text" value={airlineEmailCode}
                    onChange={(e) => setAirlineEmailCode(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="회사 이메일 인증번호 6자리"
                    style={{ ...inputStyle, flex: 1 }}
                    autoComplete="off" maxLength={6} inputMode="numeric" />
                  <button type="button" onClick={verifyAirlineEmailCode} disabled={airlineEmailVerifying}
                    style={{ padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap',
                      background: airlineEmailVerifying ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', fontWeight: 600,
                      cursor: airlineEmailVerifying ? 'wait' : 'pointer' }}>
                    {airlineEmailVerifying ? '확인 중...' : '인증'}
                  </button>
                </div>
              )}
              {airlineEmailVerified && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8 }}>
                  <CheckCircle size={14} color="#16a34a" />
                  <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {airlineInfo && <AirlineLogo airline={airlineInfo} height={14} />}
                    <span>{airlineInfo ? `${airlineInfo.name} ` : ''}회사 이메일 인증 완료</span>
                  </span>
                </div>
              )}
              <details style={{ marginTop: 6 }}>
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
            </div>
          )}

          <Field label={userType === 'crew' ? '아이디 (이메일 · 개인 이메일 가능)' : '아이디 (이메일)'} icon={<Mail size={16} />}
            helper={
              emailVerified ? '이메일 인증 완료' :
              !email ? (userType === 'crew' ? '로그인에 쓸 개인 이메일을 입력하세요. (회사 이메일과 달라도 됩니다)' : null) :
              emailStatus === 'checking' ? '확인 중...' :
              emailStatus === 'available' && !emailSent ? '사용 가능 — 오른쪽 "인증번호 받기" 버튼을 눌러 본인 확인하세요.' :
              emailStatus === 'available' && emailSent ? '인증번호가 이메일로 발송됐습니다. 메일함(스팸함 포함)을 확인하고 6자리 입력해주세요.' :
              emailStatus === 'taken' ? '이미 가입된 이메일' : null
            }
            helperColor={
              emailVerified ? '#16a34a' :
              emailStatus === 'taken' ? '#dc2626' :
              emailStatus === 'available' ? '#2563eb' : '#64748b'
            }>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailVerified}
                placeholder="example@email.com"
                style={{ ...inputStyle, flex: 1, background: emailVerified ? '#f8fafc' : 'white', cursor: emailVerified ? 'not-allowed' : 'text' }}
                autoComplete="off" required maxLength={100} />
              <button type="button" onClick={sendEmailCode}
                disabled={!email || emailStatus !== 'available' || emailVerified || emailSending}
                style={{ padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap',
                  background: emailVerified ? '#d1fae5' : emailSending ? '#94a3b8' : (!email || emailStatus !== 'available') ? '#cbd5e1' : '#2563eb',
                  color: emailVerified ? '#065f46' : 'white', border: 'none', fontWeight: 600,
                  cursor: emailVerified || emailSending || !email || emailStatus !== 'available' ? 'default' : 'pointer' }}>
                {emailVerified ? '인증 완료' : emailSending ? '전송 중...' : emailSent ? '재전송' : '인증번호 받기'}
              </button>
            </div>
            {emailError && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.5 }}>
                ⚠️ {emailError}
              </div>
            )}
            {emailSent && !emailVerified && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input type="text" value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="이메일 인증번호 6자리"
                  style={{ ...inputStyle, flex: 1 }}
                  autoComplete="off" maxLength={6} inputMode="numeric" />
                <button type="button" onClick={verifyEmailCode} disabled={emailVerifying}
                  style={{ padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap',
                    background: emailVerifying ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', fontWeight: 600,
                    cursor: emailVerifying ? 'wait' : 'pointer' }}>
                  {emailVerifying ? '확인 중...' : '인증'}
                </button>
              </div>
            )}
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

          <Field label="생년월일" icon={<Calendar size={16} />}
            helper={
              !birthdate ? '만 14세 이상만 가입할 수 있습니다.' :
              isUnder14(birthdate) ? '만 14세 미만은 가입할 수 없습니다.' :
              '확인되었습니다.'
            }
            helperColor={!birthdate ? '#64748b' : isUnder14(birthdate) ? '#dc2626' : '#16a34a'}>
            <input type="date" value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              min="1900-01-01" max={new Date().toISOString().slice(0, 10)}
              style={inputStyle} required />
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

          <Field label="추천 승무원 ID / 추천코드" icon={<Gift size={16} />} required={false}
            helper={
              !referrerAccountId ? '선택 사항. 추천 보너스 3,000포인트는 인증 승무원 회원에게만 지급됩니다.' :
              referrerStatus === 'checking' ? '확인 중...' :
              referrerStatus === 'valid' ? ((referrerFromLink && referrerAccountId.trim() === (searchParams.get('ref') || '').trim()) ? '초대링크로 추천 승무원이 자동 입력되었습니다' : '추천 승무원 확인됨') :
              referrerStatus === 'invalid' ? '해당 ID/추천코드의 승무원이 없습니다' : null
            }
            helperColor={referrerStatus === 'valid' ? '#16a34a' : referrerStatus === 'invalid' ? '#dc2626' : '#64748b'}>
            <input type="text" value={referrerAccountId}
              onChange={(e) => setReferrerAccountId(e.target.value)}
              placeholder="추천 승무원의 아이디(이메일) 또는 추천코드"
              style={inputStyle} autoComplete="off" maxLength={80} />
          </Field>

          <ConsentBox
            idPrefix="signup-email"
            agreeTerms={agreeTerms}
            agreePrivacy={agreePrivacy}
            agreeAge={agreeAge}
            onToggleTerms={toggleTerms}
            onTogglePrivacy={togglePrivacy}
            onToggleAge={setAgreeAge}
            onToggleAll={toggleAllAgree}
          />

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
  border: '1.5px solid #e2e8f0', fontSize: 14, background: 'white',
};

const consentRowStyle = { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' };
const consentBoxInputStyle = { width: 16, height: 16, marginTop: 2, flexShrink: 0, accentColor: '#2563eb', cursor: 'pointer' };
const consentLabelStyle = { flex: 1, fontSize: 13, color: '#334155', lineHeight: 1.5, cursor: 'pointer' };
const consentLinkStyle = { fontSize: 12, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 };
const consentRequiredStyle = { color: '#dc2626', fontWeight: 700 };

// 필수 동의 블록. 수집 항목·목적·보유기간 요약은 /privacy(개인정보처리방침) 본문을 그대로 줄인 것이며,
// 방침을 고치면 이 요약도 같이 맞춰야 한다. 링크는 새 탭으로 열어 작성 중이던 폼 값을 잃지 않게 한다.
function ConsentBox({ idPrefix, agreeTerms, agreePrivacy, agreeAge,
  onToggleTerms, onTogglePrivacy, onToggleAge, onToggleAll }) {
  const allAgreed = agreeTerms && agreePrivacy && agreeAge;
  return (
    <div style={{ marginBottom: 18, border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
      <div style={consentRowStyle}>
        <input id={`${idPrefix}-agree-all`} type="checkbox" checked={allAgreed}
          onChange={(e) => onToggleAll(e.target.checked)} style={consentBoxInputStyle} />
        <label htmlFor={`${idPrefix}-agree-all`} style={{ ...consentLabelStyle, fontSize: 14, fontWeight: 700, color: '#1a365d' }}>
          아래 필수 항목에 모두 동의합니다
        </label>
      </div>

      <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }} />

      <div style={consentRowStyle}>
        <input id={`${idPrefix}-agree-terms`} type="checkbox" checked={agreeTerms}
          onChange={(e) => onToggleTerms(e.target.checked)} style={consentBoxInputStyle} />
        <label htmlFor={`${idPrefix}-agree-terms`} style={consentLabelStyle}>
          <span style={consentRequiredStyle}>[필수]</span> 이용약관에 동의합니다
        </label>
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={consentLinkStyle}>약관 보기</a>
      </div>

      <div style={consentRowStyle}>
        <input id={`${idPrefix}-agree-privacy`} type="checkbox" checked={agreePrivacy}
          onChange={(e) => onTogglePrivacy(e.target.checked)} style={consentBoxInputStyle} />
        <label htmlFor={`${idPrefix}-agree-privacy`} style={consentLabelStyle}>
          <span style={consentRequiredStyle}>[필수]</span> 개인정보 수집·이용에 동의합니다
        </label>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={consentLinkStyle}>방침 보기</a>
      </div>

      <ul style={{ margin: '2px 0 6px 30px', padding: 0, listStyle: 'disc', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
        <li>수집 항목: 이메일, 비밀번호, 이름, 닉네임, 생년월일, 휴대폰번호, 주소(우편번호·도로명·상세). 승무원 회원은 항공사 이메일·항공사명이 추가되며, 이용 과정의 접속 기록이 자동 수집됩니다.</li>
        <li>이용 목적: 회원 관리 및 본인 확인, 커뮤니티 운영, 승무원 칭송매칭 운영, 포인트 적립·이용, 부정 이용 방지와 분쟁 조정·문의 대응.</li>
        <li>보유 기간: 회원 탈퇴 시 지체 없이 파기합니다. 관계 법령이 보존을 정한 결제·거래 기록은 법정 보존기간 동안 분리 보관한 뒤 파기합니다.</li>
      </ul>

      <div style={consentRowStyle}>
        <input id={`${idPrefix}-agree-age`} type="checkbox" checked={agreeAge}
          onChange={(e) => onToggleAge(e.target.checked)} style={consentBoxInputStyle} />
        <label htmlFor={`${idPrefix}-agree-age`} style={consentLabelStyle}>
          <span style={consentRequiredStyle}>[필수]</span> 만 14세 이상입니다
        </label>
      </div>

      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
        동의를 거부할 수 있으나, 위 항목은 회원 관리와 본인 확인에 필요한 최소한의 정보이므로 거부하면 회원가입이 제한됩니다.
      </p>
    </div>
  );
}

function Field({ label, icon, helper, helperColor, required = true, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', fontWeight: 600, marginBottom: 6 }}>
        {icon}
        <span>{label}</span>
        {required && <span style={{ color: '#dc2626', fontWeight: 700 }}>*</span>}
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
