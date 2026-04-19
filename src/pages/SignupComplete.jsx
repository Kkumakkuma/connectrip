import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Phone, MapPin, CheckCircle, Loader2, Gift } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';

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
  const { user, profile, isLoggedIn, fetchProfile } = useAuth();

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState(null); // 'checking' | 'available' | 'taken' | null
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [zipcode, setZipcode] = useState('');
  const [addressRoad, setAddressRoad] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [userType, setUserType] = useState('traveler');
  const [referrerNickname, setReferrerNickname] = useState('');
  const [referrerStatus, setReferrerStatus] = useState(null); // 'checking' | 'valid' | 'invalid' | null
  const [referrerId, setReferrerId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  // 기존 프로필 값 프리필
  useEffect(() => {
    if (profile) {
      if (profile.name && !name) setName(profile.name);
      if (profile.nickname && !nickname) setNickname(profile.nickname);
      if (profile.phone) setPhone(profile.phone);
      if (profile.phone_verified) setPhoneVerified(true);
      if (profile.address_zipcode) setZipcode(profile.address_zipcode);
      if (profile.address_road) setAddressRoad(profile.address_road);
      if (profile.address_detail) setAddressDetail(profile.address_detail);
      if (profile.user_type) setUserType(profile.user_type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // 추천인 닉네임 검증 (400ms debounce)
  useEffect(() => {
    if (!referrerNickname || referrerNickname.length < 2) {
      setReferrerStatus(null);
      setReferrerId(null);
      return;
    }
    const q = referrerNickname.trim();
    setReferrerStatus('checking');
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, nickname')
        .eq('nickname', q)
        .neq('id', user?.id || '')
        .limit(1);
      if (err || !data || data.length === 0) {
        setReferrerStatus('invalid');
        setReferrerId(null);
      } else {
        setReferrerStatus('valid');
        setReferrerId(data[0].id);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [referrerNickname, user?.id]);

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

  const sendPhoneCode = () => {
    setError('');
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) {
      setError('휴대폰 번호를 정확히 입력해주세요.');
      return;
    }
    // TODO: 실제 SMS OTP 연동 (Supabase phone auth / PortOne / NICE 본인인증 등)
    // MVP: 인증코드 발송 UI만 제공, 코드 검증은 스킵
    setPhoneSent(true);
    setError('');
    alert('개발 중: 실제 SMS는 아직 발송되지 않습니다. 아래 인증번호 칸에 아무 값이나 입력 후 "인증" 버튼을 눌러주세요. 외부 SMS 업체 연동 후 정식 인증이 활성화됩니다.');
  };

  const verifyPhoneCode = () => {
    if (!phoneCode || phoneCode.length < 4) {
      setError('인증번호를 입력해주세요.');
      return;
    }
    // TODO: 실제 코드 검증
    setPhoneVerified(true);
    setError('');
  };

  const canSubmit = () => {
    if (!name.trim()) return false;
    if (!nickname.trim() || nicknameStatus !== 'available') return false;
    if (!phoneVerified) return false;
    if (!zipcode || !addressRoad) return false;
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
      const updates = {
        name: name.trim(),
        nickname: nickname.trim(),
        phone,
        phone_verified: phoneVerified,
        address_zipcode: zipcode,
        address_road: addressRoad,
        address_detail: addressDetail,
        user_type: userType,
        profile_completed: true,
        updated_at: new Date().toISOString(),
      };
      if (referrerId && referrerStatus === 'valid') {
        updates.referred_by = referrerId;
      }
      const { error: upErr } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);
      if (upErr) throw upErr;

      // 추천인 세팅됐으면 양쪽 보너스 지급 (DB 함수 호출)
      if (updates.referred_by) {
        await supabase.rpc('grant_referral_bonus', { p_user_id: user.id }).catch(() => {});
      }
      await fetchProfile(user.id);
      navigate('/');
    } catch (err) {
      setError(err.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!isLoggedIn) return null;

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 20px' }}>
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

        <form onSubmit={handleSubmit}>
          {/* 회원 타입 */}
          <Field label="가입 유형">
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

          {/* 이름 */}
          <Field label="이름 (실명)" icon={<User size={16} />}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              style={inputStyle}
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

          {/* 휴대폰 */}
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
                disabled={phoneVerified}
                style={{
                  padding: '0 14px', borderRadius: 10,
                  background: phoneVerified ? '#d1fae5' : '#2563eb',
                  color: phoneVerified ? '#065f46' : 'white',
                  border: 'none', fontWeight: 600,
                  cursor: phoneVerified ? 'default' : 'pointer',
                }}
              >
                {phoneVerified ? '인증 완료' : phoneSent ? '재전송' : '인증번호 받기'}
              </button>
            </div>
            {phoneSent && !phoneVerified && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="인증번호 4~6자리"
                  style={{ ...inputStyle, flex: 1 }}
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={verifyPhoneCode}
                  style={{
                    padding: '0 14px', borderRadius: 10, background: '#16a34a',
                    color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
                  }}
                >인증</button>
              </div>
            )}
            {phoneVerified && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#16a34a', fontSize: 13 }}>
                <CheckCircle size={14} /> 인증 완료
              </div>
            )}
          </Field>

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

          {/* 추천인 */}
          <Field
            label="추천인 닉네임 (선택) — 입력 시 양쪽에 3,000포인트 지급"
            icon={<Gift size={16} />}
            helper={
              !referrerNickname ? null :
              referrerStatus === 'checking' ? '확인 중...' :
              referrerStatus === 'valid' ? '추천인 확인 완료' :
              referrerStatus === 'invalid' ? '해당 닉네임의 추천인이 없습니다' : null
            }
            helperColor={
              referrerStatus === 'valid' ? '#16a34a' :
              referrerStatus === 'invalid' ? '#dc2626' : '#64748b'
            }
          >
            <input
              type="text"
              value={referrerNickname}
              onChange={(e) => setReferrerNickname(e.target.value)}
              placeholder="친구의 닉네임을 입력하세요 (비워둬도 됩니다)"
              style={inputStyle}
              maxLength={20}
            />
          </Field>

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
      </motion.div>
      <style>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none',
  background: 'white',
};

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
