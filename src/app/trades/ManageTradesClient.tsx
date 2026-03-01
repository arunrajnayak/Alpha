'use client';

import React, { useState, useMemo, Fragment, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import CalendarViewMonthIcon from '@mui/icons-material/CalendarViewMonth';
import TradeDialog from '@/components/trades/TradeDialog';
import { TableVirtuoso } from 'react-virtuoso';
import { styled } from '@mui/material/styles';
import { addTransaction, updateTransaction, deleteTransaction, validateSymbols, type SymbolValidationResult, processZerodhaUpload, getCurrentStockQuantities } from '../actions';
import { useImport } from '@/context/ImportContext';
import { validateTradebook, type ParsedTrade, type Discrepancy, type TradeSummary, detectDiscrepancies, generateSummary } from '@/lib/tradeValidation';
import { formatCurrency, formatNumber } from '@/lib/format';
import UploadPreviewModal from '@/components/trades/UploadPreviewModal';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import CircularProgress from '@mui/material/CircularProgress';
import FileUploadIcon from '@mui/icons-material/FileUpload';

import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';

import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { Transaction } from '@prisma/client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faFile, 
  faCircleCheck, 
  faClipboardCheck, 
  faLightbulb, 
  faTriangleExclamation, 
  faCheckCircle,
  faInbox 
} from '@fortawesome/free-solid-svg-icons';

type UploadStatus = 'idle' | 'validating' | 'preview' | 'uploading' | 'processing' | 'success' | 'error';

// Grouped Transaction Interface
interface GroupedTransaction {
    id: string; // Composite ID
    date: Date;
    symbol: string;
    type: string;
    quantity: number;
    avgPrice: number;
    totalAmount: number;
    transactions: Transaction[];
    isExpanded?: boolean;
}

interface DailyGroup {
    dateStr: string;
    date: Date;
    transactions: Transaction[];
    netCashflow: number;
    count: number;
}

// Virtuoso Components
const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof TableContainer>>((props, ref) => (
    <TableContainer component={Paper} {...props} ref={ref} className="scroll-smooth" sx={{ boxShadow: 'none', backgroundColor: 'transparent' }} />
));
VirtuosoScroller.displayName = 'VirtuosoScroller';

const VirtuosoTable = (props: React.ComponentProps<typeof Table>) => (
    <Table {...props} sx={{ borderCollapse: 'separate', tableLayout: 'fixed' }} />
);

const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<typeof TableHead>>((props, ref) => (
    <TableHead {...props} ref={ref} sx={{ zIndex: 50 }} />
));
VirtuosoTableHead.displayName = 'VirtuosoTableHead';

const VirtuosoTableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<typeof TableBody>>((props, ref) => (
    <TableBody {...props} ref={ref} />
));
VirtuosoTableBody.displayName = 'VirtuosoTableBody';

const StyledTableRow = styled(TableRow)(() => ({
    '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
}));

// Types for flattened list
type FlatItem = 
    | { type: 'group'; data: GroupedTransaction }
    | { type: 'group-detail'; parent: GroupedTransaction }
    | { type: 'daily'; data: DailyGroup }
    | { type: 'daily-detail'; parent: DailyGroup };

export default function ManageTradesClient({ 
    initialTransactions,
    initialMappings = {} 
}: { 
    initialTransactions: Transaction[],
    initialMappings?: Record<string, string>
}) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingTrade, setEditingTrade] = useState<Transaction | null>(null);
    const [filterValue, setFilterValue] = useState("");
    // const [page, setPage] = useState(1);
    const [viewMode, setViewMode] = useState<'default' | 'daily'>('default');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [expandedDailyGroups, setExpandedDailyGroups] = useState<Set<string>>(new Set());
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; id: number | null }>({
        open: false,
        id: null
    });

    // Snackbar State
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info';
    }>({ open: false, message: '', severity: 'success' });

    // Upload State
    const [file, setFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
    const [uploadMessage, setUploadMessage] = useState<string>('');
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Validation state
    const [validatedTrades, setValidatedTrades] = useState<ParsedTrade[]>([]);
    const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
    const [summary, setSummary] = useState<TradeSummary>({ 
        totalBuys: 0, 
        totalSells: 0, 
        totalExits: 0,
        uniqueSymbols: [], 
        dateRange: null, 
        totalValue: 0 
    });
    const [symbolValidation, setSymbolValidation] = useState<SymbolValidationResult[]>([]);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const { isImporting: isGlobalImporting } = useImport();
    const [showUploadSection, setShowUploadSection] = useState(false);
    // Existing holdings for discrepancy validation
    const [existingHoldings, setExistingHoldings] = useState<Record<string, number>>({});
    // Sync Orders state
    const [isSyncing, setIsSyncing] = useState(false);
    // Initialize preview state with known mappings
    
    const hasSearchFilter = Boolean(filterValue);
    
    // Grouping Logic
    const groupedTransactions = useMemo(() => {
        const filtered = initialTransactions.filter((item) => {
            const matchesSearch = hasSearchFilter 
                ? item.symbol.toLowerCase().includes(filterValue.toLowerCase())
                : true;
            const isNotCorporateAction = !['SPLIT', 'BONUS'].includes(item.type);
            return matchesSearch && isNotCorporateAction;
        });

        const groups = new Map<string, GroupedTransaction>();

        for (const t of filtered) {
            // Key: Date + Symbol + Type
            const dateStr = format(new Date(t.date), 'yyyy-MM-dd');
            const key = `${dateStr}-${t.symbol}-${t.type}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    id: key,
                    date: new Date(t.date),
                    symbol: t.symbol,
                    type: t.type,
                    quantity: 0,
                    avgPrice: 0,
                    totalAmount: 0,
                    transactions: []
                });
            }

            const group = groups.get(key)!;
            group.transactions.push(t);
            group.quantity += t.quantity;
            group.totalAmount += (t.quantity * t.price);
        }

        // Finalize averages
        const result: GroupedTransaction[] = [];
        for (const g of groups.values()) {
            g.avgPrice = g.quantity > 0 ? g.totalAmount / g.quantity : 0;
            // Sort internal transactions by ID or creation?
            g.transactions.sort((a, b) => b.id - a.id);
            result.push(g);
        }

        // Sort groups by date descending
        // Sort groups by date descending
        return result.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [initialTransactions, hasSearchFilter, filterValue]);

    // Daily Grouping Logic
    const dailyGroups = useMemo(() => {
        const filtered = initialTransactions.filter((item) => {
            const matchesSearch = hasSearchFilter 
                ? item.symbol.toLowerCase().includes(filterValue.toLowerCase())
                : true;
            const isNotCorporateAction = !['SPLIT', 'BONUS'].includes(item.type);
            return matchesSearch && isNotCorporateAction;
        });

        const groups = new Map<string, DailyGroup>();

        for (const t of filtered) {
            const dateStr = format(new Date(t.date), 'yyyy-MM-dd');
            
            if (!groups.has(dateStr)) {
                groups.set(dateStr, {
                    dateStr,
                    date: new Date(t.date),
                    transactions: [],
                    netCashflow: 0,
                    count: 0
                });
            }

            const group = groups.get(dateStr)!;
            group.transactions.push(t);
            group.count += 1;
            
            // Cashflow: Buy is outflow (-), Sell is inflow (+)
            const amount = t.quantity * t.price;
            if (t.type === 'BUY') {
                group.netCashflow -= amount;
            } else {
                group.netCashflow += amount;
            }
        }

        const result = Array.from(groups.values());
        // Sort by date descending
        return result.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [initialTransactions, hasSearchFilter, filterValue]);

    // Flatten the data for proper virtualization of expanded rows
    const flattenedItems = useMemo(() => {
        const result: FlatItem[] = [];

        if (viewMode === 'default') {
            groupedTransactions.forEach(group => {
                result.push({ type: 'group', data: group });
                if (expandedGroups.has(group.id)) {
                    result.push({ type: 'group-detail', parent: group });
                }
            });
        } else {
            dailyGroups.forEach(group => {
                result.push({ type: 'daily', data: group });
                if (expandedDailyGroups.has(group.dateStr)) {
                    result.push({ type: 'daily-detail', parent: group });
                }
            });
        }
        return result;
    }, [viewMode, groupedTransactions, dailyGroups, expandedGroups, expandedDailyGroups]);

    const handleAdd = () => {
        setEditingTrade(null);
        setIsDialogOpen(true);
    };

    const handleEdit = (trade: Transaction) => {
        setEditingTrade(trade);
        setIsDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        setDeleteConfirmation({ open: true, id });
    };

    const confirmDelete = async () => {
        if (deleteConfirmation.id) {
            try {
                await deleteTransaction(deleteConfirmation.id);
                setSnackbar({ open: true, message: 'Trade deleted successfully', severity: 'success' });
            } catch (error) {
                console.error("Failed to delete trade", error);
                setSnackbar({ open: true, message: 'Failed to delete trade', severity: 'error' });
            }
        }
        setDeleteConfirmation({ open: false, id: null });
    };

    const cancelDelete = () => {
        setDeleteConfirmation({ open: false, id: null });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSubmit = async (data: any) => {
        try {
            if (editingTrade) {
                await updateTransaction(editingTrade.id, data);
                setSnackbar({ open: true, message: 'Trade updated successfully', severity: 'success' });
            } else {
                await addTransaction(data);
                setSnackbar({ open: true, message: 'Trade added successfully', severity: 'success' });
            }
            setIsDialogOpen(false);
        } catch (error) {
            console.error("Failed to save trade", error);
            setSnackbar({ open: true, message: 'Failed to save trade', severity: 'error' });
        }
    };






    
    const toggleGroup = (groupId: string) => {
        const newSet = new Set(expandedGroups);
        if (newSet.has(groupId)) {
            newSet.delete(groupId);
        } else {
            newSet.add(groupId);
        }
        setExpandedGroups(newSet);
    };

    const toggleDailyGroup = (dateStr: string) => {
        const newSet = new Set(expandedDailyGroups);
        if (newSet.has(dateStr)) {
            newSet.delete(dateStr);
        } else {
            newSet.add(dateStr);
        }
        setExpandedDailyGroups(newSet);
    };

    // Upload Functions
    const validateFileType = (fileToValidate: File): { valid: boolean; error?: string } => {
        if (!fileToValidate.name.endsWith('.csv')) {
            return { valid: false, error: 'Please upload a CSV file' };
        }
        if (fileToValidate.size > 10 * 1024 * 1024) {
            return { valid: false, error: 'File size must be less than 10MB' };
        }
        return { valid: true };
    };

    const handleFile = useCallback((selectedFile: File) => {
        setUploadStatus('validating');
        setUploadMessage('Validating file...');
        
        const validation = validateFileType(selectedFile);
        if (!validation.valid) {
            setUploadStatus('error');
            setUploadMessage(validation.error || 'Invalid file');
            return;
        }

        setFile(selectedFile);
        handleValidateAndPreview(selectedFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleValidateAndPreview = async (fileOrEvent: React.FormEvent | File) => {
        let currentFile = file;

        if (fileOrEvent instanceof File) {
            currentFile = fileOrEvent;
        } else if (fileOrEvent && 'preventDefault' in fileOrEvent) {
            fileOrEvent.preventDefault();
        }
        
        if (!currentFile) {
            setUploadStatus('idle');
            return;
        }

        setUploadStatus('validating');
        setUploadMessage('Parsing and validating trades...');
        setUploadProgress(20);

        try {
            const csvContent = await currentFile.text();
            setUploadProgress(50);
            
            const result = validateTradebook(csvContent);
            
            setUploadProgress(80);

            if (!result.success) {
                setUploadStatus('error');
                setUploadMessage(result.error || 'Failed to parse CSV file');
                setUploadProgress(0);
                return;
            }

            // Apply existing symbol mappings
            const mappedTrades = result.trades.map(t => {
                const mappedSymbol = initialMappings[t.symbol];
                if (mappedSymbol) {
                    return { ...t, symbol: mappedSymbol };
                }
                return t;
            });

            setUploadMessage('Verifying symbols with live market data...');
            let validationResults: SymbolValidationResult[] = [];
            let autoResolvedTrades = [...mappedTrades];

            try {
                // Get unique symbols with ISIN from MAPPED trades
                const uniqueInputsMap = new Map<string, { symbol: string, isin?: string }>();
                mappedTrades.forEach(t => {
                     // Collect ISIN data
                     if (!uniqueInputsMap.has(t.symbol) || (t.isin && !uniqueInputsMap.get(t.symbol)?.isin)) {
                         uniqueInputsMap.set(t.symbol, { symbol: t.symbol, isin: t.isin });
                     }
                });
                
                // Call validation with objects including ISIN
                validationResults = await validateSymbols(Array.from(uniqueInputsMap.values()));
                
                // Apply Auto-Resolutions
                const autoResolutions = new Map<string, string>();
                validationResults.forEach(res => {
                    if (res.resolvedSymbol && res.originalSymbol) {
                        autoResolutions.set(res.originalSymbol, res.resolvedSymbol);
                    }
                });

                if (autoResolutions.size > 0) {
                    autoResolvedTrades = mappedTrades.map(t => {
                        const newSym = autoResolutions.get(t.symbol);
                        return newSym ? { ...t, symbol: newSym } : t;
                    });
                }

            } catch (err) {
                console.error("Symbol validation failed (non-blocking):", err);
            }

            // Fetch existing stock quantities to use as starting balance for discrepancy detection
            setUploadMessage('Checking against existing holdings...');
            let fetchedHoldings: Record<string, number> = {};
            try {
                fetchedHoldings = await getCurrentStockQuantities();
            } catch (err) {
                console.error("Failed to fetch existing holdings (non-blocking):", err);
            }
            setExistingHoldings(fetchedHoldings);

            setValidatedTrades(autoResolvedTrades);
            // Re-detect discrepancies on validated (and potentially resolved) trades WITH existing holdings
            // This prevents false positives when selling shares you already own
            setDiscrepancies(detectDiscrepancies(autoResolvedTrades, fetchedHoldings));
            setSummary(generateSummary(autoResolvedTrades));
            
            setSymbolValidation(validationResults);
            
            setUploadStatus('preview');
            setIsPreviewOpen(true);
            setUploadProgress(0);
        } catch (error: unknown) {
            console.error(error);
            const errorMessage = error instanceof Error ? error.message : 'An error occurred while processing the file';
            setUploadStatus('error');
            setUploadMessage(errorMessage);
            setUploadProgress(0);
        }
    };


    const handleConfirmImport = async (filteredTrades?: ParsedTrade[], symbolMappings?: Record<string, string>) => {
        if (!file && !filteredTrades) return;

        // Reset local UI immediately
        setIsPreviewOpen(false);
        setShowUploadSection(false);
        setUploadStatus('idle');
        setUploadProgress(0);
        setFile(null); // Optional: clear file selection

        const formData = new FormData();
        
        if (filteredTrades) {
            formData.append('trades_json', JSON.stringify(filteredTrades));
        } else if (file) {
            formData.append('file', file);
        }

        // Add mappings if any
        if (symbolMappings) {
            formData.append('mappings', JSON.stringify(symbolMappings));
        }

        try {
            setSnackbar({ open: true, message: 'Import started...', severity: 'info' });

            // Trigger background import
            await processZerodhaUpload(formData);
            
            // Success handled by JobProgress completion or here
        } catch (e) {
            console.error("Import failed:", e);
            const msg = e instanceof Error ? e.message : 'Import failed';
            setSnackbar({ open: true, message: msg, severity: 'error' });
            // JobProgress will show failed state
        }
    };



    const handleClosePreview = () => {
        setIsPreviewOpen(false);
        setUploadStatus('idle');
        setUploadProgress(0);
    };

    const handleUploadReset = () => {
        setFile(null);
        setUploadStatus('idle');
        setUploadMessage('');
        setUploadProgress(0);
        setValidatedTrades([]);
        setDiscrepancies([]);
        setSummary({ totalBuys: 0, totalSells: 0, totalExits: 0, uniqueSymbols: [], dateRange: null, totalValue: 0 });
        setSymbolValidation([]);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Sync Orders Handler
    const handleSyncOrders = async () => {
        if (isSyncing) return;
        
        setIsSyncing(true);
        setSnackbar({ open: true, message: 'Checking sync status...', severity: 'info' });
        
        try {
            const response = await fetch('/api/sync-orders?source=manual', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' } // Trigger SSE response
            });
            
            // Read SSE stream for instructions
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let finalMessage = '';
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const text = decoder.decode(value);
                    const lines = text.split('\n').filter(line => line.startsWith('data: '));
                    
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            finalMessage = data.message || finalMessage;
                            
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            
                            if (data.done) {
                                // Show instructions using message from server
                                setSnackbar({ 
                                    open: true, 
                                    message: data.message || 'Sync check complete.', 
                                    severity: 'info' 
                                });
                                return;
                            }
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
            
            // Fallback message
            setSnackbar({ 
                open: true, 
                message: 'To sync orders, run: npx tsx src/scripts/zerodha-cron.ts', 
                severity: 'info' 
            });
            
        } catch (error) {
            console.error('Sync error:', error);
            const msg = error instanceof Error ? error.message : 'Sync failed';
            setSnackbar({ open: true, message: msg, severity: 'error' });
        } finally {
            setIsSyncing(false);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    };

    return (
        <div className="flex flex-col gap-4 h-full">
            {/* Header and Actions Row */}
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h1 className="text-xl md:text-3xl font-bold shrink-0">
                    <span className="gradient-text">Trades</span>
                </h1>

                <div className="flex items-center gap-3 ml-auto">
                    <TextField
                        placeholder="Search by symbol..."
                        value={filterValue}
                        onChange={(e) => {
                            setFilterValue(e.target.value);
                        }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon sx={{ color: 'gray' }} />
                                </InputAdornment>
                            ),
                            endAdornment: filterValue && (
                                <InputAdornment position="end">
                                    <IconButton onClick={() => setFilterValue("")} size="small">
                                        <CloseIcon sx={{ color: 'gray' }} />
                                    </IconButton>
                                </InputAdornment>
                            ),
                            sx: { 
                                backgroundColor: 'rgba(255,255,255,0.05)', 
                                borderRadius: '0.75rem',
                                '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                                color: 'white',
                                height: '40px',
                            }
                        }}
                        sx={{ width: '320px' }}
                        variant="outlined"
                        size="small"
                    />

                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={(e, newMode) => {
                            if (newMode) {
                                setViewMode(newMode);
                            }
                        }}
                        aria-label="view mode"
                        size="small"
                        sx={{
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '50px',
                            height: '40px',
                            '& .MuiToggleButton-root': {
                                color: '#9ca3af',
                                border: 'none',
                                textTransform: 'none',
                                px: 2,
                                borderRadius: 'inherit',
                                '&.Mui-selected': {
                                    color: '#60a5fa',
                                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                    '&:hover': {
                                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    }
                                }
                            }
                        }}
                    >
                        <ToggleButton value="default">
                            <ViewListIcon sx={{ mr: 1, fontSize: 20 }} />
                            Default
                        </ToggleButton>
                        <ToggleButton value="daily">
                            <CalendarViewMonthIcon sx={{ mr: 1, fontSize: 20 }} />
                            Daily Summary
                        </ToggleButton>
                    </ToggleButtonGroup>

                    <Tooltip title="Add Trade">
                        <IconButton 
                            onClick={handleAdd}
                            className="hidden sm:inline-flex"
                            sx={{ 
                                background: 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)',
                                borderRadius: '0.75rem',
                                color: 'white',
                                width: '40px',
                                height: '40px',
                                '&:hover': {
                                    opacity: 0.9,
                                }
                            }}
                        >
                            <AddIcon />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title="Upload CSV">
                        <IconButton 
                            onClick={() => setShowUploadSection(!showUploadSection)}
                            className="hidden sm:inline-flex"
                            sx={{ 
                                background: showUploadSection ? 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)' : 'rgba(255,255,255,0.05)',
                                borderRadius: '0.75rem',
                                color: showUploadSection ? 'white' : 'rgba(255,255,255,0.7)',
                                border: '1px solid',
                                borderColor: showUploadSection ? 'transparent' : 'rgba(255,255,255,0.2)',
                                width: '40px',
                                height: '40px',
                                '&:hover': {
                                    backgroundColor: showUploadSection ? undefined : 'rgba(255,255,255,0.1)',
                                    borderColor: 'rgba(255,255,255,0.4)',
                                }
                            }}
                        >
                            <FileUploadIcon />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title="Sync Orders from Zerodha">
                        <IconButton 
                            onClick={handleSyncOrders}
                            disabled={isSyncing || isGlobalImporting}
                            sx={{ 
                                background: isSyncing ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)',
                                borderRadius: '0.75rem',
                                color: isSyncing ? '#60a5fa' : 'rgba(255,255,255,0.7)',
                                border: '1px solid',
                                borderColor: isSyncing ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255,255,255,0.2)',
                                width: '40px',
                                height: '40px',
                                '&:hover': {
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    borderColor: 'rgba(59, 130, 246, 0.5)',
                                },
                                '&.Mui-disabled': {
                                    color: 'rgba(255,255,255,0.3)',
                                }
                            }}
                        >
                            {isSyncing ? (
                                <CircularProgress size={20} color="inherit" />
                            ) : (
                                <SyncIcon />
                            )}
                        </IconButton>
                    </Tooltip>
                </div>
            </div>

            <Collapse in={showUploadSection}>
                <div className="glass-card p-4 space-y-4">
                    <form onSubmit={handleValidateAndPreview} className="space-y-3">
                        {/* File Selection Zone */}
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`
                                relative p-4 rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer
                                ${uploadStatus === 'error' 
                                    ? 'border-red-500/50 bg-red-500/5' 
                                    : uploadStatus === 'success'
                                    ? 'border-emerald-500/50 bg-emerald-500/5'
                                    : 'border-white/20 hover:border-blue-500/50 hover:bg-white/5'
                                }
                            `}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            
                            {!file ? (
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center border border-white/10">
                                        <FontAwesomeIcon icon={faFile} className="text-blue-400 text-lg" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-medium text-white">Click to select CSV file</h3>
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            Select the tradebook file downloaded from Zerodha
                                        </p>
                                    </div>
                                    <div className="flex gap-2 text-[10px] text-gray-500">
                                        <span className="px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10">.CSV only</span>
                                        <span className="px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10">Max 10MB</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-500/30 flex-shrink-0">
                                        <FontAwesomeIcon icon={faCircleCheck} className="text-emerald-400 text-lg" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm text-white truncate">{file.name}</p>
                                        <p className="text-xs text-gray-400">{formatFileSize(file.size)} • CSV Document</p>
                                    </div>
                                    {uploadStatus === 'idle' && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleUploadReset(); }}
                                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                                        >
                                            <span className="text-base">✕</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Progress Bar */}
                        {(uploadStatus === 'validating' || uploadStatus === 'uploading' || uploadStatus === 'processing') && (
                            <div className="space-y-1 animate-fade-in">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-400">{uploadMessage}</span>
                                    <span className="text-blue-400">{uploadProgress}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Status Messages */}
                        {uploadStatus === 'success' && (
                            <div className="p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 animate-fade-in">
                                <div className="flex items-center gap-2">
                                    <FontAwesomeIcon icon={faCheckCircle} className="text-emerald-400 text-xl" />
                                    <div>
                                        <p className="font-semibold text-sm text-emerald-400">{uploadMessage}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">Your trades have been added to the portfolio</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {uploadStatus === 'error' && (
                            <div className="p-3 rounded-lg bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30 animate-fade-in">
                                <div className="flex items-center gap-2">
                                    <FontAwesomeIcon icon={faTriangleExclamation} className="text-red-400 text-xl" />
                                    <div>
                                        <p className="font-semibold text-sm text-red-400">Upload Failed</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{uploadMessage}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Action Button */}
                        {uploadStatus !== 'success' && (
                            <Button
                                type="button"
                                onClick={() => {
                                    if (file && !['validating', 'uploading', 'processing'].includes(uploadStatus)) {
                                        handleValidateAndPreview({ preventDefault: () => {} } as React.FormEvent);
                                    }
                                }}
                                disabled={!file || ['validating', 'uploading', 'processing'].includes(uploadStatus)}
                                className="w-full btn-gradient font-semibold shadow-lg hover:shadow-blue-500/25 py-3 text-sm"
                                variant="contained"
                                sx={{ 
                                    background: 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)',
                                    '&:disabled': { opacity: 0.5, cursor: 'not-allowed', background: 'gray' }
                                }}
                            >
                                {['validating', 'uploading', 'processing'].includes(uploadStatus) ? (
                                    <div className="flex items-center gap-2">
                                        <CircularProgress size={16} color="inherit" />
                                        <span>
                                            {uploadStatus === 'validating' ? 'Validating...' : 'Processing...'}
                                        </span>
                                    </div>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <FontAwesomeIcon icon={faClipboardCheck} />
                                        Validate & Preview
                                    </span>
                                )}
                            </Button>
                        )}

                        {uploadStatus === 'success' && (
                            <Button
                                onClick={handleUploadReset}
                                variant="outlined"
                                className="w-full text-gray-400 hover:text-white border-white/20 hover:border-white/40 py-3 text-sm"
                                sx={{ borderColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', '&:hover': { color: 'white', borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.05)' } }}
                            >
                                Upload Another
                            </Button>
                        )}
                    </form>

                    {/* Help Text */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
                        <div>
                            <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                <FontAwesomeIcon icon={faLightbulb} className="text-yellow-400" />Need to export your trades?
                            </h3>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                                Download your tradebook from Zerodha Console
                            </p>
                        </div>
                        <a 
                            href="https://console.zerodha.com/reports/tradebook" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 text-[10px] font-medium transition-all border border-blue-500/20 hover:border-blue-500/40"
                        >
                            Open console
                        </a>
                    </div>
                </div>
            </Collapse>
            
            {flattenedItems.length > 0 ? (
                 <Paper className="glass-card" sx={{ height: 'calc(100vh - 180px)', backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none', overflow: 'hidden' }}>
                    <TableVirtuoso
                        data={flattenedItems}
                        components={{
                            Scroller: VirtuosoScroller,
                            Table: VirtuosoTable,
                            TableHead: VirtuosoTableHead,
                            TableBody: VirtuosoTableBody,
                            TableRow: StyledTableRow, // Using styled row directly
                        }}
                        fixedHeaderContent={() => (
                           <TableRow sx={{ background: 'linear-gradient(to right, rgba(59, 130, 246, 0.1), rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1))' }}>
                                {viewMode === 'default' ? (
                                    <>
                                        <TableCell width="50" sx={{ backgroundColor: '#111827', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }} />
                                        <TableCell sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Date</TableCell>
                                        <TableCell sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Symbol</TableCell>
                                        <TableCell sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Type</TableCell>
                                        <TableCell align="right" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Total Qty</TableCell>
                                        <TableCell align="right" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Avg Price</TableCell>
                                        <TableCell align="right" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Total Amount</TableCell>
                                        <TableCell align="center" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Actions</TableCell>
                                    </>
                                ) : (
                                    <>
                                        <TableCell width="50" sx={{ backgroundColor: '#111827', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }} />
                                        <TableCell sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Date</TableCell>
                                        <TableCell align="center" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Transactions Count</TableCell>
                                        <TableCell align="right" sx={{ backgroundColor: '#111827', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', py: 2 }}>Net Cashflow</TableCell>
                                    </>
                                )}
                           </TableRow>
                        )}
                        itemContent={(index, item: FlatItem) => {
                            if (item.type === 'group') {
                                const group = item.data;
                                const isExpanded = expandedGroups.has(group.id);
                                const hasMultiple = group.transactions.length > 1;

                                return (
                                    <>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            {hasMultiple && (
                                                <IconButton aria-label="expand row" size="small" onClick={(e) => { e.stopPropagation(); toggleGroup(group.id); }}>
                                                    {isExpanded ? <KeyboardArrowUpIcon sx={{ color: 'gray' }} /> : <KeyboardArrowDownIcon sx={{ color: 'gray' }} />}
                                                </IconButton>
                                            )}
                                        </TableCell>
                                        <TableCell sx={{ color: '#d1d5db', borderBottom: 'none' }}>
                                            {format(group.date, 'dd MMM yyyy')}
                                        </TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-white">
                                                    {group.symbol}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            <div className={`
                                                inline-flex items-center px-2 py-0.5 rounded text-xs font-bold
                                                ${group.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
                                            `}>
                                                {group.type}
                                            </div>
                                        </TableCell>
                                        <TableCell align="right" sx={{ color: '#d1d5db', borderBottom: 'none' }}>{formatNumber(group.quantity, 0, 0)}</TableCell>
                                        <TableCell align="right" sx={{ color: '#d1d5db', borderBottom: 'none' }}>{formatCurrency(group.avgPrice, 2, 2)}</TableCell>
                                        <TableCell align="right" sx={{ color: '#9ca3af', borderBottom: 'none' }}>
                                            {formatCurrency(group.totalAmount, 0, 0)}
                                        </TableCell>
                                        <TableCell align="center" sx={{ color: 'gray', borderBottom: 'none' }}>
                                            {hasMultiple ? group.transactions.length : (
                                                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                                                    <Tooltip title="Edit trade">
                                                        <IconButton 
                                                            onClick={() => handleEdit(group.transactions[0])}
                                                            size="small"
                                                            sx={{ color: '#9ca3af', '&:hover': { color: '#60a5fa' } }}
                                                        >
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Delete trade">
                                                        <IconButton 
                                                            onClick={() => handleDelete(group.transactions[0].id)}
                                                            size="small"
                                                            sx={{ color: '#6b7280', '&:hover': { color: '#f87171' } }}
                                                        >
                                                            <DeleteIcon sx={{ fontSize: 16 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            )}
                                        </TableCell>
                                    </>
                                );
                            } else if (item.type === 'group-detail') {
                                const group = item.parent;
                                return (
                                    <TableCell style={{ paddingBottom: 0, paddingTop: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }} colSpan={8}>
                                        <Box sx={{ margin: 1 }}>
                                            <Table size="small" aria-label="purchases">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }}>Time/ID</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="right">Qty</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="right">Price</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="center">Actions</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {group.transactions.map((tx) => (
                                                        <TableRow key={tx.id}>
                                                            <TableCell component="th" scope="row" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                                                                #{tx.id}
                                                            </TableCell>
                                                            <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>{formatNumber(tx.quantity, 0, 0)}</TableCell>
                                                            <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>{formatCurrency(tx.price, 2, 2)}</TableCell>
                                                            <TableCell align="center">
                                                                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                                                                    <IconButton onClick={() => handleEdit(tx)} size="small" sx={{ color: '#6b7280', '&:hover': { color: '#60a5fa' } }}>
                                                                        <EditIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                    <IconButton onClick={() => handleDelete(tx.id)} size="small" sx={{ color: '#6b7280', '&:hover': { color: '#f87171' } }}>
                                                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </Box>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </Box>
                                    </TableCell>
                                );
                            } else if (item.type === 'daily') {
                                const group = item.data;
                                const isExpanded = expandedDailyGroups.has(group.dateStr);

                                return (
                                    <>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            <IconButton aria-label="expand row" size="small" onClick={(e) => { e.stopPropagation(); toggleDailyGroup(group.dateStr); }}>
                                                {isExpanded ? <KeyboardArrowUpIcon sx={{ color: 'gray' }} /> : <KeyboardArrowDownIcon sx={{ color: 'gray' }} />}
                                            </IconButton>
                                        </TableCell>
                                        <TableCell sx={{ color: '#d1d5db', borderBottom: 'none' }}>
                                            {format(group.date, 'dd MMM yyyy')}
                                        </TableCell>
                                        <TableCell align="center" sx={{ color: '#d1d5db', borderBottom: 'none' }}>
                                            {group.count}
                                        </TableCell>
                                        <TableCell align="right" sx={{ borderBottom: 'none' }}>
                                            <span className={group.netCashflow >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                    {group.netCashflow >= 0 ? '+' : ''}{formatCurrency(Math.abs(group.netCashflow), 2, 2)}
                                            </span>
                                        </TableCell>
                                    </>
                                );
                            } else if (item.type === 'daily-detail') {
                                const group = item.parent;
                                return (
                                    <TableCell style={{ paddingBottom: 0, paddingTop: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }} colSpan={4}>
                                        <Box sx={{ margin: 1.5 }}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }}>Symbol</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }}>Type</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="right">Qty</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="right">Price</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="right">Amount</TableCell>
                                                        <TableCell sx={{ color: 'gray', fontSize: '0.7rem' }} align="center">Actions</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {group.transactions.map((tx) => (
                                                        <TableRow key={tx.id}>
                                                            <TableCell sx={{ color: '#white', fontSize: '0.8rem', fontWeight: 600 }}>{tx.symbol}</TableCell>
                                                            <TableCell>
                                                                <span className={`
                                                                    px-1.5 py-0.5 rounded text-[10px] font-bold
                                                                    ${tx.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
                                                                `}>
                                                                    {tx.type}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>{formatNumber(tx.quantity, 0, 0)}</TableCell>
                                                            <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>{formatCurrency(tx.price, 2, 2)}</TableCell>
                                                            <TableCell align="right" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                                                                {formatCurrency(tx.quantity * tx.price, 2, 2)}
                                                            </TableCell>
                                                            <TableCell align="center">
                                                                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                                                                    <IconButton onClick={() => handleEdit(tx)} size="small" sx={{ color: '#6b7280', '&:hover': { color: '#60a5fa' } }}>
                                                                        <EditIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                    <IconButton onClick={() => handleDelete(tx.id)} size="small" sx={{ color: '#6b7280', '&:hover': { color: '#f87171' } }}>
                                                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </Box>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </Box>
                                    </TableCell>
                                );
                            }
                            return <></>; // Fallback
                        }}
                    />
                 </Paper>
             ) : ( 
                 <TableContainer component={Paper} className="glass-card" sx={{ backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none', flex: 1, overflow: 'auto' }}>
                     <Table 
                         sx={{ minWidth: 650 }} 
                         aria-label="trades table"
                         size="small"
                     >
                        <TableBody>
                             <TableRow>
                                <TableCell colSpan={8} sx={{ borderBottom: 'none', py: 8 }}>
                                    <div className="flex flex-col items-center justify-center text-gray-500">
                                        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                                            <FontAwesomeIcon icon={faInbox} className="text-3xl opacity-50" />
                                        </div>
                                        <p className="text-lg font-medium text-gray-400">
                                            {hasSearchFilter ? 'No trades found' : 'No trades yet'}
                                        </p>
                                        <p className="text-sm text-gray-600 mt-1">
                                            {hasSearchFilter ? `No results for "${filterValue}"` : 'Get started by adding a new trade or uploading a CSV'}
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                         </TableBody>
                     </Table>
                 </TableContainer>
             )}
             
            {/* Pagination Removed */}
            <Box sx={{ display: 'none' }}>
                {/* Placeholder to keep layout if needed, but we removed it */}
            </Box>

            <TradeDialog 
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSubmit={handleSubmit}
                initialData={editingTrade}
            />


            {/* Delete Confirmation Dialog */}
             <Dialog
                open={deleteConfirmation.open}
                onClose={cancelDelete}
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
                <DialogTitle sx={{ color: 'white' }}>Confirm Delete</DialogTitle>
                <DialogContent>
                    <div className="text-gray-300">
                        Are you sure you want to delete this trade? This action cannot be undone.
                    </div>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={cancelDelete} sx={{ color: 'gray' }}>
                        Cancel
                    </Button>
                    <Button onClick={confirmDelete} color="error" autoFocus>
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>

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

            {/* Upload Preview Modal */}
            <UploadPreviewModal
                isOpen={isPreviewOpen}
                onClose={handleClosePreview}
                onConfirm={handleConfirmImport}
                trades={validatedTrades}
                discrepancies={discrepancies}
                summary={summary}
                isLoading={isGlobalImporting}
                validationResults={symbolValidation}
                existingHoldings={existingHoldings}
            />
        </div>
    );
}
