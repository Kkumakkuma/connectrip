import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import SEOHead from '../components/SEOHead';
import SentenceLines from '../components/SentenceLines';
import { SITE_ORIGIN } from '../lib/api';
import { APP_RETURN_PAGE } from '../lib/appReturn';
import { isNativeApp } from '../lib/native';
import {
    appBridgeUrl, findAppIdResult, identityNav, launchIdentityForApp, parseAppIdentityParams, prepareAppIdentity,
} from '../lib/identity';

// 앱 전용 본인확인 창(2026-09-27 PASS 복귀 실패 수정). 앱이 크롬 탭으로 이 화면을 연다(IntentUrlPlugin).
// 여기서 웹과 똑같이 포트원 PASS 창을 열고, 끝나면 다리 페이지(app-return.html) → 앱으로 돌아간다.
// 결속(2026-10-02, 설계 v2 §3.3): 이 화면이 비밀값 ds 를 만들어 서버에 등록하고 서버가 발급한 id 로만 PASS 를 연다.
// 주소로 들어온 id 는 쓰지 않는다(남이 만든 링크로 피해자의 PASS 결과를 가로채지 못하게). ds 는 크롬 저장소에만 두고,
// 다리 페이지가 앱으로 넘기는 intent 를 만들 때만 붙인다 — 그래서 앱으로 돌아가는 단추는 모두 다리 주소(appBridgeUrl)다.
// 창이 안 열리거나(12초) 인증 창에서 뒤로 돌아오면(bfcache 복원) '앱으로 돌아가기' 단추를 보인다 — 크롬 탭은
// 페이지가 스스로 닫을 수 없어서, 단추가 없으면 대기 표시만 남는다(교차검토 지적).
// GA 는 이 화면에서 불러오지 않는다(analytics.js 가 /app-identity 를 제외한다).
const STALE_MS = 12000;
const HOME = `${SITE_ORIGIN}/`;
const BAD_REQUEST = '본인확인 요청이 올바르지 않습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.';
// 크롬 탭을 열지 못해 앱 WebView 안으로 떨어진 경우(IntentUrlPlugin openCustomTab 실패) — 여기서 PASS 를 하면 9/27 실패가 되풀이된다
const IN_APP = '브라우저를 열 수 없어 본인확인을 진행할 수 없어요. 크롬을 켜 두거나 기본 브라우저를 확인한 뒤 다시 시도해 주세요.';
// 1.3.4 이하 앱(옛 계약: 앱이 id 를 만들어 넘김) — 결속 뒤 서버가 받지 않으므로 등록·PASS 없이 업데이트를 안내한다.
// 같은 문구를 다리 주소 message 로 넘기면 옛 앱이 실패 복귀로 받아 진행 기록을 정리하고 이 문구를 띄운다.
const UPDATE_REQUIRED = '이 앱 버전에서는 본인확인을 진행할 수 없어요. 커넥트립 앱을 최신 버전으로 업데이트해 주세요. 업데이트 전에는 커넥트립 웹사이트에서 진행할 수 있어요.';
const NOT_FOUND = '인증 결과를 찾지 못했어요. 커넥트립 앱으로 돌아가 본인확인을 다시 진행해 주세요.';
const START_FAILED = '본인확인을 시작하지 못했습니다. 커넥트립 앱으로 돌아가 다시 시도해 주세요.';
const NOT_MINE = '커넥트립 앱에서 직접 시작한 본인확인이 아니라면 이 창을 닫아 주세요.';

// 아이폰·아이패드(데스크톱 모드 아이패드 = 맥 UA + 터치 지점 여러 개) — 커넥트립 앱이 없다.
// 안드로이드 UA 를 요구하지는 않는다: 안드로이드 태블릿 크롬의 데스크톱 모드는 UA 에서 Android 가 빠진다(flows9·completeness8).
const isAppleTouch = () => {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
};

function Screen({ title, children, action }) {
    return (
        <>
            <h1 className="mt-4 text-lg font-bold text-ink">{title}</h1>
            {children}
            {action}
        </>
    );
}

const Text = ({ text, alert = false }) => (
    <p className="mt-2 text-sm leading-relaxed text-muted" role={alert ? 'alert' : undefined}><SentenceLines text={text} /></p>
);
const BackToApp = ({ href }) => (
    <a href={href} className="btn-air-primary btn-air-lg mt-6 w-full">커넥트립 앱으로 돌아가기</a>
);
const SiteLink = () => (
    <p className="mt-4 text-sm"><a href={HOME} className="text-muted underline">커넥트립 웹사이트로 가기</a></p>
);

export default function AppIdentity() {
    const location = useLocation();
    const params = useMemo(() => parseAppIdentityParams(location.search), [location.search]);
    // 모드 — 설계 v2 §3.3 표. 앱 WebView 안·iOS 는 주소와 상관없이 등록·PASS 를 하지 않는다.
    const mode = useMemo(() => {
        if (isNativeApp()) return 'inApp';
        if (isAppleTouch()) return 'ios';
        if (!params) return 'bad';
        if (params.legacy) return 'legacy';
        if (params.resume) return 'resume';
        return 'start';
    }, [params]);
    // 결과 가져오기: 이 시도(state·용도)의 크롬 보관분 중 1시간 안 최신 것
    const resumeHit = useMemo(
        () => (mode === 'resume' ? findAppIdResult(params.state, params.purpose) : null),
        [mode, params],
    );
    const [ticketId, setTicketId] = useState('');   // 이번에 PASS 를 띄운 id(서버 발급) — 앱으로 돌아가는 단추에 싣는다
    const [failure, setFailure] = useState(null);   // { kind: 'start' | 'launch', code, message }
    const [stale, setStale] = useState(false);
    const started = useRef(false);

    // 결과 가져오기: 찾았으면 다리로 보낸다 — resume=1 없이 일반 성공 복귀로(다리가 ds 를 붙이고 앱이 attach → confirm 을
    // 한 번 한다, codex v2 #1). PASS·SDK 는 부르지 않는다. 기록이 남지 않게 replace.
    useEffect(() => {
        if (mode !== 'resume' || !resumeHit || started.current) return;
        started.current = true;
        identityNav.replace(appBridgeUrl({ to: params.to, q: params.q, state: params.state, id: resumeHit.id }));
    }, [mode, resumeHit, params]);

    // 기본: 등록(30분 안 같은 시도면 크롬 보관분 재사용) → PASS 창 자동 시작.
    // 자동 시작은 유지한다 — 결속 뒤에는 공식 도메인 링크로 띄워도 빼앗을 결과가 없다(redteam4, 설계 v2 §6 권고).
    useEffect(() => {
        if (mode !== 'start' || started.current) return;
        started.current = true;
        (async () => {
            let ticket;
            try {
                ticket = await prepareAppIdentity({ state: params.state, purpose: params.purpose });
            } catch (err) {
                // 등록 실패(429·503·네트워크)·저장소 실패 — 앱으로 사유(code)를 보내 진행 기록을 끝낸다
                setFailure({ kind: 'start', code: err?.code || 'IDENTITY_START_FAILED', message: err?.message || START_FAILED });
                return;
            }
            setTicketId(ticket.id);
            try {
                await launchIdentityForApp({ id: ticket.id, state: params.state, to: params.to, q: params.q });
            } catch {
                // SDK 시작 오류 — 새로 고침으로 다시 쓴 id 가 이미 끝났을 때 등(agy v2 P1). 이미 인증을 마쳤을 수 있으므로
                // 사유 없이 이 id 로 돌려보낸다(다리가 ds 를 붙여 앱이 확인한다). 포트원은 끝나지 않은 id 의 재요청은 받는다.
                setFailure({ kind: 'launch' });
            }
        })();
    }, [mode, params]);

    useEffect(() => {
        if (mode !== 'start') return undefined;
        const timer = setTimeout(() => setStale(true), STALE_MS);
        const onShow = (e) => { if (e.persisted) setStale(true); };
        window.addEventListener('pageshow', onShow);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pageshow', onShow);
        };
    }, [mode]);

    // 앱으로 돌아가는 다리 주소(이 시도의 state + 상황별 id 또는 사유)
    const bridge = (extra) => appBridgeUrl({ to: params.to, q: params.q, state: params.state, ...extra });

    let body;
    if (mode === 'inApp') {
        body = (
            <Screen title="본인확인을 진행할 수 없어요"
                action={(
                    <button type="button" onClick={() => window.history.back()} className="btn-air-primary btn-air-lg mt-6 w-full">
                        이전 화면으로 돌아가기
                    </button>
                )}>
                <Text text={IN_APP} alert />
            </Screen>
        );
    } else if (mode === 'ios') {
        body = (
            <Screen title="커넥트립 안드로이드 앱 전용 화면이에요" action={<SiteLink />}>
                <Text text="아이폰·아이패드에서는 커넥트립 웹사이트에서 본인확인을 진행해 주세요." />
            </Screen>
        );
    } else if (mode === 'bad') {
        body = (
            <Screen title="본인확인을 시작하지 못했어요" action={<BackToApp href={`${SITE_ORIGIN}${APP_RETURN_PAGE}`} />}>
                <Text text={BAD_REQUEST} alert />
            </Screen>
        );
    } else if (mode === 'legacy') {
        body = (
            <Screen title="앱 업데이트가 필요해요"
                action={(
                    <>
                        <BackToApp href={bridge({ code: 'APP_UPDATE_REQUIRED', message: UPDATE_REQUIRED })} />
                        <SiteLink />
                    </>
                )}>
                <Text text={UPDATE_REQUIRED} alert />
            </Screen>
        );
    } else if (mode === 'resume') {
        body = resumeHit ? (
            <Screen title="커넥트립 앱으로 돌아가는 중이에요" action={<BackToApp href={bridge({ id: resumeHit.id })} />}>
                <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 잠시만 기다려 주세요
                </p>
            </Screen>
        ) : (
            <Screen title="인증 결과를 찾지 못했어요"
                action={<BackToApp href={bridge({ code: 'IDENTITY_RESULT_NOT_FOUND', message: NOT_FOUND })} />}>
                <Text text={NOT_FOUND} alert />
            </Screen>
        );
    } else if (failure?.kind === 'start') {
        body = (
            <Screen title="본인확인을 시작하지 못했어요"
                action={<BackToApp href={bridge({ code: failure.code, message: failure.message })} />}>
                <Text text={failure.message} alert />
            </Screen>
        );
    } else if (failure?.kind === 'launch') {
        body = (
            <Screen title="본인확인 창을 열지 못했어요" action={<BackToApp href={bridge({ id: ticketId })} />}>
                <Text text="이미 인증을 마쳤다면 앱으로 돌아가 결과를 확인해 주세요. 아직 인증 전이라면 앱에서 본인확인을 다시 시작해 주세요." alert />
            </Screen>
        );
    } else if (stale) {
        // 다리가 이 id 의 ds 를 붙여 앱이 결과를 확인한다(C6). 등록 전이면 id 없이 — 앱이 다시 시작을 안내한다.
        body = (
            <Screen title="본인확인 창이 보이지 않나요?" action={<BackToApp href={bridge({ id: ticketId })} />}>
                <Text text="창이 열리지 않았거나 인증 창에서 돌아왔다면 아래 단추를 눌러 커넥트립 앱으로 돌아가 주세요. 인증을 이미 마쳤다면 앱이 결과를 확인해요." />
            </Screen>
        );
    } else {
        body = (
            <Screen title="본인확인 창을 여는 중이에요">
                <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 잠시만 기다려 주세요
                </p>
                <p className="mt-4 text-xs leading-relaxed text-muted"><SentenceLines text={NOT_MINE} /></p>
            </Screen>
        );
    }

    return (
        <div className="mx-auto max-w-md px-5 py-16 text-center">
            <SEOHead title="본인확인 | 커넥트립" path="/app-identity" robots="noindex, nofollow" />
            <ShieldCheck size={40} className="mx-auto text-rausch" aria-hidden="true" />
            {body}
        </div>
    );
}
