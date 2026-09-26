import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { UserRound, Pencil, Loader2, Check, X, ShieldCheck, Camera } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';
import AddressInput from './AddressInput';
import Avatar from './Avatar';
import { imageFileError, uploadImageFile } from '../lib/imageUpload';
import { passwordWeak } from '../lib/loginId';
import { checkNicknameTaken } from '../lib/nicknameApi';
import {
  maskPhone, normalizeNickname, nicknameProblem, formatJoinedDate, userTypeLabel,
  messageFor, codeFromError, EMAIL_OTP_PURPOSE_CHANGE, EMAIL_RE,
} from '../lib/profileEdit';

// 마이페이지 맨 위 "회원 정보" 카드 (2026-09-14, 쿠마님 9583 "1번부터").
// 표시만: 아이디·이름·생년월일·휴대폰(가림)·회원 유형·가입일. 수정: 닉네임·연락 이메일(OTP)·주소·비밀번호.
// 휴대폰 번호 변경은 넣지 않는다(쿠마님 9600 "사람들이 번호 살면서 몇 번이나 바꾼다고" — 제거).
// · 닉네임·주소 = profiles 본인 행 직접 UPDATE(RLS + profiles_guard 허용 컬럼, 주소는 트리거가 재암호화)
// · 이메일 = /api/send-email-otp → /api/verify-email-otp(purpose email_change) → rpc change_my_email
// · 비밀번호 = 현재 비밀번호로 signInWithPassword 재확인 → auth.updateUser (아이디 로그인 계정만)
// · 승무원의 연락 이메일은 항공사 이메일(가입 RPC 확정) → 여기선 표시만, 갱신은 승무원 인증 카드.
const RESEND_SECONDS = 60;

const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 14,
  background: 'white', color: '#0f172a', outline: 'none', boxSizing: 'border-box',
};
// 버튼은 index.css 의 btn-air-primary / btn-air-secondary (2026-09-25 버튼 통일)

function Row({ label, value, hint, actionLabel, onAction, editing, children }) {
  return (
    <div style={{ borderTop: '1px solid #f1f5f9', padding: '14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 92px', fontSize: 13, color: '#64748b', fontWeight: 600, paddingTop: 2 }}>{label}</div>
        <div style={{ flex: '1 1 160px', minWidth: 0, fontSize: 15, color: '#0f172a', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
          {value}
          {hint && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, wordBreak: 'keep-all' }}>{hint}</div>}
        </div>
        {actionLabel && !editing && (
          <button type="button" onClick={onAction} className="btn-air-secondary" aria-label={`${label} ${actionLabel}`}>
            <Pencil size={14} /> {actionLabel}
          </button>
        )}
      </div>
      {editing && <div style={{ marginTop: 12, paddingLeft: 0 }}>{children}</div>}
    </div>
  );
}

function Notice({ tone = 'error', children }) {
  const palette = tone === 'ok'
    ? { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' }
    : { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' };
  return (
    <div role={tone === 'ok' ? 'status' : 'alert'} style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, fontSize: 13, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color, wordBreak: 'keep-all' }}>
      {children}
    </div>
  );
}

// embedded: 마이페이지 팝업(회원 정보 수정 버튼) 안에서 쓸 때 — 카드 테두리·머리글 없이 항목만 그린다(2026-09-15).
// active: 팝업 안에서 쓸 때 열림 여부(MyPage). 팝업은 닫혀도 카드를 유지하므로(keepMounted) 닫힐 때 비밀번호 입력만 비운다.
export default function ProfileCard({ embedded = false, active = true }) {
  const { user, profile, isCrew, updateProfile, fetchProfile } = useAuth();
  const [editing, setEditing] = useState(null);      // 'nickname' | 'email' | 'address' | 'password' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');               // 저장 성공 안내(행 닫힌 뒤 카드 하단에 표시)
  // 프로필 사진(2026-09-26). 공개 버킷 images 에 한 장(최대 변 512px), profiles.avatar_url 에 주소.
  // 바꾸거나 기본으로 돌린 옛 사진 파일은 매일 정리 작업(images_orphans)이 지운다.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef(null);
  const [birthdate, setBirthdate] = useState('');

  // 닉네임
  const [nickname, setNickname] = useState('');
  const [nickStatus, setNickStatus] = useState(null); // 'checking' | 'available' | 'taken' | null
  // 이메일
  const [newEmail, setNewEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // 주소
  const [addr, setAddr] = useState({ zipcode: '', road: '', detail: '' });
  // 비밀번호
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [emailToken, setEmailToken] = useState('');  // OTP 확인 뒤 받은 소비 토큰 — 변경 RPC 가 일시 실패하면 재시도에 쓴다
  const startedUserRef = useRef(null);               // 편집을 연 시점의 계정. 다른 탭에서 계정이 바뀌면 저장하지 않는다(codex 지적)

  const canChangePassword = !profile?.provider || profile.provider === 'email';

  // 생년월일은 profiles_private(본인만 SELECT)에 있다. 없으면 행을 숨긴다.
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    supabase.from('profiles_private').select('birthdate').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setBirthdate(data?.birthdate || ''); })
      .catch(() => { /* 표시용이라 실패는 무시 */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (active) return;
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    // 저장 중이면 결과를 보여줘야 하므로 행을 닫지 않는다(busy 가 끝난 뒤 다시 열면 결과 안내가 남아 있다).
    if (!busy) setEditing((cur) => (cur === 'password' ? null : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // 닉네임 중복 확인(입력 멈춘 뒤 400ms)
  useEffect(() => {
    if (editing !== 'nickname') return undefined;
    const n = normalizeNickname(nickname);
    if (nicknameProblem(n) || n === (profile?.nickname || '')) { setNickStatus(null); return undefined; }
    setNickStatus('checking');
    let cancelled = false;
    const t = setTimeout(async () => {
      const taken = await checkNicknameTaken(n);
      if (cancelled) return;
      setNickStatus(taken === null ? null : (taken ? 'taken' : 'available'));
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [nickname, editing, profile?.nickname]);

  const open = (section) => {
    if (busy) return;
    startedUserRef.current = user?.id || null;
    setError('');
    setDone('');
    setEditing(section);
    if (section === 'nickname') { setNickname(profile?.nickname || ''); setNickStatus(null); }
    if (section === 'email') { setNewEmail(''); setEmailSent(false); setEmailCode(''); setResendIn(0); setEmailToken(''); }
    if (section === 'address') setAddr({ zipcode: profile?.address_zipcode || '', road: profile?.address_road || '', detail: profile?.address_detail || '' });
    if (section === 'password') { setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
  };
  const close = () => { setEditing(null); setError(''); };
  const SESSION_CHANGED = '로그인 계정이 바뀌었습니다. 새로고침한 뒤 다시 시도해주세요.';
  // 저장 직전에 세션의 계정이 편집을 연 계정과 같은지 확인(다른 탭 로그아웃·계정 전환 대비).
  const sameUser = async () => {
    try { const { data } = await supabase.auth.getSession(); return !!data?.session?.user?.id && data.session.user.id === startedUserRef.current; }
    catch { return false; }
  };
  // 저장 성공 → 표시 갱신(get_my_profile 재조회). 재조회 결과로 실제 반영을 확인하고, 재조회가 실패하면 그 사실을 안내한다.
  const finish = async (message, check) => {
    let after = null;
    try { after = await fetchProfile(user.id); } catch { after = null; }
    setEditing(null);
    if (!after) { setError(''); setDone(message + ' 새로고침해주세요.'); return; }
    if (check && !check(after)) { setDone(''); setError('저장이 반영되지 않았습니다. 새로고침한 뒤 다시 확인해주세요.'); return; }
    setError('');
    setDone(message);
  };
  const fail = (err, fallback) => {
    const code = typeof err === 'string' ? err : codeFromError(err);
    setError(messageFor(code, (err && err.message && !code) ? err.message : fallback));
  };

  // ---------- 닉네임 ----------
  const saveNickname = async () => {
    const n = normalizeNickname(nickname);
    const problem = nicknameProblem(n);
    if (problem) { setError(problem); return; }
    if (n === (profile?.nickname || '')) { setError(messageFor('same')); return; }
    if (nickStatus === 'taken') { setError(messageFor('NICKNAME_TAKEN')); return; }
    setBusy(true); setError('');
    try {
      if (!(await sameUser())) { setError(SESSION_CHANGED); return; }
      await updateProfile({ nickname: n });
      await finish('닉네임을 바꿨습니다.', (p) => p.nickname === n);
    } catch (err) { fail(err, '닉네임을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  // ---------- 연락 이메일 ----------
  const sendEmailCode = async () => {
    const cleaned = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(cleaned)) { setError(messageFor('email_invalid')); return; }
    if (cleaned === String(profile?.email || '').toLowerCase()) { setError(messageFor('same')); return; }
    setBusy(true); setError('');
    try {
      const resp = await fetch(apiUrl('/api/send-email-otp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned, purpose: EMAIL_OTP_PURPOSE_CHANGE }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) { setError(data.error || '인증번호를 보내지 못했습니다.'); return; }
      setEmailSent(true); setEmailCode(''); setResendIn(RESEND_SECONDS);
    } catch (err) { setError('네트워크 오류: ' + (err.message || '알 수 없음')); }
    finally { setBusy(false); }
  };
  const confirmEmailCode = async () => {
    const cleaned = newEmail.trim().toLowerCase();
    if (!/^[0-9]{6}$/.test(emailCode)) { setError('인증번호 6자리를 입력해주세요.'); return; }
    setBusy(true); setError('');
    try {
      const resp = await fetch(apiUrl('/api/verify-email-otp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned, code: emailCode, purpose: EMAIL_OTP_PURPOSE_CHANGE }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok || !data.verifyToken) { setError(data.error || '인증에 실패했습니다.'); return; }
      setEmailToken(data.verifyToken);
      await applyEmailChange(cleaned, data.verifyToken);
    } catch (err) { setError('네트워크 오류: ' + (err.message || '알 수 없음') + ' 아래 "변경 다시 시도"를 눌러주세요.'); }
    finally { setBusy(false); }
  };
  // OTP 는 이미 확인됐고 토큰만 남은 상태에서 변경 RPC 를 호출한다. 일시 장애면 토큰을 남겨 두고 재시도할 수 있다(codex 지적).
  const applyEmailChange = async (cleaned, token) => {
    if (!(await sameUser())) { setError(SESSION_CHANGED); return; }
    const { data: result, error: rpcErr } = await supabase.rpc('change_my_email', { p_email: cleaned, p_email_otp_token: token });
    if (rpcErr) { fail(rpcErr, '이메일을 바꾸지 못했습니다. 아래 "변경 다시 시도"를 눌러주세요.'); return; }
    if (result !== 'ok') {
      setEmailToken('');
      if (result === 'proof_invalid') { setEmailSent(false); setEmailCode(''); }
      fail(String(result), '이메일을 바꾸지 못했습니다.');
      return;
    }
    setEmailToken('');
    await finish('연락 이메일을 바꿨습니다.', (p) => String(p.email || '').toLowerCase() === cleaned);
  };
  const retryEmailChange = async () => {
    if (!emailToken) return;
    setBusy(true); setError('');
    try { await applyEmailChange(newEmail.trim().toLowerCase(), emailToken); }
    catch (err) { setError('네트워크 오류: ' + (err.message || '알 수 없음')); }
    finally { setBusy(false); }
  };

  // ---------- 주소 ----------
  const saveAddress = async () => {
    if (!addr.zipcode || !addr.road) { setError('주소 검색으로 우편번호와 도로명 주소를 입력해주세요.'); return; }
    const detail = addr.detail.trim();
    if (addr.zipcode === (profile?.address_zipcode || '') && addr.road === (profile?.address_road || '') && detail === (profile?.address_detail || '')) {
      setError(messageFor('same')); return;
    }
    setBusy(true); setError('');
    try {
      if (!(await sameUser())) { setError(SESSION_CHANGED); return; }
      await updateProfile({ address_zipcode: addr.zipcode, address_road: addr.road, address_detail: detail || null });
      await finish('주소를 바꿨습니다.', (p) => p.address_road === addr.road && String(p.address_zipcode || '') === addr.zipcode);
    } catch (err) { fail(err, '주소를 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  // ---------- 비밀번호 ----------
  const savePassword = async () => {
    if (!pwCurrent) { setError('현재 비밀번호를 입력해주세요.'); return; }
    if (passwordWeak(pwNew)) { setError('새 비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.'); return; }
    if (pwNew === pwCurrent) { setError('현재 비밀번호와 다른 비밀번호를 입력해주세요.'); return; }
    if (pwNew !== pwConfirm) { setError('새 비밀번호가 서로 다릅니다.'); return; }
    setBusy(true); setError('');
    try {
      if (!(await sameUser())) { setError(SESSION_CHANGED); return; }
      // 현재 비밀번호 확인 = 같은 계정으로 다시 로그인(세션은 같은 사용자로 교체될 뿐 화면은 유지)
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwCurrent });
      if (signErr) { setError('현재 비밀번호가 올바르지 않습니다.'); return; }
      const { error: updErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updErr) { setError(updErr.message || '비밀번호를 바꾸지 못했습니다.'); return; }
      // 비밀번호 찾기 경로(revoke_user_sessions)와 같은 정책 — 다른 기기 세션은 끊는다(검토 지적). 실패해도 변경은 완료.
      try { await supabase.auth.signOut({ scope: 'others' }); } catch { /* 무시 */ }
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setEditing(null);
      setDone('비밀번호를 바꿨습니다.');
    } catch (err) { setError('네트워크 오류: ' + (err.message || '알 수 없음')); }
    finally { setBusy(false); }
  };

  if (!user || !profile) return null;

  const addressText = profile.address_road
    ? `${profile.address_zipcode ? `(${profile.address_zipcode}) ` : ''}${profile.address_road}${profile.address_detail ? ` ${profile.address_detail}` : ''}`
    : '';

  const Wrap = embedded ? 'div' : motion.div;
  const wrapProps = embedded ? {} : {
    initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 },
    style: { background: 'white', borderRadius: '1.5rem', padding: '1.5rem', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' },
  };
  const changeAvatar = async (file) => {
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (!file || !user) return;
    const bad = imageFileError(file);
    if (bad) { setDone(''); setError(bad); return; }
    setAvatarBusy(true); setError(''); setDone('');
    try {
      const url = await uploadImageFile(file, { userId: user.id, bucket: 'images', maxDimension: 512 });
      await updateProfile({ avatar_url: url });
      setDone('프로필 사진을 바꿨습니다.');
    } catch (err) {
      console.error('프로필 사진 변경 실패:', err);
      setError('프로필 사진을 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const resetAvatar = async () => {
    if (!user) return;
    setAvatarBusy(true); setError(''); setDone('');
    try {
      await updateProfile({ avatar_url: null });
      setDone('기본 프로필 사진으로 바꿨습니다.');
    } catch (err) {
      console.error('프로필 사진 되돌리기 실패:', err);
      setError('프로필 사진을 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Wrap {...wrapProps}>
      {!embedded && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ background: 'linear-gradient(135deg,#2563eb,#3b82f6)', width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
          <UserRound size={20} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#1f2937' }}>회원 정보</h3>
          <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{userTypeLabel(profile.user_type)} · 가입일 {formatJoinedDate(profile.created_at)}</p>
        </div>
      </div>
      )}

      <Row label="프로필 사진" value={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Avatar src={profile.avatar_url} size={64} alt="내 프로필 사진" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy} className="btn-air-secondary btn-air-sm">
              {avatarBusy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} 사진 변경
            </button>
            {profile.avatar_url && (
              <button type="button" onClick={resetAvatar} disabled={avatarBusy} className="btn-air-secondary btn-air-sm">기본 이미지로</button>
            )}
          </div>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" aria-label="프로필 사진 파일 선택"
            onChange={(e) => changeAvatar(e.target.files?.[0])} />
        </div>
      } />
      <Row label="아이디" value={profile.login_id || '-'} />
      <Row label="이름" value={profile.name || '-'} />
      {birthdate && <Row label="생년월일" value={birthdate} />}
      {embedded && <Row label="회원 유형" value={userTypeLabel(profile.user_type)} />}
      {embedded && <Row label="가입일" value={formatJoinedDate(profile.created_at)} />}

      <Row label="휴대폰" value={profile.phone ? maskPhone(profile.phone) : '미등록'} />

      <Row label="닉네임" value={profile.nickname || '-'}
        actionLabel="수정" onAction={() => open('nickname')} editing={editing === 'nickname'}>
        <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20}
          aria-label="새 닉네임" placeholder="새 닉네임" style={inputStyle} autoComplete="off" />
        <div style={{ fontSize: 12, marginTop: 6, minHeight: 16, color: nickStatus === 'taken' ? '#dc2626' : nickStatus === 'available' ? '#16a34a' : '#94a3b8' }}>
          {nickStatus === 'checking' && '확인 중...'}
          {nickStatus === 'available' && '사용할 수 있는 닉네임입니다.'}
          {nickStatus === 'taken' && '이미 사용 중인 닉네임입니다.'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={saveNickname} disabled={busy || nickStatus === 'checking' || nickStatus === 'taken'} className="btn-air-primary">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장
          </button>
          <button type="button" onClick={close} className="btn-air-secondary" disabled={busy}><X size={14} /> 취소</button>
        </div>
      </Row>

      {isCrew ? (
        <Row label="항공사" value={`${profile.airline_name || '-'}${profile.airline_email ? ` · ${profile.airline_email}` : ''}`}
        />
      ) : (
        <Row label="연락 이메일" value={profile.email || '미등록'}
          actionLabel="변경" onAction={() => open('email')} editing={editing === 'email'}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setEmailSent(false); setEmailCode(''); }}
              aria-label="새 이메일" placeholder="새 이메일 주소" style={{ ...inputStyle, flex: '1 1 200px' }} autoComplete="email" disabled={busy} />
            <button type="button" onClick={sendEmailCode} disabled={busy || resendIn > 0} className="btn-air-secondary">
              {emailSent ? (resendIn > 0 ? `재발송 ${resendIn}초` : '재발송') : '인증번호 받기'}
            </button>
          </div>
          {emailSent && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input type="text" inputMode="numeric" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                aria-label="이메일 인증번호" placeholder="인증번호 6자리" style={{ ...inputStyle, flex: '1 1 160px' }} autoComplete="one-time-code" disabled={busy} />
              <button type="button" onClick={confirmEmailCode} disabled={busy || emailCode.length !== 6} className="btn-air-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 확인하고 변경
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {emailToken && (
              <button type="button" onClick={retryEmailChange} disabled={busy} className="btn-air-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 변경 다시 시도
              </button>
            )}
            <button type="button" onClick={close} className="btn-air-secondary" disabled={busy}><X size={14} /> 취소</button>
          </div>
        </Row>
      )}

      <Row label="주소" value={addressText || '미등록'}
        actionLabel="수정" onAction={() => open('address')} editing={editing === 'address'}>
        <AddressInput zipcode={addr.zipcode} road={addr.road} detail={addr.detail} inputStyle={inputStyle}
          onSelect={({ zipcode, road }) => setAddr((a) => ({ ...a, zipcode, road }))}
          onDetailChange={(v) => setAddr((a) => ({ ...a, detail: v }))} disabled={busy} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" onClick={saveAddress} disabled={busy} className="btn-air-primary">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장
          </button>
          <button type="button" onClick={close} className="btn-air-secondary" disabled={busy}><X size={14} /> 취소</button>
        </div>
      </Row>

      {canChangePassword && (
        <Row label="비밀번호" value="••••••••"
          actionLabel="변경" onAction={() => open('password')} editing={editing === 'password'}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} aria-label="현재 비밀번호" placeholder="현재 비밀번호" style={inputStyle} autoComplete="current-password" disabled={busy} />
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} aria-label="새 비밀번호" placeholder="새 비밀번호" style={inputStyle} autoComplete="new-password" disabled={busy} />
            <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} aria-label="새 비밀번호 확인" placeholder="새 비밀번호 확인" style={inputStyle} autoComplete="new-password" disabled={busy} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={savePassword} disabled={busy} className="btn-air-primary">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} 비밀번호 변경
            </button>
            <button type="button" onClick={close} className="btn-air-secondary" disabled={busy}><X size={14} /> 취소</button>
          </div>
        </Row>
      )}

      {error && <Notice>{error}</Notice>}
      {done && !error && <Notice tone="ok">{done}</Notice>}
    </Wrap>
  );
}
