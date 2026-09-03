import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Phone, MapPin, CheckCircle, Loader2, Gift, Plane, Shield, Calendar } from 'lucide-react';
import { getAirlineInfo } from '../lib/airlines';
import AirlineLogo from '../components/AirlineLogo';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { isUnder14 } from '../lib/age';
import { apiUrl } from '../lib/api';
import SEOHead from '../components/SEOHead';
import IdentityVerifyStep from '../components/IdentityVerifyStep';
import { IDENTITY_ENABLED, loadIdentityProof, clearIdentityProof, clearIdentityStart, parseIdentityReturn, stripIdentityParams } from '../lib/identity';

// Daum 우편번호 스크립트 동적 로더
function loadDaumPostcode() {
  return new Promise((resolve, reject) => {
    if (window.daum && window.daum.Postcode) {
      resolve();
      return;
    }
    const existing = document.getElementById('daum-postcode-sdk');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.id = 'daum-postcode-sdk';
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Daum Postcode 스크립트 로드 실패'));
    document.body.appendChild(script);
  });
}

export default function SignupComplete() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, isLoggedIn, fetchProfile } = useAuth();

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState(null); // 'checking' | 'available' | 'taken' | null
  const [birthdate, setBirthdate] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [zipcode, setZipcode] = useState('');
  const [addressRoad, setAddressRoad] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [userType, setUserType] = useState('traveler');
  // 가입 유형은 /signup 에서 이미 골랐다(→ /signup/email?type=… → 여기). 앞 단계가 남긴 pendingSignupType /
  // pendingCrew / pendingOtpProof(항공사) 로 이어받고, 이어받았으면 이 화면에서 다시 고르지 않는다(쿠마님 2026-09-02).
  // 셋 다 없을 때(확인 메일을 다른 브라우저에서 열어 세션 스토리지가 없는 경우)만 선택 UI 를 보여준다.
  const [typeLocked, setTypeLocked] = useState(false);
  // OAuth 리턴 시 /signup 에서 승무원을 선택하고 항공사 이메일까지 검증했던 상태를 복원
  const [airlineEmail, setAirlineEmail] = useState('');
  const [airlineInfo, setAirlineInfo] = useState(null);
  const [referrerAccountId, setReferrerAccountId] = useState('');
  const [referrerStatus, setReferrerStatus] = useState(null); // 'checking' | 'valid' | 'invalid' | null
  const [referrerId, setReferrerId] = useState(null);
  // 회사(항공사) 이메일 별도 인증 상태 — 로그인 이메일(구글 계정)과 완전 분리
  const [airlineEmailCode, setAirlineEmailCode] = useState('');
  const [airlineEmailSent, setAirlineEmailSent] = useState(false);
  const [airlineEmailVerified, setAirlineEmailVerified] = useState(false);
  const [airlineEmailSending, setAirlineEmailSending] = useState(false);
  const [airlineEmailVerifying, setAirlineEmailVerifying] = useState(false);
  const [airlineEmailError, setAirlineEmailError] = useState('');
  // 인증에 성공한 회사 이메일(정규화값) — 늦은 응답 레이스/입력변경으로 잘못 통과되지 않게 canSubmit 에서 대조
  const [verifiedAirlineEmail, setVerifiedAirlineEmail] = useState('');
  // OTP 인증에 성공한 클라이언트만 가입을 완성할 수 있도록 서버가 준 일회성 소비 토큰
  const [phoneOtpToken, setPhoneOtpToken] = useState('');
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [airlineOtpToken, setAirlineOtpToken] = useState('');
  // 휴대폰 본인확인(PASS/SMS) 증빙 — OAuth·이메일확인 ON 경로도 본인확인을 마쳐야 폼이 열린다(IDENTITY_ENABLED 일 때).
  // SignupEmail 에서 마친 증빙은 같은 세션 스토리지 키(1시간)로 이어받는다.
  const [identityProof, setIdentityProof] = useState(() => (IDENTITY_ENABLED ? loadIdentityProof() : null));
  const [identityReturn, setIdentityReturn] = useState(null);
  // 비동기 프리필(profiles_private 생년월일 조회)이 본인확인 값보다 늦게 끝나 덮어쓰지 않도록 최신값을 ref 로 본다
  const identityProofRef = useRef(identityProof);
  useEffect(() => { identityProofRef.current = identityProof; }, [identityProof]);
  // pendingOtpProof 로 복원된 회사 이메일 값 — 아래 [airlineEmail] 리셋 effect 가 복원 직후 인증 상태를
  // 지워 이메일확인 ON·OAuth 복귀 승무원이 제출을 못 하던 문제 방지(codex 지적, 2026-09-02)
  const restoredAirlineEmailRef = useRef('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 개인정보보호법 제15조·제22조 — 개인정보를 저장하기 전에 필수 동의를 명시적으로 받는다.
  // SignupEmail 에서 넘어온 경우에도 이 화면에서 다시 받는다(사전 체크는 '명시적 동의'가 아니므로 하지 않는다).
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);
  // 동의한 순간(저장 시각이 아니라)을 기록해 complete_signup_profile RPC 로 넘긴다 — 분쟁 시 입증자료.
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

  // 로그인 안 된 경우 /signup 으로
  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/signup');
    }
  }, [isLoggedIn, navigate]);

  // 이미 profile_completed=true 면 홈으로
  useEffect(() => {
    if (profile?.profile_completed) {
      navigate('/');
    }
  }, [profile, navigate]);

  // OAuth 복귀 시 sessionStorage 에 저장된 승무원 항공사 정보 복원
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pendingCrew');
      if (raw) {
        const parsed = JSON.parse(raw);
        // 서버의 OTP 인정 기간(1시간)보다 오래된 정보는 무시
        if (parsed && parsed.airlineEmail && Date.now() - (parsed.ts || 0) < 60 * 60 * 1000) {
          setUserType('crew');
          setTypeLocked(true);
          setAirlineEmail(parsed.airlineEmail);
          setAirlineInfo(getAirlineInfo(parsed.airlineEmail));
        }
      }
      // SignupEmail 이 남긴 가입 유형(24시간) — 확인 메일을 눌러 돌아온 경우
      const rawType = sessionStorage.getItem('pendingSignupType');
      if (rawType) {
        const t = JSON.parse(rawType);
        if (t && (t.userType === 'crew' || t.userType === 'traveler') && Date.now() - (t.savedAt || 0) < 24 * 60 * 60 * 1000) {
          setUserType(t.userType);
          setTypeLocked(true);
        }
      }
    } catch { /* noop */ }
  }, []);

  // 이메일 확인 ON 경로: SignupEmail 에서 인증까지 마치고 넘어온 소비 토큰을 이어받는다.
  // (그 화면을 떠나면서 state 가 사라지므로 세션 스토리지를 경유한다)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pendingOtpProof');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || Date.now() - (p.savedAt || 0) >= 60 * 60 * 1000) {
        sessionStorage.removeItem('pendingOtpProof');
        return;
      }
      if (p.phoneToken && p.phone) {
        setPhone(p.phone);
        setVerifiedPhone(p.phone);
        setPhoneOtpToken(p.phoneToken);
        setPhoneVerified(true);
      }
      if (p.airlineToken && p.airlineEmail) {
        setUserType('crew');
        setTypeLocked(true);
        restoredAirlineEmailRef.current = p.airlineEmail;
        setAirlineEmail(p.airlineEmail);
        setAirlineInfo(getAirlineInfo(p.airlineEmail));
        setVerifiedAirlineEmail(p.airlineEmail);
        setAirlineOtpToken(p.airlineToken);
        setAirlineEmailVerified(true);
      }
    } catch { /* 복원 실패 시 화면에서 다시 인증받으면 된다 */ }
  }, []);

  // 모바일 본인확인 복귀(?flow=identity&…): 결과를 state 로 옮기고 URL 에서 복귀 파라미터를 지운다.
  useEffect(() => {
    if (!IDENTITY_ENABLED) return;
    const ret = parseIdentityReturn(location.search);
    if (!ret) return;
    setIdentityReturn(ret);
    clearIdentityStart(); // 결과를 옮겼으니 시작 기록은 폐기(성공·실패·불일치 공통)
    navigate({ pathname: location.pathname, search: stripIdentityParams(location.search) }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 본인확인 값으로 폼 채우기(잠금 필드) — 프로필 프리필보다 우선
  useEffect(() => {
    if (!identityProof) return;
    setName(identityProof.name || '');
    setBirthdate(identityProof.birthdate || '');
    setPhone(identityProof.phone || '');
  }, [identityProof]);

  const restartIdentity = () => {
    clearIdentityProof();
    setIdentityProof(null);
    setIdentityReturn(null);
    setName(''); setBirthdate(''); setPhone('');
    setError('');
  };

  // 기존 프로필 값 프리필 (본인확인 값이 있으면 이름·휴대폰은 덮어쓰지 않는다)
  useEffect(() => {
    if (profile) {
      if (profile.name && !name && !identityProof) setName(profile.name);
      if (profile.nickname && !nickname) setNickname(profile.nickname);
      if (profile.phone && !identityProof) setPhone(profile.phone);
      // phone_verified 로 인증 상태를 복원하지 않는다. 가입 완료 RPC 가 이번 인증에서 발급된
      // 소비 토큰을 요구하므로, 토큰 없이 "인증됨"으로 보이면 제출이 막힌 채 원인을 알 수 없게 된다.
      if (profile.address_zipcode) setZipcode(profile.address_zipcode);
      if (profile.address_road) setAddressRoad(profile.address_road);
      if (profile.address_detail) setAddressDetail(profile.address_detail);
      // user_type 은 프로필에서 가져오지 않는다 — 미완성 프로필의 값은 트리거 기본값('traveler')일 뿐이고,
      // 앞 단계에서 이어받은 유형(typeLocked)을 덮어써 승무원이 여행자로 바뀌던 문제가 있었다.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // 생년월일 프리필: birthdate 는 profiles 가 아니라 비공개 테이블(profiles_private)에 있으므로
  // 본인 행만 별도 조회(RLS: auth.uid()=user_id). (profiles 직접 조회 대신 profiles_private 사용)
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles_private')
        .select('birthdate')
        .eq('user_id', user.id)
        .maybeSingle();
      // 본인확인 값이 있으면(응답이 늦게 와도) 그 생년월일이 최종이라 덮어쓰지 않는다
      if (!cancelled && data?.birthdate && !identityProofRef.current) setBirthdate(String(data.birthdate).slice(0, 10));
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // 추천 승무원 ID(로그인 이메일) 검증 (400ms debounce) — email 컬럼은 PII 잠금이라 RPC 로 확인
  useEffect(() => {
    if (!referrerAccountId || referrerAccountId.trim().length < 5) {
      setReferrerStatus(null);
      setReferrerId(null);
      return;
    }
    const q = referrerAccountId.trim();
    setReferrerStatus('checking');
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase
        .rpc('find_crew_referrer', { p_login_id: q });
      // 본인 ID 를 추천인으로 넣는 것도 무효 처리 (서버 complete_signup_profile 도 self-referral 차단)
      if (err || !data || data === (user?.id || '')) {
        setReferrerStatus('invalid');
        setReferrerId(null);
      } else {
        setReferrerStatus('valid');
        setReferrerId(data);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [referrerAccountId, user?.id]);

  // 항공사 이메일 값 바뀌면 회사 인증 상태 리셋
  //  · 복원값 그대로면 리셋하지 않는다(복원 직후 렌더)
  //  · 초기 마운트(빈 값·미인증)에는 지울 것이 없다 — 같은 배치의 복원 setState 를 덮지 않기 위함
  useEffect(() => {
    if (airlineEmail && airlineEmail === restoredAirlineEmailRef.current) return;
    if (!airlineEmail && !airlineEmailVerified) return;
    setAirlineEmailVerified(false);
    setAirlineEmailSent(false);
    setAirlineEmailCode('');
    setVerifiedAirlineEmail('');
    setAirlineOtpToken('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airlineEmail]);

  // 닉네임 중복 체크 (300ms debounce)
  useEffect(() => {
    if (!nickname || nickname.length < 2) {
      setNicknameStatus(null);
      return;
    }
    const current = nickname.trim();
    setNicknameStatus('checking');
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id')
        .eq('nickname', current)
        .neq('id', user?.id || '')
        .limit(1);
      if (err) {
        setNicknameStatus(null);
        return;
      }
      setNicknameStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 300);
    return () => clearTimeout(t);
  }, [nickname, user?.id]);

  const openPostcode = async () => {
    try {
      await loadDaumPostcode();
      new window.daum.Postcode({
        oncomplete: (data) => {
          setZipcode(data.zonecode);
          const road = data.roadAddress || data.jibunAddress || '';
          setAddressRoad(road);
        },
      }).open();
    } catch (err) {
      setError(err.message || '주소 검색을 열 수 없습니다.');
    }
  };

  // 회사(항공사) 이메일 인증번호 발송 — 로그인 이메일(구글 계정)과 별개 주소로 발송
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
    if (!name.trim()) return false;
    if (!nickname.trim() || nicknameStatus !== 'available') return false;
    if (!birthdate || isUnder14(birthdate)) return false;
    if (IDENTITY_ENABLED) {
      // 본인확인 증빙 토큰이 휴대폰 OTP 를 대신한다(서버가 토큰 소비 + 값 재검증)
      if (!identityProof?.token) return false;
    } else {
      if (!phoneVerified || !phoneOtpToken) return false;
      if (verifiedPhone !== phone.replace(/[^0-9]/g, '')) return false;
    }
    if (!zipcode || !addressRoad) return false;
    // 승무원은 회사 이메일 인증 필수 + 인증한 이메일이 현재 입력값과 일치해야 함
    if (userType === 'crew' && (!airlineInfo || !airlineEmailVerified || !airlineOtpToken
        || verifiedAirlineEmail !== airlineEmail.trim().toLowerCase())) return false;
    // 필수 동의 3종을 모두 체크해야 제출 가능 (RPC 호출 자체를 막는 게 목적)
    if (!agreeTerms || !agreePrivacy || !agreeAge) return false;
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setError('로그인 정보가 없습니다. 다시 로그인해주세요.');
      return;
    }
    if (!canSubmit()) {
      setError('모든 필수 정보를 채워주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // 추천인 최종 확정 — 디바운스 검증 미완료 상태의 빠른 제출에도 보너스가 유실되지 않도록 재해석.
      let resolvedReferrer = (referrerId && referrerStatus === 'valid') ? referrerId : null;
      if (!resolvedReferrer && referrerAccountId.trim().length >= 3) {
        const { data: rid } = await supabase.rpc('find_crew_referrer', { p_login_id: referrerAccountId.trim() });
        if (rid && rid !== (user?.id || '')) resolvedReferrer = rid;  // self-referral 제외
      }
      // 보호컬럼(user_type/crew_verified/phone_verified)은 서버 RPC 가 검증 후 설정.
      // 휴대폰은 phone_otps.verified_at 으로 재검증되고, 추천 보너스도 서버가 self-referral 차단 포함 처리.
      const { error: upErr } = await supabase.rpc('complete_signup_profile', {
        p_name: name.trim(),
        p_nickname: nickname.trim(),
        p_phone: phone,
        p_zipcode: zipcode,
        p_road: addressRoad,
        p_detail: addressDetail,
        p_user_type: userType,
        p_airline_email: (userType === 'crew' && airlineInfo) ? (verifiedAirlineEmail || airlineEmail.trim().toLowerCase()) : null,
        p_airline_name: (userType === 'crew' && airlineInfo) ? airlineInfo.name : null,
        p_referred_by: resolvedReferrer,
        p_birthdate: birthdate,
        p_phone_otp_token: IDENTITY_ENABLED ? null : phoneOtpToken,
        p_airline_otp_token: (userType === 'crew') ? airlineOtpToken : null,
        // 동의 시각 기록. 인자를 추가한 SQL 을 먼저 배포해야 한다(구버전 함수에는 이 인자가 없어 '함수 없음' 에러가 난다).
        p_terms_agreed_at: termsAgreedAt,
        p_privacy_agreed_at: privacyAgreedAt,
        // 휴대폰 본인확인 증빙(2026-09-02, identity_20260902.sql). 서버가 소비하며 이름·생년월일·휴대폰을 확정.
        p_identity_token: IDENTITY_ENABLED ? (identityProof?.token || null) : null,
      });
      if (upErr) throw upErr;
      // 승무원 pending 정보와 소비 토큰·본인확인 증빙은 사용 완료 → 세션 스토리지에서 제거
      try {
        sessionStorage.removeItem('pendingCrew');
        sessionStorage.removeItem('pendingOtpProof');
        sessionStorage.removeItem('pendingSignupType');
      } catch { /* noop */ }
      clearIdentityProof();
      await fetchProfile(user.id);
      navigate('/');
    } catch (err) {
      // 저장은 됐는데 응답만 유실됐을 수 있다. 프로필을 다시 확인해 성공이면 그대로 진행한다.
      try {
        const { data: prof } = await supabase.rpc('get_my_profile');
        const row = Array.isArray(prof) ? prof[0] : prof;
        if (row?.profile_completed) {
          try {
            sessionStorage.removeItem('pendingCrew');
            sessionStorage.removeItem('pendingOtpProof');
            sessionStorage.removeItem('pendingSignupType');
          } catch { /* noop */ }
          clearIdentityProof();
          await fetchProfile(user.id);
          navigate('/');
          return;
        }
      } catch { /* 조회 실패 시 아래 안내로 진행 */ }

      const msg = err.message || '';
      if (msg.includes('IDENTITY_PROOF_INVALID') || msg.includes('IDENTITY_REQUIRED')) {
        // 증빙이 만료(1시간)·이미 사용됨 → 본인확인 단계로 되돌린다
        restartIdentity();
        setError('본인확인 유효시간이 지났습니다. 본인확인을 다시 진행해주세요.');
      } else if (msg.includes('IDENTITY_ALREADY_REGISTERED')) {
        setError('이미 가입된 회원입니다. 기존 계정으로 로그인하거나 아이디·비밀번호 찾기를 이용해주세요.');
      } else if (msg.includes('IDENTITY_BLOCKED')) {
        setError('이용이 제한된 사용자입니다. 문의가 필요하면 고객센터로 연락해주세요.');
      } else if (msg.includes('OTP_PROOF')) {
        setError('인증 확인 시간이 지났습니다. 휴대폰·회사 이메일 인증을 다시 받아주세요.');
      } else if (msg.includes('PHONE_BLOCKED')) {
        setError('이용이 제한된 번호입니다. 문의가 필요하면 고객센터로 연락해주세요.');
      } else if (msg.includes('PHONE_ALREADY_CLAIMED')) {
        setError('이미 가입에 사용된 휴대폰 번호입니다. 번호 하나로 계정 하나만 만들 수 있습니다.');
      } else if (msg.includes('AIRLINE_EMAIL_PREVIOUSLY_USED')) {
        setError('이미 가입에 사용된 회사 이메일입니다. 다시 사용할 수 없습니다.');
      } else if (msg.includes('AIRLINE_EMAIL_ALREADY_CLAIMED')) {
        setError('이미 다른 계정에 등록된 회사 이메일입니다.');
      } else {
        setError(msg || '저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isLoggedIn) return null;

  return (
    <div style={{ maxWidth: 520, margin: '120px auto 40px', padding: '0 20px' }}>
      <SEOHead
        title="회원정보 입력 - ConnectTrip"
        description="ConnectTrip 회원가입 마무리. 남은 회원정보를 입력하고 가입을 완료하세요."
        path="/signup/complete"
        robots="noindex, follow"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ background: 'white', borderRadius: 16, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 8, color: '#1a365d', fontWeight: 700 }}>
          회원정보 입력
        </h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          ConnectTrip 사용을 위해 몇 가지 정보가 더 필요합니다.
        </p>

        {IDENTITY_ENABLED && !identityProof ? (
          // 1단계: 휴대폰 본인확인. OAuth(구글·카카오)·이메일확인 ON 경로도 예외 없이 본인확인 → 가입 순서.
          <IdentityVerifyStep
            returnPath={location.pathname + stripIdentityParams(location.search)}
            returnResult={identityReturn}
            onVerified={(proof) => { setIdentityReturn(null); setIdentityProof(proof); }}
            accent={userType === 'crew' ? '#7c3aed' : '#2563eb'}
          />
        ) : (
        <form onSubmit={handleSubmit}>
          {identityProof && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#065f46' }}>
              <CheckCircle size={16} color="#16a34a" />
              <span style={{ flex: 1, fontWeight: 600 }}>휴대폰 본인확인 완료 · {identityProof.name}</span>
              <button type="button" onClick={restartIdentity}
                style={{ background: 'none', border: 'none', color: '#047857', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                다시 인증
              </button>
            </div>
          )}

          {/* 가입 유형 — 앞 단계(/signup)에서 고른 값을 이어받아 표시만 한다. 이어받지 못한 경우에만 선택 UI. */}
          {typeLocked ? (
            <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
              <span style={{ fontWeight: 600 }}>가입 유형</span>
              <span style={{ padding: '4px 10px', borderRadius: 999, fontWeight: 700, fontSize: 12,
                background: userType === 'crew' ? '#f3e8ff' : '#eff6ff', color: userType === 'crew' ? '#6d28d9' : '#1d4ed8' }}>
                {userType === 'crew' ? '승무원' : '여행자'}
              </span>
            </div>
          ) : (
          <Field label="가입 유형" helper="앞 단계에서 고른 유형을 불러오지 못했습니다. 다시 선택해주세요." helperColor="#64748b">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'traveler', label: '여행자' },
                { v: 'crew', label: '승무원' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setUserType(opt.v)}
                  style={{
                    flex: 1, padding: '10px', border: `2px solid ${userType === opt.v ? '#2563eb' : '#e2e8f0'}`,
                    borderRadius: 10, background: userType === opt.v ? '#eff6ff' : 'white',
                    color: userType === opt.v ? '#1d4ed8' : '#334155', cursor: 'pointer', fontWeight: 600,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </Field>
          )}

          {/* 승무원 회사(항공사) 이메일 별도 인증 — 로그인 계정과 분리 */}
          {userType === 'crew' && (
            <Field label="회사(항공사) 이메일 인증 (승무원)" icon={<Plane size={16} />}
              helper={
                airlineEmailVerified ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{airlineInfo && <AirlineLogo airline={airlineInfo} height={14} />}{airlineInfo ? `${airlineInfo.name} ` : ''}회사 이메일 인증 완료</span>) :
                !airlineEmail ? '로그인 계정과 별개로, 회사(항공사) 이메일로 인증번호를 받아 인증합니다.' :
                airlineInfo ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><AirlineLogo airline={airlineInfo} height={14} />{`${airlineInfo.name} 도메인 확인됨 — 인증번호를 받아 인증하세요.`}</span>) :
                airlineEmail.includes('@') ? '지원되지 않는 항공사 도메인' : '유효한 이메일 형식이 아닙니다'
              }
              helperColor={airlineEmailVerified ? '#16a34a' : airlineInfo ? '#2563eb' : airlineEmail ? '#dc2626' : '#64748b'}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="email" value={airlineEmail}
                  onChange={(e) => {
                    setAirlineEmail(e.target.value);
                    setAirlineInfo(getAirlineInfo(e.target.value));
                  }}
                  readOnly={airlineEmailVerified}
                  placeholder="예: name@koreanair.com"
                  style={{ ...inputStyle, flex: 1, background: airlineEmailVerified ? '#f8fafc' : 'white' }}
                  autoComplete="off" maxLength={100} />
                <button type="button" onClick={sendAirlineEmailCode}
                  disabled={!airlineInfo || airlineEmailVerified || airlineEmailSending}
                  style={{ padding: '0 14px', borderRadius: 10, whiteSpace: 'nowrap',
                    background: airlineEmailVerified ? '#d1fae5' : airlineEmailSending ? '#94a3b8' : !airlineInfo ? '#cbd5e1' : '#7c3aed',
                    color: airlineEmailVerified ? '#065f46' : 'white', border: 'none', fontWeight: 600,
                    cursor: airlineEmailVerified || airlineEmailSending || !airlineInfo ? 'default' : 'pointer' }}>
                  {airlineEmailVerified ? '인증 완료' : airlineEmailSending ? '전송 중...' : airlineEmailSent ? '재전송' : '인증번호 받기'}
                </button>
              </div>
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
              <div style={{ marginTop: 8, padding: '10px 12px', background: '#faf5ff', borderRadius: 8, fontSize: 12, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={14} /> 승무원 인증은 본 계정 외부로 노출되지 않습니다. 승무원 전용 게시판 접근 권한 용도로만 사용.
              </div>
            </Field>
          )}

          {/* 이름 — 본인확인 값이면 잠금 */}
          <Field label="이름 (실명)" icon={<User size={16} />}
            helper={identityProof ? '본인확인으로 확인된 이름입니다.' : null} helperColor="#16a34a">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={!!identityProof}
              placeholder="홍길동"
              style={identityProof ? lockedInputStyle : inputStyle}
              maxLength={30}
              required
            />
          </Field>

          {/* 닉네임 */}
          <Field
            label="닉네임 (중복 불가)"
            helper={
              nickname.length < 2 ? '2자 이상 입력' :
              nicknameStatus === 'checking' ? '확인 중...' :
              nicknameStatus === 'taken' ? '이미 사용 중인 닉네임' :
              nicknameStatus === 'available' ? '사용 가능한 닉네임' : null
            }
            helperColor={
              nicknameStatus === 'taken' ? '#dc2626' :
              nicknameStatus === 'available' ? '#16a34a' : '#64748b'
            }
          >
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="2~20자"
              style={inputStyle}
              maxLength={20}
              required
            />
          </Field>

          {/* 생년월일 (만 14세 확인) — 본인확인 값이면 잠금 */}
          <Field
            label="생년월일"
            icon={<Calendar size={16} />}
            helper={
              identityProof ? '본인확인으로 확인된 생년월일입니다.' :
              !birthdate ? '만 14세 이상만 가입할 수 있습니다.' :
              isUnder14(birthdate) ? '만 14세 미만은 가입할 수 없습니다.' :
              '확인되었습니다.'
            }
            helperColor={identityProof ? '#16a34a' : !birthdate ? '#64748b' : isUnder14(birthdate) ? '#dc2626' : '#16a34a'}
          >
            {identityProof ? (
              <input type="text" value={birthdate} readOnly style={lockedInputStyle} />
            ) : (
              <input
                type="date"
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
                min="1900-01-01"
                max={new Date().toISOString().slice(0, 10)}
                style={inputStyle}
                required
              />
            )}
          </Field>

          {/* 휴대폰 — 본인확인 값이면 잠금(SMS OTP 블록 없음) */}
          {identityProof ? (
            <Field label="휴대폰 번호" icon={<Phone size={16} />} helper="본인확인으로 확인된 번호입니다." helperColor="#16a34a">
              <input type="tel" value={phone} readOnly style={lockedInputStyle} />
            </Field>
          ) : (
          <Field label="휴대폰 번호 (인증 필요)" icon={<Phone size={16} />}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="01012345678"
                style={{ ...inputStyle, flex: 1 }}
                maxLength={11}
                disabled={phoneVerified}
              />
              <button
                type="button"
                onClick={sendPhoneCode}
                disabled={phoneVerified || phoneSending}
                style={{
                  padding: '0 14px', borderRadius: 10,
                  background: phoneVerified ? '#d1fae5' : '#2563eb',
                  color: phoneVerified ? '#065f46' : 'white',
                  border: 'none', fontWeight: 600,
                  cursor: (phoneVerified || phoneSending) ? 'default' : 'pointer',
                  opacity: phoneSending ? 0.7 : 1,
                }}
              >
                {phoneVerified ? '인증 완료' : phoneSending ? '발송 중...' : phoneSent ? '재전송' : '인증번호 받기'}
              </button>
            </div>
            {phoneSent && !phoneVerified && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="인증번호 6자리"
                  style={{ ...inputStyle, flex: 1 }}
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={verifyPhoneCode}
                  disabled={phoneVerifying}
                  style={{
                    padding: '0 14px', borderRadius: 10, background: '#16a34a',
                    color: 'white', border: 'none', fontWeight: 600,
                    cursor: phoneVerifying ? 'default' : 'pointer',
                    opacity: phoneVerifying ? 0.7 : 1,
                  }}
                >{phoneVerifying ? '확인 중...' : '인증'}</button>
              </div>
            )}
            {phoneVerified && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#16a34a', fontSize: 13 }}>
                <CheckCircle size={14} /> 인증 완료
              </div>
            )}
          </Field>
          )}

          {/* 주소 */}
          <Field label="주소" icon={<MapPin size={16} />}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={zipcode}
                readOnly
                placeholder="우편번호"
                style={{ ...inputStyle, flex: '0 0 120px' }}
              />
              <button
                type="button"
                onClick={openPostcode}
                style={{
                  padding: '0 14px', borderRadius: 10, background: '#2563eb',
                  color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
                }}
              >주소 검색</button>
            </div>
            <input
              type="text"
              value={addressRoad}
              readOnly
              placeholder="도로명 주소"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <input
              type="text"
              value={addressDetail}
              onChange={(e) => setAddressDetail(e.target.value)}
              placeholder="상세 주소 (동/호수 등)"
              style={inputStyle}
              maxLength={80}
            />
          </Field>

          {/* 추천 승무원 */}
          <Field
            label="추천 승무원 ID / 추천코드 (선택) — 추천 보너스 3,000P는 인증 승무원 회원에게만 지급"
            icon={<Gift size={16} />}
            helper={
              !referrerAccountId ? null :
              referrerStatus === 'checking' ? '확인 중...' :
              referrerStatus === 'valid' ? '추천 승무원 확인 완료' :
              referrerStatus === 'invalid' ? '해당 ID/추천코드의 승무원이 없습니다' : null
            }
            helperColor={
              referrerStatus === 'valid' ? '#16a34a' :
              referrerStatus === 'invalid' ? '#dc2626' : '#64748b'
            }
          >
            <input
              type="text"
              value={referrerAccountId}
              onChange={(e) => setReferrerAccountId(e.target.value)}
              placeholder="추천 승무원의 아이디(이메일) 또는 추천코드"
              style={inputStyle}
              maxLength={80}
            />
          </Field>

          <ConsentBox
            idPrefix="signup-complete"
            agreeTerms={agreeTerms}
            agreePrivacy={agreePrivacy}
            agreeAge={agreeAge}
            onToggleTerms={toggleTerms}
            onTogglePrivacy={togglePrivacy}
            onToggleAge={setAgreeAge}
            onToggleAll={toggleAllAgree}
          />

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !canSubmit()}
            style={{
              width: '100%', padding: '14px', borderRadius: 12,
              background: canSubmit() && !saving ? '#2563eb' : '#cbd5e1',
              color: 'white', border: 'none', fontWeight: 700, fontSize: 16,
              cursor: canSubmit() && !saving ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {saving && <Loader2 size={16} className="spin" />}
            {saving ? '저장 중...' : '회원가입 완료'}
          </button>
        </form>
        )}
      </motion.div>
      <style>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #e2e8f0', fontSize: 14,
  background: 'white',
};
// 본인확인으로 확정돼 수정할 수 없는 값(이름·생년월일·휴대폰)
const lockedInputStyle = { ...inputStyle, background: '#f8fafc', color: '#334155', cursor: 'not-allowed' };

const consentRowStyle = { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' };
const consentBoxInputStyle = { width: 16, height: 16, marginTop: 2, flexShrink: 0, accentColor: '#2563eb', cursor: 'pointer' };
const consentLabelStyle = { flex: 1, fontSize: 13, color: '#334155', lineHeight: 1.5, cursor: 'pointer' };
const consentLinkStyle = { fontSize: 12, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 };
const consentRequiredStyle = { color: '#dc2626', fontWeight: 700 };

// 필수 동의 블록. 수집 항목·목적·보유기간 요약은 /privacy(개인정보처리방침) 본문을 그대로 줄인 것이며,
// 방침을 고치면 이 요약도 같이 맞춰야 한다. 링크는 새 탭으로 열어 작성 중이던 폼 값을 잃지 않게 한다.
// 이 화면은 소셜 로그인·이메일 확인 후 진입하므로 로그인 계정 이메일은 이미 확보된 상태다.
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
        <li>수집 항목: 이메일(로그인 계정), 닉네임, 주소(우편번호·도로명·상세), 휴대폰 본인확인으로 확인된 이름·생년월일·성별·휴대폰번호·이동통신사·내외국인 여부·연계정보(CI, 복원 불가한 해시로만 저장). 승무원 회원은 항공사 이메일·항공사명이 추가되며, 이용 과정의 접속 기록이 자동 수집됩니다.</li>
        <li>이용 목적: 회원 관리 및 본인 확인, 커뮤니티 운영, 승무원 칭찬매칭 운영, 포인트 적립·이용, 부정 이용 방지와 분쟁 조정·문의 대응.</li>
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

function Field({ label, icon, helper, helperColor, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', fontWeight: 600, marginBottom: 6 }}>
        {icon}
        {label}
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
