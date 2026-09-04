import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Button from '../kit/Button';
import Card from '../kit/Card';
import Input from '../kit/Input';
import Select from '../kit/Select';
import { createTrip } from '../api';
import { daysBetween, todayISO } from '../lib/format';

// /planner/new — 이름·기간·통화·타임존을 받아 planner_create_trip 을 부른다.
// 생성이 끝나면 날짜 행까지 함께 만들어진 상태라 곧바로 일정판으로 넘긴다.

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

// IANA 이름. DB CHECK 가 'Area/City' 형태만 받는다.
const TIMEZONES = [
  { value: '', label: '선택 안 함' },
  { value: 'Asia/Seoul', label: '한국 표준시 (Asia/Seoul)' },
  { value: 'Asia/Tokyo', label: '일본 (Asia/Tokyo)' },
  { value: 'Asia/Shanghai', label: '중국 (Asia/Shanghai)' },
  { value: 'Asia/Hong_Kong', label: '홍콩 (Asia/Hong_Kong)' },
  { value: 'Asia/Taipei', label: '대만 (Asia/Taipei)' },
  { value: 'Asia/Bangkok', label: '태국 (Asia/Bangkok)' },
  { value: 'Asia/Ho_Chi_Minh', label: '베트남 (Asia/Ho_Chi_Minh)' },
  { value: 'Asia/Singapore', label: '싱가포르 (Asia/Singapore)' },
  { value: 'Asia/Manila', label: '필리핀 (Asia/Manila)' },
  { value: 'Asia/Kuala_Lumpur', label: '말레이시아 (Asia/Kuala_Lumpur)' },
  { value: 'Asia/Jakarta', label: '인도네시아 (Asia/Jakarta)' },
  { value: 'Asia/Dubai', label: '아랍에미리트 (Asia/Dubai)' },
  { value: 'Europe/London', label: '영국 (Europe/London)' },
  { value: 'Europe/Paris', label: '중부 유럽 (Europe/Paris)' },
  { value: 'America/New_York', label: '미국 동부 (America/New_York)' },
  { value: 'America/Los_Angeles', label: '미국 서부 (America/Los_Angeles)' },
  { value: 'Australia/Sydney', label: '호주 동부 (Australia/Sydney)' },
  { value: 'Pacific/Guam', label: '괌 (Pacific/Guam)' },
  { value: 'Pacific/Honolulu', label: '하와이 (Pacific/Honolulu)' },
];

const MAX_SPAN_DAYS = 60; // 여행 기간 상한 = 61일 (DB CHECK 와 같은 값)

export default function TripNew() {
  const navigate = useNavigate();
  const today = todayISO();

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [currency, setCurrency] = useState('KRW');
  const [timezone, setTimezone] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

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
        timezone: timezone || null,
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
      <p className="mb-5 text-sm text-muted">이름과 기간을 정하면 날짜별 일정판이 만들어집니다.</p>

      <Card className="p-5">
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            <Input
              label="여행 이름"
              value={title}
              maxLength={80}
              placeholder="예: 도쿄 가을 여행"
              error={errors.title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
              options={CURRENCIES}
              hint="예상 비용을 적을 때 쓰는 단위입니다."
              onChange={(e) => setCurrency(e.target.value)}
            />
            <Select
              label="타임존"
              value={timezone}
              options={TIMEZONES}
              hint="달력으로 내보낼 때 쓰입니다. 나중에 바꿀 수 있습니다."
              onChange={(e) => setTimezone(e.target.value)}
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
