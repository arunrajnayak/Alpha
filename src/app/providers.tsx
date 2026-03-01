'use client';

import { Suspense } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { RecomputeProvider } from '@/context/RecomputeContext';
import { ImportProvider } from '@/context/ImportContext';
import { LiveDataProvider } from '@/context/LiveDataContext';
import { QueryProvider } from '@/providers/QueryProvider';
import ConnectionErrorToast from '@/components/ui/ConnectionErrorToast';
import theme from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AppRouterCacheProvider>
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
              <RecomputeProvider>
                <LiveDataProvider>
                  <ImportProvider>
                    <CssBaseline />
                    {children}
                    {/* Connection error toast - wrapped in Suspense for useSearchParams */}
                    <Suspense fallback={null}>
                      <ConnectionErrorToast />
                    </Suspense>
                  </ImportProvider>
                </LiveDataProvider>
              </RecomputeProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </AppRouterCacheProvider>
    </QueryProvider>
  );
}
