


import { Suspense } from 'react';
import SnapshotTabs from '@/components/snapshots/SnapshotTabs';
import { getDailySnapshots, getWeeklySnapshots, getMonthlySnapshots } from '@/app/actions/snapshots';
import { getDataLockDate } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function SnapshotsPage() {
    // Parallel data fetching
    const [daily, weekly, monthly, lockDate] = await Promise.all([
        getDailySnapshots(),
        getWeeklySnapshots(),
        getMonthlySnapshots(),
        getDataLockDate()
    ]);

    return (
        <div className="animate-fade-in-up">

            <Suspense fallback={<div>Loading...</div>}>
                <SnapshotTabs 
                    dailySnapshots={daily}
                    weeklySnapshots={weekly}
                    monthlySnapshots={monthly}
                    lockDate={lockDate?.toISOString() || null}
                />
            </Suspense>
        </div>
    );
}
