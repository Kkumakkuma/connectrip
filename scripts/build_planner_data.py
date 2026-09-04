# -*- coding: utf-8 -*-
"""여행 플래너 정적 데이터 생성기 (오프라인 전용).

만드는 것
  public/planner-data/destinations.json        목적지 목록(좌표는 Nominatim 실측)
  public/planner-data/attractions/<id>.json     도시별 추천 명소 10~12개

왜 미리 만들어 두나 (2026-09-04 실측)
  런타임에 Overpass 를 부르는 안을 먼저 만들었다가 측정하고 버렸다.
    · 도쿄 10km 조회 10,196ms / 강릉 16,851ms  → Vercel 함수 기본 제한 10초를 넘는다.
    · 도쿄는 `out center 250` 상한에 정확히 250개로 걸려 잘렸다 — 상위 명소가 잘린 쪽에 있을 수 있다.
    · name:ko 가 250개 중 32개(12.8%)뿐이라 화면에 일본어가 뜬다.
  셋 다 "미리 만들어 두면" 사라지는 문제다. 여기서는 시간이 넉넉하고, 이름은 Wikidata
  한국어 라벨로 채우고, 결과는 사람이 한 번 훑어보고 커밋한다.

실행
  python scripts/build_planner_data.py            # 전부
  python scripts/build_planner_data.py --only tokyo,osaka
  python scripts/build_planner_data.py --geocode-only
  python scripts/build_planner_data.py --dry-run  # 파일을 쓰지 않는다

외부 서비스 예의
  · Nominatim  요청 간 1.2초 (정책상 1req/s)
  · Overpass   요청 간 3초, 실패 시 1회 재시도
  · Wikidata   50개씩 묶어서, 요청 간 1초
  운영 중에는 절대 실행되지 않는다. 내가 손으로 돌리는 도구다.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from math import asin, cos, radians, sin, sqrt

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SEED = os.path.join(HERE, "planner_destinations_seed.json")
OUT_DIR = os.path.join(ROOT, "public", "planner-data")
ATTR_DIR = os.path.join(OUT_DIR, "attractions")

GENERATOR = "build_planner_data.py/1"
QUERY_VERSION = "v1"          # Overpass 태그 집합을 바꾸면 올린다
UA = "ConnectTrip-Planner/1.0 (+https://www.connecttrip.co.kr; 200kgBrothers@gmail.com)"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
# 본 서버가 자주 504 를 뱉는다(2026-09-04 실측). 미러를 돌아가며 쓴다 — 한 곳에 몰리지 않게
# 하는 게 정책상으로도 맞다.
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
WIKIDATA = "https://www.wikidata.org/w/api.php"

TARGET = 12          # 도시당 목표 개수
MIN_KEEP = 6         # 이보다 적으면 화면에 추천 블록을 띄우지 않는다(파일은 남긴다)

# 목적지로 인정하는 Nominatim 결과. "도쿄"로 검색하면 도쿄역(railway/station)이 1등으로
# 나오므로(2026-09-04 실측) 카테고리를 반드시 걸러야 한다.
PLACE_TYPES = {
    "city", "town", "village", "municipality", "borough", "island",
    "region", "state", "county", "province", "city_district", "suburb",
}


# ---------------------------------------------------------------------------
# 공통
# ---------------------------------------------------------------------------
def get(url, *, timeout=30, data=None):
    req = urllib.request.Request(
        url,
        data=data.encode("utf-8") if isinstance(data, str) else data,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        ctype = resp.headers.get("Content-Type", "")
    if "json" not in ctype:
        raise RuntimeError(f"JSON 이 아닌 응답: {ctype} / {raw[:120]!r}")
    return json.loads(raw.decode("utf-8", "replace"))


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    dlat, dlng = radians(b_lat - a_lat), radians(b_lng - a_lng)
    h = sin(dlat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(h))


def norm_name(s):
    """비교용 정규화. 악센트·공백·구두점을 걷어낸다(São Paulo == sao paulo)."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[\s\-·'’\"（）()\[\],.]+", "", s).lower()


def write_json_atomic(path, obj, dry_run=False):
    """임시 파일에 쓰고 바꿔치기한다. 도중에 죽어도 기존 파일이 깨지지 않는다."""
    if dry_run:
        print(f"    (dry-run) {os.path.relpath(path, ROOT)} 안 씀")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# 1단계 — 목적지 좌표
# ---------------------------------------------------------------------------
def geocode(seed_row):
    """Nominatim 으로 도시 좌표를 얻는다. 못 찾으면 None."""
    for q in (seed_row["q"], seed_row.get("en"), seed_row.get("ko")):
        if not q:
            continue
        url = (
            f"{NOMINATIM}?format=jsonv2&limit=10&addressdetails=1&accept-language=ko"
            f"&q={urllib.parse.quote(q)}"
        )
        try:
            rows = get(url, timeout=25)
        except Exception as e:
            print(f"    ! Nominatim 실패({q}): {e}")
            time.sleep(1.2)
            continue
        time.sleep(1.2)
        for r in rows:
            cat, typ = r.get("category"), r.get("type")
            ok = (cat == "place" and typ in PLACE_TYPES) or (cat == "boundary" and typ == "administrative")
            if not ok:
                continue
            cc = ((r.get("address") or {}).get("country_code") or "").upper()
            # 씨앗의 국가코드와 다르면 동명이지(同名異地)다. "Macau" 는 프랑스·브라질에도 있고
            # "도쿄"는 두바이의 섬으로도 잡힌다(2026-09-04 실측). 이 대조가 그걸 막는다.
            # 다만 Nominatim 의 country_code 는 정치적 소속을 따른다 — 홍콩·마카오는 cn,
            # 괌·사이판은 us 로 온다. 그래서 대조용 코드를 cc_geo 로 따로 받는다.
            want = (seed_row.get("cc_geo") or seed_row.get("cc") or "").upper()
            if cc and want and cc != want:
                continue
            return {"lat": round(float(r["lat"]), 5), "lng": round(float(r["lon"]), 5), "matched": q}
    return None


def build_destinations(seed, only=None, dry_run=False, prev=None):
    prev_by_id = {d["id"]: d for d in (prev or [])}
    out, failed = [], []
    for row in seed:
        if only and row["id"] not in only:
            # 이번에 다시 찾지 않는 도시는 기존 값을 그대로 둔다.
            if row["id"] in prev_by_id:
                out.append(prev_by_id[row["id"]])
            continue
        hit = geocode(row)
        if not hit:
            # 좌표를 못 찾았다고 기존에 잘 있던 값을 지우지 않는다.
            if row["id"] in prev_by_id:
                print(f"  ~ {row['ko']}: 조회 실패 — 기존 좌표 유지")
                out.append(prev_by_id[row["id"]])
            else:
                failed.append(row["id"])
                print(f"  X {row['ko']}({row['id']}): 좌표를 못 찾음 — 씨앗의 q 를 고쳐야 함")
            continue
        out.append({
            "id": row["id"], "ko": row["ko"], "en": row["en"],
            "alias": row.get("alias") or [],
            "lat": hit["lat"], "lng": hit["lng"],
            "cc": row["cc"], "country": row["country"], "cur": row["cur"],
            "r": row.get("r", 12),
            # 추천 명소를 준비한 도시인지. 화면이 미리 안내할 때 쓴다.
            **({"major": True} if row.get("major") else {}),
        })
        print(f"  o {row['ko']:<12} {hit['lat']:>9.4f},{hit['lng']:>10.4f}  ({hit['matched']})")
    return out, failed


# ---------------------------------------------------------------------------
# 2단계 — Overpass 후보 수집
# ---------------------------------------------------------------------------
# 카테고리별 가중치. sitelinks 만으로 줄 세우면 오래된 유적이 몰표를 받는다.
CATEGORY = [
    # (키, 값 정규식, 분류, 가중, wikidata 필수 여부)
    ("tourism", r"^(attraction|museum|viewpoint|theme_park|zoo|aquarium|gallery|artwork)$", "sight", 1.00, False),
    ("historic", r"^(castle|monument|memorial|ruins|palace|city_gate|temple|archaeological_site)$", "historic", 0.95, False),
    ("man_made", r"^(tower|lighthouse)$", "sight", 1.00, True),
    ("leisure", r"^(park|garden)$", "park", 0.85, True),
    ("natural", r"^(beach|peak)$", "nature", 0.90, True),
    ("amenity", r"^(place_of_worship)$", "worship", 0.80, True),
    ("place", r"^(suburb|quarter|neighbourhood)$", "district", 0.80, True),
    ("shop", r"^(department_store|mall)$", "shopping", 0.90, True),
]
# 한 종류가 화면을 다 먹지 않게 하는 상한
CAT_CAP = {"worship": 3, "historic": 5, "district": 2, "park": 2, "shopping": 2, "nature": 2}


def overpass_query(lat, lng, radius_m, require_wd=True):
    """분류를 두 무리로 나눠 각각 상한을 준다.

    한 union 에 몰아넣고 전체 상한을 걸면 개수가 많은 쪽이 자리를 다 먹는다.
    실측(2026-09-04, 도쿄 15km): 볼거리 계열은 881건인데 전체로는 3,000 상한에 걸렸다.
    범인은 amenity=place_of_worship 이다 — 도쿄에는 wikidata 가 붙은 신사·절이 수천 개다.
    Overpass 는 결과 집합에 이름을 붙여 따로 out 할 수 있으므로 요청 한 번으로 나눠 받는다.

    wikidata 태그는 모든 분류에 요구한다. 랭킹 근거가 Wikidata sitelinks 뿐이라
    QID 없는 항목은 어차피 0점이고, 요구하면 후보가 줄어 잘림이 사라진다.
    """
    wd = '["wikidata"]' if require_wd else ""

    def block(keys):
        return "".join(
            f'nwr(around:{radius_m},{lat},{lng})["{k}"~"{pat}"]["name"]{wd};'
            for k, pat, *_ in CATEGORY if k in keys
        )

    sights = block({"tourism", "historic", "man_made", "place", "shop"})
    bulk = block({"amenity", "leisure", "natural"})
    return (
        f"[out:json][timeout:180];"
        f"({sights})->.a;"
        f"({bulk})->.b;"
        f".a out center tags 2500;"
        f".b out center tags 800;"
    )


def element_point(el):
    """node 는 lat/lon, way·relation 은 center.lat/lon. 경도 필드 이름은 항상 lon 이다."""
    if el.get("type") == "node":
        lat, lng = el.get("lat"), el.get("lon")
    else:
        c = el.get("center") or {}
        lat, lng = c.get("lat"), c.get("lon")
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def classify(tags):
    for key, pattern, cat, weight, _need in CATEGORY:
        v = tags.get(key)
        if v and re.match(pattern, v):
            return cat, weight
    return None, 0.0


def fetch_candidates(dest, require_wd=True):
    q = overpass_query(dest["lat"], dest["lng"], int(dest["r"] * 1000), require_wd=require_wd)
    data, last = None, None
    for attempt, url in enumerate(OVERPASS_ENDPOINTS * 2, 1):
        try:
            t0 = time.time()
            data = get(url, timeout=240, data=urllib.parse.urlencode({"data": q}))
            host = url.split("/")[2]
            print(f"    Overpass {len(data.get('elements', []))}건 / {time.time() - t0:.1f}s ({host})")
            break
        except Exception as e:
            last = e
            print(f"    ! Overpass 실패({attempt}, {url.split('/')[2]}): {e}")
            time.sleep(10 * attempt)
    if data is None:
        raise RuntimeError(f"Overpass 전 미러 실패: {last}")

    out = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        # 행정경계·수계는 제외한다. 태그가 겹쳐 붙은 대형 지물을 여기서 떨군다.
        if tags.get("boundary") or tags.get("admin_level") or tags.get("waterway"):
            continue
        cat, weight = classify(tags)
        if not cat:
            continue
        pt = element_point(el)
        if not pt:
            continue
        name = tags.get("name")
        if not name:
            continue
        out.append({
            "osm": f"{el['type']}{el['id']}",   # places.js 의 Nominatim 형식과 같게 맞춘다
            "wd": tags.get("wikidata"),
            "name": name,
            "name_ko": tags.get("name:ko"),
            "name_en": tags.get("name:en"),
            "lat": round(pt[0], 5), "lng": round(pt[1], 5),
            "cat": cat, "weight": weight,
            "dist": haversine_km(dest["lat"], dest["lng"], pt[0], pt[1]),
            # QID 가 없는 후보를 줄 세울 때 쓰는 "제대로 등록된 곳인가" 신호.
            # 문화재 지정·위키백과 문서·홈페이지·영업시간이 붙어 있으면 실제로 찾아가는 곳이다.
            "rich": sum(1 for k in ("wikipedia", "heritage", "website", "opening_hours", "description")
                        if tags.get(k)),
        })
    return out


# ---------------------------------------------------------------------------
# 3단계 — Wikidata 한국어 라벨 + 저명도
# ---------------------------------------------------------------------------
# 명소가 아닌 부류. 태그가 잘못 붙어 들어온 항목을 QID 단계에서 한 번 더 떨군다.
BAD_INSTANCE = {
    "Q515", "Q1549591", "Q486972",       # 도시 / 대도시 / 인간 정주지
    "Q3957", "Q532", "Q15284",           # 소도시 / 마을 / 코뮌
    "Q4022", "Q23397", "Q165",           # 강 / 호수 / 바다
    "Q8502", "Q46831",                   # 산 / 산맥
    "Q56061", "Q10864048",               # 행정구역
    "Q18545121",                         # 대한민국의 자치구 — 부산 '동구·서구' 가 상위에 올라왔다
}

# QID 가 실제로 "그 자리에 있는 것"을 가리키는지 검사할 거리(km).
# 이게 없으면 태그가 잘못 붙은 항목이 개념 문서의 sitelinks 를 그대로 물고 1위로 올라온다.
# 2026-09-04 실측: 부산 1위가 '우동'(Q471861 = 면 요리, 좌표 없음, sitelinks 52),
# 서울 1위가 '혼천의'(Q328720 = 천문 기구, 좌표 없음, 48), 그 밖에 'North American T-28A'(항공기 기종),
# '성 비오 10세회'(단체). 넷 다 P625 좌표가 아예 없다는 공통점이 있었다.
QID_MAX_KM = 3.0


def enrich(cands):
    """QID 가 있는 후보에 한국어 라벨과 sitelinks 수를 붙인다."""
    qids = sorted({c["wd"] for c in cands if c.get("wd") and re.match(r"^Q\d+$", c["wd"])})
    info = {}
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        url = (
            f"{WIKIDATA}?action=wbgetentities&format=json&ids={'|'.join(chunk)}"
            f"&props=labels|sitelinks|claims&languages=ko|en"
        )
        try:
            data = get(url, timeout=60)
        except Exception as e:
            print(f"    ! Wikidata 실패: {e}")
            time.sleep(2)
            continue
        for qid, ent in (data.get("entities") or {}).items():
            labels = ent.get("labels") or {}
            claims = ent.get("claims") or {}
            p31 = set()
            for c in claims.get("P31", []):
                try:
                    p31.add(c["mainsnak"]["datavalue"]["value"]["id"])
                except (KeyError, TypeError):
                    pass
            coord = None
            for c in claims.get("P625", []):
                try:
                    v = c["mainsnak"]["datavalue"]["value"]
                    coord = (float(v["latitude"]), float(v["longitude"]))
                    break
                except (KeyError, TypeError, ValueError):
                    pass
            info[qid] = {
                "ko": (labels.get("ko") or {}).get("value"),
                "en": (labels.get("en") or {}).get("value"),
                "sitelinks": len(ent.get("sitelinks") or {}),
                "p31": p31,
                "coord": coord,
            }
        if (i // 50) % 10 == 0 or i + 50 >= len(qids):
            print(f"    Wikidata {min(i + 50, len(qids))}/{len(qids)}")
        time.sleep(0.4)

    kept, dropped = [], 0
    for c in cands:
        meta = info.get(c.get("wd") or "")
        if meta:
            if meta["p31"] & BAD_INSTANCE:
                continue                     # 도시·강·산맥·자치구 등은 명소 카드가 아니다
            # QID 가 이 자리의 것인지 좌표로 확인한다. 좌표가 아예 없으면 장소가 아니라
            # 개념·단체·기종 문서다(우동·혼천의·T-28·성비오10세회). 붙어 있어도 멀면 오태깅이다.
            near = meta["coord"] is not None and                 haversine_km(c["lat"], c["lng"], meta["coord"][0], meta["coord"][1]) <= QID_MAX_KM
            if not near:
                dropped += 1
                continue
            c["ko"] = meta["ko"] or c.get("name_ko")
            c["en"] = meta["en"] or c.get("name_en") or c["name"]
            c["sitelinks"] = meta["sitelinks"]
        else:
            c["ko"] = c.get("name_ko")
            c["en"] = c.get("name_en") or c["name"]
            c["sitelinks"] = 0
        kept.append(c)
    if dropped:
        print(f"    QID 불일치로 제외 {dropped}건(좌표 없음 또는 {QID_MAX_KM}km 초과)")
    return kept


# ---------------------------------------------------------------------------
# 4단계 — 중복 제거 + 랭킹
# ---------------------------------------------------------------------------
def dedupe(cands):
    """같은 장소가 node/way/relation 으로 여러 번 들어온다. QID → 이름 → 근접 좌표 순으로 접는다."""
    best = {}
    for c in sorted(cands, key=lambda x: (-(x["sitelinks"]), x["dist"])):
        key = c["wd"] or ("name:" + norm_name(c["ko"] or c["name"]))
        if key in best:
            continue
        # 이름이 같고 150m 안이면 같은 장소로 본다(QID 가 한쪽에만 붙은 경우)
        n = norm_name(c["ko"] or c["name"])
        dup = False
        for other in best.values():
            if norm_name(other["ko"] or other["name"]) == n and \
               haversine_km(c["lat"], c["lng"], other["lat"], other["lng"]) < 0.15:
                dup = True
                break
        if dup:
            continue
        best[key] = c
    return list(best.values())


def rank(cands, radius_km):
    for c in cands:
        # sitelinks 는 저명도의 대리지표지 정답이 아니다. 로그로 눌러 상위 편중을 줄이고,
        # 카테고리 가중과 중심 거리 감점을 함께 준다.
        base = (c["sitelinks"] ** 0.5)
        near = max(0.0, 1.0 - (c["dist"] / max(radius_km, 1)) * 0.35)
        c["score"] = round(base * c["weight"] * near, 3)
    cands.sort(key=lambda x: (-x["score"], x["dist"]))

    picked, used = [], {}
    for c in cands:
        cap = CAT_CAP.get(c["cat"])
        if cap is not None and used.get(c["cat"], 0) >= cap:
            continue
        picked.append(c)
        used[c["cat"]] = used.get(c["cat"], 0) + 1
        if len(picked) >= TARGET:
            break
    # 상한 때문에 자리가 남으면 남은 후보로 채운다
    if len(picked) < TARGET:
        chosen = {c["osm"] for c in picked}
        for c in cands:
            if c["osm"] in chosen:
                continue
            picked.append(c)
            if len(picked) >= TARGET:
                break
    return picked


def to_place(c):
    name = c.get("ko") or c.get("name")
    return {
        "name": name[:120],
        "en": (c.get("en") or "")[:120],
        "lat": c["lat"], "lng": c["lng"],
        "osm": c["osm"],
        "wd": c.get("wd"),
        "cat": c["cat"],
        "sl": c["sitelinks"],
    }


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="쉼표로 구분한 도시 id")
    ap.add_argument("--geocode-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-existing", action="store_true",
                    help="이미 만들어 둔 도시는 건너뛴다. Overpass 가 느려 중간에 끊겼을 때 이어서 돌린다.")
    ap.add_argument("--sleep", type=float, default=3.0, help="도시 사이 대기(초)")
    ap.add_argument("--major-only", action="store_true",
                    help="씨앗에 major 표시된 도시만 만든다. 쿠마님 방침(2026-09-04) 기본 운용 방식이다.")
    ap.add_argument("--stamp", default="", help="생성일(YYYY-MM-DD). 비우면 today")
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    stamp = args.stamp or time.strftime("%Y-%m-%d")

    seed = json.load(io.open(SEED, encoding="utf-8"))["destinations"]
    print(f"씨앗 {len(seed)}개")

    dest_path = os.path.join(OUT_DIR, "destinations.json")
    prev = None
    if os.path.exists(dest_path):
        try:
            prev = json.load(io.open(dest_path, encoding="utf-8")).get("destinations")
        except Exception:
            prev = None

    print("\n[1] 목적지 좌표")
    dests, failed = build_destinations(seed, only=only, dry_run=args.dry_run, prev=prev)
    if failed:
        print(f"  ! 좌표 실패 {len(failed)}건: {', '.join(failed)}")
    write_json_atomic(dest_path, {
        "v": 1, "generated": stamp, "generator": GENERATOR,
        "destinations": sorted(dests, key=lambda d: d["id"]),
    }, args.dry_run)
    print(f"  → destinations.json {len(dests)}개")

    if args.geocode_only:
        return

    print("\n[2] 도시별 추천 명소")
    major_ids = {r["id"] for r in seed if r.get("major")}
    targets = [d for d in dests if not only or d["id"] in only]
    if args.major_only:
        targets = [d for d in targets if d["id"] in major_ids]
        print(f"  주요 도시만: {len(targets)}개")
    thin = []
    for i, d in enumerate(targets, 1):
        path = os.path.join(ATTR_DIR, f"{d['id']}.json")
        if args.skip_existing and os.path.exists(path):
            continue
        print(f"  [{i}/{len(targets)}] {d['ko']} (r={d['r']}km)")
        try:
            cands = fetch_candidates(d)
        except Exception as e:
            print(f"    X 건너뜀: {e}")
            time.sleep(args.sleep)
            continue
        cands = enrich(cands)
        cands = dedupe(cands)
        picked = rank(cands, d["r"])

        # 지방 소도시는 OSM 에 wikidata 가 거의 안 붙어 있다(강릉 4곳). 자리가 남으면
        # QID 없는 후보로 채운다. 저명도를 알 수 없으니 분류 가중 + 중심 거리로만 줄 세우고,
        # 이미 뽑힌 것과 이름·좌표로 중복 제거한다. 요청이 한 번 더 나가므로 부족할 때만 한다.
        if len(picked) < TARGET:
            print(f"    자리 {TARGET - len(picked)}개 남음 — QID 없는 후보로 2차 수집")
            time.sleep(args.sleep)
            try:
                extra = fetch_candidates(d, require_wd=False)
            except Exception as e:
                extra = []
                print(f"    ~ 2차 수집 실패(무시): {e}")
            seen_osm = {c["osm"] for c in picked}
            seen_name = {norm_name(c.get("ko") or c["name"]) for c in picked}
            fill = []
            for c in extra:
                if c["osm"] in seen_osm:
                    continue
                c["ko"] = c.get("name_ko") or c["name"]
                c["en"] = c.get("name_en") or c["name"]
                c["sitelinks"] = 0
                n = norm_name(c["ko"])
                if n in seen_name:
                    continue
                seen_name.add(n)
                # QID 가 없으므로 저명도를 모른다. 분류 가중 · 중심 거리 · 등록 충실도로 줄 세운다.
                near = max(0.0, 1.0 - c["dist"] / max(d["r"], 1))
                c["score"] = round(c["weight"] * near * (1.0 + 0.5 * c.get("rich", 0)), 3)
                fill.append(c)
            fill.sort(key=lambda x: (-x["score"], x["dist"]))
            picked = picked + fill[: TARGET - len(picked)]

        if len(picked) < MIN_KEEP and os.path.exists(path):
            # 이번 결과가 부실하면 이미 있던 좋은 파일을 덮어쓰지 않는다.
            print(f"    ~ {len(picked)}건뿐 — 기존 파일 유지")
            thin.append(d["id"])
            time.sleep(args.sleep)
            continue
        if len(picked) < MIN_KEEP:
            thin.append(d["id"])

        write_json_atomic(path, {
            "v": 1, "city": d["id"], "name": d["ko"],
            "generated": stamp, "generator": GENERATOR, "query": QUERY_VERSION,
            "radius_km": d["r"],
            "places": [to_place(c) for c in picked],
        }, args.dry_run)
        print("    → " + ", ".join(f"{c.get('ko') or c['name']}({c['sitelinks']})" for c in picked[:6]))
        time.sleep(args.sleep)

    if thin:
        print(f"\n! 후보가 {MIN_KEEP}개 미만인 도시 {len(thin)}건: {', '.join(thin)}")
        print("  반경(r)을 키우거나 씨앗 좌표를 확인할 것.")


if __name__ == "__main__":
    main()
