import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useMe } from './lib/hooks';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { VerifyPage } from './pages/Verify';
import { DashboardPage } from './pages/Dashboard';
import { AccountsPage } from './pages/Accounts';
import { AccountFormPage } from './pages/AccountForm';
import { TradesPage } from './pages/Trades';
import { TradeFormPage } from './pages/TradeForm';
import { ImportPage } from './pages/Import';
import { AdminPage } from './pages/Admin';

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
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/trades/new" element={<TradeFormPage key="new" />} />
        <Route path="/trades/:id" element={<TradeFormPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/accounts/:id" element={<AccountFormPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
