// Vercel Serverless Function: 계정 복구 묶음 — 비밀번호 찾기 확인 + 아이디 찾기.
// 무료 플랜은 배포당 서버리스 함수 12개까지라(2026-09-05 13번째 함수로 배포 실패) 두 핸들러를 한 함수로 묶고,
// 기존 경로는 vercel.json rewrites 로 유지한다:
//   /api/reset-password-confirm → /api/account?action=reset-password
//   /api/find-login-id          → /api/account?action=find-id
// 실제 로직은 _account_*.js (밑줄 파일은 함수로 배포되지 않는다).

import resetPassword from './_account_reset_password.js';
import findLoginId from './_account_find_login_id.js';

export default async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'reset-password') return resetPassword(req, res);
  if (action === 'find-id') return findLoginId(req, res);
  return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Not found' });
}
