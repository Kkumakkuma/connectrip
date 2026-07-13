package com.connecttrip.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Android 15+(API 35)는 edge-to-edge 강제라 콘텐츠가 상태바 뒤까지 그려져 상단이 잘린다.
    // 시스템 바 높이는 기기(갤럭시 폴드 접힘/펼침 포함)마다 인셋 값으로 정확히 내려온다.
    //
    // ⚠️이력: ①capacitor.config adjustMarginsForEdgeToEdge=auto 무효 ②WebView 에 인셋 리스너
    //   +requestApplyInsets 도 실기기(폴드7)에서 무효 — dispatch 가 WebView 까지 안 내려온다.
    // → 최상위 android.R.id.content 에 패딩을 주고, dispatch 에 의존하지 않도록
    //   attach 후 루트 인셋을 직접 읽어 초기값을 적용한다(리스너는 회전·폴드 전환 갱신용).

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 35) {
            View content = findViewById(android.R.id.content);

            // 회전·폴드 전환 등 인셋 변경 갱신용 리스너
            ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
                applyBars(v, windowInsets);
                return WindowInsetsCompat.CONSUMED;
            });

            // 초기값 — attach 후 루트 인셋을 직접 읽어 즉시 패딩 (dispatch 미도달 대비)
            content.post(() -> {
                WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(content);
                if (wi != null) applyBars(content, wi);
            });

            // 상태바 영역 배경이 흰색(웹 캔버스)이라 아이콘을 어두운 색으로
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                    .setAppearanceLightStatusBars(true);
        }
    }

    private static void applyBars(View v, WindowInsetsCompat windowInsets) {
        Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
    }
}
