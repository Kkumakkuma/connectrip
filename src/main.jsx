import { createRoot } from 'react-dom/client'
import { Component } from 'react'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { initAnalytics } from './lib/analytics.js'
import { startKeepMiddot } from './lib/keepMiddot.js'

// 웹에서만 gtag 스크립트를 주입한다(앱은 무동작). /app-identity 로 처음 열린 문서는 끝까지 넣지 않고, 본인확인 복귀 주소
// (flow=identity·ds)로 열리면 여기서는 미룬다 — 화면이 주소를 정리한 뒤 AnalyticsTracker 가 넣는다(2026-10-02 PASS 결속 C1).
initAnalytics()

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('React Error Boundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h1 style={{ color: '#e53e3e', marginBottom: '16px' }}>Something went wrong</h1>
          <p style={{ color: '#666', marginBottom: '16px' }}>{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            className="btn-air-primary"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>
)

// 줄이 가운뎃점(·)으로 시작하지 않게 — 화면 글자의 '·' 앞에 보이지 않는 이음 문자를 넣는다(lib/keepMiddot.js)
startKeepMiddot()
