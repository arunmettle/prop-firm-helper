import { Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { useActiveAccount } from '../components/AccountSwitcher';
import { Button, EmptyState, PageHeader, Spinner } from '../components/ui';

export function DashboardPage() {
  const { account, isLoading } = useActiveAccount();
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Dashboard" description="Where you stand today against your evaluation rules." />
      {!account && (
        <EmptyState
          icon={<Wallet className="size-5" />}
          title="Add your evaluation account"
          action={
            <Link to="/accounts/new">
              <Button variant="primary">Add account</Button>
            </Link>
          }
        >
          Start by entering your challenge rules. Every number in Cooldown is computed from them.
        </EmptyState>
      )}
    </>
  );
}
