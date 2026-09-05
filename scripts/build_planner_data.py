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
# Overpass·Wikidata 응답을 그대로 담아 두는 곳. 순위·제외 규칙을 고칠 때마다 외부 서비스를
# 다시 부르지 않으려고 둔다(--rerank). 커밋하지 않는다.
CACHE_DIR = os.path.join(HERE, ".planner_cache")

GENERATOR = "build_planner_data.py/1"
QUERY_VERSION = "v1"          # Overpass 태그 집합을 바꾸면 올린다
ENRICH_VERSION = "v1"         # Wikidata 에서 무엇을 받아 오는지 바꾸면 올린다(캐시 무효화)
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
STRONG_SITELINKS = 3  # 이 정도 언어판에 문서가 있으면 "알려진 곳"으로 본다
MIN_STRONG = 5        # 알려진 곳이 이보다 적은 도시는 추천을 아예 두지 않는다

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
    """Nominatim 으로 도시 좌표를 얻는다. 못 찾으면 None.

    씨앗에 lat/lng 이 있으면 그대로 쓴다. 행정 중심과 여행 중심이 다른 곳을 위한 것이다 —
    제주는 시청(제주시 북쪽)을 중심으로 잡으면 성산일출봉·중문이 반경 밖으로 나간다.
    """
    if seed_row.get("lat") is not None and seed_row.get("lng") is not None:
        return {"lat": round(float(seed_row["lat"]), 5),
                "lng": round(float(seed_row["lng"]), 5), "matched": "씨앗 지정"}
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
        # 상한은 넉넉히. 베를린이 3,147건으로 옛 상한(2500+800)에 닿아 브란덴부르크 문이
        # 잘려 나갔다(2026-09-05 실측). 잘리면 정렬 보장이 없어 1등이 사라질 수 있다.
        f".a out center tags 6000;"
        f".b out center tags 2000;"
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
# 언제나 명소가 아닌 것. 지형 전체나 행정 단위다.
BAD_ALWAYS = {
    "Q4022", "Q23397", "Q165",           # 강 / 호수 / 바다
    "Q56061", "Q10864048",               # 행정구역
    "Q18545121",                         # 대한민국의 자치구 — 부산 '동구·서구' 가 상위에 올라왔다
    # 아래 셋은 2026-09-04 실측으로 확인한 것이다. 오사카 4위 '주오구', 6위 '기타구',
    # 인천 '도화동·발산동·부평동', 제주 '건입동' 이 이 유형으로 올라왔다.
    # 아키하바라(Q418096)는 Q123705(지구)라 여기 걸리지 않는다 — 동네는 남기고 행정구역만 뺀다.
    "Q137773",                           # 일본의 행정구(정령지정도시의 구)
    "Q490329",                           # 대한민국의 동(행정동·법정동)
    "Q182742",                           # 도쿄도 특별구
    "Q705296",                           # 대만의 구 — 가오슝 '펑산구·옌청구', 타이베이 '신이구'
    "Q15634883",                         # 마닐라의 구 — 'Tondo' 가 20위권에 올라왔다
    "Q5503",                             # 지하철 체계 — 프라하 4위가 '프라하 메트로'였다
    # 사건 자체를 가리키는 문서. 추모비에 그 사건 QID 가 붙어 유명세를 물고 올라온다 —
    # 나고야 2위가 '중화항공 140편 추락 사고'(Q699055, P31=Q744913)였다.
    "Q744913",                           # 항공 사고
    # 경기·대회 그 자체를 가리키는 문서. 경기장에 그 경기 QID 가 붙어 올라온다 —
    # 도하 1위가 '2022년 FIFA 월드컵 결승전'(Q55620455)이었다. 경기장은 다른 QID 로 따로 있다.
    "Q12708896",                         # FIFA 월드컵 결승전
    "Q17315159",                         # 국제 축구 경기
    "Q13406554",                         # 스포츠 대회
    # 교통 시설·표지·놀이기구. 재검토(2026-09-05)에서 가오슝 '구산 역·산퀴춰 역', 세부 'historical marker' 2건,
    # 골드코스트 'Jet Rescue·Batwing Spaceshot'(놀이공원 안의 기구)이 꼬리에 올라와 있었다.
    "Q55488", "Q22808403", "Q928830", "Q2175765", "Q1793804",   # 철도역·지하역·도시철도역·노면전차 정류장·S-Bahn
    "Q21562164",                         # 필리핀 국가역사위원회 표지
    "Q2389789", "Q390365",               # 스틸 롤러코스터·Space Shot(놀이기구)
}

# 사람이 사는 곳. 동네 분류로 들어왔을 때만 뺀다.
# 관광지로 태그된 채 마을 유형을 함께 가진 곳이 있다 — 제주 성읍민속마을(Q532)이 그렇다.
BAD_SETTLEMENT = {
    "Q515", "Q1549591", "Q486972",       # 도시 / 대도시 / 인간 정주지
    "Q3957", "Q532", "Q15284",           # 소도시 / 마을 / 코뮌
    "Q24764",                            # 필리핀의 지방자치단체
}
# 산은 빼지 않는다. Q8502(산)를 막았더니 성산일출봉(Q8502 를 함께 가진 유네스코 자연유산)이
# 통째로 사라졌다(2026-09-04 실측). 지형이 화면을 먹는 건 nature 상한 2개로 막는다.

# 유형으로는 못 거르는 개별 항목. 도시별 씨앗의 block 목록과 함께 쓴다.
BLOCK_GLOBAL = set()

# QID 가 실제로 "그 자리에 있는 것"을 가리키는지 검사할 거리(km).
# 이게 없으면 태그가 잘못 붙은 항목이 개념 문서의 sitelinks 를 그대로 물고 1위로 올라온다.
# 2026-09-04 실측: 부산 1위가 '우동'(Q471861 = 면 요리, 좌표 없음, sitelinks 52),
# 서울 1위가 '혼천의'(Q328720 = 천문 기구, 좌표 없음, 48), 그 밖에 'North American T-28A'(항공기 기종),
# '성 비오 10세회'(단체). 넷 다 P625 좌표가 아예 없다는 공통점이 있었다.
QID_MAX_KM = 3.0


def enrich(cands):
    """QID 가 있는 후보에 한국어 라벨과 sitelinks 수를 붙인다.

    (후보, 전부 조회했는가) 를 돌려준다. 한 묶음이라도 실패하면 그 후보들은 좌표도 유형도
    없는 채로 남는데, 그건 "QID 에 좌표가 없다"와 구분되지 않는다. 부르는 쪽이 그 결과를
    캐시에 굳히지 않도록 실패를 알려 준다.
    """
    ok = True
    qids = sorted({c["wd"] for c in cands if c.get("wd") and re.match(r"^Q\d+$", c["wd"])})
    info = {}
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        url = (
            f"{WIKIDATA}?action=wbgetentities&format=json&ids={'|'.join(chunk)}"
            f"&props=labels|sitelinks|claims&languages=ko|en"
        )
        data = None
        for attempt in (1, 2):
            try:
                data = get(url, timeout=60)
                break
            except Exception as e:
                print(f"    ! Wikidata 실패({attempt}): {e}")
                time.sleep(3 * attempt)
        if data is None:
            # 이 묶음 50개가 통째로 "좌표 없음"이 되어 screen() 에서 탈락한다.
            # 부르는 쪽이 이 결과를 캐시에 굳히지 않도록 알린다.
            ok = False
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

    # 여기서는 아무것도 버리지 않는다. 판단 근거(유형·좌표 어긋남)만 후보에 붙여 두고
    # 실제로 거르는 일은 screen() 이 한다 — 그래야 규칙을 고칠 때 캐시로 다시 돌릴 수 있다.
    for c in cands:
        meta = info.get(c.get("wd") or "")
        if meta:
            c["ko"] = meta["ko"] or c.get("name_ko")
            c["en"] = meta["en"] or c.get("name_en") or c["name"]
            c["sitelinks"] = meta["sitelinks"]
            c["p31"] = sorted(meta["p31"])
            # QID 가 이 자리의 것인지 좌표로 확인한다. 좌표가 아예 없으면 장소가 아니라
            # 개념·단체·기종 문서다(우동·혼천의·T-28·성비오10세회). 붙어 있어도 멀면 오태깅이다.
            c["qid_km"] = (
                round(haversine_km(c["lat"], c["lng"], meta["coord"][0], meta["coord"][1]), 2)
                if meta["coord"] else None
            )
        else:
            c["ko"] = c.get("name_ko")
            c["en"] = c.get("name_en") or c["name"]
            c["sitelinks"] = 0
            c["p31"] = []
            c["qid_km"] = None
    return cands, ok


def screen(cands, block=()):
    """명소가 아닌 것을 걷어낸다. 캐시에서 다시 돌릴 때도 이 함수만 통과시키면 된다."""
    blocked = {norm_name(b) for b in block} | {norm_name(b) for b in BLOCK_GLOBAL}
    kept, off, bad, hand = [], 0, 0, 0
    for c in cands:
        p31 = set(c.get("p31") or [])
        if p31 & BAD_ALWAYS or (c["cat"] == "district" and p31 & BAD_SETTLEMENT):
            bad += 1                          # 강·행정구역·행정동 등은 명소 카드가 아니다
            continue
        if c.get("wd"):
            km = c.get("qid_km")
            if km is None or km > QID_MAX_KM:
                off += 1
                continue
        # 한국어 라벨이 없으면 c["ko"] 가 비어 원문(일본어 등)이 남는다. 씨앗에 한국어로 적어 둔
        # 이름과 안 맞을 수 있으므로 ko·en·원문을 모두 대조한다.
        if any(norm_name(v) in blocked for v in (c.get("ko"), c.get("en"), c.get("name")) if v):
            hand += 1
            continue
        kept.append(c)
    notes = []
    if off:
        notes.append(f"QID 불일치 {off}건(좌표 없음 또는 {QID_MAX_KM}km 초과)")
    if bad:
        notes.append(f"명소 아닌 유형 {bad}건")
    if hand:
        notes.append(f"손으로 뺀 것 {hand}건")
    if notes:
        print("    제외 — " + " · ".join(notes))
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


def cache_path_for(city_id):
    return os.path.join(CACHE_DIR, f"{city_id}.json")


def load_cache(city_id, dest=None):
    """저장해 둔 후보 풀. 수집 조건이 하나라도 다르면 쓰지 않는다.

    후보 풀은 (태그 집합, 중심 좌표, 반경) 으로 정해진다. 반경만 보고 좌표를 안 보면
    씨앗 좌표를 옮겨도 옛 중심의 캐시를 그대로 쓰게 된다.
    block·BAD_*·가중치는 수집 조건이 아니라 걸러 내는 규칙이라 캐시 키가 아니다 —
    그것들을 고쳤을 때 캐시를 그대로 재사용하는 게 --rerank 의 목적이다.
    """
    try:
        with io.open(cache_path_for(city_id), encoding="utf-8") as fp:
            obj = json.load(fp)
    except Exception:
        return None
    if obj.get("query") != QUERY_VERSION or obj.get("enrich") != ENRICH_VERSION:
        return None
    if not isinstance(obj.get("candidates"), list):
        return None              # 스키마가 다른 옛 파일
    if dest is not None:
        if obj.get("radius_km") != dest["r"] or            obj.get("lat") != dest["lat"] or obj.get("lng") != dest["lng"]:
            return None          # 중심·반경이 바뀌면 후보 풀 자체가 다르다
    return obj


def save_cache(city_id, obj, dry_run=False):
    if dry_run:
        return
    os.makedirs(CACHE_DIR, exist_ok=True)
    write_json_atomic(cache_path_for(city_id), obj)


def rank(cands, radius_km):
    for c in cands:
        # sitelinks 는 저명도의 대리지표지 정답이 아니다. 로그로 눌러 상위 편중을 줄이고,
        # 카테고리 가중과 중심 거리 감점을 함께 준다.
        # +1 을 하는 이유: sitelinks 가 0 이면 곱셈이라 카테고리 가중도 거리도 통째로 사라져
        # 0점끼리 거리순으로만 줄 서게 된다. 최소 기저를 줘서 나머지 신호를 살린다.
        base = ((c["sitelinks"] + 1) ** 0.5)
        # 반경이 넓은 곳(섬·광역)은 "중심에서 멀다"가 의미를 잃는다 — 제주 성산일출봉은
        # 중심에서 38km 지만 그 도시의 1번 명소다. 감점 폭을 줄인다.
        penalty = 0.20 if radius_km >= 20 else 0.35
        near = max(0.0, 1.0 - (c["dist"] / max(radius_km, 1)) * penalty)
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
    # 상한 때문에 자리가 남으면 남은 후보로 채우되, 상한의 두 배까지만 허용한다.
    # 아무 제한 없이 채우면 "분류별 상한"이 사실상 없는 것과 같아진다 — 공원만 여섯 개가 된다.
    if len(picked) < TARGET:
        chosen = {c["osm"] for c in picked}
        for c in cands:
            if len(picked) >= TARGET:
                break
            if c["osm"] in chosen:
                continue
            cap = CAT_CAP.get(c["cat"])
            if cap is not None and used.get(c["cat"], 0) >= cap * 2:
                continue
            picked.append(c)
            used[c["cat"]] = used.get(c["cat"], 0) + 1
    return picked


HANGUL_RE = re.compile(r"[가-힣]")


def place_rows(picked, rename=None):
    """화면에 나갈 목록. 같은 이름이 두 줄 나오지 않게 한다.

    좌표가 떨어져 있어도 한국어 라벨이 같으면 사용자에게는 구분이 안 된다 —
    하와이에서 'Waikiki Beach'(해변)와 'Waikīkī'(동네)가 둘 다 '와이키키'로 나왔다(2026-09-05).
    순위가 높은 쪽만 남긴다.
    """
    rows, seen = [], set()
    # 알려진 곳이 충분하면(6개 이상) 꼬리의 무명 항목(sitelinks 0~1)은 뺀다.
    # 상위 4~6개는 어느 도시나 좋은데 7~12위에 동네 상가·기구·표지가 섞이는 게 문제였다.
    strong = sum(1 for c in picked if c["sitelinks"] >= STRONG_SITELINKS)
    for c in picked:
        if strong >= 6 and c["sitelinks"] < 2:
            continue
        row = to_place(c, rename)
        name = row["name"]
        # 한국어도 영어(ASCII)도 아닌 이름(베트남어 등 라틴 확장)은 라벨이 없다는 뜻이다.
        # 저명도까지 낮으면 사용자가 읽지도 못하는 줄이 된다 — 뺀다.
        if not HANGUL_RE.search(name) and not name.isascii() and c["sitelinks"] < 3:
            continue
        key = norm_name(name)
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return rows


def to_place(c, rename=None):
    """화면에 나갈 한 줄. rename 은 씨앗의 이름 고침표다.

    Wikidata 한국어 라벨이 그대로 쓰기엔 이상한 것이 있다 — 문화재 지정 명칭이 붙어 길거나
    (성산일출봉 천연보호구역) 라벨이 겹쳐 들어간 것(중문·대포 해안 주상절리대대포주상절리대)이 있다.
    """
    # 한국어 라벨이 없으면 원문(한자·일본어)보다 영어가 낫다. 한국 사람이 읽을 수 있는 쪽을 고른다 —
    # 徳川美術館·勝連城跡 보다 Tokugawa Art Museum·Katsuren Castle 이 도움이 된다.
    name = c.get("ko") or c.get("en") or c.get("name")
    if rename:
        name = rename.get(name, name)
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
    ap.add_argument("--rerank", action="store_true",
                    help="외부 서비스를 부르지 않고 캐시(scripts/.planner_cache)로 순위만 다시 매긴다. "
                         "제외 규칙·가중치를 고쳤을 때 쓴다.")
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
    if args.rerank and prev:
        # 좌표는 다시 찾지 않되, 씨앗에서 바꾼 값(lat/lng/r/이름)은 반영한다.
        # prev 를 그대로 쓰면 씨앗을 고쳐도 재순위에 반영되지 않는다.
        by_prev = {d["id"]: d for d in prev}
        dests, failed = [], []
        for row in seed:
            base = dict(by_prev.get(row["id"]) or {})
            if not base:
                continue
            if row.get("lat") is not None and row.get("lng") is not None:
                base["lat"] = round(float(row["lat"]), 5)
                base["lng"] = round(float(row["lng"]), 5)
            base.update({"ko": row["ko"], "en": row["en"], "alias": row.get("alias") or [],
                         "cc": row["cc"], "country": row["country"], "cur": row["cur"],
                         "r": row.get("r", 12)})
            if row.get("major"):
                base["major"] = True
            else:
                base.pop("major", None)
            dests.append(base)
        print(f"  캐시 재순위 — 기존 좌표 {len(dests)}개 재사용(씨앗 값 반영)")
    else:
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
    seed_by_id = {r["id"]: r for r in seed}
    thin, weak, redo = [], [], []
    for i, d in enumerate(targets, 1):
        path = os.path.join(ATTR_DIR, f"{d['id']}.json")
        if args.skip_existing and os.path.exists(path):
            continue
        print(f"  [{i}/{len(targets)}] {d['ko']} (r={d['r']}km)")
        block = seed_by_id.get(d["id"], {}).get("block") or []
        cache = load_cache(d["id"], d)
        if cache is None:
            if args.rerank:
                print("    ~ 캐시가 없다 — 건너뜀")
                continue
            try:
                cands = fetch_candidates(d)
            except Exception as e:
                print(f"    X 건너뜀: {e}")
                time.sleep(args.sleep)
                continue
            cands, wikidata_ok = enrich(cands)
            cache = {"v": 1, "city": d["id"], "query": QUERY_VERSION,
                     "enrich": ENRICH_VERSION, "lat": d["lat"], "lng": d["lng"],
                     "radius_km": d["r"], "candidates": cands}
            if wikidata_ok:
                save_cache(d["id"], cache, args.dry_run)
            else:
                # Wikidata 가 한 번이라도 실패하면 그 후보들은 p31 도 좌표도 없는 채로 남는다.
                # 그대로 캐시에 굳히면 "QID 좌표 없음"과 구분이 안 되어 영원히 제외된다.
                print("    ~ Wikidata 실패가 있어 캐시를 저장하지 않는다")
                redo.append(d["id"])
        else:
            cands = cache["candidates"]
            print(f"    캐시 {len(cands)}건 재사용")
        cands = screen(cands, block)
        cands = dedupe(cands)
        picked = rank(cands, d["r"])

        # 지방 소도시는 OSM 에 wikidata 가 거의 안 붙어 있다(강릉 4곳). 자리가 남으면
        # QID 없는 후보로 채운다. 저명도를 알 수 없으니 분류 가중 + 중심 거리로만 줄 세우고,
        # 이미 뽑힌 것과 이름·좌표로 중복 제거한다. 요청이 한 번 더 나가므로 부족할 때만 한다.
        if len(picked) < TARGET:
            extra = cache.get("extra")
            if extra is not None:
                print(f"    자리 {TARGET - len(picked)}개 남음 — 캐시된 2차 후보 {len(extra)}건 사용")
            elif args.rerank:
                extra = []
                print(f"    ~ 자리 {TARGET - len(picked)}개 남지만 캐시에 2차 후보가 없다")
            else:
                print(f"    자리 {TARGET - len(picked)}개 남음 — QID 없는 후보로 2차 수집")
                time.sleep(args.sleep)
                try:
                    extra = fetch_candidates(d, require_wd=False)
                except Exception as e:
                    extra = []
                    print(f"    ~ 2차 수집 실패(무시): {e}")
                cache["extra"] = extra
                save_cache(d["id"], cache, args.dry_run)
            seen_osm = {c["osm"] for c in picked}
            seen_name = {norm_name(c.get("ko") or c["name"]) for c in picked}
            fill = []
            for c in extra:
                if c["osm"] in seen_osm:
                    continue
                # require_wd=False 는 "QID 없는 것만"이 아니라 "QID 조건을 뺀 전부"다.
                # QID 가 붙은 후보를 여기로 들이면 enrich·screen 을 건너뛴 채 sitelinks=0 으로
                # 들어와 오태깅·행정구역 검사가 통째로 무력화된다(인천 extra 1,123건 중 15건).
                # 1차에서 통과한 것은 이미 picked 에 있으므로, 여기서는 QID 없는 것만 본다.
                if c.get("wd"):
                    continue
                # QID 가 없다는 건 Wikidata 문서조차 없다는 뜻이다. 그런 동네 이름·동네 교회는
                # 추천이 될 수 없다(인천 2차에서 '간석동·관교동·인천청암교회'가 올라왔다).
                if c["cat"] in ("district", "worship"):
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
            # 1차에서 쓴 분류 상한을 이어 받는다. 다만 자리를 채우는 게 목적이므로 두 배까지 허용한다 —
            # 상한을 그대로 두면 후보가 적은 도시가 6개도 못 채운다.
            used = {}
            for c in picked:
                used[c["cat"]] = used.get(c["cat"], 0) + 1
            for c in fill:
                if len(picked) >= TARGET:
                    break
                cap = CAT_CAP.get(c["cat"])
                if cap is not None and used.get(c["cat"], 0) >= cap * 2:
                    continue
                picked.append(c)
                used[c["cat"]] = used.get(c["cat"], 0) + 1

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
            "places": place_rows(picked, seed_by_id.get(d["id"], {}).get("rename")),
        }, args.dry_run)
        # 저명도가 있는 것이 몇 개인지 본다. sitelinks 가 낮은 것만 모인 도시는 OSM·Wikidata
        # 등록이 얇다는 뜻이라, 카드를 띄우면 동네 공원 목록이 된다 — 차라리 안 띄우는 게 낫다.
        strong = sum(1 for c in picked if c["sitelinks"] >= STRONG_SITELINKS)
        if strong < MIN_STRONG:
            weak.append(f"{d['id']}({strong})")
        print("    → " + ", ".join(f"{c.get('ko') or c['name']}({c['sitelinks']})" for c in picked[:6]))
        time.sleep(args.sleep)

    if thin:
        print(f"\n! 후보가 {MIN_KEEP}개 미만인 도시 {len(thin)}건: {', '.join(thin)}")
        print("  반경(r)을 키우거나 씨앗 좌표를 확인할 것.")
    if weak:
        print(f"\n! 알려진 곳이 {MIN_STRONG}개 미만인 도시 {len(weak)}건: {', '.join(weak)}")
        print(f"  (sitelinks {STRONG_SITELINKS} 이상인 개수). 씨앗의 major 를 빼고 파일을 지울 것.")
    if redo:
        print(f"\n! Wikidata 조회가 불완전한 도시 {len(redo)}건: {', '.join(redo)}")
        print("  --only 로 다시 돌릴 것(캐시를 저장하지 않았다).")


if __name__ == "__main__":
    main()
