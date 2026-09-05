import { useState } from 'react';
import { Link2, MapPin, Search } from 'lucide-react';
import Button from '../../kit/Button';
import EmptyState from '../../kit/EmptyState';
import Input from '../../kit/Input';
import Sheet from '../../kit/Sheet';
import { extractLinkPlaces, searchPlaces } from '../../api';
import SourceAttribution from '../../providers/SourceAttribution';

// 장소를 담는 두 가지 경로 (설계 §1.1 의 ①검색 ③링크로 담기).
// ②지도 롱프레스는 TripBoard 가 직접 처리한다.
//
// 두 시트 모두 "찾아서 → 고르고 → 담는다" 는 같은 흐름이라 한 파일에 둔다.
// 담기는 부모(TripBoard)가 한다 — 여기서는 고른 결과만 넘긴다.

function ResultRow({ item, onPick, busy }) {
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
          <span className="block truncate text-sm font-semibold text-ink">{item.name}</span>
          {item.address && <span className="mt-0.5 block truncate text-xs text-muted">{item.address}</span>}
        </span>
      </button>
    </li>
  );
}

export function PlaceSearchSheet({ open, targetLabel, saving, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null); // null = 아직 안 찾음
  const [provider, setProvider] = useState('osm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    const term = q.trim();
    if (term.length < 2) {
      setError('두 글자 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await searchPlaces(term);
      setProvider(out.provider);
      setRows(out.results);
    } catch (e) {
      setError(e?.message || '장소를 찾지 못했습니다.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="장소 검색">
      <p className="mb-3 text-xs text-muted">
        찾은 장소는 <strong className="font-semibold text-ink">{targetLabel}</strong>에 담깁니다.
      </p>
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
          placeholder="장소 이름이나 주소"
          aria-label="검색어"
        />
        <Button variant="primary" onClick={run} loading={busy}>
          <Search size={16} aria-hidden="true" />
          찾기
        </Button>
      </div>
      {/* 자동완성을 쓰지 않는 이유를 사용자에게도 한 줄로 알린다 — 타이핑해도 안 뜨는 게 정상이다. */}
      <p className="mt-2 text-xs text-muted">엔터를 누르면 찾습니다.</p>
      {error && <p className="mt-2 text-xs text-warning">{error}</p>}

      <div className="mt-3 max-h-[46vh] overflow-y-auto">
        {rows === null ? null : rows.length === 0 ? (
          <EmptyState icon={Search} message="검색 결과가 없습니다." />
        ) : (
          <ul>
            {rows.map((item) => (
              <ResultRow
                key={`${item.provider}-${item.provider_place_id}`}
                item={item}
                busy={saving}
                onPick={onPick}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 출처 표기. 구글이면 공식 로고(시트가 지도를 덮어 지도 내장 표기가 안 보이므로 정책상 필수), OSM 이면 ODbL 문구. */}
      {rows !== null && rows.length > 0 && <SourceAttribution providers={[provider]} className="mt-3" />}
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
