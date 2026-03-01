'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
    Paper, Button, IconButton, Snackbar, Alert,
    Dialog, DialogActions, DialogContent, DialogTitle,
    TextField, Box
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { addSymbolMapping, deleteSymbolMapping } from '@/app/actions/symbol-mappings';

export interface SymbolMappingDisplay {
    id: number;
    oldSymbol: string;
    newSymbol: string;
    createdAt: Date;
}

interface SymbolMappingsCardProps {
    initialMappings: SymbolMappingDisplay[];
}

export default function SymbolMappingsCard({ initialMappings }: SymbolMappingsCardProps) {
    const [mappings, setMappings] = useState(initialMappings);
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [newMapping, setNewMapping] = useState({ oldSymbol: '', newSymbol: '' });

    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error';
    }>({ open: false, message: '', severity: 'success' });

    const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null; symbol: string }>({
        open: false,
        id: null,
        symbol: ''
    });

    const handleAddDialogClose = () => {
        setAddDialogOpen(false);
        setNewMapping({ oldSymbol: '', newSymbol: '' });
    };

    const handleSaveMapping = async () => {
        if (!newMapping.oldSymbol || !newMapping.newSymbol) {
            setSnackbar({ open: true, message: 'Both old and new symbols are required', severity: 'error' });
            return;
        }

        setIsSaving(true);
        try {
            const result = await addSymbolMapping(newMapping.oldSymbol, newMapping.newSymbol);
            
            if (result.success) {
                setSnackbar({ open: true, message: 'Symbol mapping added!', severity: 'success' });
                handleAddDialogClose();
                setTimeout(() => window.location.reload(), 1000);
            } else {
                setSnackbar({ open: true, message: result.error || 'Failed to add mapping', severity: 'error' });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setSnackbar({ open: true, message: 'Error: ' + errorMessage, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (id: number, oldSymbol: string) => {
        setDeleteConfirm({ open: true, id, symbol: oldSymbol });
    };

    const handleConfirmDelete = async () => {
        if (deleteConfirm.id === null) return;
        
        try {
            const result = await deleteSymbolMapping(deleteConfirm.id);
            if (result.success) {
                setMappings(mappings.filter(m => m.id !== deleteConfirm.id));
                setSnackbar({ open: true, message: 'Symbol mapping deleted!', severity: 'success' });
            } else {
                setSnackbar({ open: true, message: result.error || 'Failed to delete', severity: 'error' });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setSnackbar({ open: true, message: 'Error: ' + errorMessage, severity: 'error' });
        } finally {
            setDeleteConfirm({ open: false, id: null, symbol: '' });
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
                            <span className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400">
                                <SwapHorizIcon sx={{ fontSize: 16 }} />
                            </span>
                            Symbol Renames
                        </h2>
                        <span className="text-xs text-gray-500">{mappings.length} mappings</span>
                    </div>
                    
                    <p className="text-xs text-gray-500">
                        Map old stock symbols to their new names after corporate actions.
                    </p>

                    <div className="flex gap-2 mt-auto">
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<VisibilityIcon sx={{ fontSize: 16 }} />}
                            onClick={() => setViewModalOpen(true)}
                            sx={{ 
                                flex: 1,
                                textTransform: 'none', 
                                height: '36px',
                                borderColor: 'rgba(255,255,255,0.1)',
                                color: '#94a3b8',
                                '&:hover': { borderColor: 'rgba(255,255,255,0.2)' },
                                fontSize: '0.8rem'
                            }}
                        >
                            View Details
                        </Button>
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                            onClick={() => setAddDialogOpen(true)}
                            className="btn-gradient"
                            sx={{ 
                                flex: 1,
                                textTransform: 'none', 
                                height: '36px',
                                fontSize: '0.8rem'
                            }}
                        >
                            Add Mapping
                        </Button>
                    </div>
                </div>
            </Paper>

            {/* View Details Modal with Virtualized Table */}
            <Dialog
                open={viewModalOpen}
                onClose={() => setViewModalOpen(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white', maxHeight: '80vh' }
                }}
            >
                <DialogTitle sx={{ color: 'white', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SwapHorizIcon sx={{ color: '#f59e0b' }} />
                    Symbol Renames ({mappings.length})
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    {/* Sticky Header */}
                    <div className="flex items-center px-3 py-2 bg-slate-800 border-b border-white/10 sticky top-0 z-10">
                        <div className="flex-1 text-xs font-semibold text-gray-400">Old Symbol</div>
                        <div className="px-2"></div>
                        <div className="flex-1 text-xs font-semibold text-gray-400">New Symbol</div>
                        <div className="text-xs font-semibold text-gray-400 w-20 text-right">Added</div>
                        <div className="w-10"></div>
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto">
                        {mappings.length > 0 ? mappings.map((mapping, index) => (
                            <div 
                                key={mapping.id}
                                className={`flex items-center px-3 py-2 border-b border-white/5 ${index % 2 === 0 ? 'bg-slate-900/20' : 'bg-slate-900/40'}`}
                            >
                                <div className="flex-1 min-w-0">
                                    <span className="font-mono text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                                        {mapping.oldSymbol}
                                    </span>
                                </div>
                                <div className="px-2 text-gray-500 text-xs">→</div>
                                <div className="flex-1 min-w-0">
                                    <span className="font-mono text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded font-semibold">
                                        {mapping.newSymbol}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 w-20 text-right">
                                    {format(new Date(mapping.createdAt), 'dd MMM yy')}
                                </div>
                                <IconButton
                                    onClick={() => handleDeleteClick(mapping.id, mapping.oldSymbol)}
                                    size="small"
                                    sx={{ color: '#6b7280', '&:hover': { color: '#ef4444' }, ml: 1 }}
                                >
                                    <DeleteIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </div>
                        )) : (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No symbol mappings found.
                            </div>
                        )}
                    </div>
                </DialogContent>
                <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <Button onClick={() => setViewModalOpen(false)} sx={{ color: '#94a3b8' }}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Symbol Mapping Dialog */}
            <Dialog
                open={addDialogOpen}
                onClose={handleAddDialogClose}
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white', minWidth: '360px' }
                }}
            >
                <DialogTitle sx={{ pb: 1 }}>Add Symbol Mapping</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            label="Old Symbol"
                            value={newMapping.oldSymbol}
                            onChange={(e) => setNewMapping({ ...newMapping, oldSymbol: e.target.value.toUpperCase() })}
                            placeholder="e.g. ZOMATO"
                            fullWidth
                            size="small"
                            InputLabelProps={{ sx: { color: '#94a3b8' } }}
                            InputProps={{ sx: { color: 'white', fontFamily: 'monospace' } }}
                        />

                        <div className="flex justify-center">
                            <span className="text-xl text-gray-500">↓</span>
                        </div>

                        <TextField
                            label="New Symbol"
                            value={newMapping.newSymbol}
                            onChange={(e) => setNewMapping({ ...newMapping, newSymbol: e.target.value.toUpperCase() })}
                            placeholder="e.g. ETERNAL"
                            fullWidth
                            size="small"
                            InputLabelProps={{ sx: { color: '#94a3b8' } }}
                            InputProps={{ sx: { color: 'white', fontFamily: 'monospace' } }}
                        />
                    </Box>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleAddDialogClose} sx={{ color: '#9ca3af' }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveMapping}
                        variant="contained"
                        disabled={isSaving || !newMapping.oldSymbol || !newMapping.newSymbol}
                        className="btn-gradient"
                        size="small"
                    >
                        {isSaving ? 'Saving...' : 'Add'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={deleteConfirm.open}
                onClose={() => setDeleteConfirm({ open: false, id: null, symbol: '' })}
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white' }
                }}
            >
                <DialogTitle sx={{ color: 'white' }}>Delete Mapping?</DialogTitle>
                <DialogContent>
                    <p className="text-gray-400 text-sm">
                        Delete mapping for <strong className="text-white">{deleteConfirm.symbol}</strong>?
                    </p>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm({ open: false, id: null, symbol: '' })} sx={{ color: '#9ca3af' }}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirmDelete} sx={{ color: '#ef4444' }}>
                        Delete
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
