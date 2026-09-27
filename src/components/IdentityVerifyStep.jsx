import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, Smartphone, RefreshCw } from 'lucide-react';
import {
  startIdentityVerification, confirmIdentity, loadPendingIdentity, parseIdentityReturn, clearIdentityStart,
  IDENTITY_PG_NAME, IDENTITY_PURPOSE_SIGNUP,
} from '../lib/identity';
import { isNativeApp } from '../lib/native';
import SentenceLines from './SentenceLines';

// 앱: 인증 창은 크롬 탭(Custom Tab)으로 열리고 이 화면은 그대로 남는다(IntentUrlPlugin, 2026-09-27).
// 돌아오면(탭 닫기·최근 앱·'앱으로 돌아가기' 단추) 진행 중인 본인확인 id 로 서버에 결과를 확인한다.
// 자동 확인은 id 당 최대 3번·15초 간격(서버 IP당 10분 10회 제한 보호) — 그 뒤는 '인증 결과 확인' 단추.
const AUTO_MAX = 3;
const AUTO_GAP_MS = 15000;
const NOT_VERIFIED_SOFT = "본인확인이 아직 끝나지 않았어요. PASS 인증을 마친 뒤 '인증 결과 확인'을 눌러 주세요.";

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
  description = '안전한 커뮤니티를 위해 가입 전에 본인 명의 휴대폰으로 본인확인을 진행합니다.',
  // 하단 고지. 가입 외 용도(휴대폰 변경 등)는 부모가 그 용도에 맞는 문구를 넘긴다(검토 지적, 2026-09-14).
  notice = null,
  // 서버 검증 진행 중 여부를 부모에 알린다(부모가 닫기·다른 편집을 잠글 수 있게).
  onBusyChange = null,
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');   // 안내(아직 인증 전 등) — 'notice' 는 하단 고지 prop 이름
  const native = isNativeApp();
  // 앱: 진행 중인 본인확인(이 카드의 용도) — 있으면 '인증 결과 확인' 단추를 보인다
  const pendingOf = () => {
    const p = native ? loadPendingIdentity() : null;
    return p && p.purpose === purpose ? p : null;
  };
  const [pending, setPending] = useState(pendingOf);
  const handledRef = useRef(new Set());   // 성공했거나 확인 중인 id — onVerified 는 id 당 한 번
  const autoRef = useRef(new Map());      // id → { n, at } 자동 확인 횟수·시각
  const doneRef = useRef(false);          // 이 카드에서 본인확인이 끝남 — 뒤늦은 복귀(같은 링크 재클릭 등)는 무시
  const aliveRef = useRef(true);
  const timerRef = useRef(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; clearTimeout(timerRef.current); };
  }, []);

  // soft: 앱 재개·수동 확인 — 아직 안 끝난 인증은 오류가 아니라 안내로 보인다
  const finish = async (id, { soft = false } = {}) => {
    if (!id || handledRef.current.has(id)) return;
    handledRef.current.add(id);
    setBusy(true);
    setError('');
    setInfoMsg('');
    try {
      const proof = await confirmIdentity(id, purpose);
      if (!aliveRef.current) return;
      doneRef.current = true;
      setPending(null);
      onVerified?.(proof);
    } catch (err) {
      handledRef.current.delete(id);   // 다시 확인할 수 있게
      if (!aliveRef.current) return;
      if (soft && err.code === 'IDENTITY_NOT_VERIFIED') setInfoMsg(NOT_VERIFIED_SOFT);
      else setError(err.message || '본인확인 결과를 확인하지 못했습니다.');
      setPending(pendingOf());
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  // 앱: 진행 중인 본인확인을 서버에 확인(auto = 앱 재개 때 자동)
  const checkPending = (auto) => {
    const p = pendingOf();
    if (!p) return;
    if (auto) {
      const a = autoRef.current.get(p.id) || { n: 0, at: 0 };
      if (a.n >= AUTO_MAX || Date.now() - a.at < AUTO_GAP_MS) return;
      autoRef.current.set(p.id, { n: a.n + 1, at: Date.now() });
    }
    finish(p.id, { soft: true });
  };
  // 복귀 결과 처리 — parseIdentityReturn 결과 {ok, id, resume | failed, message}. 부모가 URL 에서 읽은 returnResult 와
  // 앱에서 지금 이 화면으로 온 딥링크(ct-app-return)가 같이 쓴다. 같은 id 는 한 번만 검증(finish).
  // · resume(앱이 복귀 주소 없이 다시 열림)은 아직 인증 전일 수 있어 오류가 아니라 안내로 보인다.
  // · 실패·취소(failed)는 진행 중 기록까지 끝낸다 — 남겨 두면 앱 재개 때마다 서버에 되묻고 '아직 안 끝났다'고 안내한다(교차검토 지적).
  const applyReturn = (ret) => {
    if (!ret || doneRef.current) return;
    if (!ret.ok) {
      if (ret.failed) clearIdentityStart();
      setPending(pendingOf());
      setInfoMsg('');
      setError(ret.message || '본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.');
      return;
    }
    finish(ret.id, { soft: !!ret.resume });
  };
  const checkRef = useRef(checkPending);
  const returnRef = useRef(applyReturn);
  useEffect(() => { checkRef.current = checkPending; returnRef.current = applyReturn; });

  // 모바일 REDIRECTION 복귀(부모가 URL 에서 읽어 넘김)
  useEffect(() => {
    applyReturn(returnResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnResult]);

  // 앱: ① 앱 재개(크롬 탭을 닫거나 최근 앱으로 돌아옴) ② '앱으로 돌아가기' 딥링크가 지금 이 화면으로 왔을 때
  // (AppReturnBridge 가 같은 경로면 화면을 다시 띄우지 않고 이벤트로 알린다 — 화면들의 복귀 처리가 처음 한 번만 돌기 때문, agy B1)
  useEffect(() => {
    if (!native) return undefined;
    let removed = false;
    let handle = null;
    import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => checkRef.current(true)))
      .then((h) => { if (removed) Promise.resolve(h.remove()).catch(() => {}); else handle = h; })
      .catch(() => {});
    const onReturn = (e) => returnRef.current(parseIdentityReturn(e.detail?.search || ''));
    window.addEventListener('ct-app-return', onReturn);
    return () => {
      removed = true;
      if (handle) Promise.resolve(handle.remove()).catch(() => {});
      window.removeEventListener('ct-app-return', onReturn);
    };
  }, [native]);

  const start = async () => {
    setBusy(true);
    setError('');
    setInfoMsg('');
    try {
      const run = startIdentityVerification({ returnPath, purpose });
      if (native) {
        // 앱: 인증 창은 크롬 탭으로 열리고 이 화면은 남는다 — SDK 약속은 끝나지 않으므로 기다리지 않는다.
        run.catch((err) => {
          if (!aliveRef.current) return;
          setError(err.message || '본인확인을 시작하지 못했습니다.');
          setBusy(false);
        });
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (!aliveRef.current) return;
          setBusy(false);
          setPending(pendingOf());
        }, 1500);
        return;
      }
      const id = await run;
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
      {description && (
        <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
          {description}
        </p>
      )}
      <button type="button" onClick={start} disabled={busy || disabled}
        className="w-full btn-air-primary btn-air-lg">
        {busy ? <Loader2 size={16} className="spin" /> : <Smartphone size={16} />}
        {disabled ? '본인확인 준비 중' : busy ? '확인 중...' : 'PASS로 본인확인'}
      </button>
      {native && pending && !disabled && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            PASS 인증을 마치고 커넥트립 앱으로 돌아오면 결과를 자동으로 확인해요.
          </p>
          <button type="button" onClick={() => checkPending(false)} disabled={busy}
            className="w-full btn-air-secondary">
            <RefreshCw size={15} /> 인증 결과 확인
          </button>
        </div>
      )}
      {infoMsg && !error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1e40af', fontSize: 12, lineHeight: 1.5 }}>
          <SentenceLines text={infoMsg} />
        </div>
      )}
      {disabled && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 12, lineHeight: 1.5 }}>
          본인확인 서비스 준비 중입니다. 오픈 시 PASS 앱으로 본인확인이 진행됩니다.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.5 }}>
          ⚠️ <SentenceLines text={error} />
        </div>
      )}
      {notice !== false && (
      <p style={{ margin: '12px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
        본인확인은 {IDENTITY_PG_NAME}(휴대폰 본인확인 서비스)를 통해 이동통신사가 처리합니다. 확인 과정에서 받는 이름·생년월일·성별·휴대폰번호·통신사·내외국인 여부·연계정보(CI)는
        {' '}{notice || '실명 확인, 1인 1계정 확인, 만 14세 미만 가입 제한 목적으로만 사용하며, 가입을 마치지 않으면 24시간 안에 파기합니다.'}
      </p>
      )}
    </div>
  );
}
