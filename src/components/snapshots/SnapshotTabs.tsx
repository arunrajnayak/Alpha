'use client';

import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import DailySnapshotTable from './DailySnapshotTable';
import WeeklySnapshotTable from './WeeklySnapshotTable';
import MonthlySnapshotTable from './MonthlySnapshotTable';
import { DailyPortfolioSnapshot, WeeklyPortfolioSnapshot, MonthlyPortfolioSnapshot } from '@prisma/client';

interface SnapshotTabsProps {
    dailySnapshots: DailyPortfolioSnapshot[];
    weeklySnapshots: WeeklyPortfolioSnapshot[];
    monthlySnapshots: MonthlyPortfolioSnapshot[];
    lockDate: string | null;
}

type ViewType = 'daily' | 'weekly' | 'monthly';

export default function SnapshotTabs({dailySnapshots, weeklySnapshots, monthlySnapshots, lockDate}: SnapshotTabsProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const currentView = (searchParams.get('view') as ViewType) || 'daily';

    const handleViewChange = (event: React.MouseEvent<HTMLElement>, newView: ViewType | null) => {
        if (newView !== null) {
            const params = new URLSearchParams(searchParams);
            params.set('view', newView);
            router.push(`${pathname}?${params.toString()}`);
        }
    };

    return (
        <Box sx={{ width: '100%' }}>
            <div className="flex justify-between items-center mb-4 overflow-x-auto pb-2">
                <h1 className="text-xl md:text-3xl font-bold">
                    <span className="gradient-text">Snapshots</span>
                </h1>
                <ToggleButtonGroup
                    value={currentView}
                    exclusive
                    onChange={handleViewChange}
                    aria-label="snapshot view"
                    size="medium"
                    sx={{
                        height: '40px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '50px',
                        '& .MuiToggleButton-root': {
                            color: '#9ca3af',
                            border: 'none',
                            textTransform: 'none',
                            px: 3,
                            fontSize: '0.875rem',
                            whiteSpace: 'nowrap',
                            borderRadius: 'inherit',
                            '&.Mui-selected': {
                                color: '#60a5fa',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                '&:hover': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                }
                            }
                        }
                    }}
                >
                    <ToggleButton value="daily">Daily</ToggleButton>
                    <ToggleButton value="weekly">Weekly</ToggleButton>
                    <ToggleButton value="monthly">Monthly</ToggleButton>
                </ToggleButtonGroup>
            </div>
            
            {currentView === 'daily' && <DailySnapshotTable snapshots={dailySnapshots} lockDate={lockDate} />}
            {currentView === 'weekly' && <WeeklySnapshotTable snapshots={weeklySnapshots} />}
            {currentView === 'monthly' && <MonthlySnapshotTable snapshots={monthlySnapshots} />}
        </Box>
    );
}
