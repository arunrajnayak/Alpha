'use client';

import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight, faArrowTrendUp, faArrowTrendDown } from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import { getStockMarketDepthAction, StockMarketDepthData } from '@/app/actions/stocks';

interface MarketDepthPanelProps {
  symbol: string;
  onSelectPrice?: (price: number) => void;
}

export default function MarketDepthPanel({ symbol, onSelectPrice }: MarketDepthPanelProps) {
  const [data, setData] = useState<StockMarketDepthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDepth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStockMarketDepthAction(symbol);
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market depth');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchDepth();
  }, [fetchDepth]);

  if (loading && !data) {
    return (
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, bgcolor: 'rgba(15, 23, 42, 0.6)', borderRadius: 1.5 }}>
        <CircularProgress size={16} sx={{ color: '#60a5fa' }} />
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>
          Loading 5-level market depth for {symbol}...
        </Typography>
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 1.5 }}>
        <Typography variant="caption" sx={{ color: '#f87171' }}>
          Market depth unavailable: {error}
        </Typography>
        <IconButton size="small" onClick={fetchDepth} sx={{ color: '#f87171', p: 0.5 }}>
          <FontAwesomeIcon icon={faRotateRight} size="xs" />
        </IconButton>
      </Box>
    );
  }

  if (!data) return null;

  const totalBuy = data.totalBuyQuantity;
  const totalSell = data.totalSellQuantity;
  const totalVolumeOrders = totalBuy + totalSell;
  const buyPercent = totalVolumeOrders > 0 ? (totalBuy / totalVolumeOrders) * 100 : 50;

  return (
    <Box sx={{ 
      p: 2, 
      bgcolor: 'rgba(11, 15, 25, 0.85)', 
      border: '1px solid rgba(255, 255, 255, 0.08)', 
      borderRadius: 2, 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 1.5,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
    }}>
      {/* Header bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.8rem', color: '#f3f4f6', letterSpacing: '0.02em' }}>
            5-Level Order Book — {data.symbol}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: data.netChange >= 0 ? '#4ade80' : '#f87171' }}>
              ₹{formatNumber(data.lastPrice, 2)}
            </Typography>
            <Typography sx={{ fontSize: '0.7rem', color: data.netChange >= 0 ? '#4ade80' : '#f87171' }}>
              ({data.netChange >= 0 ? '+' : ''}{formatNumber(data.netChange, 2)})
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>
            Click price to fill limit order
          </Typography>
          <IconButton 
            size="small" 
            onClick={fetchDepth} 
            disabled={loading} 
            sx={{ color: '#9ca3af', p: 0.5, '&:hover': { color: '#fff' } }}
          >
            {loading ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} size="xs" />}
          </IconButton>
        </Box>
      </Box>

      {/* 5-Level Table: Bids (left) and Asks (right) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        {/* BUY BIDS */}
        <Box sx={{ border: '1px solid rgba(74, 222, 128, 0.15)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'rgba(34, 197, 94, 0.02)' }}>
          <Box sx={{ px: 1.5, py: 0.6, bgcolor: 'rgba(34, 197, 94, 0.08)', display: 'grid', gridTemplateColumns: '40px 1fr 1fr', borderBottom: '1px solid rgba(74, 222, 128, 0.15)' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#4ade80' }}>Orders</Typography>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#4ade80', textAlign: 'right' }}>Qty</Typography>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#4ade80', textAlign: 'right' }}>Bid (₹)</Typography>
          </Box>
          {data.depth.buy.map((b, idx) => (
            <Box 
              key={`buy-${idx}`} 
              onClick={() => b.price > 0 && onSelectPrice?.(b.price)}
              sx={{ 
                px: 1.5, 
                py: 0.45, 
                display: 'grid', 
                gridTemplateColumns: '40px 1fr 1fr', 
                borderBottom: idx < 4 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                cursor: b.price > 0 ? 'pointer' : 'default',
                transition: 'background-color 0.15s',
                '&:hover': b.price > 0 ? { bgcolor: 'rgba(74, 222, 128, 0.12)' } : {}
              }}
            >
              <Typography sx={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                {b.orders > 0 ? b.orders : '-'}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#e2e8f0', fontFamily: 'monospace', textAlign: 'right' }}>
                {b.quantity > 0 ? formatNumber(b.quantity) : '-'}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#4ade80', fontFamily: 'monospace', textAlign: 'right' }}>
                {b.price > 0 ? formatNumber(b.price, 2) : '-'}
              </Typography>
            </Box>
          ))}
          <Box sx={{ px: 1.5, py: 0.6, bgcolor: 'rgba(34, 197, 94, 0.05)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(74, 222, 128, 0.15)' }}>
            <Typography sx={{ fontSize: '0.65rem', color: '#9ca3af' }}>Total Buy Qty</Typography>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#4ade80', fontFamily: 'monospace' }}>
              {formatNumber(totalBuy)}
            </Typography>
          </Box>
        </Box>

        {/* SELL ASKS */}
        <Box sx={{ border: '1px solid rgba(248, 113, 113, 0.15)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'rgba(239, 68, 68, 0.02)' }}>
          <Box sx={{ px: 1.5, py: 0.6, bgcolor: 'rgba(239, 68, 68, 0.08)', display: 'grid', gridTemplateColumns: '1fr 1fr 40px', borderBottom: '1px solid rgba(248, 113, 113, 0.15)' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#f87171' }}>Ask (₹)</Typography>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#f87171', textAlign: 'right' }}>Qty</Typography>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#f87171', textAlign: 'right' }}>Orders</Typography>
          </Box>
          {data.depth.sell.map((s, idx) => (
            <Box 
              key={`sell-${idx}`} 
              onClick={() => s.price > 0 && onSelectPrice?.(s.price)}
              sx={{ 
                px: 1.5, 
                py: 0.45, 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr 40px', 
                borderBottom: idx < 4 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                cursor: s.price > 0 ? 'pointer' : 'default',
                transition: 'background-color 0.15s',
                '&:hover': s.price > 0 ? { bgcolor: 'rgba(248, 113, 113, 0.12)' } : {}
              }}
            >
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#f87171', fontFamily: 'monospace' }}>
                {s.price > 0 ? formatNumber(s.price, 2) : '-'}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#e2e8f0', fontFamily: 'monospace', textAlign: 'right' }}>
                {s.quantity > 0 ? formatNumber(s.quantity) : '-'}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace', textAlign: 'right' }}>
                {s.orders > 0 ? s.orders : '-'}
              </Typography>
            </Box>
          ))}
          <Box sx={{ px: 1.5, py: 0.6, bgcolor: 'rgba(239, 68, 68, 0.05)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(248, 113, 113, 0.15)' }}>
            <Typography sx={{ fontSize: '0.65rem', color: '#9ca3af' }}>Total Sell Qty</Typography>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#f87171', fontFamily: 'monospace' }}>
              {formatNumber(totalSell)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Buy / Sell Pressure Ratio Bar */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#9ca3af' }}>
          <span>Buyers: {buyPercent.toFixed(1)}%</span>
          <span>Sellers: {(100 - buyPercent).toFixed(1)}%</span>
        </Box>
        <Box sx={{ height: 4, borderRadius: 2, bgcolor: '#f87171', overflow: 'hidden', display: 'flex' }}>
          <Box sx={{ width: `${buyPercent}%`, bgcolor: '#4ade80', transition: 'width 0.3s ease' }} />
        </Box>
      </Box>

      {/* Additional Stats: Circuit Limits, VWAP, Volume, OHLC */}
      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, 
        gap: 1, 
        pt: 1, 
        borderTop: '1px solid rgba(255, 255, 255, 0.05)' 
      }}>
        <Box>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>Lower Circuit (LCL)</Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171', fontFamily: 'monospace' }}>
            {data.lowerCircuitLimit > 0 ? formatCurrency(data.lowerCircuitLimit) : 'N/A'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>Upper Circuit (UCL)</Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#4ade80', fontFamily: 'monospace' }}>
            {data.upperCircuitLimit > 0 ? formatCurrency(data.upperCircuitLimit) : 'N/A'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>Avg Price (VWAP)</Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', fontFamily: 'monospace' }}>
            {data.averagePrice > 0 ? formatCurrency(data.averagePrice) : 'N/A'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem' }}>Volume</Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', fontFamily: 'monospace' }}>
            {formatNumber(data.volume)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
