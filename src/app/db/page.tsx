import { getDatabaseModels } from '@/app/actions/db';
import DatabaseViewer from './DatabaseViewer';

export const dynamic = 'force-dynamic';

export default async function DatabasePage() {
  const models = await getDatabaseModels();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-xl md:text-3xl font-bold mb-8 text-white">Database Viewer</h1>
      <DatabaseViewer models={models} />
    </div>
  );
}
