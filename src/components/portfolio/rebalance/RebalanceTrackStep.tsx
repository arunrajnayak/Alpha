'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRotateRight, 
  faCircleCheck, 
  faCircleXmark, 
  faClock, 
  faBan,
  faPen,
  faCheck,
  faXmark,
  faArrowsRotate,
  faTrophy,
  faArrowRight
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { RebalanceOrderItem, OrderLiveStatus, OrderExecutionResult } from '@/lib/types';
import { 
  executeRebalanceBatchAction, 
  executeSingleOrderAction, 
  checkRebalanceOrdersStatusAction,
  modifyZerodhaOrderAction,
  cancelZerodhaOrderAction
} from '@/app/actions/zerodha-orders';

const StyledHeaderCell = styled(TableCell)(() => ({
  backgroundColor: '#0f172a',
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  padding: '8px 12px',
}));

const StyledCell = styled(TableCell)(() => ({
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color: '#d1d5db',
  padding: '8px 12px',
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
}));

interface RebalanceTrackStepProps {
  initialOrders: RebalanceOrderItem[];
  onFinishRebalance: () => void;
}

export default function RebalanceTrackStep({
  initialOrders,
  onFinishRebalance,
}: RebalanceTrackStepProps) {
  const [orders, setOrders] = useState<RebalanceOrderItem[]>(initialOrders);
  const [orderStatusMap, setOrderStatusMap] = useState<Record<string, OrderLiveStatus>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const [modifyingOrderId, setModifyingOrderId] = useState<string | null>(null);
  const [modifyPriceInput, setModifyPriceInput] = useState<number>(0);
  const [isModifying, setIsModifying] = useState(false);

  const hasInitiatedRef = useRef(false);

  // 1. Polling order status from Zerodha
  const pollStatus = useCallback(async (currentOrdersList?: RebalanceOrderItem[]) => {
    const list = currentOrdersList || orders;
    const placedOrderIds = list.filter(o => o.orderId).map(o => o.orderId!);
    if (placedOrderIds.length === 0) return;

    setIsPolling(true);
    try {
      const res = await checkRebalanceOrdersStatusAction(placedOrderIds);
      if (res.success) {
        setOrderStatusMap(prev => ({ ...prev, ...res.data }));
      }
    } catch (err) {
      console.error('Failed to poll orders status:', err);
    } finally {
      setIsPolling(false);
    }
  }, [orders]);

  // 2. Batch Execution Function (Sequentially places SELL orders, then BUY orders)
  const runBatchExecution = useCallback(async (targetOrders: RebalanceOrderItem[]) => {
    setIsExecuting(true);
    setExecutionMessage('Placing SELL orders first to release capital...');

    // Mark orders as submitting
    setOrders(prev => prev.map(o => {
      const isTarget = targetOrders.some(t => t.symbol === o.symbol);
      return isTarget ? { ...o, status: 'submitting', error: undefined } : o;
    }));

    try {
      const res = await executeRebalanceBatchAction(targetOrders);
      if (res.success) {
        const resultMap = new Map(res.data.map((r: OrderExecutionResult) => [r.symbol, r]));
        let anyFailed = false;

        const updated = orders.map(o => {
          const r = resultMap.get(o.symbol);
          if (!r) return o;
          if (r.success) {
            return { ...o, status: 'placed' as const, orderId: r.orderId, error: undefined };
          } else {
            anyFailed = true;
            return { ...o, status: 'failed' as const, error: r.error };
          }
        });

        setOrders(updated);

        if (anyFailed) {
          setExecutionMessage('Some orders failed. Review failure reasons and retry or modify below.');
        } else {
          setExecutionMessage('All orders placed with Zerodha! Tracking live execution...');
        }

        // Initial status poll right after placement
        pollStatus(updated);
      } else {
        setExecutionMessage(res.error);
        setOrders(prev => prev.map(o => o.status === 'submitting' ? { ...o, status: 'failed' as const, error: res.error } : o));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      setExecutionMessage(msg);
      setOrders(prev => prev.map(o => o.status === 'submitting' ? { ...o, status: 'failed' as const, error: msg } : o));
    } finally {
      setIsExecuting(false);
    }
  }, [orders, pollStatus]);

  // Run execution automatically on mount
  useEffect(() => {
    if (!hasInitiatedRef.current && initialOrders.length > 0) {
      hasInitiatedRef.current = true;
      runBatchExecution(initialOrders);
    }
  }, [initialOrders, runBatchExecution]);

  // Auto-polling interval while orders are not all complete
  useEffect(() => {
    const placedOrderIds = orders.filter(o => o.orderId).map(o => o.orderId!);
    if (placedOrderIds.length === 0) return;

    // Check if any order is still open/pending
    const hasActiveOrders = orders.some(o => {
      if (o.status !== 'placed') return true;
      if (!o.orderId) return true;
      const live = orderStatusMap[o.orderId];
      if (!live) return true;
      return live.status === 'OPEN';
    });

    if (!hasActiveOrders) return;

    const interval = setInterval(() => {
      pollStatus();
    }, 1000);

    return () => clearInterval(interval);
  }, [orders, orderStatusMap, pollStatus]);

  // 3. Row-Level Actions: Retry, Modify, Cancel
  const handleRetrySingle = async (order: RebalanceOrderItem) => {
    setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'submitting', error: undefined } : o));

    try {
      const res = await executeSingleOrderAction(order);
      if (res.success && res.data.success) {
        const updated = orders.map(o => o.symbol === order.symbol ? { 
          ...o, 
          status: 'placed' as const, 
          orderId: res.data.orderId, 
          error: undefined 
        } : o);
        setOrders(updated);
        pollStatus(updated);
      } else {
        const err = (res.success && !res.data.success ? res.data.error : !res.success ? res.error : 'Order failed') || 'Order failed';
        setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'failed', error: err } : o));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to place order';
      setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'failed', error: msg } : o));
    }
  };

  const handleModifyOpenOrder = async (orderId: string, newPrice: number) => {
    setIsModifying(true);
    try {
      const res = await modifyZerodhaOrderAction(orderId, { price: newPrice });
      if (res.success) {
        setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, price: newPrice } : o));
        setModifyingOrderId(null);
        pollStatus();
      } else {
        alert(`Failed to modify order: ${res.error}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to modify order');
    } finally {
      setIsModifying(false);
    }
  };

  const handleCancelOpenOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this open limit order in Zerodha?')) return;
    try {
      const res = await cancelZerodhaOrderAction(orderId);
      if (res.success) {
        pollStatus();
      } else {
        alert(`Failed to cancel order: ${res.error}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel order');
    }
  };

  // Execution Summary Metrics
  const placedCount = useMemo(() => orders.filter(o => o.status === 'placed').length, [orders]);
  const failedOrders = useMemo(() => orders.filter(o => o.status === 'failed'), [orders]);

  const filledCount = useMemo(() => {
    return orders.filter(o => {
      if (!o.orderId) return false;
      return orderStatusMap[o.orderId]?.status === 'COMPLETE';
    }).length;
  }, [orders, orderStatusMap]);

  const openCount = useMemo(() => {
    return orders.filter(o => {
      if (!o.orderId) return false;
      const st = orderStatusMap[o.orderId]?.status;
      return st === 'OPEN';
    }).length;
  }, [orders, orderStatusMap]);

  const isAllComplete = orders.length > 0 && filledCount === orders.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Status & Controls */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        px: { xs: 2, sm: 3 }, 
        py: 1.5, 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        bgcolor: 'rgba(15, 23, 42, 0.4)' 
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#f3f4f6' }}>
            Live Execution Progress
          </Typography>
          <Chip 
            label={`Filled: ${filledCount} of ${orders.length}`} 
            size="small" 
            sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700, bgcolor: isAllComplete ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.15)', color: isAllComplete ? '#4ade80' : '#60a5fa' }} 
          />
          {openCount > 0 && (
            <Chip 
              icon={<FontAwesomeIcon icon={faClock} size="xs" style={{ color: '#38bdf8' }} />}
              label={`${openCount} Open in Exchange`} 
              size="small" 
              sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600, bgcolor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }} 
            />
          )}
          {failedOrders.length > 0 && (
            <Chip 
              icon={<FontAwesomeIcon icon={faCircleXmark} size="xs" style={{ color: '#f87171' }} />}
              label={`${failedOrders.length} Failed`} 
              size="small" 
              sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }} 
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {failedOrders.length > 0 && (
            <Button
              size="small"
              variant="contained"
              onClick={() => runBatchExecution(failedOrders)}
              disabled={isExecuting}
              startIcon={<FontAwesomeIcon icon={faRotateRight} size="xs" />}
              sx={{ height: 30, fontSize: '0.75rem', textTransform: 'none', bgcolor: '#ef4444', color: '#fff', '&:hover': { bgcolor: '#dc2626' } }}
            >
              Retry Failed ({failedOrders.length})
            </Button>
          )}

          <Button
            size="small"
            variant="outlined"
            onClick={() => pollStatus()}
            disabled={isPolling}
            startIcon={isPolling ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faArrowsRotate} size="xs" />}
            sx={{
              color: '#d1d5db',
              borderColor: 'rgba(255,255,255,0.15)',
              textTransform: 'none',
              fontSize: '0.75rem',
              height: 30,
              '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.03)' }
            }}
          >
            Refresh Status
          </Button>
        </Box>
      </Box>

      {/* Main Order Tracking Body */}
      <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {executionMessage && (
          <Alert 
            severity={failedOrders.length > 0 ? "error" : isAllComplete ? "success" : "info"}
            sx={{ 
              bgcolor: failedOrders.length > 0 ? 'rgba(239, 68, 68, 0.1)' : isAllComplete ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)', 
              color: failedOrders.length > 0 ? '#f87171' : isAllComplete ? '#4ade80' : '#60a5fa', 
              border: `1px solid ${failedOrders.length > 0 ? 'rgba(239, 68, 68, 0.2)' : isAllComplete ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)'}` 
            }}
          >
            {executionMessage}
          </Alert>
        )}

        {/* Completion Celebration Card */}
        {isAllComplete && (
          <Box sx={{ 
            p: 3, 
            borderRadius: 2.5, 
            bgcolor: 'rgba(34, 197, 94, 0.08)', 
            border: '1px solid rgba(74, 222, 128, 0.3)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            boxShadow: '0 0 25px rgba(34, 197, 94, 0.15)'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: 'rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80' }}>
                <FontAwesomeIcon icon={faTrophy} size="lg" />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontSize: '1.05rem', fontWeight: 700, color: '#4ade80' }}>
                  Rebalance Executed Successfully!
                </Typography>
                <Typography variant="body2" sx={{ color: '#cbd5e1', fontSize: '0.8rem' }}>
                  All {orders.length} orders have filled at exchange prices. Your portfolio weights are now up to date.
                </Typography>
              </Box>
            </Box>

            <Button
              variant="contained"
              size="medium"
              onClick={onFinishRebalance}
              endIcon={<FontAwesomeIcon icon={faArrowRight} size="xs" />}
              sx={{
                bgcolor: '#16a34a',
                color: '#fff',
                fontWeight: 700,
                textTransform: 'none',
                px: 3,
                height: 40,
                '&:hover': { bgcolor: '#15803d' }
              }}
            >
              Finish & View Portfolio
            </Button>
          </Box>
        )}

        {/* Orders Table */}
        <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <StyledHeaderCell>Stock & Side</StyledHeaderCell>
                <StyledHeaderCell align="center">Order ID</StyledHeaderCell>
                <StyledHeaderCell align="right">Filled / Target Qty</StyledHeaderCell>
                <StyledHeaderCell align="right">Limit Price (₹)</StyledHeaderCell>
                <StyledHeaderCell align="right">Avg Fill Price</StyledHeaderCell>
                <StyledHeaderCell align="center" sx={{ width: 140 }}>Status</StyledHeaderCell>
                <StyledHeaderCell align="center" sx={{ width: 150 }}>Action</StyledHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((o) => {
                const live = o.orderId ? orderStatusMap[o.orderId] : undefined;
                const isSell = o.transactionType === 'SELL';
                const isSubmitting = o.status === 'submitting';
                const isEditing = modifyingOrderId === o.orderId;
                const isOpen = live?.status === 'OPEN';
                const isComplete = live?.status === 'COMPLETE';
                const isRejected = o.status === 'failed' || live?.status === 'REJECTED';

                return (
                  <StyledTableRow key={o.symbol}>
                    {/* Stock & Side */}
                    <StyledCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip 
                          label={o.transactionType} 
                          size="small" 
                          sx={{ 
                            height: 18, 
                            fontSize: '0.65rem', 
                            fontWeight: 700, 
                            bgcolor: isSell ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)', 
                            color: isSell ? '#f87171' : '#4ade80' 
                          }} 
                        />
                        <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                        <Chip label="CNC" size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                      </Box>
                    </StyledCell>

                    {/* Order ID */}
                    <StyledCell align="center">
                      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: o.orderId ? '#9ca3af' : '#64748b' }}>
                        {o.orderId ? `#${o.orderId}` : '-'}
                      </Typography>
                    </StyledCell>

                    {/* Filled / Target Qty */}
                    <StyledCell align="right">
                      <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: isComplete ? '#4ade80' : '#cbd5e1' }}>
                        {live ? `${live.filledQuantity} / ${o.quantity}` : `0 / ${o.quantity}`}
                      </Typography>
                    </StyledCell>

                    {/* Limit Price (Editable if modifying) */}
                    <StyledCell align="right">
                      {isEditing ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                          <TextField
                            size="small"
                            type="number"
                            value={modifyPriceInput}
                            onChange={(e) => setModifyPriceInput(parseFloat(e.target.value) || 0.05)}
                            slotProps={{
                              htmlInput: { step: 0.05, style: { textAlign: 'right', padding: '2px 6px', fontSize: '0.8rem', fontFamily: 'monospace' } }
                            }}
                            sx={{ width: 85, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#38bdf8' } }}
                          />
                          <IconButton 
                            size="small" 
                            onClick={() => o.orderId && handleModifyOpenOrder(o.orderId, modifyPriceInput)}
                            disabled={isModifying}
                            sx={{ color: '#4ade80', p: 0.5 }}
                          >
                            <FontAwesomeIcon icon={faCheck} size="xs" />
                          </IconButton>
                          <IconButton 
                            size="small" 
                            onClick={() => setModifyingOrderId(null)}
                            disabled={isModifying}
                            sx={{ color: '#9ca3af', p: 0.5 }}
                          >
                            <FontAwesomeIcon icon={faXmark} size="xs" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Typography sx={{ fontFamily: 'monospace', color: '#cbd5e1' }}>
                          ₹{formatNumber(o.price, 2)}
                        </Typography>
                      )}
                    </StyledCell>

                    {/* Avg Fill Price */}
                    <StyledCell align="right">
                      <Typography sx={{ fontFamily: 'monospace', color: live?.averagePrice ? '#4ade80' : '#64748b', fontWeight: live?.averagePrice ? 600 : 400 }}>
                        {live?.averagePrice && live.averagePrice > 0 ? `₹${formatNumber(live.averagePrice, 2)}` : '-'}
                      </Typography>
                    </StyledCell>

                    {/* Status Badge */}
                    <StyledCell align="center">
                      {isSubmitting ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8 }}>
                          <CircularProgress size={12} sx={{ color: '#60a5fa' }} />
                          <Typography variant="caption" sx={{ color: '#60a5fa', fontSize: '0.7rem' }}>Placing...</Typography>
                        </Box>
                      ) : isComplete ? (
                        <Chip 
                          icon={<FontAwesomeIcon icon={faCircleCheck} size="xs" />}
                          label="Complete" 
                          size="small" 
                          sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }} 
                        />
                      ) : isOpen ? (
                        <Chip 
                          icon={<FontAwesomeIcon icon={faClock} size="xs" />}
                          label="Open in Market" 
                          size="small" 
                          sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }} 
                        />
                      ) : isRejected ? (
                        <Tooltip title={live?.statusMessage || o.error || 'Rejected by broker'}>
                          <Chip 
                            icon={<FontAwesomeIcon icon={faCircleXmark} size="xs" />}
                            label="Failed" 
                            size="small" 
                            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', cursor: 'help' }} 
                          />
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" sx={{ color: '#64748b' }}>Ready</Typography>
                      )}
                    </StyledCell>

                    {/* Action Column */}
                    <StyledCell align="center">
                      {isRejected ? (
                        <Button 
                          size="small" 
                          variant="outlined" 
                          onClick={() => handleRetrySingle(o)}
                          disabled={isExecuting}
                          sx={{ height: 22, fontSize: '0.65rem', textTransform: 'none', px: 1, borderColor: 'rgba(248, 113, 113, 0.4)', color: '#f87171' }}
                        >
                          Retry
                        </Button>
                      ) : isOpen ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Button 
                            size="small" 
                            variant="text" 
                            onClick={() => {
                              setModifyingOrderId(o.orderId!);
                              setModifyPriceInput(o.price);
                            }}
                            disabled={isEditing}
                            startIcon={<FontAwesomeIcon icon={faPen} size="xs" />}
                            sx={{ height: 22, fontSize: '0.65rem', textTransform: 'none', color: '#38bdf8', px: 0.8 }}
                          >
                            Modify
                          </Button>
                          <IconButton 
                            size="small" 
                            onClick={() => o.orderId && handleCancelOpenOrder(o.orderId)}
                            title="Cancel Order"
                            sx={{ color: '#9ca3af', p: 0.5, '&:hover': { color: '#f87171' } }}
                          >
                            <FontAwesomeIcon icon={faBan} size="xs" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>-</Typography>
                      )}
                    </StyledCell>
                  </StyledTableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Box>

      {/* Footer Bar */}
      <Box sx={{ 
        px: { xs: 2, sm: 3 }, 
        py: 1.5, 
        borderTop: '1px solid rgba(255,255,255,0.08)', 
        bgcolor: 'rgba(15, 23, 42, 0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between' 
      }}>
        <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>
          Filled: <span style={{ color: '#fff', fontWeight: 700 }}>{filledCount}</span> of {orders.length} orders
        </Typography>

        <Button
          variant={isAllComplete ? "contained" : "outlined"}
          size="small"
          onClick={onFinishRebalance}
          sx={{
            textTransform: 'none',
            height: 38,
            px: 2.5,
            fontSize: '0.8rem',
            fontWeight: 600,
            borderColor: 'rgba(255,255,255,0.15)',
            bgcolor: isAllComplete ? '#16a34a' : 'transparent',
            color: '#fff',
            '&:hover': { bgcolor: isAllComplete ? '#15803d' : 'rgba(255,255,255,0.05)' }
          }}
        >
          {isAllComplete ? "Finish & Close" : "Close (Orders Active)"}
        </Button>
      </Box>
    </Box>
  );
}
