// 텍스트 파일(.ics·.json)을 사용자에게 건넨다.
//   웹  Blob + a[download] 로 내려받는다.
//   앱  안드로이드 WebView 는 Blob 다운로드를 받지 못한다(아무 일도 안 일어난다).
//       @capacitor/filesystem 으로 앱 캐시 폴더에 쓰고 @capacitor/share 로 공유 창을 연다 —
//       사용자가 삼성 캘린더·구글 캘린더·파일 앱 등 받을 앱을 고른다.
//       공유 플러그인은 AndroidManifest 의 FileProvider(${applicationId}.fileprovider, cache-path ".")로
//       content:// 주소를 만들어 넘긴다. MIME 은 파일 확장자로 정해진다(.ics → text/calendar).
//
// 반환: 'downloaded' | 'shared' | 'cancelled'. 실패는 예외로 던진다.
import { isNativeApp } from '../../lib/native';

function downloadInBrowser(fileName, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 해제하면 사파리에서 저장이 취소되는 사례가 있어 한 틱 뒤에 푼다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 사용자가 공유 창을 그냥 닫은 경우. 플러그인이 "Share canceled" 로 reject 한다.
function isCancel(err) {
  return /cancel/i.test(String(err?.message || err || ''));
}

async function shareInApp(fileName, text, dialogTitle) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const written = await Filesystem.writeFile({
    path: `exports/${fileName}`,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  try {
    await Share.share({ files: [written.uri], dialogTitle });
  } catch (err) {
    if (isCancel(err)) return 'cancelled';
    throw err;
  }
  return 'shared';
}

export async function saveTextFile({ fileName, text, mime = 'text/plain', dialogTitle = '파일 보내기' }) {
  if (isNativeApp()) return shareInApp(fileName, text, dialogTitle);
  downloadInBrowser(fileName, text, mime);
  return 'downloaded';
}
