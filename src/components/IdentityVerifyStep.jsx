import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, Smartphone, RefreshCw } from 'lucide-react';
import {
  startIdentityVerification, confirmIdentity, loadPendingIdentity, parseIdentityReturn, clearIdentityStart,
  attachStartDs, prepareWebIdentity, appIdentityUrl, identityNav, isMobileUA,
  IDENTITY_ENABLED, IDENTITY_FLOW, IDENTITY_NEED_RESULT_MSG, IDENTITY_PG_NAME, IDENTITY_PURPOSE_SIGNUP,
} from '../lib/identity';
import { isNativeApp } from '../lib/native';
import SentenceLines from './SentenceLines';

// 앱: 인증 창은 크롬 탭(Custom Tab)으로 열리고 이 화면은 그대로 남는다(IntentUrlPlugin, 2026-09-27).
// 결속(2026-10-02, 설계 v2 §3.3): 서버는 결속 값(ds) 없이는 결과를 내주지 않는다. ds 는 크롬 탭이 만들어 다리 페이지가
// 앱으로 넘겨 주는 딥링크로만 온다 — 그래서 결과를 받은 뒤(기록에 id·ds)에만 서버에 묻고, 아직 못 받았으면 서버를 부르지 않고
// '인증 결과 가져오기'(크롬 탭이 보관해 둔 결과를 다리로 다시 보냄)를 안내한다.
// 자동 확인은 id 당 최대 3번·15초 간격(서버 IP당 10분 10회 제한 보호) — 그 뒤는 '인증 결과 확인' 단추.
const AUTO_MAX = 3;
const AUTO_GAP_MS = 15000;
// C4: 같은 id 를 확인하는 중에 결과(ds)를 가진 확인 요청이 또 오면 — 완료 딥링크든 앱 재개 자동 확인(checkPending)이든 —
// 진행 중 확인이 '아직 인증 전'으로 끝났을 때 이만큼 뒤 한 번 더 확인한다. 본래 대상은 앱 재개 자동 확인이 PASS 완료 직전에
// 나가고 바로 뒤 완료 딥링크가 같은 id 로 오는 경우지만, 둘의 순서는 이 화면이 알 수 없다(딥링크가 먼저 오고 재개가 뒤따르기도
// 한다 — 어느 쪽이든 진행 중 확인은 완료 전에 나갔을 수 있다). 그래서 복귀·재개 순서와 무관하게 1회만 재확인한다
// (재개 자동 확인에서도 걸리는 것이 의도. 15초 간격·3회 제한(autoRef)과는 별개로 이 1회뿐이다 — 2026-10-02 검토 확인).
const RECHECK_MS = 1500;
// '인증 결과 가져오기' 연타로 크롬 탭이 여러 개 열리지 않게
const OPEN_GUARD_MS = 1500;
const NOT_VERIFIED_SOFT = "본인확인이 아직 끝나지 않았어요. PASS 인증을 마친 뒤 '인증 결과 확인'을 눌러 주세요.";
const AUTO_HINT = 'PASS 인증을 마치고 커넥트립 앱으로 돌아오면 결과를 자동으로 확인해요.';
const PURPOSE_MISMATCH = '본인확인 용도가 맞지 않습니다. 본인확인을 다시 진행해주세요.';

// 이 화면이 본인확인 복귀 주소(flow=identity)로 열렸는지 — 부모가 주소를 읽어 returnResult 를 넘기는 효과는 이 카드의
// 마운트 효과보다 뒤에 돈다(자식 효과가 먼저). 그래서 마운트 때는 주소를 직접 본다.
const openedByReturn = () => {
  try { return new URLSearchParams(window.location.search).get('flow') === IDENTITY_FLOW; } catch { return false; }
};

// 통신사 휴대폰 본인확인(PASS) 카드. 가입 1단계와 비밀번호 찾기 2단계가 같이 쓴다.
// · PC: 화면을 열 때 미리 등록 → 버튼 → 포트원 창 → 응답의 id·ds 로 서버 검증 → onVerified(proof)
// · 모바일/앱: 버튼 → 페이지 이동(REDIRECTION)·크롬 탭 → 복귀 시 부모가 URL 에서 읽은 returnResult 를 넘기면
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
  // 앱: 진행 중인 본인확인(이 카드의 용도) — 있으면 '인증 결과 확인'(결과를 받음)·'인증 결과 가져오기'(아직) 단추를 보인다
  const pendingOf = () => {
    const p = native ? loadPendingIdentity() : null;
    return p && p.purpose === purpose ? p : null;
  };
  const [pending, setPending] = useState(pendingOf);
  const handledRef = useRef(new Set());   // 성공했거나 확인 중인 id — onVerified 는 id 당 한 번
  const autoRef = useRef(new Map());      // id → { n, at } 자동 확인 횟수·시각
  const recheckRef = useRef(null);        // C4: 확인 중에 온 같은 id 의 복귀 { id, ds, soft }
  const doneRef = useRef(false);          // 이 카드에서 본인확인이 끝남 — 뒤늦은 복귀(같은 링크 재클릭 등)는 무시
  const aliveRef = useRef(true);
  const timerRef = useRef(null);
  const recheckTimerRef = useRef(null);
  const openedAtRef = useRef(0);          // '인증 결과 가져오기'로 크롬 탭을 연 시각
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      clearTimeout(recheckTimerRef.current);
    };
  }, []);

  // PC 웹: 화면을 열 때 미리 등록한다 — 클릭과 팝업 사이의 서버 왕복을 줄인다(설계 v2 §0-5, 팝업 차단 완화).
  // 모바일 웹(REDIRECTION — 팝업 없음)·앱·복귀 화면(returnResult·flow=identity)에서는 하지 않는다(쓰지 않을 행·속도 제한, agy v2).
  useEffect(() => {
    if (native || isMobileUA() || !IDENTITY_ENABLED || disabled || returnResult || openedByReturn()) return;
    prepareWebIdentity(purpose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // soft: 앱 재개·수동 확인 — 아직 안 끝난 인증은 오류가 아니라 안내로 보인다. ds: 결속 값(서버 확인 본문에만 싣는다)
  const finish = async (id, { soft = false, ds = '' } = {}) => {
    if (!id) return;
    if (handledRef.current.has(id)) {
      // 같은 id 를 확인하는 중(또는 이미 성공) — 결과(ds)를 가진 요청(완료 딥링크·앱 재개 자동 확인 모두)이면 진행 중 확인이
      // '아직'으로 끝날 때 다시 확인한다(C4 — 복귀·재개 순서와 무관하게 1회, RECHECK_MS 주석)
      if (ds && !doneRef.current) recheckRef.current = { id, ds, soft };
      return;
    }
    handledRef.current.add(id);
    clearTimeout(recheckTimerRef.current);
    setBusy(true);
    setError('');
    setInfoMsg('');
    let proof;
    try {
      proof = await confirmIdentity(id, purpose, ds);
    } catch (err) {
      handledRef.current.delete(id);   // 다시 확인할 수 있게
      const again = recheckRef.current?.id === id ? recheckRef.current : null;
      recheckRef.current = null;
      if (!aliveRef.current) return;
      if (again && err.code === 'IDENTITY_NOT_VERIFIED') {
        // '확인 중' 표시는 그대로 두고 잠시 뒤 한 번만 더 묻는다(C4)
        recheckTimerRef.current = setTimeout(() => {
          if (aliveRef.current && !doneRef.current) finish(again.id, { soft: again.soft, ds: again.ds });
        }, RECHECK_MS);
        return;
      }
      // PC 웹: 창은 성공했는데 서버 확인이 실패했다(409 PHONE_ALREADY_CLAIMED 등) — 다시 누를 때 등록 왕복 없이 팝업이 뜨게
      // 다음 것을 미리 등록해 둔다(startIdentityVerification 의 failWith 와 같은 이유, 2026-10-02 검토 should-fix).
      // 앱·모바일 웹(REDIRECTION)·30분 안 등록분이 이미 있으면 prepareWebIdentity 가 스스로 거른다.
      if (!native) prepareWebIdentity(purpose);
      if (soft && err.code === 'IDENTITY_NOT_VERIFIED') setInfoMsg(NOT_VERIFIED_SOFT);
      else setError(err.message || '본인확인 결과를 확인하지 못했습니다.');
      // 최종 거절(R3)이면 confirmIdentity 가 이 시도의 기록을 지웠다 → 결과 확인 단추도 사라진다
      setPending(pendingOf());
      setBusy(false);
      return;
    }
    recheckRef.current = null;
    if (!aliveRef.current) return;
    doneRef.current = true;
    setPending(null);
    setBusy(false);
    onVerified?.(proof);
  };

  // 앱: 진행 중인 본인확인 처리(auto = 앱 재개 때 자동, 아니면 단추)
  const checkPending = (auto) => {
    const p = pendingOf();
    if (!p) {
      setPending(null);
      return;
    }
    if (p.id && p.ds) {
      // 결과(id·ds)를 이미 받았다 — 서버에 확인
      if (auto) {
        const a = autoRef.current.get(p.id) || { n: 0, at: 0 };
        if (a.n >= AUTO_MAX || Date.now() - a.at < AUTO_GAP_MS) return;
        autoRef.current.set(p.id, { n: a.n + 1, at: Date.now() });
      }
      finish(p.id, { soft: true, ds: p.ds });
      return;
    }
    // 결과를 아직 받지 못했다 — ds 없이는 서버가 답하지 않으므로 부르지 않는다
    if (auto) {
      setError('');
      setInfoMsg(IDENTITY_NEED_RESULT_MSG);
      return;
    }
    // '인증 결과 가져오기': 크롬 탭(/app-identity resume)이 보관해 둔 결과를 다리 페이지를 거쳐 앱으로 다시 보낸다.
    // 이 화면은 그대로 남고, 결과는 딥링크(ct-app-return)로 돌아온다.
    if (Date.now() - openedAtRef.current < OPEN_GUARD_MS) return;
    openedAtRef.current = Date.now();
    identityNav.go(appIdentityUrl({ state: p.state, purpose: p.purpose, returnPath: p.returnPath, resume: true }));
  };
  // 복귀 결과 처리 — parseIdentityReturn 결과. 부모가 URL 에서 읽은 returnResult 와
  // 앱에서 지금 이 화면으로 온 딥링크(ct-app-return)가 같이 쓴다. 같은 id 는 한 번만 검증(finish).
  // · resume(앱이 복귀 주소 없이 다시 열림)은 아직 인증 전일 수 있어 오류가 아니라 안내로 보인다.
  // · 실패·취소(failed)는 진행 중 기록까지 끝낸다 — 남겨 두면 앱 재개 때마다 서버에 되묻고 '아직 안 끝났다'고 안내한다(교차검토 지적).
  // · needResult(앱이 결과를 아직 받지 못함)는 '인증 결과 가져오기' 안내.
  const applyReturn = (ret) => {
    if (!ret || doneRef.current) return;
    if (!ret.ok) {
      if (ret.failed) clearIdentityStart();
      setPending(pendingOf());
      if (ret.needResult) {
        setError('');
        setInfoMsg(ret.message || IDENTITY_NEED_RESULT_MSG);
        return;
      }
      setInfoMsg('');
      setError(ret.message || '본인확인이 취소되었거나 실패했습니다. 다시 시도해주세요.');
      return;
    }
    if (ret.purpose && ret.purpose !== purpose) {
      // C3: 다른 용도로 시작한 본인확인의 결과는 이 화면에서 쓰지 않는다(서버도 등록한 용도로만 내준다)
      setInfoMsg('');
      setError(PURPOSE_MISMATCH);
      return;
    }
    // 앱: 받은 결과를 시작 기록에 붙여 둔다 — 일시 오류 뒤 '인증 결과 확인'·앱 재개·콜드 스타트 재개가 다시 쓴다
    if (native && !ret.resume) attachStartDs(ret.id, ret.ds, ret.state);
    finish(ret.id, { soft: !!ret.resume, ds: ret.ds });
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
        // 앱: 인증 창은 크롬 탭으로 열리고 이 화면은 남는다 — 결과는 딥링크로 오므로 기다리지 않는다.
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
      const r = await run;
      if (!r) return; // REDIRECTION — 페이지 이동 중
      await finish(r.id, { ds: r.ds });
    } catch (err) {
      setError(err.message || '본인확인을 시작하지 못했습니다.');
      setBusy(false);
    }
  };

  const hasResult = !!(pending?.id && pending?.ds);
  const pendingHint = hasResult ? AUTO_HINT : IDENTITY_NEED_RESULT_MSG;
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
          {/* 아래 안내 상자에 같은 문장이 떠 있으면 한 번만 보인다 */}
          {infoMsg !== pendingHint && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
              <SentenceLines text={pendingHint} />
            </p>
          )}
          <button type="button" onClick={() => checkPending(false)} disabled={busy}
            className="w-full btn-air-secondary">
            <RefreshCw size={15} /> {hasResult ? '인증 결과 확인' : '인증 결과 가져오기'}
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
