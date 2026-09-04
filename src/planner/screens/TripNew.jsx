import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Search, X } from 'lucide-react';
import Button from '../kit/Button';
import Card from '../kit/Card';
import Input from '../kit/Input';
import Select from '../kit/Select';
import { createTrip } from '../api';
import { daysBetween, todayISO } from '../lib/format';
import { currencyOf, loadDestinations, searchDestinations } from '../lib/destinations';

// /planner/new — 어디로 가는지, 언제 가는지만 받는다.
//
// 첫 칸이 예전에는 "여행 이름"(자유 텍스트)이었다. 목적지를 물으면 세 가지가 한 번에 풀린다.
//   · 여행 이름을 대신 지어 준다 — 사용자가 칠 게 하나 줄어든다.
//   · 통화를 자동으로 고른다.
//   · 그 도시의 추천 명소를 일정판에 바로 깔 수 있다(빈 화면을 마주하지 않는다).
//
// 검색은 네트워크를 쓰지 않는다. 목적지 목록은 미리 만들어 둔 파일이다(lib/destinations.js).
// Nominatim 에 "도쿄"를 물으면 1등이 도쿄역, 3등이 두바이의 섬이라 쓸 수 없었다(2026-09-04 실측).
//
// 목적지는 건너뛸 수 있다. 목록에 없는 도시는 이름만 적고 만들면 되고, 장소는 검색으로 담는다.
// 타임존은 묻지 않는다 — 목적지나 담은 장소의 좌표에서 알아낸다(lib/timezone.js).

// DB CHECK 가 3자리 대문자만 받는다(currency ~ '^[A-Z]{3}$').
const CURRENCIES = [
  { value: 'KRW', label: 'KRW · 대한민국 원' },
  { value: 'JPY', label: 'JPY · 일본 엔' },
  { value: 'USD', label: 'USD · 미국 달러' },
  { value: 'EUR', label: 'EUR · 유로' },
  { value: 'THB', label: 'THB · 태국 바트' },
  { value: 'VND', label: 'VND · 베트남 동' },
  { value: 'TWD', label: 'TWD · 대만 달러' },
  { value: 'CNY', label: 'CNY · 중국 위안' },
  { value: 'HKD', label: 'HKD · 홍콩 달러' },
  { value: 'SGD', label: 'SGD · 싱가포르 달러' },
  { value: 'PHP', label: 'PHP · 필리핀 페소' },
  { value: 'MYR', label: 'MYR · 말레이시아 링깃' },
  { value: 'GBP', label: 'GBP · 영국 파운드' },
  { value: 'AUD', label: 'AUD · 호주 달러' },
];

const MAX_SPAN_DAYS = 60; // 여행 기간 상한 = 61일 (DB CHECK 와 같은 값)

// 목적지의 통화가 목록에 없으면 그 값을 한 줄 얹어 준다(예: MOP·IDR).
function currencyOptions(extra) {
  if (!extra || CURRENCIES.some((c) => c.value === extra)) return CURRENCIES;
  return [{ value: extra, label: extra }, ...CURRENCIES];
}

export default function TripNew() {
  const navigate = useNavigate();
  const today = todayISO();

  const [all, setAll] = useState([]);
  const [query, setQuery] = useState('');
  const [dest, setDest] = useState(null);
  const [openList, setOpenList] = useState(false);

  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [currency, setCurrency] = useState('KRW');
  // 사용자가 통화를 직접 골랐는지. 골랐다면 목적지를 바꿔도 덮지 않는다.
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadDestinations().then((rows) => {
      if (alive) setAll(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 바깥을 누르면 추천 목록을 닫는다.
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpenList(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(
    () => (openList && !dest ? searchDestinations(all, query) : []),
    [all, query, openList, dest],
  );

  const pick = (d) => {
    setDest(d);
    setQuery(d.ko);
    setOpenList(false);
    if (!currencyTouched) setCurrency(currencyOf(d));
    // 사용자가 직접 이름을 친 적이 있으면 덮어쓰지 않는다.
    if (!titleTouched) setTitle(`${d.ko} 여행`);
    setErrors((prev) => ({ ...prev, title: undefined }));
  };

  // 목적지 선택을 풀 때 자동으로 채워 넣었던 값만 되돌린다. 사용자가 직접 고친 값은 둔다.
  const resetAuto = () => {
    setDest(null);
    if (!titleTouched) setTitle('');
    if (!currencyTouched) setCurrency('KRW');
  };

  const clearDest = () => {
    resetAuto();
    setQuery('');
    setOpenList(false);
    setShowTitle(true);
  };

  const validate = () => {
    const next = {};
    const name = title.trim();
    if (name.length < 1) next.title = '여행 이름을 넣어 주세요.';
    else if (name.length > 80) next.title = '여행 이름은 80자까지 넣을 수 있습니다.';

    const span = daysBetween(startDate, endDate);
    if (span === null) next.endDate = '시작일과 종료일을 모두 골라 주세요.';
    else if (span < 0) next.endDate = '종료일이 시작일보다 빠릅니다.';
    else if (span > MAX_SPAN_DAYS) next.endDate = `기간은 최대 ${MAX_SPAN_DAYS + 1}일까지 만들 수 있습니다.`;

    setErrors(next);
    // 이름이 비어 있어서 막혔다면 이름 칸을 펼쳐 준다 — 안 보이는 칸의 오류는 못 고친다.
    if (next.title) setShowTitle(true);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!validate()) return;

    setSaving(true);
    try {
      const tripId = await createTrip({
        title: title.trim(),
        startDate,
        endDate,
        currency,
        country: dest?.country || null,
        destId: dest?.id || null,
        destName: dest?.ko || null,
        destLat: dest ? dest.lat : null,
        destLng: dest ? dest.lng : null,
      });
      navigate(`/planner/t/${tripId}`, { replace: true });
    } catch (err) {
      setErrors({ form: err.message });
      setSaving(false);
    }
  };

  // 시작일을 바꾸면 종료일이 그보다 앞설 수 없게 따라 옮긴다.
  const handleStartChange = (value) => {
    setStartDate(value);
    const span = daysBetween(value, endDate);
    if (span === null || span < 0) setEndDate(value);
  };

  return (
    <section className="mx-auto max-w-md">
      <Link
        to="/planner"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        내 여행
      </Link>
      <h1 className="mb-1 text-xl">여행 만들기</h1>
      <p className="mb-5 text-sm text-muted">어디로 언제 가는지만 정하면 일정판이 만들어집니다.</p>

      <Card className="p-5">
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            {/* 목적지 --------------------------------------------------- */}
            <div ref={boxRef} className="relative">
              <label htmlFor="dest-input" className="mb-1.5 block text-sm font-medium text-ink">
                어디로 가세요?
              </label>
              <div className="relative">
                <Search
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="dest-input"
                  value={query}
                  autoComplete="off"
                  placeholder="도시 이름 (예: 도쿄)"
                  className="h-11 w-full rounded-sm border border-hairline bg-canvas pl-9 pr-9 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // 고른 뒤 글자를 고치면 선택이 풀린다. 이때 자동으로 채웠던 값을 그대로 두면
                    // "목적지는 없는데 제목은 도쿄 여행, 통화는 엔"인 여행이 만들어진다.
                    if (dest) resetAuto();
                    setOpenList(true);
                  }}
                  onFocus={() => setOpenList(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // 폼이 먼저 제출되지 않게 막고, 후보가 하나면 그걸 고른다.
                      e.preventDefault();
                      if (matches.length > 0) pick(matches[0]);
                    } else if (e.key === 'Escape') {
                      setOpenList(false);
                    }
                  }}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="목적지 지우기"
                    onClick={clearDest}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted transition-colors hover:text-ink"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>

              {dest ? (
                <p className="mt-1.5 text-xs text-muted">
                  {dest.country} · 통화 {currencyOf(dest)}. 일정판에서 대표 명소를 바로 담을 수 있습니다.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted">
                  목록에 없는 도시라면 비워 두고 이름만 적어도 됩니다.
                </p>
              )}

              {matches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-hairline bg-canvas shadow-lg">
                  {matches.map((d) => (
                    <li key={d.id} className="border-t border-hairline first:border-t-0">
                      <button
                        type="button"
                        onClick={() => pick(d)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-soft"
                      >
                        <MapPin size={15} className="shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{d.ko}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {d.country} · {d.en}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 여행 이름 — 목적지를 고르면 자동으로 채워지므로 접어 둔다 -------- */}
            {showTitle || !dest ? (
              <Input
                label="여행 이름"
                value={title}
                maxLength={80}
                placeholder="예: 도쿄 가을 여행"
                error={errors.title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleTouched(true);
                }}
              />
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-sm border border-hairline px-3 py-2.5">
                <span className="min-w-0 truncate text-sm text-ink">{title}</span>
                <button
                  type="button"
                  onClick={() => setShowTitle(true)}
                  className="shrink-0 text-xs text-muted underline transition-colors hover:text-ink"
                >
                  이름 바꾸기
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="시작일"
                type="date"
                value={startDate}
                onChange={(e) => handleStartChange(e.target.value)}
              />
              <Input
                label="종료일"
                type="date"
                value={endDate}
                min={startDate}
                error={errors.endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Select
              label="통화"
              value={currency}
              options={currencyOptions(currency)}
              hint="예상 비용을 적을 때 쓰는 단위입니다."
              onChange={(e) => {
                setCurrency(e.target.value);
                setCurrencyTouched(true);
              }}
            />
          </div>

          {errors.form && (
            <p role="alert" className="mt-4 text-sm text-error">
              {errors.form}
            </p>
          )}

          <div className="mt-6 flex gap-2">
            {/* a 안에 button 을 넣으면 잘못된 마크업이라 키보드·보조기술 동작이 갈린다.
                화면 안 동작 버튼은 navigate 로 옮긴다. */}
            <Button
              variant="secondary"
              className="flex-1"
              disabled={saving}
              onClick={() => navigate('/planner')}
            >
              취소
            </Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>
              만들기
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
