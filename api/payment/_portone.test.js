// 포트원 조회 오류 코드 위생 테스트 (2026-09-05 보안 감사 ⑥).
// getPayment 가 돌려주는 code 는 confirm 응답의 code 와 ct_payment_orders.last_error 로 남는다.
// 제공자가 문장형 메시지를 type 에 담아 보내면 외부 응답 원문이 그대로 사용자에게 나간다.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPayment, verifyPaid } from './_portone.js';

function stubFetch(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('getPayment 오류 코드', () => {
  it('코드형 토큰은 그대로 쓴다', async () => {
    stubFetch(400, { type: 'PAYMENT_NOT_PAID' });
    const r = await getPayment('secret', 'ct-0123456789abcdef0123');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYMENT_NOT_PAID');
  });

  it('문장형 메시지는 버리고 상태코드로 대체한다', async () => {
    const leak = '가맹점 정보가 올바르지 않습니다 (storeId=store-abcd, 담당자 010-0000-0000)';
    stubFetch(400, { type: leak, message: leak });
    const r = await getPayment('secret', 'ct-0123456789abcdef0123');
    expect(r.code).toBe('http_400');
    expect(JSON.stringify(r)).not.toContain('storeId');
    expect(JSON.stringify(r)).not.toContain('010-0000-0000');
  });

  it('type 이 없으면 상태코드로 대체한다', async () => {
    stubFetch(500, {});
    const r = await getPayment('secret', 'ct-0123456789abcdef0123');
    expect(r.code).toBe('http_500');
    expect(r.retryable).toBe(true);
  });
});

describe('verifyPaid 미결제 코드', () => {
  const order = {
    order_id: 'ct-0123456789abcdef0123', amount: 10000, env: 'test',
    channel_key: 'channel-key-1', store_id: 'store-1',
  };

  it('정상 상태값은 그대로 코드에 담는다', () => {
    const r = verifyPaid(order, { status: 'READY' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not_paid_READY');
    expect(r.kind).toBe('transient');
  });

  it('문장형 상태값은 UNKNOWN 으로 눌러 담는다', () => {
    const r = verifyPaid(order, { status: '결제 대기 중입니다 (가맹점 store-1, 담당 010-0000-0000)' });
    expect(r.code).toBe('not_paid_UNKNOWN');
    expect(JSON.stringify(r)).not.toContain('010-0000-0000');
    expect(JSON.stringify(r)).not.toContain('store-1');
  });
});
