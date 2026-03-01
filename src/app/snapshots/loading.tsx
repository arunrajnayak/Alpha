import Skeleton from '@/components/ui/Skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { Box } from '@mui/material';

export default function Loading() {
  return (
    <Box sx={{ width: '100%' }}>
        {/* Header and Toggle Buttons */}
        <div className="flex justify-between items-center mb-4">
            <Skeleton variant="text" className="w-32 md:w-64 h-8 md:h-10" />
            <div className="flex gap-1">
                <Skeleton className="w-16 md:w-20 h-8 md:h-10 rounded-lg" />
                <Skeleton className="w-16 md:w-20 h-8 md:h-10 rounded-lg" />
                <Skeleton className="w-16 md:w-20 h-8 md:h-10 rounded-lg" />
            </div>
        </div>
        
        {/* Table Skeleton */}
        <TableSkeleton rows={15} cols={9} className="h-[calc(100vh-180px)] overflow-hidden" showHeader={true} />
    </Box>
  );
}
