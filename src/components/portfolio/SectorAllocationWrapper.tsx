'use client';

import dynamic from 'next/dynamic';
import { SectorAllocation } from '@/lib/types';

interface WrapperProps {
    allocations: SectorAllocation[];
    privacyMode?: boolean;
}

const SectorAllocationChart = dynamic(() => import('./SectorAllocationChart'), {
  loading: () => <div className="h-full min-h-[300px] bg-slate-800/50 rounded-2xl animate-pulse" />,
  ssr: false
});

export default function SectorAllocationWrapper(props: WrapperProps) {
    return <SectorAllocationChart {...props} />;
}
