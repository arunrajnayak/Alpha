'use client';

import { useMemo, useCallback, useSyncExternalStore } from 'react';
import { useLiveData, ConnectionError } from '@/context/LiveDataContext';
import { Snackbar, Alert, Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LoginIcon from '@mui/icons-material/Login';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSearchParams, useRouter } from 'next/navigation';

// Simple external store for tracking if auth was handled
let authHandled = false;
const listeners = new Set<() => void>();

function subscribeToAuthHandled(callback: () => void) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

function getAuthHandled() {
    return authHandled;
}

function setAuthHandled(value: boolean) {
    authHandled = value;
    listeners.forEach(l => l());
}

export default function ConnectionErrorToast() {
    const { connectionError, clearConnectionError, refresh } = useLiveData();
    const searchParams = useSearchParams();
    const router = useRouter();

    // Use external store for auth handled state
    const hasHandledAuth = useSyncExternalStore(subscribeToAuthHandled, getAuthHandled, getAuthHandled);

    // Get URL params
    const authError = searchParams.get('auth_error');
    const authSuccess = searchParams.get('auth_success');

    // Memoize the error from URL params
    const urlError = useMemo((): ConnectionError | null => {
        if (authError) {
            return {
                type: 'token',
                message: decodeURIComponent(authError),
                timestamp: new Date(),
            };
        }
        return null;
    }, [authError]);

    // Derive current error - URL error takes precedence
    const currentError: ConnectionError | null = urlError || connectionError;

    // Derive open states
    const isErrorOpen = !!currentError;
    const isSuccessOpen = authSuccess === 'true' && !hasHandledAuth;

    const handleClose = useCallback((_event?: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') return;
        clearConnectionError();
        if (authError) {
            router.replace('/', { scroll: false });
        }
    }, [clearConnectionError, authError, router]);

    const handleSuccessClose = useCallback(() => {
        setAuthHandled(true);
        clearConnectionError();
        router.replace('/', { scroll: false });
        refresh();
    }, [clearConnectionError, router, refresh]);

    const handleLogin = useCallback(() => {
        window.location.href = '/api/upstox/login';
    }, []);

    const handleRetry = useCallback(() => {
        clearConnectionError();
        refresh();
    }, [clearConnectionError, refresh]);

    // Success toast
    if (isSuccessOpen) {
        return (
            <Snackbar
                open={true}
                autoHideDuration={5000}
                onClose={handleSuccessClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={handleSuccessClose}
                    severity="success"
                    variant="filled"
                    sx={{
                        backgroundColor: '#059669',
                        '& .MuiAlert-icon': { color: 'white' },
                    }}
                >
                    Successfully connected to Upstox!
                </Alert>
            </Snackbar>
        );
    }

    // Error toast
    if (!isErrorOpen || !currentError) return null;

    const isTokenError = currentError.type === 'token';
    const errorTitle = isTokenError 
        ? 'Upstox Connection Required' 
        : 'Connection Error';

    return (
        <Snackbar
            open={true}
            autoHideDuration={isTokenError ? null : 10000}
            onClose={handleClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
            <Alert
                severity="warning"
                variant="filled"
                sx={{
                    width: '100%',
                    maxWidth: '500px',
                    backgroundColor: isTokenError ? '#b45309' : '#dc2626',
                    '& .MuiAlert-icon': { color: 'white' },
                    '& .MuiAlert-message': { width: '100%' },
                }}
                action={
                    <IconButton
                        size="small"
                        aria-label="close"
                        color="inherit"
                        onClick={handleClose}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                }
            >
                <div className="flex flex-col gap-2">
                    <div className="font-semibold">{errorTitle}</div>
                    <div className="text-sm opacity-90">
                        {isTokenError 
                            ? 'Login to Upstox to enable real-time market data and streaming prices.'
                            : currentError.message
                        }
                    </div>
                    <div className="flex gap-2 mt-1">
                        {isTokenError ? (
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={<LoginIcon />}
                                onClick={handleLogin}
                                sx={{
                                    backgroundColor: 'white',
                                    color: '#b45309',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    '&:hover': {
                                        backgroundColor: '#f3f4f6',
                                    },
                                }}
                            >
                                Login to Upstox
                            </Button>
                        ) : (
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<RefreshIcon />}
                                onClick={handleRetry}
                                sx={{
                                    borderColor: 'white',
                                    color: 'white',
                                    textTransform: 'none',
                                    '&:hover': {
                                        borderColor: 'white',
                                        backgroundColor: 'rgba(255,255,255,0.1)',
                                    },
                                }}
                            >
                                Retry
                            </Button>
                        )}
                    </div>
                </div>
            </Alert>
        </Snackbar>
    );
}
