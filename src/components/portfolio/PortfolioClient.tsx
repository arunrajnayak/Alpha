'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import HoldingsTable from './HoldingsTable';
import HistoricalHoldingsTable from './HistoricalHoldingsTable';
import RebalanceModal from './RebalanceModal';
import DematReconciliationModal from './DematReconciliationModal';
import StockChartModal from '@/components/chart/StockChartModal';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faScaleBalanced, faBuildingColumns } from '@fortawesome/free-solid-svg-icons';
import { 
    PortfolioHolding, 
    HistoricalHoldingData, 
    DematReconciliationResult, 
    BrokerCashMetrics 
} from '@/lib/types';
import { getDematReconciliationAction, getBrokerCashMetricsAction } from '@/app/actions/portfolio-sync';
import { formatCurrency } from '@/lib/format';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface PortfolioClientProps {
    currentHoldings: PortfolioHolding[];
    historicalHoldings: HistoricalHoldingData[];
    totalEquity?: number;
    privacyMode?: boolean;
}

export default function PortfolioClient({ 
    currentHoldings, 
    historicalHoldings,
    totalEquity,
    privacyMode = false
}: PortfolioClientProps) {
    const [view, setView] = useState<'current' | 'historical'>('current');
    const [rebalanceOpen, setRebalanceOpen] = useState(false);
    const [reconciliationOpen, setReconciliationOpen] = useState(false);
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

    // Demat Reconciliation & Cash State
    const [reconciliationData, setReconciliationData] = useState<DematReconciliationResult | null>(null);
    const [isLoadingReconciliation, setIsLoadingReconciliation] = useState(false);
    const [reconciliationError, setReconciliationError] = useState<string | null>(null);
    const [brokerCash, setBrokerCash] = useState<BrokerCashMetrics | null>(null);

    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const prevRebalanceParam = useRef<string | null>(null);

    const handleSymbolClick = useCallback((symbol: string) => {
        setSelectedSymbol(symbol);
    }, []);

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

    // Fetch Demat Reconciliation
    const fetchReconciliation = useCallback(async () => {
        setIsLoadingReconciliation(true);
        setReconciliationError(null);
        try {
            const res = await getDematReconciliationAction();
            if (res.success) {
                setReconciliationData(res.data);
            } else {
                setReconciliationError(res.error);
            }
        } catch (err) {
            setReconciliationError(err instanceof Error ? err.message : 'Failed to fetch reconciliation');
        } finally {
            setIsLoadingReconciliation(false);
        }
    }, []);

    // Fetch Broker Available Cash (Informational only — never factored into NAV or XIRR)
    const fetchBrokerCash = useCallback(async () => {
        try {
            const res = await getBrokerCashMetricsAction();
            if (res.success) {
                setBrokerCash(res.data);
            }
        } catch {
            // Silently ignore if Zerodha is not connected
        }
    }, []);

    // Initial background loads
    useEffect(() => {
        fetchBrokerCash();
        fetchReconciliation();
    }, [fetchBrokerCash, fetchReconciliation]);

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

    const summary = reconciliationData?.summary;
    const totalDiscrepancies = (summary?.discrepancyCount ?? 0) + (summary?.missingInAlphaCount ?? 0) + (summary?.missingInDematCount ?? 0);
    const hasDiscrepancy = totalDiscrepancies > 0;

    return (
        <div className="flex flex-col gap-4">

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <h1 className="text-xl md:text-3xl font-bold">
                        <span className="gradient-text">Portfolio</span>
                    </h1>

                    {/* Informational Available Cash Pill (Strictly informational: NEVER in NAV/XIRR) */}
                    {brokerCash && brokerCash.availableCash > 0 && (
                        <Box sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1,
                            bgcolor: 'rgba(30, 41, 59, 0.5)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '50px',
                            px: 2,
                            py: 0.6,
                            fontSize: '0.75rem',
                        }}>
                            <span className="text-gray-400">Available Cash:</span>
                            <span className="font-semibold text-emerald-400 font-mono">
                                {privacyMode ? '••••••' : formatCurrency(brokerCash.availableCash)}
                            </span>
                            <span className="text-[0.65rem] text-gray-500">(Zerodha)</span>
                        </Box>
                    )}
                </Box>
                
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    {view === 'current' && (
                        <>
                            {/* Reconcile Demat Button */}
                            <Button
                                variant="outlined"
                                onClick={() => {
                                    setReconciliationOpen(true);
                                    if (!reconciliationData) fetchReconciliation();
                                }}
                                startIcon={<FontAwesomeIcon icon={faBuildingColumns} />}
                                sx={{
                                    borderRadius: '50px',
                                    height: '40px',
                                    textTransform: 'none',
                                    px: 2.5,
                                    fontSize: '0.85rem',
                                    borderColor: hasDiscrepancy ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)',
                                    color: hasDiscrepancy ? '#f87171' : '#fbbf24',
                                    bgcolor: hasDiscrepancy ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                    '&:hover': {
                                        bgcolor: hasDiscrepancy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                        borderColor: hasDiscrepancy ? 'rgba(239, 68, 68, 0.6)' : 'rgba(245, 158, 11, 0.6)',
                                    }
                                }}
                            >
                                Reconcile Demat
                                {hasDiscrepancy && (
                                    <Box component="span" sx={{
                                        ml: 1,
                                        px: 1,
                                        py: 0.2,
                                        borderRadius: '10px',
                                        bgcolor: '#ef4444',
                                        color: '#fff',
                                        fontSize: '0.65rem',
                                        fontWeight: 700
                                    }}>
                                        {totalDiscrepancies}
                                    </Box>
                                )}
                            </Button>

                            {/* Rebalance Button */}
                            <Button
                                variant="contained"
                                className="btn-gradient"
                                onClick={() => setRebalanceOpen(true)}
                                startIcon={<FontAwesomeIcon icon={faScaleBalanced} />}
                                sx={{
                                    borderRadius: '50px',
                                    height: '40px',
                                    textTransform: 'none',
                                    px: 3,
                                    fontSize: '0.85rem',
                                    boxShadow: '0 0 15px rgba(99, 102, 241, 0.3)',
                                }}
                            >
                                Rebalance
                            </Button>
                        </>
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
                     <HoldingsTable holdings={currentHoldings} privacyMode={privacyMode} onSymbolClick={handleSymbolClick} />
                ) : (
                    <HistoricalHoldingsTable holdings={historicalHoldings} privacyMode={privacyMode} onSymbolClick={handleSymbolClick} />
                )}
            </section>

            {/* Demat Reconciliation Modal */}
            <DematReconciliationModal
                open={reconciliationOpen}
                onClose={() => setReconciliationOpen(false)}
                data={reconciliationData}
                isLoading={isLoadingReconciliation}
                error={reconciliationError}
                onRefresh={fetchReconciliation}
                privacyMode={privacyMode}
            />

            {/* Rebalance Modal */}
            <RebalanceModal
                open={rebalanceOpen}
                onClose={() => setRebalanceOpen(false)}
                currentHoldings={rebalanceSnapshot}
                totalEquity={rebalanceEquity}
                availableCash={brokerCash?.availableCash}
                onResetToLive={handleResetToLive}
            />

            <StockChartModal
                symbol={selectedSymbol}
                isOpen={!!selectedSymbol}
                onClose={() => setSelectedSymbol(null)}
                privacyMode={privacyMode}
            />
        </div>
    );
}
