import { Hammer } from 'lucide-react';
import Card from '../kit/Card';
import EmptyState from '../kit/EmptyState';

// 화면 뼈대만 잡아 둔 자리. 라우트·레이아웃·로그인 가드가 먼저 완성돼야
// 뒤이어 붙는 화면들이 같은 셸 위에서 자란다.
export default function Placeholder({ title, description }) {
  return (
    <section>
      <h1 className="mb-1 text-xl">{title}</h1>
      {description && <p className="mb-5 text-sm text-muted">{description}</p>}
      <Card>
        <EmptyState icon={Hammer} message="이 화면은 아직 준비 중입니다." />
      </Card>
    </section>
  );
}
