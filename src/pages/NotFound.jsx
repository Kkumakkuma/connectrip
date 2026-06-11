import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import SEOHead from '../components/SEOHead';

const NotFound = () => {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-24">
      <SEOHead title="페이지를 찾을 수 없습니다 - ConnectTrip" robots="noindex, follow" />
      <div className="text-center max-w-md mx-auto">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Compass size={40} className="text-blue-500" />
        </div>
        <div className="text-6xl font-black text-blue-600 mb-3">404</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">페이지를 찾을 수 없습니다</h1>
        <p className="text-gray-500 mb-8">
          주소가 바뀌었거나 삭제된 페이지일 수 있어요.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-8 py-3 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700 transition-colors shadow-md"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </section>
  );
};

export default NotFound;
