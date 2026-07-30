// 토스페이먼츠 결제위젯 v2 어댑터 (ConnectTrip 포인트 충전용, 2026-07-30).
// clientKey 는 파일에 안 박고 주문 생성 응답(order.pgParams.clientKey)으로 서버가 내려준다.

const SDK_SRC = 'https://js.tosspayments.com/v2/standard';
let sdkPromise = null;

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.TossPayments) { resolve(window.TossPayments); return; }
    const s = document.createElement('script');
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () => { window.TossPayments ? resolve(window.TossPayments) : (sdkPromise = null, reject(new Error('TossPayments 없음'))); };
    s.onerror = () => { sdkPromise = null; reject(new Error('토스 SDK 로드 실패')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export const tossAdapter = {
  id: 'toss',
  async mount(root, order) {
    const clientKey = order.pgParams?.clientKey;
    if (!clientKey) throw new Error('clientKey 미수신');
    // 주문별 고유 selector — 전역 고정 id(#toss-method) 를 쓰면 동시 인스턴스가 서로의 DOM 을 덮어씀(codex).
    const uid = 'toss-' + String(order.orderId || Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9]/g, '');
    const methodSel = '#' + uid + '-method';
    const agreementSel = '#' + uid + '-agreement';
    const methodEl = document.createElement('div');
    const agreementEl = document.createElement('div');
    methodEl.id = uid + '-method';
    agreementEl.id = uid + '-agreement';
    root.replaceChildren(methodEl, agreementEl);

    const TossPayments = await loadSdk();
    const toss = TossPayments(clientKey);
    const widgets = toss.widgets({ customerKey: TossPayments.ANONYMOUS });
    await widgets.setAmount({ currency: order.currency || 'KRW', value: order.amount });
    await Promise.all([
      widgets.renderPaymentMethods({ selector: methodSel, variantKey: 'DEFAULT' }),
      widgets.renderAgreement({ selector: agreementSel, variantKey: 'AGREEMENT' }),
    ]);
    return {
      async requestPayment({ successUrl, failUrl }) {
        await widgets.requestPayment({
          orderId: order.orderId,
          orderName: order.orderName,
          successUrl,
          failUrl,
        });
      },
      destroy() { root.replaceChildren(); },
    };
  },
};
