// 다음(카카오) 우편번호 서비스 — 키 없이 쓰는 공개 스크립트. 도로명 주소 기준으로 우편번호(5자리)를 찾는다.
// 가입 화면(SignupEmail·SignupComplete)이 components/AddressInput 을 통해 쓴다.
const SDK_ID = 'daum-postcode-sdk';
const SDK_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
const LOAD_TIMEOUT_MS = 15000;

export const LOAD_ERROR_MESSAGE = '주소 검색 서비스를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';

let pending = null;

export function isDaumPostcodeReady() {
  return typeof window !== 'undefined' && !!(window.daum && window.daum.Postcode);
}

// 스크립트를 한 번만 받는다. 동시에 여러 번 불려도 같은 약속을 돌려준다.
export function loadDaumPostcode() {
  if (isDaumPostcodeReady()) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    let script = document.getElementById(SDK_ID);
    let timer = null;
    const done = (err) => {
      clearTimeout(timer);
      pending = null;
      if (err) {
        // 실패한 태그는 지워서 다음 클릭에 새로 받게 한다(이미 load/error 가 지나간 태그에 리스너를 다시 달면 영영 안 온다).
        if (script && script.parentNode) script.parentNode.removeChild(script);
        reject(err);
        return;
      }
      resolve();
    };
    const onLoad = () => (isDaumPostcodeReady() ? done() : done(new Error(LOAD_ERROR_MESSAGE)));
    const onError = () => done(new Error(LOAD_ERROR_MESSAGE));
    if (!script) {
      script = document.createElement('script');
      script.id = SDK_ID;
      script.src = SDK_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => done(new Error(LOAD_ERROR_MESSAGE)), LOAD_TIMEOUT_MS);
  });
  return pending;
}

// 검색 결과를 우리 폼 값으로 바꾼다. 도로명·지번·건물명 어느 쪽으로 찾았든 확정 도로명 주소(roadAddress)가 있으면 그것을 넣는다.
// autoRoadAddress 는 쓰지 않는다 — 지번 하나에 도로명이 여러 개인 필지에서 '선택 안함'을 누르면 카카오가 임의의 첫 번째 도로명을 넣어
// 주는 값이라, 사용자가 고르지 않은 도로명이 저장된다(codex 지적, 2026-09-14). 그 경우엔 사용자가 실제 고른 지번 주소를 넣는다.
// 다음 가이드의 참고항목 규칙: 법정동(동/로/가 로 끝나는 이름, 법정리는 제외)과 공동주택 건물명을 괄호로 덧붙인다.
export function formatDaumAddress(data) {
  const d = data || {};
  const zipcode = String(d.zonecode || '').trim();
  const road = String(d.roadAddress || '').trim();
  const jibun = String(d.jibunAddress || d.autoJibunAddress || '').trim();
  let address = road || jibun;
  if (road) {
    const extras = [];
    const bname = String(d.bname || '').trim();
    const building = String(d.buildingName || '').trim();
    if (bname && /[동로가]$/.test(bname)) extras.push(bname);
    if (building && d.apartment === 'Y') extras.push(building);
    if (extras.length) address += ' (' + extras.join(', ') + ')';
  }
  return { zipcode, road: address, isRoad: !!road };
}
