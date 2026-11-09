'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFingerprint, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { useLiveData } from '@/context/LiveDataContext';

export default function BiometricSetupModal() {
  const {
    biometricModalOpen,
    closeBiometricModal,
    handleRegisterBiometric,
    handleUnlockWithoutBiometric,
  } = useLiveData();

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onRegister = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await handleRegisterBiometric();
      if (!res.success && !res.cancelled && res.error) {
        setErrorMessage(res.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const onUnlockWithout = () => {
    setErrorMessage(null);
    handleUnlockWithoutBiometric();
  };

  const handleClose = () => {
    if (loading) return;
    setErrorMessage(null);
    closeBiometricModal();
  };

  return (
    <Dialog
      open={biometricModalOpen}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '16px',
            p: 1,
            color: '#f9fafb',
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-400 flex items-center justify-center border border-violet-500/30">
          <FontAwesomeIcon icon={faFingerprint} className="w-5 h-5" />
        </div>
        <div>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'white' }}>
            Set Up Fingerprint Unlock
          </Typography>
          <Typography variant="caption" sx={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FontAwesomeIcon icon={faShieldHalved} className="w-3 h-3 text-emerald-400" />
            Desktop Privacy Protection
          </Typography>
        </div>
      </DialogTitle>

      <DialogContent sx={{ py: 2 }}>
        <Typography variant="body2" sx={{ color: '#cbd5e1', lineHeight: 1.6 }}>
          Touch ID / Windows Hello is available on this computer. Register your fingerprint to securely protect turning off Privacy Mode and unmasking portfolio values.
        </Typography>

        {errorMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {errorMessage}
          </div>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button
          variant="contained"
          fullWidth
          onClick={onRegister}
          disabled={loading}
          sx={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
            color: 'white',
            fontWeight: 600,
            py: 1,
            textTransform: 'none',
            borderRadius: '10px',
            '&:hover': {
              background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
            },
          }}
        >
          {loading ? (
            <CircularProgress size={18} sx={{ color: 'white' }} />
          ) : (
            'Register Fingerprint & Unlock'
          )}
        </Button>

        <div className="flex w-full gap-2 mt-1">
          <Button
            variant="text"
            fullWidth
            onClick={onUnlockWithout}
            disabled={loading}
            sx={{
              color: '#94a3b8',
              fontSize: '0.75rem',
              textTransform: 'none',
              '&:hover': { color: '#e2e8f0' },
            }}
          >
            Unlock Without Fingerprint
          </Button>

          <Button
            variant="text"
            fullWidth
            onClick={handleClose}
            disabled={loading}
            sx={{
              color: '#64748b',
              fontSize: '0.75rem',
              textTransform: 'none',
              '&:hover': { color: '#94a3b8' },
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogActions>
    </Dialog>
  );
}
