import { useState } from 'react';
import { Share2, Link, MessageCircle, X as XIcon, Check } from 'lucide-react';

// 카카오 SDK(85.5kB)를 index.html 에서 빼고 여기서 필요할 때만 받는다. 실사용처는 이 컴포넌트뿐이고
// ShareButtons 는 lazy 라우트에만 들어가므로, 전 페이지 초기 로딩에서 이 요청이 통째로 빠진다.
// 로더 패턴은 src/lib/payments/toss.js 의 loadSdk() 와 동일 — 모듈 스코프 프라미스 캐시로 중복 삽입 방지.
const KAKAO_SRC = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
let kakaoPromise = null;

function loadKakaoSdk() {
  if (kakaoPromise) return kakaoPromise;
  kakaoPromise = new Promise((resolve, reject) => {
    if (window.Kakao) { resolve(window.Kakao); return; }
    const s = document.createElement('script');
    s.src = KAKAO_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => { window.Kakao ? resolve(window.Kakao) : (kakaoPromise = null, reject(new Error('Kakao 없음'))); };
    s.onerror = () => { kakaoPromise = null; reject(new Error('카카오 SDK 로드 실패')); };
    document.head.appendChild(s);
  });
  return kakaoPromise;
}

const ShareButtons = ({ title, description, url }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const shareUrl = url || window.location.href;
  const shareTitle = title || 'ConnectTrip';
  const shareDesc = description || '여행자부터 승무원까지 모두를 연결하는 여행 플랫폼';

  // 메뉴를 열 때 SDK 를 미리 당긴다. 카카오 버튼은 메뉴가 열린 뒤에만 보이므로 사용자가 메뉴를 읽는 동안
  // 로드가 끝난다. 클릭 핸들러 안에서 await 로 기다리면 네트워크 대기 뒤에 window.open 이 호출돼
  // 사파리에서 user activation 이 풀리고 팝업이 차단된다 — 그래서 프리페치 + 동기 호출 조합을 쓴다.
  const openMenu = () => {
    setShowMenu(true);
    loadKakaoSdk().catch(() => {});
  };

  // 동기 유지 필수. sendDefault 가 클릭과 같은 태스크에서 호출돼야 팝업이 뜬다.
  const handleKakaoShare = () => {
    if (window.Kakao) {
      if (!window.Kakao.isInitialized()) {
        window.Kakao.init(import.meta.env.VITE_KAKAO_JS_KEY || 'YOUR_KAKAO_JS_KEY');
      }
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: shareTitle,
          description: shareDesc,
          imageUrl: 'https://www.connecttrip.co.kr/icon-512x512.png',
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [
          { title: '자세히 보기', link: { mobileWebUrl: shareUrl, webUrl: shareUrl } },
        ],
      });
    } else {
      alert('카카오톡 공유 기능을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    }
    setShowMenu(false);
  };

  const handleTwitterShare = () => {
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer,width=600,height=400');
    setShowMenu(false);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setShowMenu(false);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareDesc, url: shareUrl });
      } catch {
        // 사용자가 공유를 취소한 경우 — 무시
      }
    } else {
      openMenu();
    }
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={navigator.share ? handleNativeShare : () => (showMenu ? setShowMenu(false) : openMenu())}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all whitespace-nowrap"
        title="공유하기"
      >
        <Share2 size={16} className="flex-shrink-0" />
        <span>공유</span>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 bottom-full mb-2 z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-2 w-48 animate-in fade-in slide-in-from-bottom-2">
            <button
              onClick={handleKakaoShare}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-yellow-50 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-yellow-400 rounded-lg flex items-center justify-center">
                <MessageCircle size={16} className="text-yellow-900" />
              </div>
              <span className="text-sm font-medium text-gray-700">카카오톡</span>
            </button>

            <button
              onClick={handleTwitterShare}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <XIcon size={14} className="text-white" />
              </div>
              <span className="text-sm font-medium text-gray-700">X (Twitter)</span>
            </button>

            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                {copied ? <Check size={16} className="text-green-600" /> : <Link size={16} className="text-blue-600" />}
              </div>
              <span className="text-sm font-medium text-gray-700">
                {copied ? '복사됨!' : 'URL 복사'}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ShareButtons;
