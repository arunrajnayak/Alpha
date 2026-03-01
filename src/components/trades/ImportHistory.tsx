'use client';

import { useState, useEffect } from 'react';
import { getImportHistory, revertImport, clearAllTransactions } from '@/app/actions';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Snackbar, Alert } from '@mui/material';
import { format } from 'date-fns';

type ImportBatch = {
  id: number;
  filename: string;
  timestamp: Date;
  count: number;
  startDate?: Date | null;
  endDate?: Date | null;
};

export default function ImportHistory() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Dialog State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);

  // Snackbar State
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const fetchHistory = async () => {
    try {
      const history = await getImportHistory();
      // Filter out zero-count batches (failed or empty imports)
      setBatches(history.filter(batch => batch.count > 0));
    } catch (error) {
      console.error('Failed to fetch import history:', error);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const openConfirmation = (title: string, message: string, action: () => Promise<void>) => {
    setDialogConfig({ title, message, action });
    setDialogOpen(true);
  };

  const handleConfirm = async () => {
    if (!dialogConfig) return;
    
    setLoading(true);
    setDialogOpen(false); // Close immediately for better UX, or wait? Better UX to show loading elsewhere or keep dialog open.
    // Let's close dialog and show loading on the specific item or globally. Current design uses global loading state which disables buttons.
    
    try {
      await dialogConfig.action();
      await fetchHistory();
      setSnackbar({ open: true, message: 'Operation successfull', severity: 'success' });
    } catch (error) {
      console.error('Operation failed:', error);
      setSnackbar({ open: true, message: 'Operation failed', severity: 'error' });
    } finally {
      setLoading(false);
      setDialogConfig(null);
    }
  };

  const RequestRevert = (batchId: number) => {
    openConfirmation(
        'Revert Import?',
        'Are you sure you want to revert this import? This will delete all trades associated with it.',
        () => revertImport(batchId)
    );
  };

  const RequestClearAll = () => {
    openConfirmation(
        'Clear All Data?',
        'DANGER: This will delete ALL transactions and import history. This action cannot be undone. Are you sure?',
        () => clearAllTransactions()
    );
  };

  return (
    <div className="glass-card p-6 mt-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Import History</h2>
        {batches.length > 0 && (
            <Button 
                variant="outlined" 
                color="error" 
                onClick={RequestClearAll}
                disabled={loading}
                size="small"
            >
                Clear All Data
            </Button>
        )}
      </div>

      {batches.length === 0 ? (
          <p className="text-gray-400 text-center py-4">No import history found.</p>
      ) : (
          <div className="space-y-3">
            {batches.map((batch) => (
              <div key={batch.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 gap-3">
                <div>
                  <p className="text-white font-medium">{batch.filename}</p>
                  <div className="flex flex-col gap-1">
                      <p className="text-sm text-gray-400">
                        {format(new Date(batch.timestamp), 'MMM d, yyyy HH:mm')} • {batch.count} trades
                      </p>
                      {batch.startDate && batch.endDate && (
                          <p className="text-xs text-blue-400 font-mono">
                              Period: {format(new Date(batch.startDate), 'dd MMM yyyy')} - {format(new Date(batch.endDate), 'dd MMM yyyy')}
                          </p>
                      )}
                  </div>
                </div>
                <Button
                  variant="outlined"
                  color="warning"
                  size="small"
                  onClick={() => RequestRevert(batch.id)}
                  disabled={loading}
                  sx={{ borderColor: 'rgba(255, 152, 0, 0.5)', color: 'rgba(255, 152, 0, 0.8)', '&:hover': { borderColor: 'rgba(255, 152, 0, 1)', color: 'rgba(255, 152, 0, 1)' } }}
                >
                  Revert
                </Button>
              </div>
            ))}
          </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => !loading && setDialogOpen(false)}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        PaperProps={{
            className: "glass-card",
            sx: { 
                backgroundColor: 'rgba(31, 41, 55, 0.95)', 
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'white'
            }
        }}
      >
        <DialogTitle id="alert-dialog-title" sx={{ color: 'white' }}>
          {dialogConfig?.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description" sx={{ color: 'gray' }}>
            {dialogConfig?.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: 'gray' }} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} color="error" autoFocus disabled={loading}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar Status */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={6000} 
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
            onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} 
            severity={snackbar.severity} 
            sx={{ width: '100%' }}
            variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}
