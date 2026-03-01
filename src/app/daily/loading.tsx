import Skeleton from '@/components/ui/Skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';

export default function Loading() {
  return (
    <div style={{ padding: '2rem' }}>
      <Skeleton variant="text" className="w-64 h-10 mb-6" />
      <TableSkeleton rows={12} cols={8} />
    </div>
  );
}
