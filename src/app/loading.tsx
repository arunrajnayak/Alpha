import Skeleton from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-8 h-full pb-8 md:pb-0">
       {/* Header */}
       <div className="flex items-center gap-3">
          <Skeleton variant="text" className="w-32 md:w-48 h-8 md:h-10" />
          <Skeleton className="w-8 h-8 rounded-full" />
       </div>

       {/* Row 1: Big Cards (Value, NAV, DD) */}
       <div className="flex-none h-auto md:h-[240px]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 h-full">
             {[...Array(3)].map((_, i) => (
               <div key={i} className="glass-card p-6 flex flex-col justify-between h-[200px] md:h-full">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                        <Skeleton className="w-10 h-10 rounded-xl" />
                        <Skeleton variant="text" className="w-24" />
                    </div>
                    <Skeleton variant="text" className="w-32 md:w-40 h-8 md:h-10 mb-2" />
                    <Skeleton variant="text" className="w-24 md:w-32 h-4 md:h-5" />
                  </div>
                  <Skeleton className="w-full h-12 md:h-16 rounded opacity-20" />
               </div>
             ))}
          </div>
       </div>

       {/* Row 2: Secondary Stats */}
       <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-8 flex-none h-auto md:h-[180px] mb-2">
           {[...Array(4)].map((_, i) => (
             <div key={i} className="glass-card p-6 flex flex-col justify-between h-[160px] md:h-full">
                 <div className="flex items-center gap-3 mb-2">
                    <Skeleton className="w-10 h-10 rounded-xl" />
                    <Skeleton variant="text" className="w-20 md:w-24" />
                 </div>
                 <Skeleton variant="text" className="w-28 md:w-32 h-8 md:h-10" />
                 <div className="border-t border-gray-700/50 pt-3 flex flex-col gap-1">
                     <Skeleton variant="text" className="w-full h-3 md:h-4" />
                     <Skeleton variant="text" className="w-full h-3 md:h-4" />
                 </div>
             </div>
           ))}
       </div>

       {/* Row 3: Market Cap, Returns, Avg Gain/Loss */}
       <div className="grid grid-cols-1 md:grid-cols-8 gap-4 md:gap-8 flex-none h-auto md:h-[200px]">
           {/* Market Cap (Span 3) */}
           <div className="col-span-1 md:col-span-3 h-[240px] md:h-full glass-card p-6 flex flex-col">
               <div className="flex items-center gap-3 mb-4">
                   <Skeleton className="w-10 h-10 rounded-xl" />
                   <Skeleton variant="text" className="w-24 md:w-32" />
               </div>
               <Skeleton className="w-full h-4 rounded-full mb-4" />
               <div className="grid grid-cols-4 gap-2">
                   {[...Array(4)].map((_, i) => (
                       <div key={i} className="flex flex-col items-center gap-1">
                           <Skeleton className="w-2 h-2 rounded-full" />
                           <Skeleton className="w-8 md:w-12 h-4 md:h-6" />
                           <Skeleton className="w-8 md:w-10 h-2 md:h-3" />
                       </div>
                   ))}
               </div>
           </div>

           {/* Returns (Span 3) */}
           <div className="col-span-1 md:col-span-3 h-[180px] md:h-full glass-card p-6 flex flex-col">
               <div className="flex items-center gap-3 mb-4">
                   <Skeleton className="w-10 h-10 rounded-xl" />
                   <Skeleton variant="text" className="w-24" />
               </div>
               <div className="grid grid-cols-4 gap-2 md:gap-4 flex-1 content-center">
                   {[...Array(4)].map((_, i) => (
                       <div key={i} className="flex flex-col items-center gap-2">
                           <Skeleton className="w-12 md:w-16 h-6 md:h-8" />
                           <Skeleton className="w-8 md:w-10 h-2 md:h-3" />
                       </div>
                   ))}
               </div>
           </div>

           {/* Avg Gain/Loss (Span 2) */}
           <div className="col-span-1 md:col-span-2 h-[160px] md:h-full glass-card p-6 flex flex-col">
               <div className="flex items-center gap-3 mb-4">
                   <Skeleton className="w-10 h-10 rounded-xl" />
                   <Skeleton variant="text" className="w-24" />
               </div>
               <div className="space-y-4">
                   {[...Array(2)].map((_, i) => (
                       <div key={i} className="flex justify-between items-center">
                           <Skeleton className="w-12 md:w-16 h-3 md:h-4" />
                           <Skeleton className="w-16 md:w-20 h-5 md:h-6" />
                       </div>
                   ))}
               </div>
           </div>
       </div>
    </div>
  );
}
