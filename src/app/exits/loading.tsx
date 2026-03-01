import Skeleton from '@/components/ui/Skeleton';
import TableSkeleton from '@/components/ui/TableSkeleton';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 max-w-7xl animate-pulse">
      {/* Top Section using Flex */}
      <div className="flex flex-col xl:flex-row justify-between items-end mb-6 gap-6">
           {/* Title and Filters */}
           <div className="flex flex-col gap-4 w-full xl:w-auto">
               <Skeleton variant="text" className="w-32 md:w-48 h-8 md:h-10" />
               <div className="flex flex-wrap gap-2">
                   {[...Array(5)].map((_, i) => (
                       <Skeleton key={i} className="w-14 md:w-16 h-8 rounded-lg" />
                   ))}
               </div>
           </div>
           
           {/* Stats Cards */}
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full xl:w-auto">
               {[...Array(4)].map((_, i) => (
                   <div key={i} className="min-w-[100px] h-[60px] bg-gray-800/50 rounded-lg border border-white/5" />
               ))}
           </div>
      </div>
      
      {/* Table Skeleton */}
      <TableSkeleton rows={15} cols={10} className="max-h-[calc(100vh-230px)]" />
    </div>
  );
}
