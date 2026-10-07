import { fetchDashboardData } from '@/app/actions/queries';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard | Alpha',
  description: 'Historical portfolio performance and analytics',
};

export default async function DashboardPage() {
  const initialData = await fetchDashboardData().catch(() => null);

  return <DashboardClient initialData={initialData} />;
}
