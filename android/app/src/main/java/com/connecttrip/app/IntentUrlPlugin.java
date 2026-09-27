package com.connecttrip.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 휴대폰 본인확인(포트원 → KCP → PASS) 페이지는 통신사 앱을 intent:// 또는 tauthlink:// 같은
 * 커스텀 스킴으로 호출한다. Capacitor 8 기본 Bridge.launchIntent 는 intent:// 를 Intent.parseUri 로
 * 해석하지 않아 ERR_UNKNOWN_URL_SCHEME 이 뜨므로, 여기서 먼저 가로채 네이티브로 넘긴다.
 */
@CapacitorPlugin(name = "IntentUrl")
public class IntentUrlPlugin extends Plugin {

    private static final String TAG = "IntentUrl";

    // WebView 가 직접 처리해야 하는 스킴 — 이건 건드리지 않고 Capacitor 기본 정책(null)에 맡긴다
    private static final List<String> WEBVIEW_SCHEMES = Arrays.asList(
            "http", "https", "data", "blob", "javascript", "about", "file");

    // ── 앱 밖에서 끝나는 외부 흐름(PASS 본인확인) — 2026-09-27 PASS 복귀 실패 수정 ──
    // 앱 WebView 주소는 https://localhost 라, 흐름이 PASS 앱·크롬 쪽에서 끝나면 그 주소로 돌아올 수 없었다.
    // 또 포트원 SDK 는 KCP 창으로 폼 POST 이동을 해서 WebView 에서는 가로챌 수 없다(POST 는 shouldOverrideUrlLoading 을 안 탄다).
    // ① 앱이 여는 사이트의 /app-identity(앱 전용 본인확인 화면)는 크롬 탭(Custom Tab)으로 연다 — 인증은 모바일 웹과 똑같이
    //    크롬에서 진행되고, 앱 화면은 그대로 남아 돌아오면 서버에 결과를 확인한다(IdentityVerifyStep).
    // ② 복귀 주소(사이트 다리 페이지 app-return.html, connecttrip://app-return)가 앱 WebView 안에서 열리면 앱 안 경로로 바로 연다.
    // 경로 허용 목록은 src/lib/appReturn.js · public/app-return.html 과 같아야 한다(appReturn.test.js 가 대조).
    static final Pattern RETURN_PATH = Pattern.compile("^/(find-id|forgot-password|signup(/[a-z-]+)?|mypage|points)$");
    private static final String RETURN_SCHEME = "connecttrip";
    private static final String RETURN_HOST = "app-return";
    private static final String RETURN_PAGE = "/app-return.html";
    private static final String APP_IDENTITY_PAGE = "/app-identity";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null) return null;
        String scheme = url.getScheme();
        if (scheme == null) return null;
        scheme = scheme.toLowerCase();

        if ("intent".equals(scheme)) {
            return handleIntentScheme(url);
        }

        if (RETURN_SCHEME.equals(scheme)) {
            // connecttrip://app-return/<경로>?<쿼리> 가 앱 WebView 안에서 호출됨 → 앱 안 경로로(자기 자신 실행 대신)
            String local = localReturnUrl(url);
            if (local != null) loadInWebView(local);
            return true;
        }

        if ("https".equals(scheme) || "http".equals(scheme)) {
            String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
            boolean ourSite = host.equals("www.connecttrip.co.kr") || host.equals("connecttrip.co.kr");
            if (ourSite && RETURN_PAGE.equals(url.getPath())) {
                String local = localReturnUrl(url);
                if (local != null) {
                    loadInWebView(local);
                    return true;
                }
                return null;   // 허용 밖 경로 — 기본 정책(외부 브라우저)
            }
            if (ourSite && APP_IDENTITY_PAGE.equals(url.getPath()) && openCustomTab(url)) {
                Log.i(TAG, "본인확인 창을 크롬 탭으로 엶");
                return true;
            }
            return null;
        }

        if (WEBVIEW_SCHEMES.contains(scheme)) {
            return null;
        }

        // market, tauthlink, ktauthexternalcall, upluscorporation, tel, sms 등 앱 호출 스킴
        startView(url);
        return true;
    }

    /** intent://... 처리. 어떤 경우든 true 를 돌려 WebView 가 에러 페이지를 띄우지 않게 한다. */
    private Boolean handleIntentScheme(Uri url) {
        Intent intent;
        try {
            intent = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
        } catch (URISyntaxException | RuntimeException e) {
            Log.w(TAG, "intent:// 파싱 실패: " + e.getMessage());
            return true;
        }

        // 원격 페이지가 준 Intent 이므로 브라우저(Chrome)와 같은 기준으로 정제:
        // 명시 컴포넌트·selector 제거, BROWSABLE 강제, URI 권한 부여 플래그 제거
        intent.setComponent(null);
        intent.setSelector(null);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setFlags(intent.getFlags()
                & ~Intent.FLAG_GRANT_READ_URI_PERMISSION
                & ~Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                & ~Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                & ~Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);

        // 1) 대상 앱 실행을 바로 시도 — resolveActivity 사전 조회는 패키지 가시성 때문에
        //    설치돼 있어도 "없음"으로 오판할 수 있어, 실패(ActivityNotFoundException)로 판정한다
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return true;
        try {
            activity.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            Log.i(TAG, "intent 대상 앱 미설치: " + intent.getPackage());
        } catch (SecurityException e) {
            Log.w(TAG, "intent 실행 거부: " + e.getMessage());
        }

        // 2) 미설치 — browser_fallback_url 이 있으면 Capacitor 기본 URL 정책을 그대로 태운다
        //    (http/https 만 허용: allowNavigation 호스트면 WebView 안에서, 아니면 외부 브라우저/스토어로)
        String fallback = intent.getStringExtra("browser_fallback_url");
        // 일부 PG 스크립트는 값을 이중 인코딩해 "https%3A%2F%2F..." 로 들어온다 — 그 형태일 때만 한 번 디코드
        if (fallback != null) {
            String lower = fallback.toLowerCase();
            if (lower.startsWith("http%3a") || lower.startsWith("https%3a")) {
                fallback = Uri.decode(fallback);
            }
        }
        Uri fallbackUri = fallback == null || fallback.isEmpty() ? null : Uri.parse(fallback);
        if (fallbackUri != null && isHttp(fallbackUri)) {
            if (!getBridge().launchIntent(fallbackUri)) {
                loadInWebView(fallback);
            }
            return true;
        }
        if (fallbackUri != null) {
            Log.w(TAG, "browser_fallback_url 스킴 거부(http/https 아님): " + fallbackUri.getScheme());
        }

        // 3) 그것도 없으면 패키지명으로 플레이스토어 상세로
        String pkg = intent.getPackage();
        if (pkg != null && !pkg.isEmpty()) {
            startView(Uri.parse("market://details?id=" + pkg));
        } else {
            Log.w(TAG, "intent:// 대상 앱 없음, fallback 도 없음: " + url);
        }
        return true;
    }

    /** 크롬 탭(Custom Tab)으로 연다. 탭을 지원하는 브라우저가 없으면 일반 브라우저, 그것도 없으면 false(앱 WebView 로 진행). */
    private boolean openCustomTab(Uri url) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return false;
        try {
            CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tab.launchUrl(activity, url);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "크롬 탭 열기 실패 — 앱 WebView 로 진행: " + e.getMessage());
            return false;
        }
    }

    /** 복귀 주소 → 앱 안 주소(https://localhost<경로>?<쿼리>). 허용 밖 경로면 null. src/lib/appReturn.js appReturnTarget 과 같은 규칙. */
    String localReturnUrl(Uri url) {
        String path;
        String query;
        if (RETURN_SCHEME.equalsIgnoreCase(url.getScheme())) {
            if (!RETURN_HOST.equalsIgnoreCase(url.getHost())) return null;
            path = url.getPath();
            query = url.getEncodedQuery();
        } else {
            path = url.getQueryParameter("to");
            query = stripParam(url.getEncodedQuery(), "to");
        }
        if (path == null || !RETURN_PATH.matcher(path).matches()) return null;
        String base = getBridge().getLocalUrl();
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + path + (query == null || query.isEmpty() ? "" : "?" + query);
    }

    /** 인코딩된 쿼리에서 한 이름만 뺀다(나머지 값의 인코딩은 그대로) */
    static String stripParam(String encodedQuery, String name) {
        if (encodedQuery == null) return null;
        StringBuilder sb = new StringBuilder();
        for (String part : encodedQuery.split("&")) {
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String key = eq >= 0 ? part.substring(0, eq) : part;
            if (name.equals(Uri.decode(key))) continue;
            if (sb.length() > 0) sb.append('&');
            sb.append(part);
        }
        return sb.toString();
    }

    private static boolean isHttp(Uri uri) {
        String s = uri.getScheme();
        return s != null && (s.equalsIgnoreCase("http") || s.equalsIgnoreCase("https"));
    }

    /** ACTION_VIEW 로 외부 앱 실행. 처리할 앱이 없어도 예외를 삼키고 로그만 남긴다. */
    private void startView(Uri uri) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            activity.startActivity(view);
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "ACTION_VIEW 처리 앱 없음: " + uri.getScheme() + " (" + e.getMessage() + ")");
        }
    }

    /** WebView.loadUrl 은 메인스레드에서만 안전하므로 UI 스레드로 위임 */
    private void loadInWebView(String urlToLoad) {
        WebView webView = getBridge().getWebView();
        Activity activity = getActivity();
        if (webView == null || activity == null) return;
        activity.runOnUiThread(() -> webView.loadUrl(urlToLoad));
    }
}
