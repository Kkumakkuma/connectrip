import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { ensureNickname } from './authorName';

// 글쓰기 전 닉네임 확인(2026-09-15). 사용법:
//   const { requireNickname, nicknameModal } = useNicknameGate();
//   const submit = async (e) => { e?.preventDefault?.(); ...검사...; if (!requireNickname(() => submit())) return; ...등록... };
//   <NicknameRequiredModal {...nicknameModal} />
// 닉네임이 없으면 설정 창을 열고 false. 저장이 끝나면 넘겨 둔 run 을 불러 등록을 이어 간다.
// run 은 클릭 시점의 핸들러(옛 profile 을 보는 클로저)라서, 프로필과 저장 완료 여부는 ref 로 본다 — 다시 창이 뜨지 않게.
//
// 계정에 묶기(2026-09-16 codex 검토): 저장 완료 표시·열린 창·대기 중인 등록을 모두 "그 일을 시작한 계정 id" 와 함께 둔다.
// boolean 으로 두면 같은 화면에서 계정이 바뀌었을 때(다른 탭 로그인 등) 새 계정이 설정 창을 건너뛰어 서버에 '회원' 으로 저장되거나,
// 이전 계정의 등록이 새 계정으로 실행될 수 있다.
export function useNicknameGate() {
  const { profile, user } = useAuth();
  const uid = user?.id ?? null;
  const profileRef = useRef(profile);
  const userIdRef = useRef(uid);
  const savedForRef = useRef(null);    // 닉네임을 방금 저장한 계정 id
  const pendingRef = useRef(null);     // { run, uid } — 저장 뒤 이어서 실행할 등록
  const [openFor, setOpenFor] = useState(null); // 설정 창을 연 계정 id(열려 있지 않으면 null)

  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { userIdRef.current = uid; }, [uid]);

  const requireNickname = useCallback((run) => {
    const me = userIdRef.current;
    // 로그인 전이면 닉네임 창을 띄우지 않는다 — 로그인 안내는 각 화면(isLoggedIn 확인)이 맡는다(제미나이 검토).
    if (!me) return true;
    if (savedForRef.current === me) return true;
    return ensureNickname(profileRef.current, () => {
      pendingRef.current = { run: typeof run === 'function' ? run : null, uid: me };
      setOpenFor(me ?? '');
    });
  }, []);

  const onClose = useCallback(() => {
    pendingRef.current = null;
    setOpenFor(null);
  }, []);

  const onSaved = useCallback(() => {
    const me = userIdRef.current;
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpenFor(null);
    // 창을 연 뒤 계정이 바뀌었으면 저장 완료로 치지도, 이전 계정의 등록을 실행하지도 않는다.
    if (!pending || pending.uid !== me) return;
    savedForRef.current = me;
    if (pending.run) pending.run();
  }, []);

  // 계정이 바뀌면 그 계정이 연 창이 아니므로 자동으로 닫힌 것으로 본다(effect 안에서 state 를 바꾸지 않는다).
  const open = openFor !== null && openFor === (uid ?? '');
  return { requireNickname, nicknameModal: { open, onClose, onSaved } };
}
