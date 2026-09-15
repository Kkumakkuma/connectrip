import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { ensureNickname } from './authorName';

// 글쓰기 전 닉네임 확인(2026-09-15). 사용법:
//   const { requireNickname, nicknameModal } = useNicknameGate();
//   const submit = async (e) => { e?.preventDefault?.(); ...검사...; if (!requireNickname(() => submit())) return; ...등록... };
//   <NicknameRequiredModal {...nicknameModal} />
// 닉네임이 없으면 설정 창을 열고 false. 저장이 끝나면 넘겨 둔 run 을 불러 등록을 이어 간다.
// run 은 클릭 시점의 핸들러(옛 profile 을 보는 클로저)라서, 프로필과 저장 완료 여부는 ref 로 본다 — 다시 창이 뜨지 않게.
export function useNicknameGate() {
  const { profile } = useAuth();
  const profileRef = useRef(profile);
  const savedRef = useRef(false);
  const pendingRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { profileRef.current = profile; }, [profile]);

  const requireNickname = useCallback((run) => {
    if (savedRef.current) return true;
    return ensureNickname(profileRef.current, () => {
      pendingRef.current = typeof run === 'function' ? run : null;
      setOpen(true);
    });
  }, []);

  const onClose = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  const onSaved = useCallback(() => {
    savedRef.current = true;
    const run = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    if (run) run();
  }, []);

  return { requireNickname, nicknameModal: { open, onClose, onSaved } };
}
