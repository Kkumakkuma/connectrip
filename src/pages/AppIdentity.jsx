import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import SEOHead from '../components/SEOHead';
import { SITE_ORIGIN } from '../lib/api';
import { APP_RETURN_PAGE, externalReturnUrl } from '../lib/appReturn';
import { launchIdentityForApp, parseAppIdentityParams } from '../lib/identity';

// 앱 전용 본인확인 창(2026-09-27 PASS 복귀 실패 수정). 앱이 크롬 탭으로 이 화면을 연다(IntentUrlPlugin).
// 여기서 웹과 똑같이 포트원 PASS 창을 열고, 끝나면 다리 페이지(app-return.html) → 앱으로 돌아간다.
// 본인확인 id·state 는 앱이 만들어 넘긴다(앱이 돌아와서 그 id 로 서버에 결과를 확인한다).
// 창이 안 열리거나(12초) 인증 창에서 뒤로 돌아오면(bfcache 복원) '앱으로 돌아가기' 단추를 보인다 — 크롬 탭은
// 페이지가 스스로 닫을 수 없어서, 단추가 없으면 대기 표시만 남는다(교차검토 지적).
const BAD_REQUEST = '본인확인 요청이 올바르지 않습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.';
const STALE_MS = 12000;

export default function AppIdentity() {
    const location = useLocation();
    const params = useMemo(() => parseAppIdentityParams(location.search), [location.search]);
    const [error, setError] = useState('');
    const [stale, setStale] = useState(false);
    const started = useRef(false);

    useEffect(() => {
        if (!params || started.current) return;
        started.current = true;
        launchIdentityForApp(params).catch((err) => {
            setError(err?.message || '본인확인 창을 열지 못했습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.');
        });
    }, [params]);

    useEffect(() => {
        if (!params) return undefined;
        const timer = setTimeout(() => setStale(true), STALE_MS);
        const onShow = (e) => { if (e.persisted) setStale(true); };
        window.addEventListener('pageshow', onShow);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pageshow', onShow);
        };
    }, [params]);

    // 앱으로 돌아가는 주소 — 다리 페이지가 앱을 연다. 결과는 앱이 돌아와서 직접 확인한다(IdentityVerifyStep).
    const backHref = params
        ? externalReturnUrl(params.to, params.q, { native: true })
        : `${SITE_ORIGIN}${APP_RETURN_PAGE}`;
    const shown = params ? error : BAD_REQUEST;
    return (
        <div className="mx-auto max-w-md px-5 py-16 text-center">
            <SEOHead title="본인확인 | 커넥트립" path="/app-identity" robots="noindex, nofollow" />
            <ShieldCheck size={40} className="mx-auto text-rausch" aria-hidden="true" />
            {shown ? (
                <>
                    <h1 className="mt-4 text-lg font-bold text-ink">본인확인을 시작하지 못했어요</h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted" role="alert">{shown}</p>
                </>
            ) : stale ? (
                <>
                    <h1 className="mt-4 text-lg font-bold text-ink">본인확인 창이 보이지 않나요?</h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        창이 열리지 않았거나 인증 창에서 돌아왔다면 커넥트립 앱으로 돌아가 본인확인을 다시 시작해 주세요.
                        인증을 이미 마쳤다면 앱에서 결과를 자동으로 확인해요.
                    </p>
                </>
            ) : (
                <>
                    <h1 className="mt-4 text-lg font-bold text-ink">본인확인 창을 여는 중이에요</h1>
                    <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 잠시만 기다려 주세요
                    </p>
                </>
            )}
            {(shown || stale) && (
                <a href={backHref} className="btn-air-primary btn-air-lg mt-6 w-full">커넥트립 앱으로 돌아가기</a>
            )}
        </div>
    );
}
