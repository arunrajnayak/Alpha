'use client';

import { useState, useEffect, useRef } from 'react';
import HoldingsTable from './HoldingsTable';
import HistoricalHoldingsTable from './HistoricalHoldingsTable';
import RebalanceModal from './RebalanceModal';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faScaleBalanced } from '@fortawesome/free-solid-svg-icons';
import { PortfolioHolding, HistoricalHoldingData } from '@/lib/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface PortfolioClientProps {
    currentHoldings: PortfolioHolding[];
    historicalHoldings: HistoricalHoldingData[];
    totalEquity?: number;
}

export default function PortfolioClient({ 
    currentHoldings, 
    historicalHoldings,
    totalEquity 
}: PortfolioClientProps) {
    const [view, setView] = useState<'current' | 'historical'>('current');
    const [rebalanceOpen, setRebalanceOpen] = useState(false);
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const prevRebalanceParam = useRef<string | null>(null);

    // Calculate total equity if not provided
    const portfolioValue = totalEquity ?? currentHoldings.reduce(
        (sum, h) => sum + h.currentValue, 0
    );
    const [rebalanceSnapshot, setRebalanceSnapshot] = useState(currentHoldings);
    const [rebalanceEquity, setRebalanceEquity] = useState(portfolioValue);

    const handleViewChange = (
        event: React.MouseEvent<HTMLElement>,
        newView: 'current' | 'historical' | null,
    ) => {
        if (newView !== null) {
            setView(newView);
        }
    };

    // Freeze holdings used by rebalance while modal is open
    useEffect(() => {
        if (rebalanceOpen) return;
        setRebalanceSnapshot(currentHoldings);
        setRebalanceEquity(portfolioValue);
    }, [rebalanceOpen, currentHoldings, portfolioValue]);

    const handleResetToLive = () => {
        setRebalanceSnapshot(currentHoldings);
        setRebalanceEquity(portfolioValue);
        return { holdings: currentHoldings, totalEquity: portfolioValue };
    };

    // Deep link support: open rebalance when ?rebalance=1 appears
    useEffect(() => {
        const rebalanceParam = searchParams?.get('rebalance');
        if (rebalanceParam && rebalanceParam !== prevRebalanceParam.current) {
            setView('current');
            setRebalanceOpen(true);
        }
        prevRebalanceParam.current = rebalanceParam;
    }, [searchParams]);

    // Keep URL in sync with rebalance state for shareable deep links
    useEffect(() => {
        const params = new URLSearchParams(searchParams?.toString() ?? '');
        if (rebalanceOpen) {
            if (params.get('rebalance') !== '1') {
                params.set('rebalance', '1');
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }
        } else if (params.has('rebalance')) {
            params.delete('rebalance');
            const next = params.toString();
            router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
        }
    }, [rebalanceOpen, pathname, router, searchParams]);

    return (
        <div className="flex flex-col gap-4">

            <div className="flex flex-row justify-between items-center">
                <h1 className="text-xl md:text-3xl font-bold">
                    <span className="gradient-text">Portfolio</span>
                </h1>
                
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    {view === 'current' && (
                        <Button
                            variant="contained"
                            className="btn-gradient"
                            onClick={() => setRebalanceOpen(true)}
                            startIcon={<FontAwesomeIcon icon={faScaleBalanced} />}
                            sx={{
                                display: { xs: 'none', sm: 'flex' },
                                borderRadius: '50px',
                                height: '40px',
                                textTransform: 'none',
                                px: 3,
                                boxShadow: '0 0 15px rgba(99, 102, 241, 0.3)',
                            }}
                        >
                            Rebalance
                        </Button>
                    )}
                    
                    <ToggleButtonGroup
                        value={view}
                        exclusive
                        onChange={handleViewChange}
                        aria-label="portfolio view"
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
                        <ToggleButton value="current">
                            Current <span className="hidden sm:inline">&nbsp;Holdings</span>
                        </ToggleButton>
                        <ToggleButton value="historical">
                            Historical <span className="hidden sm:inline">&nbsp;Holdings</span>
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            </div>

            <section className="animate-fade-in-up">
                {view === 'current' ? (
                     <HoldingsTable holdings={currentHoldings} />
                ) : (
                    <HistoricalHoldingsTable holdings={historicalHoldings} />
                )}
            </section>

            <RebalanceModal
                open={rebalanceOpen}
                onClose={() => setRebalanceOpen(false)}
                currentHoldings={rebalanceSnapshot}
                totalEquity={rebalanceEquity}
                onResetToLive={handleResetToLive}
            />
        </div>
    );
}
