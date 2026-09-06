import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, MapPin, Search } from 'lucide-react';
import Button from '../../kit/Button';
import EmptyState from '../../kit/EmptyState';
import Input from '../../kit/Input';
import Sheet from '../../kit/Sheet';
import { extractLinkPlaces, resolvePlace, searchPlaces, suggestPlaces } from '../../api';
import { loadAttractions } from '../../lib/destinations';
import { MAP_PROVIDERS, getMapProvider } from '../../providers/index';
import SourceAttribution from '../../providers/SourceAttribution';

// 장소를 담는 두 가지 경로 (설계 §1.1 의 ①검색 ③링크로 담기).
// ②지도 롱프레스는 TripBoard 가 직접 처리한다.
//
// 두 시트 모두 "찾아서 → 고르고 → 담는다" 는 같은 흐름이라 한 파일에 둔다.
// 담기는 부모(TripBoard)가 한다 — 여기서는 고른 결과만 넘긴다.

function ResultRow({ item, onPick, busy }) {
  const sub = item.address || item.secondary || '';
  return (
    <li className="border-t border-hairline first:border-t-0">
      <button
        type="button"
        disabled={busy}
        onClick={() => onPick(item)}
        className="flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-surface-soft disabled:opacity-50"
      >
        <MapPin size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-ink">{item.name}</span>
            {item.badge && (
              <span className="shrink-0 rounded-sm bg-surface-soft px-1.5 py-0.5 text-[11px] text-muted">{item.badge}</span>
            )}
          </span>
          {sub && <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span>}
        </span>
      </button>
    </li>
  );
}

// 구글 자동완성: 글자 입력이 멈추고 이 시간이 지나면 한 번 부른다. 세션당 과금은 최대 12건이라 타이핑마다 부르지 않는다.
const DEBOUNCE_MS = 400;
const MIN_CHARS = 2;
const STATIC_MAX = 3;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 자동완성 세션 토큰. 한 번 고를 때까지 같은 값을 쓰고, 고르면 새로 만든다(구글 세션 과금 단위).
function newSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// 장소 검색 시트. 제공자에 따라 두 가지로 움직인다(2026-09-05 쿠마님 승인 방식).
//   · 구글: 두 글자부터 자동완성. 후보 = 그 도시 추천 명소(정적, 0원) + 카탈로그에 이미 있는 장소(0원) + 구글 예측.
//           구글 예측을 고르면 그때 한 번만 좌표·주소를 받는다(카탈로그에 있으면 그것도 0원).
//   · OSM : 엔터를 눌렀을 때만 찾는다(Nominatim 정책).
export function PlaceSearchSheet({ open, targetLabel, saving, onClose, onPick, bias = null, destId = null }) {
  const [provider, setProvider] = useState('pending'); // 'pending' | 'google' | 'osm' | 'error'
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null); // OSM: 엔터 결과. 구글: 자동완성 후보. null = 아직 없음
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(newSessionToken);
  const [attractions, setAttractions] = useState([]);
  const reqRef = useRef(0);

  const isGoogle = provider === MAP_PROVIDERS.GOOGLE;
  // 부모가 매 렌더마다 새 객체를 넘겨도 효과가 다시 돌지 않게 값으로 비교한다.
  const biasKey = bias && isNum(bias.lat) && isNum(bias.lng) ? `${bias.lat},${bias.lng}` : '';

  useEffect(() => {
    let alive = true;
    getMapProvider()
      .then((p) => {
        if (alive) setProvider(p);
      })
      .catch(() => {
        if (alive) setProvider('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  // 그 도시 추천 명소(정적 파일, 0원). 구글 제공자에서만 후보에 섞는다 — OSM 은 엔터 검색이라 섞을 자리가 없다.
  useEffect(() => {
    if (!destId || !isGoogle) return undefined;
    let alive = true;
    loadAttractions(destId)
      .then((list) => {
        if (alive) setAttractions(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [destId, isGoogle]);

  // 구글: 디바운스 자동완성. 요청 번호로 늦게 온 응답을 버린다.
  useEffect(() => {
    if (!isGoogle) return undefined;
    const term = q.trim();
    // 요청 번호를 먼저 올려 두면, 두 글자 미만으로 지웠을 때 아직 날아가던 이전 응답이 화면을 되살리지 못한다(codex 권고).
    const id = ++reqRef.current;
    if (term.length < MIN_CHARS) {
      setRows(null);
      setError('');
      setBusy(false); // 날아가던 요청의 finally 는 요청번호가 달라 busy 를 못 내린다(agy 지적) — 여기서 내린다
      return undefined;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const [lat, lng] = biasKey ? biasKey.split(',').map(Number) : [];
        const out = await suggestPlaces(term, { session, bias: biasKey ? { lat, lng } : null });
        if (id !== reqRef.current) return;
        setRows(out.suggestions.map((s) => (s.known ? { ...s, badge: '담긴 적 있음' } : s)));
        setError('');
      } catch (e) {
        if (id !== reqRef.current) return;
        setError(e?.message || '장소를 찾지 못했습니다.');
        setRows([]);
      } finally {
        if (id === reqRef.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, isGoogle, session, biasKey]);

  // 추천 명소 매칭은 화면에서 한다(서버·구글 호출 없음). 구글 후보와 같은 장소는 뺀다.
  const staticMatches = useMemo(() => {
    if (!isGoogle) return [];
    const term = q.trim().toLowerCase();
    if (term.length < MIN_CHARS) return [];
    const seen = new Set((rows || []).map((r) => `${r.provider}:${r.provider_place_id}`));
    return attractions
      .filter((a) => a?.name && String(a.name).toLowerCase().includes(term) && !seen.has(`${a.provider}:${a.provider_place_id}`))
      .slice(0, STATIC_MAX)
      .map((a) => ({ ...a, badge: '추천 명소' }));
  }, [isGoogle, q, rows, attractions]);

  const list = isGoogle ? (rows === null && staticMatches.length === 0 ? null : [...staticMatches, ...(rows || [])]) : rows;

  const afterPick = () => {
    setSession(newSessionToken());
    setQ('');
    setRows(null);
  };

  // OSM: 엔터 검색
  const run = async () => {
    const term = q.trim();
    if (term.length < MIN_CHARS) {
      setError('두 글자 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await searchPlaces(term);
      setRows(out.results);
    } catch (e) {
      setError(e?.message || '장소를 찾지 못했습니다.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (item) => {
    // 좌표가 이미 있는 후보(OSM 결과·추천 명소·카탈로그)는 그대로 담는다.
    if (isNum(item.lat) && isNum(item.lng)) {
      onPick(item);
      if (isGoogle) afterPick();
      return;
    }
    // 구글 예측: 이때 한 번만 좌표·주소를 받는다(세션 종료).
    setBusy(true);
    try {
      const place = await resolvePlace({ placeId: item.provider_place_id, name: item.name, session });
      onPick(place);
      afterPick();
    } catch (e) {
      setError(e?.message || '장소 정보를 가져오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // 출처는 실제로 보이는 후보 기준으로 센다(구글 후보가 없고 추천 명소만 있으면 OSM 표기만).
  const attributionProviders = Array.from(new Set((list || []).map((r) => r.provider).filter((p) => p === 'google' || p === 'osm')));

  return (
    <Sheet open={open} onClose={onClose} title="장소 검색">
      <p className="mb-3 text-xs text-muted">
        찾은 장소는 <strong className="font-semibold text-ink">{targetLabel}</strong>에 담깁니다.
      </p>
      <div className="flex gap-2">
        <Input
          value={q}
          hangulFix
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // 한글 조합 중 Enter 는 조합 확정용이라 검색을 두 번 부르지 않는다(agy 권고)
              if (e.nativeEvent?.isComposing) return;
              if (provider === MAP_PROVIDERS.OSM) run();
            }
          }}
          placeholder="장소 이름이나 주소"
          aria-label="검색어"
          disabled={provider === 'pending' || provider === 'error'}
          autoComplete="off"
        />
        {!isGoogle && (
          <Button variant="primary" onClick={run} loading={busy} disabled={provider !== MAP_PROVIDERS.OSM}>
            <Search size={16} aria-hidden="true" />
            찾기
          </Button>
        )}
      </div>
      {provider === 'pending' && <p className="mt-2 text-xs text-muted">지도 정보를 확인하는 중입니다.</p>}
      {provider === 'error' && (
        <p className="mt-2 text-xs text-warning">장소 검색을 준비 중입니다. 잠시 뒤에 다시 열어 주세요.</p>
      )}
      {isGoogle && (
        <p className="mt-2 text-xs text-muted" aria-live="polite">
          {busy ? '찾는 중…' : '두 글자 이상 입력하면 후보가 뜹니다.'}
        </p>
      )}
      {/* 자동완성을 쓰지 않는 이유를 사용자에게도 한 줄로 알린다 — 타이핑해도 안 뜨는 게 정상이다. */}
      {provider === MAP_PROVIDERS.OSM && <p className="mt-2 text-xs text-muted">엔터를 누르면 찾습니다.</p>}
      {error && (
        <p className="mt-2 text-xs text-warning" aria-live="polite">
          {error}
        </p>
      )}

      <div className="mt-3 max-h-[46vh] overflow-y-auto">
        {list === null ? null : list.length === 0 ? (
          busy ? null : <EmptyState icon={Search} message="검색 결과가 없습니다." />
        ) : (
          <ul>
            {list.map((item) => (
              <ResultRow
                key={`${item.provider}-${item.provider_place_id}`}
                item={item}
                busy={saving || busy}
                onPick={pick}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 출처 표기. 구글이면 공식 로고(시트가 지도를 덮어 지도 내장 표기가 안 보이므로 정책상 필수), OSM 이면 ODbL 문구. */}
      {list !== null && list.length > 0 && <SourceAttribution providers={attributionProviders} className="mt-3" />}
    </Sheet>
  );
}

export function LinkImportSheet({ open, targetLabel, saving, onClose, onPick }) {
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    const value = url.trim();
    if (!value) {
      setError('링크를 넣어 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await extractLinkPlaces(value);
      setRows(out);
    } catch (e) {
      setError(e?.message || '이 링크에서는 장소를 찾지 못했습니다.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="링크로 담기">
      <p className="mb-3 text-xs text-muted">
        네이버 블로그 글이나 구글 지도 링크에서 장소를 찾아 <strong className="font-semibold text-ink">{targetLabel}</strong>에 담습니다.
      </p>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
          placeholder="https://blog.naver.com/..."
          aria-label="링크 주소"
        />
        <Button variant="primary" onClick={run} loading={busy}>
          <Link2 size={16} aria-hidden="true" />
          찾기
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-warning">{error}</p>}

      <div className="mt-3 max-h-[46vh] overflow-y-auto">
        {rows === null ? null : rows.length === 0 ? (
          <EmptyState icon={Link2} message="이 링크에서는 장소를 찾지 못했습니다." />
        ) : (
          <ul>
            {rows.map((item, i) => (
              <ResultRow key={`${item.lat}-${item.lng}-${i}`} item={item} busy={saving} onPick={onPick} />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
