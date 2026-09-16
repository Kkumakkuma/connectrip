# -*- coding: utf-8 -*-
"""커넥트립 파비콘·PWA 아이콘 일괄 생성.

원본: assets/icon-only.png (1024x1024, 하트+비행기 마크, 배경은 흰색 매트 = 투명 아님).
배경을 매트 해제해 투명 알파를 만들고, 잉크를 브랜드 색 2가지(청록 하트 / 금색 비행기)로 평탄화한 뒤
크기별 PNG·ICO 를 굽는다. 같은 그림이 검색 결과 파비콘·iOS 홈 아이콘·PWA(any/maskable)·알림 아이콘에 쓰인다.

사용:
  python scripts/gen-icons.py                           # 기본 = 두 색(청록 하트+금색 비행기, 앱 아이콘·푸터 로고와 동일) → public/ 에 기록
  python scripts/gen-icons.py --variant mono            # 단색 청록(헤더 로고와 동일)
  python scripts/gen-icons.py --preview <dir>           # public 은 건드리지 않고 비교 시트만 <dir> 에 생성
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "icon-only.png")
TEAL = (25, 77, 102)    # 원본 하트 중앙값 실측
GOLD = (191, 153, 60)   # 원본 비행기 중앙값 실측

# (파일명, 크기, 마크 비율, 배경) — 배경 None = 투명
SPEC = [
    ("favicon-16.png", 16, 0.94, None),
    ("favicon-32.png", 32, 0.94, None),
    ("favicon-48.png", 48, 0.94, None),
    ("favicon-96.png", 96, 0.94, None),
    ("favicon-192.png", 192, 0.94, None),
    ("apple-touch-icon.png", 180, 0.80, (255, 255, 255)),   # iOS 는 알파 무시 + 자체 라운딩
    ("icon-192x192.png", 192, 0.88, None),                    # PWA any · 알림 아이콘 · Organization logo
    ("icon-512x512.png", 512, 0.88, None),
    ("icon-maskable-192.png", 192, 0.62, (255, 255, 255)),   # maskable 안전영역(지름 80% 원) 안에 들어가게
    ("icon-maskable-512.png", 512, 0.62, (255, 255, 255)),
]


def load_mark(variant):
    """흰 매트 원본 → 투명 RGBA 마크(정사각, 여백 제거)."""
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    bg = np.median(a[:8, :8].reshape(-1, 3), axis=0)           # 모서리 = 배경색
    is_gold = (a[:, :, 0] - a[:, :, 2]) > 4                     # 금색은 R>B, 청록은 R<B, 배경은 회색(≈0)
    ink_src = np.where(is_gold[..., None], np.array(GOLD, np.float32), np.array(TEAL, np.float32))
    cover = np.abs(a - bg).max(axis=2) / np.maximum(np.abs(ink_src - bg).max(axis=2), 1.0)
    alpha = np.clip(cover, 0.0, 1.0)
    alpha[alpha < 0.04] = 0.0                                   # 매트 잔여 노이즈 제거
    if variant == "mono":
        ink = np.broadcast_to(np.array(TEAL, np.float32), a.shape).copy()
    else:
        ink = ink_src
    rgba = np.dstack([ink, alpha * 255.0]).astype(np.uint8)
    mark = Image.fromarray(rgba)
    ys, xs = np.where(alpha > 0.02)
    if len(xs) == 0:
        raise SystemExit("원본에서 마크를 찾지 못했다(배경과 구분되는 픽셀 없음): %s" % SRC)
    mark = mark.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = max(mark.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    return sq


def render(mark, size, scale, bg):
    inner = max(1, int(round(size * scale)))
    m = mark.resize((inner, inner), Image.LANCZOS)
    if size <= 32:
        m = m.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=0))
    canvas = Image.new("RGBA", (size, size), (bg + (255,)) if bg else (0, 0, 0, 0))
    canvas.alpha_composite(m, ((size - inner) // 2, (size - inner) // 2))
    return canvas if bg is None else canvas.convert("RGB")


def build(variant):
    mark = load_mark(variant)
    out = {}
    for name, size, scale, bg in SPEC:
        out[name] = render(mark, size, scale, bg)
    return out


def write_public(images, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, im in images.items():
        im.save(os.path.join(out_dir, name), optimize=True)
    # Pillow 는 기준 이미지보다 큰 size 를 버린다 → 가장 큰 48 을 기준으로 두고 32·16 을 append.
    ico_frames = [images["favicon-48.png"], images["favicon-32.png"], images["favicon-16.png"]]
    ico_frames[0].save(os.path.join(out_dir, "favicon.ico"), format="ICO",
                       sizes=[(48, 48), (32, 32), (16, 16)], append_images=ico_frames[1:])


def preview_sheet(variants, path):
    """실제 크기 + 4배 확대, 흰 배경/구글 다크 배경, maskable 원형 크롭 시뮬레이션."""
    cols = [16, 32, 48, 96]
    cell, pad = 120, 16
    rows = len(variants)
    w = pad + (len(cols) * 2 + 2) * (cell + pad)
    h = pad + rows * (cell + pad + 28)
    sheet = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for r, (label, imgs) in enumerate(variants):
        y = pad + r * (cell + pad + 28)
        d.text((pad, y), label, fill=(0, 0, 0))
        y += 24
        x = pad
        for bgcol in [(255, 255, 255), (32, 33, 36)]:
            for s in cols:
                tile = Image.new("RGB", (cell, cell), bgcol)
                icon = imgs["favicon-%d.png" % s].convert("RGBA")
                big = icon.resize((s * 4, s * 4), Image.NEAREST) if s * 4 <= cell else icon
                tile.paste(big, ((cell - big.width) // 2, (cell - big.height) // 2), big)
                tile.paste(icon, (4, 4), icon)
                sheet.paste(tile, (x, y))
                x += cell + pad
        # apple-touch-icon(라운드) + maskable 원형 크롭
        apple = imgs["apple-touch-icon.png"].resize((cell, cell), Image.LANCZOS)
        sheet.paste(apple, (x, y))
        x += cell + pad
        mk = imgs["icon-maskable-192.png"].resize((cell, cell), Image.LANCZOS).convert("RGBA")
        mask = Image.new("L", (cell, cell), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, cell - 1, cell - 1), fill=255)
        tile = Image.new("RGB", (cell, cell), (32, 33, 36))
        tile.paste(mk, (0, 0), mask)
        sheet.paste(tile, (x, y))
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=["mono", "duo"], default="duo")  # 2026-09-16 쿠마님 선택 = 두 색
    ap.add_argument("--out", default=os.path.join(ROOT, "public"))
    ap.add_argument("--preview", help="비교 시트만 이 폴더에 생성(public 미기록)")
    args = ap.parse_args()
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        variants = []
        for v in ("mono", "duo"):
            imgs = build(v)
            write_public(imgs, os.path.join(args.preview, v))
            variants.append((v, imgs))
        preview_sheet(variants, os.path.join(args.preview, "compare.png"))
        print("preview ->", args.preview)
        return
    images = build(args.variant)
    write_public(images, args.out)
    print("wrote", len(images) + 1, "files (%s) ->" % args.variant, args.out)


if __name__ == "__main__":
    sys.exit(main())
