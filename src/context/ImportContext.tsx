'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { recordSymbolChanges } from '@/app/actions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';



interface ImportContextType {
  isImporting: boolean;
  startImport: (formData: FormData, symbolMappings?: Record<string, string>) => Promise<void>;
}

const ImportContext = createContext<ImportContextType | undefined>(undefined);

export function ImportProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isImporting, setIsImporting] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  const handleCloseSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const startImport = useCallback(async (formData: FormData, symbolMappings?: Record<string, string>) => {
    setIsImporting(true);
    setSnackbar({
      open: true,
      message: 'Starting import...',
      severity: 'info',
    });

    try {
      // 1. Start streaming import via API
      const response = await fetch('/api/import', {
          method: 'POST',
          body: formData,
      });

      if (!response.ok || !response.body) {
          throw new Error(`Import failed: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let importCompleted = false;
      
      while (true) {
          const { done, value } = await reader.read();
          
          if (value) {
              buffer += decoder.decode(value, { stream: true });
          }
          
          // Process all complete SSE messages in the buffer
          const lines = buffer.split('\n\n');
          // Keep the last partial line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
              if (line.startsWith('data: ')) {
                  try {
                      const data = JSON.parse(line.slice(6));
                      if (data.message) {
                           setSnackbar(prev => ({ ...prev, open: true, message: data.message }));
                      }
                      if (data.done) {
                          importCompleted = true;
                      }
                      if (data.error) {
                          throw new Error(data.error);
                      }
                  } catch (e) {
                      console.error("Failed to parse SSE message", e);
                  }
              }
          }
          
          if (done) break;
      }
      
      // Process any remaining data in buffer after stream ends
      if (buffer && buffer.startsWith('data: ')) {
          try {
              const data = JSON.parse(buffer.slice(6));
              if (data.message) {
                  setSnackbar(prev => ({ ...prev, open: true, message: data.message }));
              }
              if (data.done) {
                  importCompleted = true;
              }
              if (data.error) {
                  throw new Error(data.error);
              }
          } catch (e) {
              console.error("Failed to parse final SSE message", e);
          }
      }
      
      if (!importCompleted) {
          console.warn('Import stream ended without receiving done signal');
      }

      // 2. Record Symbol Changes (concurrently or after?)
      // Let's do it after to ensure base trades exist if needed (though mapping is independent)
      if (symbolMappings && Object.keys(symbolMappings).length > 0) {
        setSnackbar(prev => ({ ...prev, message: "Recording symbol changes..." }));
        await recordSymbolChanges(symbolMappings);
      }

      // 3. Force Client Refresh
      router.refresh();

      setSnackbar({
        open: true,
        message: `Import and recalculation complete!`,
        severity: 'success',
      });
    } catch (error: unknown) {
      console.error('Import process failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setSnackbar({
        open: true,
        message: `Import failed: ${errorMessage}`,
        severity: 'error',
      });
    } finally {
      setIsImporting(false);
    }
  }, [router]);

  return (
    <ImportContext.Provider value={{ isImporting, startImport }}>
      {children}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </ImportContext.Provider>
  );
}

export function useImport() {
  const context = useContext(ImportContext);
  if (context === undefined) {
    throw new Error('useImport must be used within an ImportProvider');
  }
  return context;
}
