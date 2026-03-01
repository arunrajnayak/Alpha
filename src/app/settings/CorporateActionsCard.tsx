'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
    Paper, Button, IconButton, Snackbar, Alert,
    Dialog, DialogActions, DialogContent, DialogTitle,
    TextField, Select, MenuItem, FormControl, Box, InputLabel
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding } from '@fortawesome/free-solid-svg-icons';
import { deleteCorporateAction, addCorporateAction } from '@/app/actions';

export interface CorporateActionDisplay {
    id: number;
    date: Date;
    symbol: string;
    type: string;
    ratio: number;
    source: string;
}

interface CorporateActionsCardProps {
    initialActions: CorporateActionDisplay[];
}

export default function CorporateActionsCard({ initialActions }: CorporateActionsCardProps) {
    // Filter out SYMBOL_CHANGE as they are displayed in the Symbol Renames section
    const [actions, setActions] = useState(initialActions.filter(a => a.type !== 'SYMBOL_CHANGE'));
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [newAction, setNewAction] = useState({
        date: format(new Date(), 'yyyy-MM-dd'),
        symbol: '',
        type: 'SPLIT',
        ratio: '1',
        description: ''
    });

    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error';
    }>({ open: false, message: '', severity: 'success' });

    const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number | null }>({
        open: false,
        id: null
    });

    const handleAddDialogClose = () => {
        setAddDialogOpen(false);
        setNewAction({
            date: format(new Date(), 'yyyy-MM-dd'),
            symbol: '',
            type: 'SPLIT',
            ratio: '1',
            description: ''
        });
    };

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { name: string; value: string } }) => {
        const { name, value } = e.target as { name: string; value: string };
        setNewAction(prev => ({ ...prev, [name]: value }));
    };

    const handleSaveAction = async () => {
        try {
            if (!newAction.symbol || !newAction.ratio) {
                setSnackbar({ open: true, message: 'Symbol and Ratio are required', severity: 'error' });
                return;
            }

            setIsSaving(true);
            await addCorporateAction({
                ...newAction,
                date: new Date(newAction.date)
            });

            setSnackbar({ open: true, message: 'Corporate action added!', severity: 'success' });
            handleAddDialogClose();
            setTimeout(() => window.location.reload(), 1000);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setSnackbar({ open: true, message: 'Error: ' + errorMessage, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (id: number) => {
        setDeleteConfirm({ open: true, id });
    };

    const handleConfirmDelete = async () => {
        if (deleteConfirm.id === null) return;
        
        try {
            await deleteCorporateAction(deleteConfirm.id);
            setActions(actions.filter(a => a.id !== deleteConfirm.id));
            setSnackbar({ open: true, message: 'Corporate action deleted!', severity: 'success' });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setSnackbar({ open: true, message: 'Error: ' + errorMessage, severity: 'error' });
        } finally {
            setDeleteConfirm({ open: false, id: null });
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
                            <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                                <FontAwesomeIcon icon={faBuilding} className="w-3.5 h-3.5" />
                            </span>
                            Corporate Actions
                        </h2>
                        <span className="text-xs text-gray-500">{actions.length} actions</span>
                    </div>
                    
                    <p className="text-xs text-gray-500">
                        Track splits, bonuses, and other corporate actions.
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
                            Add Action
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
                    <FontAwesomeIcon icon={faBuilding} className="text-emerald-400" />
                    Corporate Actions ({actions.length})
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    {/* Sticky Header */}
                    <div className="flex items-center px-3 py-2 bg-slate-800 border-b border-white/10 sticky top-0 z-10">
                        <div className="w-20 text-xs font-semibold text-gray-400">Date</div>
                        <div className="flex-1 text-xs font-semibold text-gray-400">Symbol</div>
                        <div className="w-16 text-xs font-semibold text-gray-400">Type</div>
                        <div className="w-12 text-xs font-semibold text-gray-400 text-right">Ratio</div>
                        <div className="w-10"></div>
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto">
                        {actions.length > 0 ? actions.map((action, index) => (
                            <div 
                                key={action.id}
                                className={`flex items-center px-3 py-2 border-b border-white/5 ${index % 2 === 0 ? 'bg-slate-900/20' : 'bg-slate-900/40'}`}
                            >
                                <div className="w-20 text-xs text-gray-400">
                                    {format(new Date(action.date), 'dd MMM yy')}
                                </div>
                                <div className="flex-1 min-w-0 font-semibold text-sm text-gray-200">
                                    {action.symbol}
                                </div>
                                <div className="w-16">
                                    <span className={`
                                        inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold
                                        ${action.type === 'SPLIT' ? 'bg-blue-500/10 text-blue-400' : 
                                          action.type === 'BONUS' ? 'bg-emerald-500/10 text-emerald-400' : 
                                          'bg-orange-500/10 text-orange-400'}
                                    `}>
                                        {action.type}
                                    </span>
                                </div>
                                <div className="w-12 text-xs text-gray-300 text-right">
                                    {action.ratio}x
                                </div>
                                <IconButton
                                    onClick={() => handleDeleteClick(action.id)}
                                    size="small"
                                    sx={{ color: '#6b7280', '&:hover': { color: '#ef4444' }, ml: 1 }}
                                >
                                    <DeleteIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </div>
                        )) : (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No corporate actions found.
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

            {/* Add Corporate Action Dialog */}
            <Dialog
                open={addDialogOpen}
                onClose={handleAddDialogClose}
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white', minWidth: '360px' }
                }}
            >
                <DialogTitle sx={{ pb: 1 }}>Add Corporate Action</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            label="Date"
                            type="date"
                            name="date"
                            value={newAction.date}
                            onChange={handleFormChange}
                            fullWidth
                            size="small"
                            InputLabelProps={{ shrink: true, sx: { color: '#94a3b8' } }}
                            InputProps={{ sx: { color: 'white' } }}
                        />

                        <TextField
                            label="Symbol"
                            name="symbol"
                            value={newAction.symbol}
                            onChange={(e) => handleFormChange({ target: { name: 'symbol', value: e.target.value.toUpperCase() } })}
                            placeholder="e.g. RELIANCE"
                            fullWidth
                            size="small"
                            InputLabelProps={{ sx: { color: '#94a3b8' } }}
                            InputProps={{ sx: { color: 'white' } }}
                        />

                        <FormControl fullWidth size="small">
                            <InputLabel sx={{ color: '#94a3b8' }}>Type</InputLabel>
                            <Select
                                name="type"
                                value={newAction.type}
                                label="Type"
                                onChange={handleFormChange}
                                sx={{
                                    color: 'white',
                                    '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                                    '.MuiSvgIcon-root': { color: 'white' }
                                }}
                            >
                                <MenuItem value="SPLIT">SPLIT</MenuItem>
                                <MenuItem value="BONUS">BONUS</MenuItem>
                            </Select>
                        </FormControl>

                        <TextField
                            label="Ratio (Multiplier)"
                            name="ratio"
                            type="number"
                            value={newAction.ratio}
                            onChange={handleFormChange}
                            helperText="e.g. 2 for 1:2 split"
                            fullWidth
                            size="small"
                            InputLabelProps={{ sx: { color: '#94a3b8' } }}
                            InputProps={{ sx: { color: 'white' } }}
                            FormHelperTextProps={{ sx: { color: '#6b7280' } }}
                        />
                    </Box>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleAddDialogClose} sx={{ color: '#9ca3af' }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveAction}
                        variant="contained"
                        disabled={isSaving}
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
                onClose={() => setDeleteConfirm({ open: false, id: null })}
                PaperProps={{
                    style: { backgroundColor: '#1e293b', color: 'white' }
                }}
            >
                <DialogTitle sx={{ color: 'white' }}>Delete Action?</DialogTitle>
                <DialogContent>
                    <p className="text-gray-400 text-sm">
                        Are you sure you want to delete this corporate action?
                    </p>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm({ open: false, id: null })} sx={{ color: '#9ca3af' }}>
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
