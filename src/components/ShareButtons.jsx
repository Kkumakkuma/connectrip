import { useState } from 'react';
import { Share2, Link, MessageCircle, X as XIcon, Check } from 'lucide-react';

const ShareButtons = ({ title, description, url }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const shareUrl = url || window.location.href;
  const shareTitle = title || 'ConnecTrip';
  const shareDesc = description || '여행자와 승무원을 연결하는 여행 플랫폼';

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
          imageUrl: 'https://connectrip.com/icon-512x512.png',
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
    window.open(twitterUrl, '_blank', 'width=600,height=400');
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
      } catch {}
    } else {
      setShowMenu(true);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={navigator.share ? handleNativeShare : () => setShowMenu(!showMenu)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
        title="공유하기"
      >
        <Share2 size={16} />
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
