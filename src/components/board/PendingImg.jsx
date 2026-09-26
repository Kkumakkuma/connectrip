import { useEffect, useRef } from 'react';

// 고르기만 한(아직 안 올린) 사진 미리보기(2026-09-27 지연 업로드). 화면에 떠 있는 동안만 브라우저 메모리 주소(blob:)를
// 만들어 쓰고, 사라지거나 파일이 바뀌면 바로 해제한다 — 사진을 빼거나 창을 닫으면 메모리에도 남지 않는다.
// 주소는 상태(state)가 아니라 img 요소에 직접 넣는다(효과 안에서 상태를 바꾸지 않게, 개발 모드 이중 실행에도 안전).
const PendingImg = ({ file, alt = '', ...rest }) => {
    const ref = useRef(null);
    useEffect(() => {
        const img = ref.current;
        if (!img || !file || typeof URL === 'undefined' || !URL.createObjectURL) return undefined;
        const url = URL.createObjectURL(file);
        img.src = url;
        return () => {
            img.removeAttribute('src');
            URL.revokeObjectURL(url);
        };
    }, [file]);
    return <img ref={ref} alt={alt} {...rest} />;
};

export default PendingImg;
