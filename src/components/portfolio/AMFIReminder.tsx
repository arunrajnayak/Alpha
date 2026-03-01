import { getCurrentAMFIPeriod, hasAMFIData } from '@/lib/amfi-service';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from 'next/link';
import UpdateIcon from '@mui/icons-material/Update';

export default async function AMFIReminder() {
    const currentPeriod = getCurrentAMFIPeriod();
    const hasCurrentData = await hasAMFIData(currentPeriod);

    if (hasCurrentData) return null;

    const periodLabel = `${currentPeriod.year} ${currentPeriod.halfYear}`;

    return (
        <Alert 
            severity="warning" 
            icon={<UpdateIcon />}
            sx={{ 
                mb: 4, 
                borderRadius: '1rem',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                '& .MuiAlert-icon': { color: '#f59e0b' }
            }}
        >
            <AlertTitle className="font-bold">AMFI Categorization Update Needed</AlertTitle>
            Data for <strong>{periodLabel}</strong> is missing. This might affect the accuracy of your market cap distribution.
            <div className="mt-2">
                <Link 
                    href="/settings" 
                    className="text-xs font-bold uppercase tracking-wider bg-amber-500/20 px-3 py-1 rounded-full hover:bg-amber-500/30 transition-colors inline-block"
                >
                    Upload Now
                </Link>
            </div>
        </Alert>
    );
}
