import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import Button from '../../kit/Button';
import Input from '../../kit/Input';
import Textarea from '../../kit/Textarea';
import { listReviews, submitReview } from '../../api';
import { formatDate } from '../../lib/format';

// 핀 상세 안의 후기 영역 (설계 §1.1).
//
// 쓸 수 있는 조건이 두 가지다.
//   1. 이 핀이 장소 카탈로그에 연결돼 있어야 한다(검색·링크로 담은 핀). 지도 롱프레스로
//      찍은 수동 핀은 같은 장소인지 판정할 근거가 없어 후기를 붙이지 않는다.
//   2. 방문 완료로 표시해야 한다. 판정은 서버가 한다 — 안 다녀온 곳의 후기를 막는 장치라
//      화면에서 미리 안내만 하고, 최종 거절은 RPC 에 맡긴다.
//
// 별점은 잉크색 아이콘으로 그린다(설계 §8: 이모지 금지).

function Stars({ value, onChange, readOnly = false }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const icon = (
          <Star
            size={16}
            aria-hidden="true"
            className={filled ? 'text-ink' : 'text-hairline'}
            fill={filled ? 'currentColor' : 'none'}
          />
        );
        if (readOnly) return <span key={n}>{icon}</span>;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n}점`}
            aria-pressed={value === n}
            className="rounded-sm p-0.5"
          >
            {icon}
          </button>
        );
      })}
    </span>
  );
}

export default function PlaceReviews({ place, visited }) {
  const catalogId = place?.catalog_id || null;
  const [rows, setRows] = useState([]);
  const [rating, setRating] = useState(0);
  const [menu, setMenu] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!catalogId) return undefined;
    let alive = true;
    (async () => {
      try {
        const data = await listReviews(catalogId);
        if (alive) setRows(data);
      } catch {
        /* 후기를 못 읽어도 핀 상세는 그대로 쓸 수 있어야 한다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [catalogId]);

  if (!catalogId) {
    return (
      <p className="mt-4 text-xs text-muted">
        지도에서 직접 찍은 핀에는 후기를 쓸 수 없습니다. 장소 검색으로 담으면 후기를 남길 수 있습니다.
      </p>
    );
  }

  const save = async () => {
    if (!rating) {
      setMessage('별점을 골라 주세요.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await submitReview({ catalogId, rating, body: body.trim() || null, menu: menu.trim() || null });
      setRows(await listReviews(catalogId));
      setBody('');
      setMenu('');
      setMessage('후기를 올렸습니다.');
    } catch (e) {
      setMessage(e?.message || '후기를 올리지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">후기</h3>

      {rows.length > 0 ? (
        <ul className="mb-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex items-center gap-2">
                <Stars value={r.rating} readOnly />
                <span className="text-xs text-muted">{r.author_name}</span>
                {r.visited_on && <span className="text-xs text-muted">{formatDate(r.visited_on)} 방문</span>}
              </div>
              {r.recommended_menu && (
                <p className="mt-1 text-xs text-body">추천: {r.recommended_menu}</p>
              )}
              {r.body && <p className="mt-1 whitespace-pre-wrap text-sm text-body">{r.body}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-xs text-muted">아직 올라온 후기가 없습니다.</p>
      )}

      {visited ? (
        <div>
          <Stars value={rating} onChange={setRating} />
          <Input
            className="mt-2"
            value={menu}
            hangulFix
            onChange={(e) => setMenu(e.target.value)}
            placeholder="추천 메뉴 (선택)"
            aria-label="추천 메뉴"
            maxLength={200}
          />
          <Textarea
            className="mt-2"
            value={body}
            hangulFix
            onChange={(e) => setBody(e.target.value)}
            placeholder="한 줄 후기 (선택)"
            aria-label="후기"
            rows={2}
            maxLength={1000}
          />
          <Button variant="secondary" className="mt-2" onClick={save} loading={busy}>
            후기 올리기
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">방문 완료로 표시하면 후기를 쓸 수 있습니다.</p>
      )}

      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
    </div>
  );
}
