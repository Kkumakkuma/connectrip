// 포인트 충전 결제창 테스트 페이지 (2026-09-02, 포트원 V2). 프로덕션 빌드엔 라우트 자체가 없음(App.jsx 빌드플래그 VITE_PAYTEST=1).
// 목적: 이니시스 테스트 채널로 결제창이 실제로 뜨고 confirm 이 paid_test 로 끝나는지 확인. 실사용자 미노출.
// 안전: 서버 env 가 'test' 가 아니면 결제 UI 를 안 그린다. 실제 포인트 충전은 서버 RPC 가 막음(test 는 0P).
import { useEffect, useState } from 'react';
import { createChargeOrder, confirmCharge } from '../lib/payments/api.js';
import { requestPointPayment, parsePaymentReturn, stripPaymentParams, readPendingPayment, clearPendingPayment } from '../lib/payments/portone.js';
import { supabase } from '../lib/supabase.js';
import { POINT_PACKAGES } from '../lib/products.js';

export default function PayTest() {
  const [amount, setAmount] = useState(POINT_PACKAGES[0].price);
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [msg, setMsg] = useState('');
  const [order, setOrder] = useState(null);
  const [loggedIn, setLoggedIn] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data?.session));
  }, []);

  async function confirm(paymentId) {
    setState('loading'); setMsg('확인 중…');
    const r = await confirmCharge({ paymentId }).catch((e) => ({ httpOk: false, error: String(e?.message || e) }));
    if (r.ok) { clearPendingPayment(); setState('done'); setMsg(r.test ? '테스트 결제 확인(paid_test, 0P)' : `${r.credited}P 충전`); return; }
    setState('error'); setMsg(`확인 실패: ${r.error}${r.code ? ' / ' + r.code : ''}${r.retryable ? ' (재시도 가능)' : ''}`);
  }

  // 모바일 리다이렉트 복귀
  useEffect(() => {
    const handleReturn = async () => {
      const ret = parsePaymentReturn(window.location.search);
      if (!ret) return;
      stripPaymentParams();
      const pending = readPendingPayment();
      const id = ret.paymentId || pending?.paymentId || '';
      if (ret.code) { clearPendingPayment(); setState('error'); setMsg(`결제 실패/취소: ${ret.code} ${ret.message}`); return; }
      if (id) await confirm(id);
    };
    handleReturn();
  }, []);

  async function start() {
    setState('loading'); setMsg('');
    try {
      const o = await createChargeOrder(Number(amount));
      if (o.env !== 'test') { setState('error'); setMsg('서버가 라이브 모드입니다. 테스트 페이지는 여기서 멈춥니다.'); return; }
      setOrder(o);
      const r = await requestPointPayment(o, { returnPath: '/__paytest' });
      if (r.redirected) return;
      await confirm(r.paymentId);
    } catch (e) { setState('error'); setMsg(`${e?.code ? e.code + ': ' : ''}${String(e?.message || e)}${e?.pgMessage ? ' / ' + e.pgMessage : ''}`); }
  }

  const pending = readPendingPayment();

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">결제창 테스트 (포트원 V2 · KG이니시스)</h1>
      <p className="mt-2 text-sm text-gray-600">로그인 상태: {loggedIn === null ? '확인 중' : loggedIn ? '로그인됨' : '로그인 필요(/login)'}</p>

      <div className="mt-6">
        <label className="block text-sm font-semibold mb-1">충전 패키지(고정 금액만 — PG 심사 요건)</label>
        <select value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2">
          {POINT_PACKAGES.map((p) => (
            <option key={p.id} value={p.price}>{p.price.toLocaleString()}원 → {p.points.toLocaleString()}P</option>
          ))}
        </select>
        <button
          onClick={start}
          disabled={state === 'loading' || loggedIn === false}
          className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          주문 만들고 결제창 열기
        </button>
        {pending && state !== 'loading' && (
          <button onClick={() => confirm(pending.paymentId)} className="mt-2 ml-2 rounded-lg border px-4 py-2 text-sm">
            미확인 결제 다시 확인 ({pending.paymentId})
          </button>
        )}
      </div>

      {order && (
        <p className="mt-4 text-xs text-gray-500">
          주문 {order.orderId} · {order.env} · {order.amount.toLocaleString()}원 · {order.provider}
        </p>
      )}
      {msg && <p className={`mt-3 text-sm ${state === 'error' ? 'text-red-600' : 'text-gray-800'}`}>{msg}</p>}
    </div>
  );
}
