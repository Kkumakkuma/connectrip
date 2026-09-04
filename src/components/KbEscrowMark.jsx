import { useRef } from 'react';

// KB국민은행 에스크로(구매안전) 이체 인증마크.
//
// 구매안전 서비스 이용확인증을 발급받으려면 이 마크가 사이트의 초기화면과 결제화면
// 구간에 노출돼 있어야 한다(KB 안내). 마크를 누르면 KB 창이 열려 가맹점 정보를 보여준다.
//
// 원본 스니펫은 document.KB_AUTHMARK_FORM 전역 접근 + inline onclick 이라 React 에서
// 그대로 쓸 수 없어 ref 로 옮겼다. 동작(창 이름·크기·GET 파라미터)은 원본과 같다.
// 이미지 주소만 http → https 로 바꿨다. 사이트가 https 라 http 이미지는 브라우저가
// 혼합 콘텐츠로 차단한다(실측: https 로도 200 응답).
const KB_POPUP_FEATURES = 'height=604, width=648, status=yes, toolbar=no, menubar=no, location=no';

const KbEscrowMark = ({ className = '' }) => {
    const formRef = useRef(null);

    const openAuthMark = (e) => {
        e.preventDefault();
        // 창을 먼저 띄우고(사용자 클릭 컨텍스트라 팝업 차단에 걸리지 않는다) 그 창을 target 으로 폼을 보낸다.
        window.open('', 'KB_AUTHMARK', KB_POPUP_FEATURES);
        formRef.current?.submit();
    };

    return (
        <span className={className}>
            <form
                ref={formRef}
                name="KB_AUTHMARK_FORM"
                method="get"
                action="https://okbfex.kbstar.com/quics"
                target="KB_AUTHMARK"
                style={{ display: 'none' }}
            >
                <input type="hidden" name="page" value="C021590" />
                <input type="hidden" name="cc" value="b034066:b035526" />
                <input type="hidden" name="mHValue" value="baaff24064b6f2a62fbd86cb2cbb4497" />
            </form>
            <a
                href="https://okbfex.kbstar.com/quics?page=C021590"
                onClick={openAuthMark}
                title="KB국민은행 에스크로 이체 인증마크 확인"
                style={{ display: 'inline-block', lineHeight: 0 }}
            >
                <img
                    src="https://img1.kbstar.com/img/escrow/escrowcmark.gif"
                    alt="KB국민은행 에스크로 이체 인증마크"
                    width="80"
                    height="41"
                    style={{ border: 0 }}
                />
            </a>
        </span>
    );
};

export default KbEscrowMark;
