import Skeleton from '@/components/ui/Skeleton';
import { Paper } from '@mui/material';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-24 md:pb-8">
        {/* Header */}
        <div>
            <Skeleton variant="text" className="w-32 h-10 mb-2" />
        </div>

        {/* System Preferences Section (Always Expanded) */}
        <div>
            <Paper className="glass-card p-4 sm:p-6" sx={{ 
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
            }}>
                <div className="flex flex-col gap-6">
                    {/* Section Header */}
                    <div>
                        <Skeleton variant="text" className="w-48 h-8 rounded" />
                    </div>


                    {/* Row 1: Data Lock */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between bg-slate-900/40 p-4 rounded-xl border border-white/5 gap-4">
                        <div className="space-y-1">
                            <Skeleton variant="text" className="w-32 h-5" />
                            <Skeleton variant="text" className="w-56 h-3" />
                        </div>
                        <div className="flex gap-3">
                            <Skeleton className="w-full sm:w-40 h-10 rounded" />
                            <Skeleton className="w-16 h-10 rounded" />
                        </div>
                    </div>


                    {/* Row 2: Recompute */}
                    <div className="flex flex-col sm:flex-row items-center justify-between bg-slate-900/40 p-4 rounded-xl border border-white/5 gap-4">
                        <div className="space-y-1 w-full sm:w-auto">
                            <Skeleton variant="text" className="w-40 h-5" />
                            <Skeleton variant="text" className="w-72 h-3" />
                        </div>
                        <Skeleton className="w-full sm:w-36 h-10 rounded" />
                    </div>
                </div>
            </Paper>
        </div>

        {/* Other Sections (Collapsed Accordions) */}
        {/* Market Cap Definitions */}
        <div className="h-14 bg-slate-800/20 rounded-lg border border-white/5 flex items-center px-4">
             <Skeleton variant="text" className="w-56 h-6" />
        </div>

        {/* Symbol Renames */}
        <div className="h-14 bg-slate-800/20 rounded-lg border border-white/5 flex items-center px-4">
             <Skeleton variant="text" className="w-48 h-6" />
        </div>

        {/* Corporate Actions */}
        <div className="h-14 bg-slate-800/20 rounded-lg border border-white/5 flex items-center px-4">
             <Skeleton variant="text" className="w-52 h-6" />
        </div>
        
        {/* Import History */}
        <div className="h-14 bg-slate-800/20 rounded-lg border border-white/5 flex items-center px-4">
             <Skeleton variant="text" className="w-40 h-6" />
        </div>
    </div>
  );
}
