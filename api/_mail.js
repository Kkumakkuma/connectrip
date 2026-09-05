// Resend 발송 공용 모듈 (2026-09-05). 인증번호 메일 한 종류만 다룬다.
// 실패 응답 원문(도메인 검증 상태 등)은 서버 로그에만 남기고 호출부는 boolean 만 본다.

export async function sendCodeMail({ to, code, subject, heading, lead, ttlMinutes = 5 }) {
  const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
  const FROM = (process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev').trim();
  if (!RESEND_KEY) return { ok: false, reason: 'config' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html: `<div style="font-family:'Noto Sans KR',sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#ffffff">
  <h1 style="font-size:20px;color:#1e3a8a;margin-bottom:12px">${heading}</h1>
  <p style="color:#334155;font-size:15px;line-height:1.6">${lead}</p>
  <div style="font-size:32px;font-weight:700;color:#2563eb;letter-spacing:8px;text-align:center;background:#eff6ff;padding:20px 0;border-radius:12px;margin:24px 0">${code}</div>
  <p style="color:#64748b;font-size:13px;line-height:1.6">이 인증번호는 ${ttlMinutes}분간 유효합니다.<br>본인이 요청하지 않았다면 이 이메일을 무시하셔도 됩니다.</p>
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#94a3b8;font-size:12px">ConnectTrip — 여행자·승무원 커뮤니티</p>
</div>`,
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      console.error('[mail] Resend 발송 실패', resp.status, data);
      return { ok: false, reason: 'provider' };
    }
    return { ok: true };
  } catch (e) {
    console.error('[mail] 예외', e);
    return { ok: false, reason: 'exception' };
  }
}
