import { getLiveDashboardData } from '@/app/actions/live';
import LivePageClient from './LivePageClient';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const initialData = await getLiveDashboardData().catch(() => null);

  return <LivePageClient initialData={initialData} />;
}
