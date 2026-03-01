'use client';

import { useState, useEffect, useCallback } from 'react';
import { faStore, faBolt, faKey } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
    Paper, Button, TextField, Snackbar, Alert, CircularProgress, Switch, Chip
} from '@mui/material';
import { SettingsSection } from './SettingsLayout';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';

import { initializeJob, triggerRecalculatePortfolio } from '@/app/actions';
import { setDataLockDate } from '@/app/actions/settings';
import { refreshSectorMappings } from '@/app/actions/sectors';
import { getUpstoxTokenStatus, triggerPhoneAuth } from '@/app/actions/auth';
import { useLiveData } from '@/context/LiveDataContext';




// ... (other imports)

export default function SettingsClient({ 
    initialDataLockDate 
}: { 
    initialDataLockDate: string | null 
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

    // --- Authentication State ---
    const [tokenStatus, setTokenStatus] = useState<{
        hasToken: boolean;
        expiresAt: Date | null;
        hoursRemaining: number | null;
        isExpiringSoon: boolean;
        statusMessage: string;
    } | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(true);
    const [isTriggeringPhoneAuth, setIsTriggeringPhoneAuth] = useState(false);

    // Fetch token status on mount
    const fetchTokenStatus = useCallback(async () => {
        try {
            const status = await getUpstoxTokenStatus();
            setTokenStatus(status);
        } catch (error) {
            console.error('Failed to fetch token status:', error);
        } finally {
            setIsLoadingToken(false);
        }
    }, []);

    useEffect(() => {
        fetchTokenStatus();
        // Refresh token status every 5 minutes
        const interval = setInterval(fetchTokenStatus, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchTokenStatus]);

    const handleBrowserLogin = () => {
        window.open('/api/upstox/login', '_blank');
        // Start polling for token after browser login is initiated
        startTokenPolling();
    };

    // Poll for token status after auth is initiated
    const startTokenPolling = useCallback(() => {
        let attempts = 0;
        const maxAttempts = 60; // Poll for up to 5 minutes (60 * 5s)
        
        const pollInterval = setInterval(async () => {
            attempts++;
            try {
                const status = await getUpstoxTokenStatus();
                setTokenStatus(status);
                
                // Stop polling if token is obtained or max attempts reached
                if (status.hasToken || attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    if (status.hasToken) {
                        setSnackbar({
                            open: true,
                            message: 'Authentication successful! Token obtained.',
                            severity: 'success',
                        });
                    }
                }
            } catch (error) {
                console.error('Token polling error:', error);
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                }
            }
        }, 5000); // Poll every 5 seconds
        
        // Return cleanup function
        return () => clearInterval(pollInterval);
    }, []);

    const handlePhoneAuth = async () => {
        setIsTriggeringPhoneAuth(true);
        try {
            const result = await triggerPhoneAuth();
            setSnackbar({
                open: true,
                message: result.message,
                severity: result.success ? 'success' : 'error',
            });
            
            if (result.success) {
                // Start polling for token after phone auth is triggered
                startTokenPolling();
            }
        } catch (err) {
            console.error('Phone auth error:', err);
            setSnackbar({
                open: true,
                message: 'Failed to send phone notification',
                severity: 'error',
            });
        } finally {
            setIsTriggeringPhoneAuth(false);
        }
    };

    // --- Common Handlers ---
    const handleRecomputeSnapshots = async () => {
        if (recalcJobId) return; // Already running

        try {
            const id = await initializeJob('RECALCULATE');
            setRecalcJobId(id);
            setSnackbar({ open: true, message: 'Recalculation started...', severity: 'info' });
            
            // Trigger background calculation
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

    return (
        <>
            {/* Upstox Authentication Section */}
            <SettingsSection className="mb-6">
                <Paper className="glass-card p-4" sx={{ 
                    backgroundColor: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
                }}>
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base text-gray-200 font-bold flex items-center gap-2">
                                <span className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400">
                                    <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5" />
                                </span>
                                Upstox Authentication
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

                        {/* Progress Bar + Buttons in one row */}
                        <div className="flex items-center gap-6">
                            {/* Token Status Progress Bar */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all ${
                                            !tokenStatus?.hasToken ? 'bg-red-500' :
                                            tokenStatus.isExpiringSoon ? 'bg-amber-500' : 'bg-green-500'
                                        }`}
                                        style={{ width: tokenStatus?.hasToken && tokenStatus.hoursRemaining !== null 
                                            ? `${Math.min(100, (tokenStatus.hoursRemaining / 24) * 100)}%` 
                                            : '0%' 
                                        }}
                                    />
                                </div>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                    {tokenStatus?.hasToken && tokenStatus.hoursRemaining !== null 
                                        ? `${tokenStatus.hoursRemaining.toFixed(1)}h left`
                                        : 'No token'}
                                </span>
                            </div>

                            {/* Authentication Buttons */}
                            <div className="flex gap-2 shrink-0">
                                <Button
                                    variant="contained"
                                    onClick={handleBrowserLogin}
                                    size="small"
                                    startIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                                    sx={{ 
                                        textTransform: 'none', 
                                        height: '32px',
                                        minWidth: 'auto',
                                        px: 1.5,
                                        backgroundColor: '#6366f1',
                                        '&:hover': { backgroundColor: '#4f46e5' },
                                        fontSize: '0.75rem'
                                    }}
                                >
                                    Browser Login
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handlePhoneAuth}
                                    disabled={isTriggeringPhoneAuth}
                                    size="small"
                                    startIcon={isTriggeringPhoneAuth ? <CircularProgress size={12} color="inherit" /> : <PhoneAndroidIcon sx={{ fontSize: 14 }} />}
                                    sx={{ 
                                        textTransform: 'none', 
                                        height: '32px',
                                        minWidth: 'auto',
                                        px: 1.5,
                                        backgroundColor: '#10b981',
                                        '&:hover': { backgroundColor: '#059669' },
                                        fontSize: '0.75rem'
                                    }}
                                >
                                    {isTriggeringPhoneAuth ? 'Sending...' : 'Phone Auth'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Paper>
            </SettingsSection>

            {/* System Preferences Section */}
            <SettingsSection className="mb-6">
                <Paper className="glass-card p-4 sm:p-6" sx={{ 
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
                                    InputLabelProps={{ shrink: true, sx: { color: '#94a3b8' } }}
                                    InputProps={{ sx: { color: 'white', fontSize: '0.8rem' } }}
                                    sx={{ 
                                        minWidth: '140px',
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                        '& .MuiInputBase-input': { py: '6px' }
                                    }}
                                />
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

