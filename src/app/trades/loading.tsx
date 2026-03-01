import Skeleton from '@/components/ui/Skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
        <Skeleton className="w-40 md:w-56 h-8 md:h-10 rounded-lg" />

        <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full md:w-auto">
          <Skeleton className="w-full md:w-80 h-10 rounded-xl" />
          <Skeleton className="w-32 md:w-64 h-10 rounded-xl hidden md:block" />
          <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
          <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
        </div>
      </div>

        {/* Table Skeleton */}
        <TableSkeleton rows={10} cols={9} />
    </div>
  );
}
