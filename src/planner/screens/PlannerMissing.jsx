import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Card from '../kit/Card';
import Button from '../kit/Button';
import EmptyState from '../kit/EmptyState';

// /planner 하위의 없는 주소. 커넥트립 전역 404 로 튕기지 않고 플래너 안에서 받는다.
export default function PlannerMissing() {
  return (
    <Card className="mx-auto max-w-md">
      <EmptyState
        icon={Compass}
        message="주소가 바뀌었거나 없는 화면입니다."
        action={(
          <Link to="/planner">
            <Button variant="secondary">내 여행 목록</Button>
          </Link>
        )}
      />
    </Card>
  );
}
