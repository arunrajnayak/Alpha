import { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import { validateSymbols } from '@/app/actions';

interface BulkSymbolRenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (oldSymbol: string, newSymbol: string) => Promise<void>;
  uniqueSymbols: string[];
}

export default function BulkSymbolRenameModal({
  isOpen,
  onClose,
  onConfirm,
  uniqueSymbols
}: BulkSymbolRenameModalProps) {
  const [oldSymbol, setOldSymbol] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Validation State
  const [validating, setValidating] = useState(false);
  const [ltp, setLtp] = useState<number | null>(null);
  const [symbolError, setSymbolError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setOldSymbol(null);
      setNewSymbol('');
      setError('');
      setSymbolError(null);
      setLtp(null);
    }
  }, [isOpen]);

  // Debounced validation for new symbol
  useEffect(() => {
    if (!newSymbol || newSymbol.length < 3) {
         setLtp(null);
         setSymbolError(null);
         setValidating(false);
         return;
    }

    const timeoutId = setTimeout(async () => {
         setValidating(true);
         try {
             const results = await validateSymbols([newSymbol]);
             if (results[0]?.isValid) {
                 setLtp(results[0].currentPrice || null);
                 setSymbolError(null);
             } else {
                 setLtp(null);
                 setSymbolError("Invalid Symbol: Not found on NSE");
             }
         } catch {
             setSymbolError("Validation failed. Please try again.");
         } finally {
             setValidating(false);
         }
    }, 800);
    
    return () => clearTimeout(timeoutId);
  }, [newSymbol]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!oldSymbol) {
      setError('Please select a symbol to rename');
      return;
    }

    if (!newSymbol.trim()) {
      setError('Please enter a new symbol name');
      return;
    }

    if (symbolError) {
        // Prevent submit if symbol is invalid
        return; 
    }

    const trimmedNewSymbol = newSymbol.trim().toUpperCase();

    if (oldSymbol === trimmedNewSymbol) {
      setError('New symbol must be different from the old symbol');
      return;
    }

    if (uniqueSymbols.includes(trimmedNewSymbol)) {
      // Warning about merging
      // We allow it but maybe should prompt? For now showing error as per previous logic, but user might WANT merge.
      // previous implementation blocked it. sticking to blocking for safety unless logic changes.
      setError(`Symbol "${trimmedNewSymbol}" already exists. Merging is not supported yet.`);
      return;
    }

    setIsLoading(true);
    try {
      await onConfirm(oldSymbol, trimmedNewSymbol);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename symbol');
    } finally {
      setIsLoading(false);
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
        <DriveFileRenameOutlineIcon sx={{ fontSize: 28, color: '#60a5fa' }} />
        <span className="gradient-text font-bold text-xl">
          Bulk Rename Symbol
        </span>
      </DialogTitle>
      
      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 4 }}>
          <p className="text-sm text-gray-400">
            Rename a symbol across all trades. This replaces all occurrences of the old symbol with the new one.
          </p>

          <Autocomplete
              options={uniqueSymbols.sort()}
              value={oldSymbol}
              onChange={(event, newValue) => {
                  setOldSymbol(newValue);
              }}
              renderInput={(params) => (
                  <TextField 
                      {...params} 
                      label="Current Symbol" 
                      required
                      InputLabelProps={{ style: { color: '#9ca3af' } }}
                      sx={{ 
                          '& .MuiInputBase-root': { color: 'white' },
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                          '& .MuiSvgIcon-root': { color: '#9ca3af' }
                      }}
                  />
              )}
              PaperComponent={({ children }) => (
                  <Paper sx={{ backgroundColor: '#1f2937', color: 'white' }}>{children}</Paper>
              )}
          />

          <TextField
              label="New Symbol"
              placeholder="e.g. RELIANCE"
              fullWidth
              required
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              error={!!symbolError}
              helperText={symbolError}
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
          />

          {oldSymbol && newSymbol && !symbolError && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-white/10">
              <p className="text-sm text-gray-400">Preview</p>
              <p className="text-lg font-medium text-white mt-1">
                <span className="text-orange-400">{oldSymbol}</span>
                <span className="text-gray-500 mx-3">→</span>
                <span className="text-emerald-400">{newSymbol.toUpperCase()}</span>
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </DialogContent>
        
        <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.1)', gap: 1 }}>
          <Button 
            onClick={onClose} 
            variant="text"
            disabled={isLoading}
            sx={{ color: '#9ca3af', '&:hover': { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' } }}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            disabled={isLoading || !oldSymbol || !newSymbol.trim() || !!symbolError}
            variant="contained"
            className="btn-gradient"
            sx={{ 
               background: 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)',
               boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
            }}
          >
            {isLoading ? 'Processing...' : 'Rename Symbol'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
