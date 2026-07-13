// 안드로이드 앱(Capacitor) 전용 헬퍼 — 웹에서는 false.
// @capacitor/core 는 경량이라 정적 import(isNativePlatform 판별용).
import { Capacitor } from '@capacitor/core';

export const isNativeApp = () => Capacitor.isNativePlatform();
