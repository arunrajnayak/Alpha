'use client';

import { Suspense } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { RecomputeProvider } from '@/context/RecomputeContext';
import { ImportProvider } from '@/context/ImportContext';
import { LiveDataProvider } from '@/context/LiveDataContext';
import { QueryProvider } from '@/providers/QueryProvider';
import ConnectionErrorToast from '@/components/ui/ConnectionErrorToast';
import theme from '@/lib/theme';
import isPropValid from '@emotion/is-prop-valid';
import { MotionConfig } from 'framer-motion';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <MotionConfig isValidProp={isPropValid}>
        <AppRouterCacheProvider>
        <ThemeProvider theme={theme}>
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
        </ThemeProvider>
      </AppRouterCacheProvider>
      </MotionConfig>
    </QueryProvider>
  );
}
