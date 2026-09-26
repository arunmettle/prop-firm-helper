import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useMe } from './lib/hooks';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { VerifyPage } from './pages/Verify';
import { DashboardPage } from './pages/Dashboard';

export function App() {
  const me = useMe();
  const loc = useLocation();
  if (loc.pathname === '/auth/verify') return <VerifyPage />;
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <LoginPage />;
  return (
    <Layout me={me.data}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
