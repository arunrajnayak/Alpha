import Skeleton from '@/components/ui/Skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { Box } from '@mui/material';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
        <div className="flex flex-row justify-between items-center">
            {/* Title Skeleton */}
            <Skeleton variant="text" className="w-32 h-10" />

            {/* Toggle Buttons Skeleton */}
            <Box sx={{ display: 'flex' }}>
                <div className="flex gap-0">
                    <Skeleton className="w-[140px] h-9 rounded-l-full" />
                    <Skeleton className="w-[140px] h-9 rounded-r-full" />
                </div>
            </Box>
        </div>

        <div className="flex flex-col gap-6">
            {/* Table Skeleton */}
            <TableSkeleton rows={12} cols={7} />
        </div>
    </div>
  );
}
