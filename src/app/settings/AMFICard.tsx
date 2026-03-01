'use client';

import { useState, useEffect } from 'react';
import {
    Paper, Button, Snackbar, Alert, CircularProgress
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartPie } from '@fortawesome/free-solid-svg-icons';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { MenuItem, Select, FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogActions, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { uploadAMFIAction, getAMFIHistory, checkAMFIStatus, deleteAMFIPeriod } from '@/app/actions/amfi';
import { initializeJob, triggerRecalculatePortfolio } from '@/app/actions';

export default function AMFICard() {
    const [amfiFile, setAmfiFile] = useState<File | null>(null);
    const [amfiYear, setAmfiYear] = useState<number>(new Date().getFullYear());
    const [amfiHalf, setAmfiHalf] = useState<'H1' | 'H2'>(new Date().getMonth() < 6 ? 'H1' : 'H1');
    const [isUploadingAMFI, setIsUploadingAMFI] = useState(false);
    const [amfiHistory, setAmfiHistory] = useState<Array<{ period: string; count: number; updatedAt: string }>>([]);
    const [amfiStatus, setAmfiStatus] = useState<{ needsUpdate: boolean; message: string; appliedPeriod: string } | null>(null);
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [recalcJobId, setRecalcJobId] = useState<string | null>(null);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ 
        open: false, message: '', severity: 'success' 
    });

    useEffect(() => {
        const fetchAMFIData = async () => {
            try {
                const [history, status] = await Promise.all([
                    getAMFIHistory(),
                    checkAMFIStatus(),
                ]);
                setAmfiHistory(history);
                setAmfiStatus(status);
            } catch (error) {
                console.error('Failed to fetch AMFI data:', error);
            }
        };
        fetchAMFIData();
    }, []);

    const handleUploadAMFI = async () => {
        if (!amfiFile) return;
        setIsUploadingAMFI(true);
        setSnackbar({ open: true, message: 'Parsing and syncing AMFI data...', severity: 'info' });
        
        try {
            const formData = new FormData();
            formData.append('file', amfiFile);
            formData.append('year', amfiYear.toString());
            formData.append('halfYear', amfiHalf);

            const result = await uploadAMFIAction(formData);
            if (result.success) {
                setSnackbar({ open: true, message: result.message || 'AMFI data synced!', severity: 'success' });
                setAmfiFile(null);
                
                const [newHistory, newStatus] = await Promise.all([
                    getAMFIHistory(),
                    checkAMFIStatus(),
                ]);
                setAmfiHistory(newHistory);
                setAmfiStatus(newStatus);
                
                setSnackbar({ open: true, message: 'AMFI data synced! Starting portfolio recompute...', severity: 'info' });
                try {
                    const id = await initializeJob('RECALCULATE');
                    setRecalcJobId(id);
                    await triggerRecalculatePortfolio(id);
                    setSnackbar({ open: true, message: 'AMFI data synced and snapshots recomputed!', severity: 'success' });
                } catch (recomputeErr) {
                    console.error('Auto-recompute failed:', recomputeErr);
                    setSnackbar({ open: true, message: 'AMFI synced but recompute failed. Please run manually.', severity: 'error' });
                } finally {
                    setRecalcJobId(null);
                }
            } else {
                setSnackbar({ open: true, message: 'Error: ' + result.error, severity: 'error' });
            }
        } catch (e) {
            setSnackbar({ open: true, message: 'Error: ' + (e as Error).message, severity: 'error' });
        } finally {
            setIsUploadingAMFI(false);
        }
    };

    return (
        <>
            <Paper className="glass-card p-4 h-full" sx={{ 
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)'
            }}>
                <div className="flex flex-col gap-3 h-full">
                    <div className="flex items-center justify-between">
                        <h2 className="text-base text-gray-200 font-bold flex items-center gap-2">
                            <span className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">
                                <FontAwesomeIcon icon={faChartPie} className="w-3.5 h-3.5" />
                            </span>
                            AMFI Classification
                        </h2>
                        <div className="flex items-center gap-2">
                            {amfiStatus && !amfiStatus.needsUpdate && (
                                <span className="text-xs text-green-400">✓ Up to date</span>
                            )}
                            <Button
                                variant="text"
                                size="small"
                                startIcon={<VisibilityIcon sx={{ fontSize: 14 }} />}
                                onClick={() => setHistoryModalOpen(true)}
                                disabled={amfiHistory.length === 0}
                                sx={{ 
                                    textTransform: 'none', 
                                    color: '#94a3b8',
                                    fontSize: '0.7rem',
                                    minWidth: 'auto',
                                    px: 1,
                                    py: 0.5,
                                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.05)' },
                                }}
                            >
                                History ({amfiHistory.length})
                            </Button>
                        </div>
                    </div>
                    
                    <p className="text-xs text-gray-500">
                        Upload AMFI market cap classification data.
                    </p>

                    {/* Compact upload form */}
                    <div className="flex flex-wrap items-center gap-2 bg-slate-900/40 p-2 rounded-xl border border-white/5">
                        <FormControl size="small" sx={{ minWidth: 70 }}>
                            <InputLabel sx={{ color: '#94a3b8', fontSize: '0.75rem' }}>Year</InputLabel>
                            <Select
                                value={amfiYear}
                                label="Year"
                                onChange={(e) => setAmfiYear(Number(e.target.value))}
                                sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' }, fontSize: '0.75rem' }}
                            >
                                {[2023, 2024, 2025, 2026].map(y => (
                                    <MenuItem key={y} value={y}>{y}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl size="small" sx={{ minWidth: 60 }}>
                            <InputLabel sx={{ color: '#94a3b8', fontSize: '0.75rem' }}>Half</InputLabel>
                            <Select
                                value={amfiHalf}
                                label="Half"
                                onChange={(e) => setAmfiHalf(e.target.value as 'H1' | 'H2')}
                                sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' }, fontSize: '0.75rem' }}
                            >
                                <MenuItem value="H1">H1</MenuItem>
                                <MenuItem value="H2">H2</MenuItem>
                            </Select>
                        </FormControl>

                        <div className="flex items-center gap-1 flex-1">
                            <input
                                accept=".xlsx, .xls"
                                style={{ display: 'none' }}
                                id="amfi-upload-file-card"
                                type="file"
                                onChange={(e) => setAmfiFile(e.target.files?.[0] || null)}
                            />
                            <label htmlFor="amfi-upload-file-card" className="flex-1">
                                <Button
                                    variant="outlined"
                                    component="span"
                                    size="small"
                                    fullWidth
                                    startIcon={<CloudUploadIcon sx={{ fontSize: 14 }} />}
                                    sx={{ 
                                        textTransform: 'none', 
                                        height: '32px',
                                        borderColor: 'rgba(255,255,255,0.1)',
                                        color: amfiFile ? '#38bdf8' : '#94a3b8',
                                        '&:hover': { borderColor: 'rgba(255,255,255,0.2)' },
                                        fontSize: '0.7rem',
                                        px: 1,
                                    }}
                                >
                                    {amfiFile ? amfiFile.name.slice(0, 8) + '...' : 'Select'}
                                </Button>
                            </label>
                            <Button
                                variant="contained"
                                onClick={handleUploadAMFI}
                                disabled={!amfiFile || isUploadingAMFI || !!recalcJobId}
                                size="small"
                                className="btn-gradient"
                                sx={{ textTransform: 'none', height: '32px', minWidth: '60px', fontSize: '0.75rem' }}
                            >
                                {isUploadingAMFI || recalcJobId ? <CircularProgress size={14} color="inherit" /> : 'Upload'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Paper>

            {/* History Modal */}
            <Dialog
                open={historyModalOpen}
                onClose={() => setHistoryModalOpen(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white', maxHeight: '80vh' }
                }}
            >
                <DialogTitle sx={{ color: 'white', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FontAwesomeIcon icon={faChartPie} className="text-indigo-400" />
                    AMFI Classification History
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    <div className="flex items-center px-3 py-2 bg-slate-800 border-b border-white/10 sticky top-0 z-10">
                        <div className="flex-1 text-xs font-semibold text-gray-400">Period</div>
                        <div className="w-20 text-xs font-semibold text-gray-400 text-center">Stocks</div>
                        <div className="w-24 text-xs font-semibold text-gray-400 text-right">Updated</div>
                        <div className="w-10"></div>
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto">
                        {amfiHistory.length > 0 ? amfiHistory.map((h, index) => (
                            <div 
                                key={h.period}
                                className={`flex items-center px-3 py-2 border-b border-white/5 ${index % 2 === 0 ? 'bg-slate-900/20' : 'bg-slate-900/40'}`}
                            >
                                <div className="flex-1 text-sm text-gray-200 font-medium">
                                    {h.period.replace('_', ' ')}
                                </div>
                                <div className="w-20 text-xs text-gray-400 text-center">
                                    {h.count}
                                </div>
                                <div className="w-24 text-xs text-gray-500 text-right">
                                    {new Date(h.updatedAt).toLocaleDateString()}
                                </div>
                                <IconButton
                                    onClick={async () => {
                                        if (confirm(`Delete ${h.period.replace('_', ' ')} classification data?`)) {
                                            const result = await deleteAMFIPeriod(h.period);
                                            if (result.success) {
                                                setSnackbar({ open: true, message: result.message || 'Deleted', severity: 'success' });
                                                const [newHistory, newStatus] = await Promise.all([
                                                    getAMFIHistory(),
                                                    checkAMFIStatus(),
                                                ]);
                                                setAmfiHistory(newHistory);
                                                setAmfiStatus(newStatus);
                                            } else {
                                                setSnackbar({ open: true, message: result.error || 'Failed', severity: 'error' });
                                            }
                                        }
                                    }}
                                    size="small"
                                    sx={{ color: '#6b7280', '&:hover': { color: '#ef4444' }, ml: 1 }}
                                >
                                    <DeleteIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </div>
                        )) : (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No AMFI history found.
                            </div>
                        )}
                    </div>
                </DialogContent>
                <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <Button onClick={() => setHistoryModalOpen(false)} sx={{ color: '#94a3b8' }}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
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
