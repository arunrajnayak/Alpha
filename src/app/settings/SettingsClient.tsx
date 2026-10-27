'use client';

import { useState, useEffect, useCallback } from 'react';
import { faStore, faBolt, faKey } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    Paper, Button, TextField, Snackbar, Alert, CircularProgress, Switch, Chip
} from '@mui/material';
import { SettingsSection } from './SettingsLayout';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { initializeJob, triggerRecalculatePortfolio } from '@/app/actions';
import { setDataLockDate } from '@/app/actions/settings';
import { refreshSectorMappings } from '@/app/actions/sectors';
import { 
    getUpstoxTokenStatus, 
    getZerodhaSessionStatus, 
    disconnectZerodhaSession, 
    syncZerodhaOrdersNow 
} from '@/app/actions/auth';
import type { ZerodhaTokenStatus } from '@/lib/kite-client';
import { useLiveData } from '@/context/LiveDataContext';
import DataFreshnessCard from './DataFreshnessCard';
import type { LastCronRun } from '@/app/actions/screener';

interface FreshnessData {
    latestPriceDate: string | null;
    priceCount: number;
    latestRankDate: { filtered: string | null; all: string | null };
    rankCount: { filtered: number; all: number };
    totalPriceDates: number;
    totalRankDates: number;
    lastCronRun: LastCronRun | null;
}

export default function SettingsClient({
    initialDataLockDate,
    freshness,
}: {
    initialDataLockDate: string | null;
    freshness: FreshnessData | null;
}) {
    // --- Common State ---
    const [recalcJobId, setRecalcJobId] = useState<string | null>(null);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ 
        open: false, message: '', severity: 'success' 
    });

    // --- Data Lock State ---
    const [dataLockDate, setDataLockDateState] = useState<string>(initialDataLockDate || '');
    const [isSavingLock, setIsSavingLock] = useState(false);

    // --- Sector Refresh State ---
    const [isRefreshingSectors, setIsRefreshingSectors] = useState(false);
    const [sectorCount, setSectorCount] = useState<number | null>(null);

    // --- Streaming State ---
    const { streamingEnabled, setStreamingEnabled, streamStatus, isStreaming } = useLiveData();

    // --- Upstox Authentication State ---
    const [tokenStatus, setTokenStatus] = useState<{
        hasToken: boolean;
        isAnalyticsToken: boolean;
        expiresAt: Date | null;
        hoursRemaining: number | null;
        isExpiringSoon: boolean;
        statusMessage: string;
    } | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(true);

    // --- Zerodha Authentication State ---
    const [zerodhaStatus, setZerodhaStatus] = useState<ZerodhaTokenStatus | null>(null);
    const [isLoadingZerodha, setIsLoadingZerodha] = useState(true);
    const [isSyncingOrders, setIsSyncingOrders] = useState(false);
    const [isDisconnectingZerodha, setIsDisconnectingZerodha] = useState(false);

    // Fetch Upstox token status on mount
    const fetchTokenStatus = useCallback(async () => {
        try {
            const status = await getUpstoxTokenStatus();
            setTokenStatus(status);
        } catch (error) {
            console.error('Failed to fetch Upstox token status:', error);
        } finally {
            setIsLoadingToken(false);
        }
    }, []);

    // Fetch Zerodha token status on mount
    const fetchZerodhaStatus = useCallback(async () => {
        try {
            const status = await getZerodhaSessionStatus();
            setZerodhaStatus(status);
        } catch (error) {
            console.error('Failed to fetch Zerodha token status:', error);
        } finally {
            setIsLoadingZerodha(false);
        }
    }, []);

    useEffect(() => {
        fetchTokenStatus();
        fetchZerodhaStatus();

        // Check URL params for Zerodha redirect feedback
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('zerodha_connected') === 'true') {
                const user = params.get('zerodha_user') || 'account';
                setSnackbar({ open: true, message: `Connected to Zerodha (${user}) successfully!`, severity: 'success' });
                window.history.replaceState({}, '', window.location.pathname);
            } else if (params.get('zerodha_error')) {
                setSnackbar({ open: true, message: `Zerodha Error: ${params.get('zerodha_error')}`, severity: 'error' });
                window.history.replaceState({}, '', window.location.pathname);
            }
        }

        const interval = setInterval(() => {
            fetchTokenStatus();
            fetchZerodhaStatus();
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchTokenStatus, fetchZerodhaStatus]);

    // --- Handlers ---
    const handleRecomputeSnapshots = async () => {
        if (recalcJobId) return;

        try {
            const id = await initializeJob('RECALCULATE');
            setRecalcJobId(id);
            setSnackbar({ open: true, message: 'Recalculation started...', severity: 'info' });
            
            await triggerRecalculatePortfolio(id);
            setSnackbar({ open: true, message: 'Snapshots recomputed successfully!', severity: 'success' });
        } catch (e) {
            setSnackbar({ open: true, message: 'Error: ' + (e as Error).message, severity: 'error' });
        }
    };

    const handleSaveDataLock = async () => {
        setIsSavingLock(true);
        try {
            await setDataLockDate(dataLockDate || null);
            setSnackbar({ open: true, message: dataLockDate ? `Data locked until ${dataLockDate}` : 'Data lock removed', severity: 'success' });
        } catch (e) {
            setSnackbar({ open: true, message: 'Error: ' + (e as Error).message, severity: 'error' });
        } finally {
            setIsSavingLock(false);
        }
    };

    const handleRefreshSectors = async () => {
        setIsRefreshingSectors(true);
        setSnackbar({ open: true, message: 'Refreshing sector data from Zerodha...', severity: 'info' });
        try {
            const result = await refreshSectorMappings();
            if (result.success) {
                setSectorCount(result.count);
                setSnackbar({ open: true, message: `Sector data refreshed! ${result.count} stocks mapped.`, severity: 'success' });
            } else {
                setSnackbar({ open: true, message: 'Error: ' + result.error, severity: 'error' });
            }
        } finally {
            setIsRefreshingSectors(false);
        }
    };

    const handleDisconnectZerodha = async () => {
        setIsDisconnectingZerodha(true);
        try {
            await disconnectZerodhaSession();
            await fetchZerodhaStatus();
            setSnackbar({ open: true, message: 'Zerodha session disconnected.', severity: 'info' });
        } catch (e) {
            setSnackbar({ open: true, message: 'Error disconnecting Zerodha: ' + (e as Error).message, severity: 'error' });
        } finally {
            setIsDisconnectingZerodha(false);
        }
    };

    const handleSyncOrdersNow = async () => {
        if (isSyncingOrders) return;
        setIsSyncingOrders(true);
        setSnackbar({ open: true, message: 'Fetching today\'s executed orders from Zerodha...', severity: 'info' });
        try {
            const result = await syncZerodhaOrdersNow();
            if (result.success) {
                setSnackbar({ open: true, message: result.message, severity: 'success' });
            } else {
                setSnackbar({ open: true, message: `Sync failed: ${result.message}`, severity: 'error' });
            }
        } catch (e) {
            setSnackbar({ open: true, message: 'Sync error: ' + (e as Error).message, severity: 'error' });
        } finally {
            setIsSyncingOrders(false);
        }
    };

    return (
        <>
            {/* Broker Integrations: Upstox & Zerodha */}
            <SettingsSection className="mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Upstox Card */}
                    <Paper className="glass-card p-4 flex flex-col justify-between" sx={{ 
                        backgroundColor: 'rgba(30, 41, 59, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
                    }}>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm text-gray-200 font-bold flex items-center gap-2">
                                    <span className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400">
                                        <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5" />
                                    </span>
                                    Upstox (Market Data)
                                </h2>
                                {isLoadingToken ? (
                                    <CircularProgress size={14} sx={{ color: '#94a3b8' }} />
                                ) : (
                                    <Chip
                                        label={tokenStatus?.hasToken ? 'Connected' : 'Disconnected'}
                                        size="small"
                                        sx={{
                                            backgroundColor: tokenStatus?.hasToken 
                                                ? (tokenStatus.isExpiringSoon ? 'rgba(251, 191, 36, 0.1)' : 'rgba(34, 197, 94, 0.1)')
                                                : 'rgba(239, 68, 68, 0.1)',
                                            color: tokenStatus?.hasToken 
                                                ? (tokenStatus.isExpiringSoon ? '#fbbf24' : '#22c55e')
                                                : '#ef4444',
                                            border: `1px solid ${tokenStatus?.hasToken 
                                                ? (tokenStatus.isExpiringSoon ? 'rgba(251, 191, 36, 0.2)' : 'rgba(34, 197, 94, 0.2)')
                                                : 'rgba(239, 68, 68, 0.2)'}`,
                                            fontWeight: 600,
                                            fontSize: '0.65rem',
                                            height: '22px'
                                        }}
                                    />
                                )}
                            </div>

                            {/* Token Status Bar */}
                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            !tokenStatus?.hasToken ? 'bg-red-500' :
                                            tokenStatus.isExpiringSoon ? 'bg-amber-500' : 'bg-green-500'
                                        }`}
                                        style={{ width: tokenStatus?.hasToken
                                            ? (tokenStatus.isAnalyticsToken
                                                ? '100%'
                                                : tokenStatus.hoursRemaining !== null
                                                    ? `${Math.min(100, (tokenStatus.hoursRemaining / 24) * 100)}%`
                                                    : '0%')
                                            : '0%'
                                        }}
                                    />
                                </div>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                    {tokenStatus?.hasToken
                                        ? (tokenStatus.isAnalyticsToken
                                            ? 'Analytics Token (1-yr)'
                                            : tokenStatus.hoursRemaining !== null
                                                ? `${tokenStatus.hoursRemaining.toFixed(1)}h left`
                                                : 'Connected')
                                        : 'No token'}
                                </span>
                            </div>
                            <p className="text-xs text-gray-400">
                                Powers real-time websocket price streams and screener historical candles.
                            </p>
                        </div>
                    </Paper>

                    {/* Zerodha Kite Card */}
                    <Paper className="glass-card p-4 flex flex-col justify-between" sx={{ 
                        backgroundColor: 'rgba(30, 41, 59, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
                    }}>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm text-gray-200 font-bold flex items-center gap-2">
                                    <span className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400">
                                        <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5" />
                                    </span>
                                    Zerodha Kite (Execution)
                                </h2>
                                {isLoadingZerodha ? (
                                    <CircularProgress size={14} sx={{ color: '#94a3b8' }} />
                                ) : (
                                    <Chip
                                        label={zerodhaStatus?.hasToken ? 'Connected' : 'Disconnected'}
                                        size="small"
                                        sx={{
                                            backgroundColor: zerodhaStatus?.hasToken 
                                                ? (zerodhaStatus.isExpiringSoon ? 'rgba(251, 191, 36, 0.1)' : 'rgba(34, 197, 94, 0.1)')
                                                : 'rgba(239, 68, 68, 0.1)',
                                            color: zerodhaStatus?.hasToken 
                                                ? (zerodhaStatus.isExpiringSoon ? '#fbbf24' : '#22c55e')
                                                : '#ef4444',
                                            border: `1px solid ${zerodhaStatus?.hasToken 
                                                ? (zerodhaStatus.isExpiringSoon ? 'rgba(251, 191, 36, 0.2)' : 'rgba(34, 197, 94, 0.2)')
                                                : 'rgba(239, 68, 68, 0.2)'}`,
                                            fontWeight: 600,
                                            fontSize: '0.65rem',
                                            height: '22px'
                                        }}
                                    />
                                )}
                            </div>

                            {/* Token Status Bar */}
                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            !zerodhaStatus?.hasToken ? 'bg-red-500' :
                                            zerodhaStatus.isExpiringSoon ? 'bg-amber-500' : 'bg-green-500'
                                        }`}
                                        style={{ width: zerodhaStatus?.hasToken
                                            ? zerodhaStatus.hoursRemaining !== null
                                                ? `${Math.min(100, (zerodhaStatus.hoursRemaining / 24) * 100)}%`
                                                : '100%'
                                            : '0%'
                                        }}
                                    />
                                </div>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                    {zerodhaStatus?.hasToken
                                        ? zerodhaStatus.hoursRemaining !== null
                                            ? `${zerodhaStatus.hoursRemaining.toFixed(1)}h left`
                                            : 'Connected'
                                        : 'Disconnected'}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                                <p className="text-xs text-gray-400">
                                    {zerodhaStatus?.hasToken 
                                        ? `User: ${zerodhaStatus.userName || zerodhaStatus.userId}`
                                        : 'Connect Kite session for daily order & trade sync.'}
                                </p>

                                <div className="flex items-center gap-2">
                                    {zerodhaStatus?.hasToken ? (
                                        <>
                                            <Button
                                                variant="contained"
                                                size="small"
                                                onClick={handleSyncOrdersNow}
                                                disabled={isSyncingOrders}
                                                startIcon={isSyncingOrders ? <CircularProgress size={12} color="inherit" /> : <SyncIcon fontSize="small" />}
                                                className="btn-gradient"
                                                sx={{ textTransform: 'none', height: '28px', fontSize: '0.75rem', px: 1.5 }}
                                            >
                                                {isSyncingOrders ? 'Syncing...' : 'Sync Orders'}
                                            </Button>
                                            <Button
                                                variant="text"
                                                size="small"
                                                onClick={handleDisconnectZerodha}
                                                disabled={isDisconnectingZerodha}
                                                sx={{ color: '#f87171', height: '28px', fontSize: '0.75rem', minWidth: 'auto', px: 1 }}
                                            >
                                                Disconnect
                                            </Button>
                                        </>
                                    ) : zerodhaStatus?.loginUrl ? (
                                        <Button
                                            variant="contained"
                                            size="small"
                                            component="a"
                                            href={zerodhaStatus.loginUrl}
                                            endIcon={<OpenInNewIcon fontSize="small" />}
                                            sx={{ 
                                                textTransform: 'none', 
                                                height: '28px', 
                                                fontSize: '0.75rem',
                                                backgroundColor: '#f59e0b',
                                                '&:hover': { backgroundColor: '#d97706' }
                                            }}
                                        >
                                            Connect Zerodha
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-amber-400/80">Configure ZERODHA_API_KEY</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Paper>
                </div>
            </SettingsSection>

            {/* System Preferences + Data Freshness (8/4 split on lg) */}
            <SettingsSection className="mb-6">
              <div className="grid grid-cols-12 gap-4">
                {/* System Preferences — left 8 cols */}
                <div className="col-span-12 lg:col-span-8">
                <Paper className="glass-card p-4 sm:p-6 h-full" sx={{
                    backgroundColor: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
                }}>
                     <div className="flex flex-col gap-4">
                         <div>
                            <h2 className="text-base text-gray-200 font-bold flex items-center gap-2">
                                <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                                    <FontAwesomeIcon icon={faStore} className="w-3.5 h-3.5" />
                                </span>
                                System Preferences
                            </h2>
                        </div>

                        {/* Real-time Streaming Setting */}
                        <div className="flex flex-row items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-white/5 gap-3">
                            <div className="flex-1">
                                <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2">
                                    <FontAwesomeIcon icon={faBolt} className="text-yellow-400 w-3 h-3" />
                                    Real-time Streaming
                                </h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className={`w-1.5 h-1.5 rounded-full ${
                                        isStreaming ? 'bg-green-500 animate-pulse' : 
                                        streamStatus === 'connecting' || streamStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
                                        streamStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'
                                    }`}></div>
                                    <span className="text-xs text-gray-400">
                                        {isStreaming ? 'Connected' : 
                                         streamStatus === 'connecting' ? 'Connecting...' :
                                         streamStatus === 'reconnecting' ? 'Reconnecting...' :
                                         streamStatus === 'error' ? 'Error - polling fallback' :
                                         streamingEnabled ? 'Disconnected' : 'Polling (30s)'}
                                    </span>
                                </div>
                            </div>
                            <Switch
                                checked={streamingEnabled}
                                onChange={(e) => setStreamingEnabled(e.target.checked)}
                                size="small"
                                sx={{
                                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#22c55e' },
                                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#22c55e' },
                                }}
                            />
                        </div>

                        {/* Data Lock Setting */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-white/5 gap-3">
                             <div>
                                <h3 className="text-sm font-medium text-gray-200">Data Lock</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Prevent changes to historical data up to this date.</p>
                            </div>
                            <div className="flex gap-2 items-center flex-wrap">
                                 <TextField
                                     size="small"
                                     type="date"
                                     value={dataLockDate}
                                     onChange={(e) => setDataLockDateState(e.target.value)}
                                     sx={{ 
                                         minWidth: '140px',
                                         '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                         '& .MuiInputBase-input': { py: '6px' }
                                     }}
                                     slotProps={{
                                         input: { sx: { color: 'white', fontSize: '0.8rem' } },
                                         inputLabel: { shrink: true, sx: { color: '#94a3b8' } }
                                     }} />
                                 <Button
                                    variant="contained"
                                    onClick={handleSaveDataLock}
                                    disabled={isSavingLock}
                                    size="small"
                                    className="btn-gradient"
                                    sx={{ textTransform: 'none', height: '32px', minWidth: '60px' }}
                                >
                                    Save
                                </Button>
                                {dataLockDate && (
                                    <Button
                                        variant="text"
                                        size="small"
                                        onClick={() => { setDataLockDateState(''); handleSaveDataLock(); }}
                                        sx={{ color: '#f87171', minWidth: 'auto', px: 1, height: '32px' }}
                                    >
                                        Clear
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Recompute Snapshots Setting */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-white/5 gap-3">
                            <div>
                                <h3 className="text-sm font-medium text-gray-200">Recompute Snapshots</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Recalculate portfolio snapshots from trade history.</p>
                            </div>
                             <Button
                                variant="contained"
                                onClick={handleRecomputeSnapshots}
                                disabled={!!recalcJobId}
                                startIcon={!!recalcJobId ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon fontSize="small" />}
                                size="small"
                                className="btn-gradient"
                                sx={{ textTransform: 'none', height: '36px' }}
                            >
                                {!!recalcJobId ? 'Running...' : 'Recompute'}
                            </Button>
                        </div>

                        {/* Refresh Sectors Setting */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-white/5 gap-3">
                            <div>
                                <h3 className="text-sm font-medium text-gray-200">Refresh Sector Data</h3>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Fetch latest stock-to-sector mappings from Zerodha.
                                    {sectorCount !== null && <span className="text-amber-400"> ({sectorCount} stocks mapped)</span>}
                                </p>
                            </div>
                             <Button
                                variant="contained"
                                onClick={handleRefreshSectors}
                                disabled={isRefreshingSectors}
                                startIcon={isRefreshingSectors ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon fontSize="small" />}
                                size="small"
                                sx={{ textTransform: 'none', height: '36px', backgroundColor: '#f59e0b', '&:hover': { backgroundColor: '#d97706' } }}
                            >
                                {isRefreshingSectors ? 'Refreshing...' : 'Refresh Sectors'}
                            </Button>
                        </div>

                    </div>
                </Paper>
                </div>{/* end col-span-8 */}

                {/* Data Freshness — right 4 cols */}
                {freshness && (
                  <div className="col-span-12 lg:col-span-4">
                    <DataFreshnessCard freshness={freshness} />
                  </div>
                )}
              </div>
            </SettingsSection>
            {/* Snackbar for feedback */}
            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={4000} 
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert 
                    onClose={() => setSnackbar({ ...snackbar, open: false })} 
                    severity={snackbar.severity}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </>
    );
}
