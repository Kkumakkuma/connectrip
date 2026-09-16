import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { loadDaumPostcode, formatDaumAddress, LOAD_ERROR_MESSAGE } from '../lib/daumPostcode';

// 주소 입력(우편번호·도로명 주소·상세 주소) + 다음 우편번호 검색. 가입 화면 두 곳(SignupEmail·SignupComplete)이 쓴다.
// 검색창은 새 창(popup)이 아니라 화면 안의 레이어에 임베드한다 — 모바일 브라우저·PWA·안드로이드 앱(WebView)은
// 새 창을 막거나 못 띄워 팝업 방식은 "버튼을 눌러도 아무 일도 없는" 증상이 난다(2026-09-14 쿠마님 지적으로 교체).
// 도로명·지번·건물명 어느 쪽으로 찾든 우편번호(5자리)와 확정 도로명 주소가 채워지고(확정 도로명이 없는 드문 필지는 고른 지번), 상세 주소만 직접 입력한다.
export default function AddressInput({
  zipcode, road, detail, onSelect, onDetailChange, inputStyle, disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const layerRef = useRef(null);
  const detailRef = useRef(null);
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const returnFocusRef = useRef(null);

  const openLayer = useCallback(() => {
    if (disabled) return;
    setError('');
    // 취소로 닫으면 레이어를 연 버튼·칸으로 포커스를 돌려준다(주소를 고르면 상세 주소 칸으로 간다).
    returnFocusRef.current = document.activeElement;
    setOpen(true);
  }, [disabled]);
  const close = useCallback(() => {
    setOpen(false);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    setTimeout(() => { if (back && back.isConnected && typeof back.focus === 'function') back.focus(); }, 0);
  }, []);
  // 레이어 끝·처음의 보이지 않는 칸에 포커스가 오면(검색 iframe 에서 Tab 으로 빠져나온 경우 포함) 반대쪽 끝으로 되돌린다.
  const wrapFocus = useCallback((toStart) => {
    const box = dialogRef.current;
    if (!box) return;
    const nodes = [...box.querySelectorAll('button:not([disabled]), iframe')];
    const target = toStart ? nodes[0] : nodes[nodes.length - 1];
    target?.focus?.();
  }, []);
  const retry = useCallback(() => { setError(''); setAttempt((n) => n + 1); }, []);

  // 레이어가 열리면 스크립트를 받아 컨테이너에 임베드한다. 닫히면 컨테이너째 사라지므로 별도 정리는 없다.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    loadDaumPostcode()
      .then(() => {
        if (cancelled || !layerRef.current) return;
        layerRef.current.innerHTML = '';
        new window.daum.Postcode({
          width: '100%',
          height: '100%',
          oncomplete: (data) => {
            const next = formatDaumAddress(data);
            onSelect({ zipcode: next.zipcode, road: next.road });
            returnFocusRef.current = null;
            setOpen(false);
            // 레이어가 닫힌 뒤 상세 주소 칸으로 포커스
            setTimeout(() => { if (detailRef.current) detailRef.current.focus(); }, 0);
          },
        }).embed(layerRef.current, { autoClose: false });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError((err && err.message) || LOAD_ERROR_MESSAGE);
      });
    return () => { cancelled = true; };
    // onSelect 는 부모의 setter 래퍼라 매 렌더 바뀐다 — 열림/재시도 시점에만 다시 임베드한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  // 열려 있는 동안 뒤 화면 스크롤을 잠그고 Esc 로 닫는다.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Esc 는 우편번호 창만 닫는다. 마이페이지 회원 정보 팝업(WriteModal, document keydown) 안에서도 쓰이므로
    // 캡처 단계에서 먼저 받아 전파를 끊는다(2026-09-15) — 안 그러면 Esc 한 번에 팝업까지 같이 닫힌다.
    // Tab 도 여기서 가둔다(2026-09-16 codex 검토): 바깥 팝업의 Tab 트랩이 레이어 뒤에 가려진 회원 정보 칸으로 옮기지 않게.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      e.stopPropagation();
      const nodes = [...dialogRef.current.querySelectorAll('button:not([disabled]), iframe')];
      if (nodes.length === 0) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const readOnlyStyle = { ...inputStyle, cursor: disabled ? 'not-allowed' : 'pointer', background: '#f8fafc' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text" value={zipcode} readOnly placeholder="우편번호" aria-label="우편번호"
          inputMode="numeric" onClick={openLayer}
          style={{ ...readOnlyStyle, flex: '0 0 120px', minWidth: 0 }}
        />
        <button
          type="button" onClick={openLayer} disabled={disabled}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px', borderRadius: 10,
            background: disabled ? '#94a3b8' : '#2563eb', color: 'white', border: 'none', fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          <Search size={15} /> 주소 검색
        </button>
      </div>
      <input
        type="text" value={road} readOnly placeholder="도로명 주소 (주소 검색으로 입력)" aria-label="도로명 주소"
        onClick={openLayer} style={{ ...readOnlyStyle, marginBottom: 8 }}
      />
      <input
        ref={detailRef} type="text" value={detail} onChange={(e) => onDetailChange(e.target.value)}
        placeholder="상세 주소 (동/호수 등)" aria-label="상세 주소" autoComplete="off" maxLength={80}
        disabled={disabled} style={inputStyle}
      />

      {open && (
        <div
          ref={dialogRef}
          role="dialog" aria-modal="true" aria-label="주소 검색"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'hidden',
          }}
        >
          <span tabIndex={0} aria-hidden="true" onFocus={() => wrapFocus(false)} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }} />
          <div
            style={{
              // 높이는 100vh 가 아니라 부모(fixed inset:0) 기준 % — 모바일 브라우저 툴바가 보일 때 100vh 는 실제 보이는 영역보다 커서
              // 헤더·닫기 버튼이 화면 밖으로 잘린다(검토 지적 3건, 2026-09-14).
              width: '100%', maxWidth: 520, maxHeight: '100%', height: 'min(640px, 100%)',
              background: 'white', borderRadius: 14, display: 'flex', flexDirection: 'column',
              overflow: 'hidden', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <strong style={{ fontSize: 15, color: '#0f172a' }}>주소 검색</strong>
              <button
                ref={closeBtnRef}
                type="button" onClick={close} aria-label="닫기"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: '#475569', display: 'inline-flex' }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '8px 14px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #f1f5f9', wordBreak: 'keep-all' }}>
              도로명, 건물명, 지번 중 아무거나 입력해 검색하세요. 예: 테헤란로 152, 역삼동 737
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              <div ref={layerRef} style={{ width: '100%', height: '100%' }} />
              {loading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#64748b', fontSize: 13, background: 'white' }}>
                  <Loader2 size={18} className="animate-spin" /> 주소 검색을 불러오는 중...
                </div>
              )}
              {error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center', color: '#b91c1c', fontSize: 13, background: 'white', wordBreak: 'keep-all' }}>
                  <span>{error}</span>
                  <button
                    type="button" onClick={retry}
                    style={{ padding: '8px 16px', borderRadius: 10, background: '#2563eb', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                  >
                    다시 시도
                  </button>
                </div>
              )}
            </div>
          </div>
          <span tabIndex={0} aria-hidden="true" onFocus={() => wrapFocus(true)} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }} />
        </div>
      )}
    </div>
  );
}
