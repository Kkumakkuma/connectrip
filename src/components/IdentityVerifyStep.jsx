import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, Smartphone } from 'lucide-react';
import { startIdentityVerification, confirmIdentity, IDENTITY_PG_NAME, IDENTITY_PURPOSE_SIGNUP } from '../lib/identity';

// 통신사 휴대폰 본인확인(PASS) 카드. 가입 1단계와 비밀번호 찾기 2단계가 같이 쓴다.
// · PC: 버튼 → 포트원 창 → 응답의 identityVerificationId 를 서버 검증 → onVerified(proof)
// · 모바일/앱: 버튼 → 페이지 이동(REDIRECTION) → 복귀 시 부모가 URL 에서 읽은 returnResult 를 넘기면
//   여기서 서버 검증을 이어서 처리한다.
// · purpose: 증빙의 용도. 서버가 토큰을 그 용도로만 인정한다(가입용 증빙으로 비밀번호 변경 불가).
// · disabled: 포트원 키가 아직 없는 상태(오픈 전). 버튼을 잠가 진행되지 않게 한다.
export default function IdentityVerifyStep({
  returnPath, returnResult, onVerified, accent = '#2563eb', disabled = false,
  purpose = IDENTITY_PURPOSE_SIGNUP,
  title = '1단계 · 휴대폰 본인확인',
  description = '안전한 커뮤니티를 위해 가입 전에 본인 명의 휴대폰으로 본인확인을 진행합니다. PASS 앱으로 본인확인을 진행하면, 확인된 이름·생년월일·휴대폰번호는 가입 정보에 자동으로 채워집니다.',
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmedRef = useRef('');

  const finish = async (id) => {
    setBusy(true);
    setError('');
    try {
      const proof = await confirmIdentity(id, purpose);
      onVerified?.(proof);
    } catch (err) {
      setError(err.message || '본인확인 결과를 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // 모바일 REDIRECTION 복귀 처리 — parseIdentityReturn 결과 {ok, id | message}. 같은 id 는 한 번만 검증.
  useEffect(() => {
    if (!returnResult) return;
    if (!returnResult.ok) {
      setError(returnResult.message || '본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.');
      return;
    }
    if (!returnResult.id || confirmedRef.current === returnResult.id) return;
    confirmedRef.current = returnResult.id;
    finish(returnResult.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnResult]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const id = await startIdentityVerification({ returnPath, purpose });
      if (!id) return; // REDIRECTION — 페이지 이동 중
      await finish(id);
    } catch (err) {
      setError(err.message || '본인확인을 시작하지 못했습니다.');
      setBusy(false);
    }
  };

  return (
    <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '20px 18px', marginBottom: 18, background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ShieldCheck size={20} color={accent} />
        <strong style={{ fontSize: 16, color: '#1a365d' }}>{title}</strong>
      </div>
      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
        {description}
      </p>
      <button type="button" onClick={start} disabled={busy || disabled}
        style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: (busy || disabled) ? '#94a3b8' : accent, color: 'white', fontWeight: 700, fontSize: 15,
          cursor: disabled ? 'not-allowed' : busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {busy ? <Loader2 size={16} className="spin" /> : <Smartphone size={16} />}
        {disabled ? '본인확인 준비 중' : busy ? '확인 중...' : 'PASS로 본인확인'}
      </button>
      {disabled && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 12, lineHeight: 1.5 }}>
          본인확인 서비스 준비 중입니다. 오픈 시 PASS 앱으로 본인확인이 진행됩니다.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.5 }}>
          ⚠️ {error}
        </div>
      )}
      <p style={{ margin: '12px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
        본인확인은 {IDENTITY_PG_NAME}(휴대폰 본인확인 서비스)를 통해 이동통신사가 처리합니다. 확인 과정에서 받는 이름·생년월일·성별·휴대폰번호·통신사·내외국인 여부·연계정보(CI)는
        실명 확인, 1인 1계정 확인, 만 14세 미만 가입 제한 목적으로만 사용하며, 가입을 마치지 않으면 24시간 안에 파기합니다.
      </p>
    </div>
  );
}
