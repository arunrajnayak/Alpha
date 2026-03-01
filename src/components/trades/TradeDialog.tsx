'use client';

import { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { validateSymbols } from '@/app/actions';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faPenToSquare, faArrowUp, faArrowDown } from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';

type Transaction = {
    id?: number;
    date: Date;
    symbol: string;
    type: string;
    quantity: number;
    price: number;
};

interface TradeDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Transaction) => Promise<void>;
    initialData?: Transaction | null;
}

export default function TradeDialog({ isOpen, onClose, onSubmit, initialData }: TradeDialogProps) {
    const [formData, setFormData] = useState<Transaction>({
        date: new Date(),
        symbol: '',
        type: 'BUY',
        quantity: 0,
        price: 0
    });
    const [loading, setLoading] = useState(false);
    
    // Validation State
    const [validating, setValidating] = useState(false);
    const [ltp, setLtp] = useState<number | null>(null);
    const [symbolError, setSymbolError] = useState<string | null>(null);

    useEffect(() => {
        // Reset validation when dialog opens/closes or initial data changes
        setSymbolError(null);
        setLtp(null);
    }, [isOpen, initialData]);

    useEffect(() => {
        const sym = formData.symbol;
        if (!sym || sym.length < 3) {
             setLtp(null);
             setSymbolError(null);
             setValidating(false);
             return;
        }

        // Debounce validation
        const timeoutId = setTimeout(async () => {
             setValidating(true);
             try {
                 const results = await validateSymbols([sym]);
                 if (results[0]?.isValid) {
                     setLtp(results[0].currentPrice || null);
                     setSymbolError(null);
                 } else {
                     setLtp(null);
                     setSymbolError("Invalid Symbol");
                 }
             } catch {
                 setSymbolError("Validation failed");
             } finally {
                 setValidating(false);
             }
        }, 800);
        
        return () => clearTimeout(timeoutId);
    }, [formData.symbol]);

    useEffect(() => {
        if (!isOpen) return;
        
        const dataToSet = initialData ? {
            ...initialData,
            date: new Date(initialData.date)
        } : {
            date: new Date(),
            symbol: '',
            type: 'BUY',
            quantity: 0,
            price: 0
        };
        // Use setTimeout to push state update to next tick to avoid synchronous update warning
        const timer = setTimeout(() => {
             setFormData(dataToSet);
        }, 0);
        return () => clearTimeout(timer);
    }, [isOpen, initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        await onSubmit(formData);
        setLoading(false);
        onClose();
    };

    const handleTypeChange = (event: React.MouseEvent<HTMLElement>, newType: string | null) => {
        if (newType !== null) {
          setFormData({ ...formData, type: newType });
        }
    };

    return (
        <Dialog 
            open={isOpen} 
            onClose={onClose}
            PaperProps={{
                className: "glass-card",
                sx: { 
                  backgroundImage: 'none',
                  backgroundColor: 'rgba(31, 41, 55, 0.9)', 
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '1rem',
                  maxWidth: '450px',
                  width: '100%'
                }
            }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.1)', pb: 2 }}>
                <FontAwesomeIcon icon={initialData ? faPenToSquare : faPlus} className="text-blue-400 text-xl" />
                <span className="gradient-text font-bold text-xl">
                    {initialData ? 'Edit Trade' : 'Add Trade'}
                </span>
            </DialogTitle>
            
            <form onSubmit={handleSubmit}>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 4 }}>
                    <DatePicker
                        label="Date"
                        format="dd/MM/yyyy"
                        value={formData.date}
                        onChange={(newValue) => {
                            if (newValue) {
                                setFormData({ ...formData, date: newValue });
                            }
                        }}
                        slotProps={{
                            textField: {
                                fullWidth: true,
                                required: true,
                                InputLabelProps: { shrink: true, style: { color: '#9ca3af' } },
                                sx: { 
                                    '& .MuiInputBase-root': { color: 'white' },
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                                    '& .MuiSvgIcon-root': { color: '#9ca3af' }
                                }
                            }
                        }}
                    />

                    <TextField
                        label="Symbol"
                        placeholder="e.g. INFY"
                        fullWidth
                        required
                        InputLabelProps={{ style: { color: '#9ca3af' } }}
                        InputProps={{
                            sx: { color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: symbolError ? '#ef4444' : 'rgba(255,255,255,0.1)' } },
                            endAdornment: (
                                <InputAdornment position="end">
                                    {validating && <CircularProgress size={20} sx={{ color: '#9ca3af' }} />}
                                    {!validating && ltp && <span className="text-green-400 text-sm font-medium">₹{ltp.toFixed(2)}</span>}
                                </InputAdornment>
                            )
                        }}
                        error={!!symbolError}
                        helperText={symbolError}
                        value={formData.symbol}
                        onChange={e => setFormData({...formData, symbol: e.target.value.toUpperCase()})}
                    />

                    <div className="flex flex-col gap-2">
                         <span className="text-sm font-medium text-gray-400">Type</span>
                         <ToggleButtonGroup
                           value={formData.type}
                           exclusive
                           onChange={handleTypeChange}
                           fullWidth
                           sx={{ gap: 2 }}
                         >
                           <ToggleButton 
                             value="BUY" 
                             sx={{ 
                               flex: 1, 
                               borderRadius: '0.75rem !important', 
                               border: '1px solid rgba(255,255,255,0.1) !important',
                               color: '#9ca3af',
                               '&.Mui-selected': {
                                 backgroundColor: 'rgba(16, 185, 129, 0.2) !important',
                                 color: '#34d399 !important',
                                 borderColor: 'rgba(16, 185, 129, 0.3) !important'
                               }
                             }}
                           >
                             <FontAwesomeIcon icon={faArrowUp} className="mr-1" /> BUY
                           </ToggleButton>
                           <ToggleButton 
                             value="SELL"
                             sx={{ 
                               flex: 1, 
                               borderRadius: '0.75rem !important',
                               border: '1px solid rgba(255,255,255,0.1) !important',
                               color: '#9ca3af',
                               '&.Mui-selected': {
                                 backgroundColor: 'rgba(239, 68, 68, 0.2) !important',
                                 color: '#f87171 !important',
                                 borderColor: 'rgba(239, 68, 68, 0.3) !important'
                               }
                             }}
                           >
                              <FontAwesomeIcon icon={faArrowDown} className="mr-1" /> SELL
                           </ToggleButton>
                         </ToggleButtonGroup>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <TextField
                            label="Quantity"
                            type="number"
                            required
                            fullWidth
                            InputLabelProps={{ style: { color: '#9ca3af' } }}
                            InputProps={{
                                inputProps: { min: 1, step: "1" },
                                sx: { 
                                    color: 'white', 
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                    '& input[type=number]': {
                                        MozAppearance: 'textfield',
                                        appearance: 'textfield'
                                    },
                                    '& input[type=number]::-webkit-outer-spin-button': {
                                        WebkitAppearance: 'none',
                                        margin: 0
                                    },
                                    '& input[type=number]::-webkit-inner-spin-button': {
                                        WebkitAppearance: 'none',
                                        margin: 0
                                    }
                                }
                            }}
                            value={formData.quantity.toString()}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === '') {
                                    setFormData({...formData, quantity: 0});
                                    return;
                                }
                                // Only allow integers
                                if (!/^\d+$/.test(val)) return;
                                setFormData({...formData, quantity: parseInt(val, 10)})
                            }}
                        />
                        <TextField
                            label="Price (₹)"
                            type="number"
                            required
                            fullWidth
                            InputLabelProps={{ style: { color: '#9ca3af' } }}
                            InputProps={{
                                inputProps: { min: 0, step: "any" },
                                sx: { 
                                    color: 'white', 
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                                    '& input[type=number]': {
                                        MozAppearance: 'textfield',
                                        appearance: 'textfield'
                                    },
                                    '& input[type=number]::-webkit-outer-spin-button': {
                                        WebkitAppearance: 'none',
                                        margin: 0
                                    },
                                    '& input[type=number]::-webkit-inner-spin-button': {
                                        WebkitAppearance: 'none',
                                        margin: 0
                                    }
                                }
                            }}
                            value={formData.price.toString()}
                            onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})}
                        />
                    </div>
                    
                    {/* Preview */}
                    {formData.quantity > 0 && formData.price > 0 && (
                        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-white/10">
                            <p className="text-sm text-gray-400">Total Amount</p>
                            <p className="text-2xl font-bold text-white">
                                {formatCurrency(formData.quantity * formData.price, 2, 2)}
                            </p>
                        </div>
                    )}
                </DialogContent>
                
                <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.1)', gap: 1 }}>
                    <Button 
                        onClick={onClose} 
                        variant="text"
                        sx={{ color: '#9ca3af', '&:hover': { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' } }}
                    >
                        Cancel
                    </Button>
                    <Button 
                        type="submit" 
                        disabled={loading}
                        variant="contained"
                        className="btn-gradient"
                        sx={{ 
                           background: 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)',
                           boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                        }}
                    >
                        {loading ? 'Processing...' : (initialData ? 'Update Trade' : 'Add Trade')}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
