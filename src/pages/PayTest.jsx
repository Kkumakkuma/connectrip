// 포인트 충전 결제창 테스트 페이지 (2026-07-30). 프로덕션 빌드엔 라우트 자체가 없음(App.jsx 빌드플래그).
// 목적: 사업자 등록 전 카드사 심사용으로 토스 결제창이 실제로 뜨는지 확인. 실사용자 미노출.
// 안전: 서버 env 가 'test' 가 아니면 결제 UI 를 안 그린다. 실제 포인트 충전은 서버 env 게이팅이 막음.
import { useEffect, useRef, useState } from 'react';
import { createChargeOrder, confirmCharge } from '../lib/payments/api.js';
import { tossAdapter } from '../lib/payments/toss.js';
import { supabase } from '../lib/supabase.js';
import { POINT_PACKAGES } from '../lib/products.js';

export default function PayTest() {
  const rootRef = useRef(null);
  const handleRef = useRef(null);
  const [amount, setAmount] = useState(10000);
  const [state, setState] = useState('idle'); // idle | loading | ready | error | done
  const [order, setOrder] = useState(null);
  const [msg, setMsg] = useState('');
  const [loggedIn, setLoggedIn] = useState(null);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow,noarchive';
    document.head.appendChild(meta);
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data?.session));
    return () => { document.head.removeChild(meta); };
  }, []);

  // 성공 리다이렉트 처리 (/__paytest?paymentKey=...&orderId=...&amount=...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('paymentKey') || !q.get('orderId')) return;
    // setState 는 async .then/.catch 안에서만(동기 effect 본문 호출 회피)
    confirmCharge({ paymentKey: q.get('paymentKey'), orderId: q.get('orderId'), amount: Number(q.get('amount')) })
      .then((r) => {
        if (r.ok) { setState('done'); setMsg(r.test ? `테스트 결제 정상 처리(실제 충전 없음). credited=${r.credited}` : `충전 완료: ${r.credited}P`); }
        else { setState('error'); setMsg(r.message || `승인 실패: ${r.error}${r.code ? ' / ' + r.code : ''}`); }
      })
      .catch((e) => { setState('error'); setMsg(String(e?.message || e)); });
  }, []);

  async function start() {
    setState('loading'); setMsg('');
    try {
      const o = await createChargeOrder(Number(amount));
      if (o.env !== 'test') { setState('error'); setMsg('서버가 라이브 모드입니다. 테스트 페이지는 여기서 멈춥니다.'); return; }
      setOrder(o);
      const handle = await tossAdapter.mount(rootRef.current, o);
      handleRef.current = handle;
      setState('ready');
    } catch (e) { setState('error'); setMsg(String(e?.message || e)); }
  }

  async function pay() {
    try {
      await handleRef.current.requestPayment({
        successUrl: window.location.origin + '/__paytest',
        failUrl: window.location.origin + '/__paytest?fail=1',
      });
    } catch (e) { setState('error'); setMsg('결제창 호출 실패: ' + String(e?.message || e)); }
  }

  return (
    <div className="max-w-md mx-auto px-5 py-24">
      <div className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
        <b>테스트 결제 모드</b> — 카드사 심사·개발용입니다. 실제 결제·충전은 이루어지지 않습니다.
      </div>
      <h1 className="mt-6 text-2xl font-extrabold">포인트 충전 결제창 테스트</h1>

      {loggedIn === false && (
        <p className="mt-4 text-sm text-red-600">로그인 후 이용하세요(결제는 로그인 사용자만).</p>
      )}

      {state !== 'ready' && (
        <div className="mt-6">
          <label className="block text-sm font-semibold mb-1">충전 패키지(고정 금액만 — PG 심사 요건)</label>
          <select
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded-lg border px-3 py-2"
          >
            {POINT_PACKAGES.map((p) => (
              <option key={p.id} value={p.price}>{p.price.toLocaleString()}원 → {p.points.toLocaleString()}P</option>
            ))}
          </select>
          <button
            onClick={start}
            disabled={state === 'loading' || loggedIn === false}
            className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            주문 만들고 결제창 준비
          </button>
        </div>
      )}

      {order && (
        <p className="mt-4 text-xs text-gray-500">
          주문 {order.orderId} · {order.env} · {order.amount.toLocaleString()}원 · {order.provider}
        </p>
      )}

      <div ref={rootRef} className="mt-4" />

      {state === 'ready' && (
        <button onClick={pay} className="mt-4 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-bold text-white">
          결제하기(테스트)
        </button>
      )}

      {msg && <p className={`mt-4 text-sm ${state === 'error' ? 'text-red-600' : 'text-gray-700'}`}>{msg}</p>}
    </div>
  );
}
