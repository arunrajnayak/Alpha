'use client';

import { useLiveData } from '@/context/LiveDataContext';
import { Snackbar, Alert } from '@mui/material';

export default function BiometricToast() {
  const { biometricToast, closeBiometricToast } = useLiveData();

  return (
    <Snackbar
      open={biometricToast.open}
      autoHideDuration={4000}
      onClose={closeBiometricToast}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        onClose={closeBiometricToast}
        severity={biometricToast.severity}
        variant="filled"
        sx={{
          borderRadius: '12px',
          fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          ...(biometricToast.severity === 'success' && {
            bgcolor: '#059669',
            color: '#ecfdf5',
          }),
          ...(biometricToast.severity === 'error' && {
            bgcolor: '#e11d48',
            color: '#fff1f2',
          }),
        }}
      >
        {biometricToast.message}
      </Alert>
    </Snackbar>
  );
}
