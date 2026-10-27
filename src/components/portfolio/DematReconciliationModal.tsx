'use client';

import { useState, useMemo, forwardRef } from 'react';
import Dialog from '@mui/material/Dialog';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faBuildingColumns, 
  faXmark, 
  faRotateRight, 
  faTriangleExclamation, 
  faCheck,
  faLayerGroup,
  faCircleExclamation
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { DematReconciliationResult, DematReconciliationItem } from '@/lib/types';

const Transition = forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

// Styled Components
const StyledHeaderCell = styled(TableCell)(() => ({
  backgroundColor: '#0f172a',
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  padding: '10px 14px',
}));

const StyledCell = styled(TableCell)(() => ({
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color: '#d1d5db',
  padding: '10px 14px',
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
}));

interface DematReconciliationModalProps {
  open: boolean;
  onClose: () => void;
  data: DematReconciliationResult | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  privacyMode?: boolean;
}

type TabType = 'all' | 'discrepancy' | 'missing_in_alpha' | 'missing_in_demat' | 'matched';

export default function DematReconciliationModal({
  open,
  onClose,
  data,
  isLoading,
  error,
  onRefresh,
  privacyMode = false,
}: DematReconciliationModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('all');

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (activeTab === 'all') return data.items;
    return data.items.filter(it => it.status === activeTab);
  }, [data, activeTab]);

  const summary = data?.summary;
  const hasDiscrepancy = (summary?.discrepancyCount ?? 0) > 0 || (summary?.missingInAlphaCount ?? 0) > 0 || (summary?.missingInDematCount ?? 0) > 0;

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      slots={{ transition: Transition }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: '#0b0f19',
            color: '#fff',
            backgroundImage: 'radial-gradient(ellipse at top, rgba(30, 41, 59, 0.5) 0%, rgba(11, 15, 25, 0.95) 70%)'
          }
        }
      }}
    >
      {/* Header */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: { xs: 2, sm: 3 },
        py: 1.5,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        bgcolor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(10px)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ 
            width: 36, 
            height: 36, 
            borderRadius: 2, 
            bgcolor: 'rgba(245, 158, 11, 0.1)', 
            border: '1px solid rgba(245, 158, 11, 0.2)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#f59e0b'
          }}>
            <FontAwesomeIcon icon={faBuildingColumns} />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 700, color: '#f3f4f6' }}>
                Zerodha Demat Reconciliation
              </Typography>
              {summary && (
                <Chip
                  size="small"
                  icon={<FontAwesomeIcon icon={hasDiscrepancy ? faTriangleExclamation : faCheck} size="xs" style={{ color: 'inherit' }} />}
                  label={hasDiscrepancy ? `${(summary.discrepancyCount + summary.missingInAlphaCount + summary.missingInDematCount)} Discrepancies` : '100% In Sync'}
                  sx={{
                    height: 22,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: hasDiscrepancy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                    color: hasDiscrepancy ? '#f87171' : '#4ade80',
                    border: `1px solid ${hasDiscrepancy ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
                  }}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Comparing Alpha transaction ledger vs true Zerodha Demat holdings (diagnostic only)
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={onRefresh}
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} size="xs" />}
            sx={{
              color: '#d1d5db',
              borderColor: 'rgba(255,255,255,0.15)',
              textTransform: 'none',
              fontSize: '0.75rem',
              height: 32,
              '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.03)' }
            }}
          >
            Refresh Demat
          </Button>
          <IconButton 
            onClick={onClose} 
            size="small"
            sx={{ 
              color: '#9ca3af',
              bgcolor: 'rgba(255,255,255,0.05)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', color: '#fff' }
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </IconButton>
        </Box>
      </Box>

      {/* Main Container */}
      <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              bgcolor: 'rgba(239, 68, 68, 0.1)', 
              color: '#f87171', 
              border: '1px solid rgba(239, 68, 68, 0.2)' 
            }}
          >
            {error}
          </Alert>
        )}

        {/* Summary Metrics Bar */}
        {summary && (
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, 
            gap: 1.5 
          }}>
            {/* 1. Demat Assets */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Zerodha Demat Value
              </Typography>
              <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {privacyMode ? '••••••' : formatCurrency(summary.totalDematValue)}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {summary.totalDematStocks} total Demat stocks
              </Typography>
            </Box>

            {/* 2. Alpha Tracked Assets */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Alpha Tracked Value
              </Typography>
              <Typography sx={{ color: '#60a5fa', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {privacyMode ? '••••••' : formatCurrency(summary.totalAlphaValue)}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {summary.totalAlphaStocks} tracked in Alpha
              </Typography>
            </Box>

            {/* 3. Net Value Difference */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Ledger Variance
              </Typography>
              <Typography sx={{ 
                color: Math.abs(summary.netDifferenceValue) < 1 ? '#4ade80' : '#fbbf24', 
                fontSize: '1.1rem', 
                fontWeight: 700, 
                mt: 0.5 
              }}>
                {privacyMode ? '••••••' : (summary.netDifferenceValue >= 0 ? '+' : '') + formatCurrency(summary.netDifferenceValue)}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {Math.abs(summary.netDifferenceValue) < 1 ? 'Balanced' : 'Tracking discrepancy'}
              </Typography>
            </Box>

            {/* 4. Matched Stocks */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Matched Holdings
              </Typography>
              <Typography sx={{ color: '#4ade80', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {summary.matchedCount}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                Exact quantity matches
              </Typography>
            </Box>

            {/* 5. T1 Unsettled Shares */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                T+1 Unsettled Shares
              </Typography>
              <Typography sx={{ color: summary.totalT1Shares > 0 ? '#38bdf8' : '#94a3b8', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {summary.totalT1Shares}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                Pending depository credit
              </Typography>
            </Box>

            {/* 6. Pledged Collateral */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Pledged Shares
              </Typography>
              <Typography sx={{ color: summary.totalPledgedShares > 0 ? '#f472b6' : '#94a3b8', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {summary.totalPledgedShares}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                Collateral for margin
              </Typography>
            </Box>
          </Box>
        )}

        {/* Diagnostic Tabs */}
        {summary && (
          <Box sx={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <Tabs 
              value={activeTab} 
              onChange={(_, val) => setActiveTab(val)}
              sx={{
                minHeight: 40,
                '& .MuiTab-root': {
                  minHeight: 40,
                  py: 1,
                  px: 2,
                  fontSize: '0.8rem',
                  textTransform: 'none',
                  color: '#9ca3af',
                  '&.Mui-selected': { color: '#60a5fa', fontWeight: 700 }
                },
                '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' }
              }}
            >
              <Tab label={`All (${data?.items.length ?? 0})`} value="all" />
              <Tab 
                label={`Discrepancies (${summary.discrepancyCount})`} 
                value="discrepancy" 
                sx={{
                  color: summary.discrepancyCount > 0 ? '#f87171 !important' : undefined
                }}
              />
              <Tab label={`Missing in Alpha (${summary.missingInAlphaCount})`} value="missing_in_alpha" />
              <Tab label={`Missing in Demat (${summary.missingInDematCount})`} value="missing_in_demat" />
              <Tab label={`Matched (${summary.matchedCount})`} value="matched" />
            </Tabs>
          </Box>
        )}

        {/* Content Table */}
        <Box sx={{ 
          flex: 1, 
          borderRadius: 2, 
          overflow: 'hidden', 
          border: '1px solid rgba(255,255,255,0.08)',
          bgcolor: 'rgba(15, 23, 42, 0.4)' 
        }}>
          {isLoading ? (
            <Box sx={{ py: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <CircularProgress size={32} sx={{ color: '#f59e0b' }} />
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Querying Zerodha Demat holdings and computing ledger reconciliation...
              </Typography>
            </Box>
          ) : filteredItems.length === 0 ? (
            <Box sx={{ py: 10, textAlign: 'center', color: '#64748b' }}>
              <FontAwesomeIcon icon={faCheck} size="2x" style={{ opacity: 0.3 }} />
              <Typography sx={{ mt: 1, fontSize: '0.9rem' }}>No stocks in this filter view</Typography>
            </Box>
          ) : (
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <StyledHeaderCell>Stock</StyledHeaderCell>
                  <StyledHeaderCell align="right">Alpha Qty</StyledHeaderCell>
                  <StyledHeaderCell align="right">Demat Qty</StyledHeaderCell>
                  <StyledHeaderCell align="right">Difference</StyledHeaderCell>
                  <StyledHeaderCell align="right">Buy Avg (Alpha / Demat)</StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP</StyledHeaderCell>
                  <StyledHeaderCell align="right">Value Delta</StyledHeaderCell>
                  <StyledHeaderCell>Diagnostic Notes</StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredItems.map((item) => {
                  const isMatch = item.status === 'matched';
                  const isDiscrepancy = item.status === 'discrepancy';
                  const isMissingAlpha = item.status === 'missing_in_alpha';
                  const isMissingDemat = item.status === 'missing_in_demat';

                  return (
                    <StyledTableRow key={item.symbol}>
                      {/* Symbol & Name */}
                      <StyledCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                              {item.symbol}
                            </Typography>
                            {item.t1Qty > 0 && (
                              <Tooltip title={`${item.t1Qty} shares bought recently, pending T+1 settlement into Demat`}>
                                <Chip label={`T1: ${item.t1Qty}`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 600 }} />
                              </Tooltip>
                            )}
                            {item.pledgedQty > 0 && (
                              <Tooltip title={`${item.pledgedQty} shares pledged for margin collateral`}>
                                <Chip label={`Pledged: ${item.pledgedQty}`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(244, 114, 182, 0.15)', color: '#f472b6', fontWeight: 600 }} />
                              </Tooltip>
                            )}
                          </Box>
                          <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.7rem' }}>
                            {item.companyName}
                          </Typography>
                        </Box>
                      </StyledCell>

                      {/* Alpha Qty */}
                      <StyledCell align="right">
                        <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#93c5fd' }}>
                          {formatNumber(item.alphaQty)}
                        </Typography>
                      </StyledCell>

                      {/* Demat Qty */}
                      <StyledCell align="right">
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                            {formatNumber(item.dematQty)}
                          </Typography>
                          {item.t1Qty > 0 && (
                            <Typography variant="caption" sx={{ color: '#38bdf8', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                              {item.settledQty !== undefined ? `${formatNumber(item.settledQty)} set. + ${formatNumber(item.t1Qty)} T1` : `${formatNumber(item.t1Qty)} T1`}
                            </Typography>
                          )}
                        </Box>
                      </StyledCell>

                      {/* Difference */}
                      <StyledCell align="right">
                        {isMatch ? (
                          <Chip 
                            label="Match" 
                            size="small" 
                            sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', fontWeight: 700 }} 
                          />
                        ) : (
                          <Typography sx={{ 
                            fontFamily: 'monospace', 
                            fontWeight: 700, 
                            color: item.deltaQty > 0 ? '#4ade80' : '#f87171' 
                          }}>
                            {item.deltaQty > 0 ? `+${formatNumber(item.deltaQty)}` : formatNumber(item.deltaQty)}
                          </Typography>
                        )}
                      </StyledCell>

                      {/* Avg Price */}
                      <StyledCell align="right">
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <Typography sx={{ fontSize: '0.75rem', color: '#93c5fd', fontFamily: 'monospace' }}>
                            {privacyMode ? '•••' : formatCurrency(item.alphaAvgPrice)}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                            {privacyMode ? '•••' : formatCurrency(item.dematAvgPrice)} (Demat)
                          </Typography>
                        </Box>
                      </StyledCell>

                      {/* Current Price */}
                      <StyledCell align="right">
                        <Typography sx={{ fontSize: '0.8rem', color: '#fff', fontFamily: 'monospace' }}>
                          {privacyMode ? '•••' : formatCurrency(item.currentPrice)}
                        </Typography>
                      </StyledCell>

                      {/* Value Delta */}
                      <StyledCell align="right">
                        <Typography sx={{ 
                          fontSize: '0.8rem', 
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: isMatch ? '#64748b' : item.valueDiff >= 0 ? '#4ade80' : '#f87171' 
                        }}>
                          {privacyMode ? '••••••' : (item.valueDiff > 0 ? '+' : '') + formatCurrency(item.valueDiff)}
                        </Typography>
                      </StyledCell>

                      {/* Potential Reason / Diagnostic Notes */}
                      <StyledCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {isDiscrepancy && (
                            <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: '#fbbf24', fontSize: '0.75rem', flexShrink: 0 }} />
                          )}
                          {isMissingAlpha && (
                            <FontAwesomeIcon icon={faCircleExclamation} style={{ color: '#38bdf8', fontSize: '0.75rem', flexShrink: 0 }} />
                          )}
                          {isMissingDemat && (
                            <FontAwesomeIcon icon={faCircleExclamation} style={{ color: '#f87171', fontSize: '0.75rem', flexShrink: 0 }} />
                          )}
                          {isMatch && item.t1Qty > 0 && (
                            <FontAwesomeIcon icon={faCheck} style={{ color: '#38bdf8', fontSize: '0.75rem', flexShrink: 0 }} />
                          )}
                          <Typography sx={{ 
                            fontSize: '0.75rem', 
                            color: isMatch ? (item.t1Qty > 0 ? '#38bdf8' : '#64748b') : isDiscrepancy ? '#fde68a' : '#cbd5e1' 
                          }}>
                            {item.potentialReason || (isMatch ? 'All records in sync' : 'Review transaction history')}
                          </Typography>
                        </Box>
                      </StyledCell>
                    </StyledTableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
