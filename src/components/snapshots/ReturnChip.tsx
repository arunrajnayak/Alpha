import React, { memo } from 'react';
import { Chip } from '@mui/material';

type ReturnPeriod = 'daily' | 'weekly' | 'monthly';

interface ReturnChipProps {
    value: number | null | undefined;
    period?: ReturnPeriod;
}

/**
 * Memoized return chip component.
 * Re-renders only when value or period changes.
 */
export default memo(function ReturnChip({ value, period = 'daily' }: ReturnChipProps) {
    const returnVal = value || 0;
    const absReturn = Math.abs(returnVal);
    const isZero = absReturn < 0.000001;
    const isProfit = returnVal > 0;
    const percentage = absReturn * 100;

    // Gradient Thresholds (Max Intensity Caps)
    // Daily: 6% for full intensity
    // Weekly: 12%
    // Monthly: 18%
    let maxThreshold = 6;
    if (period === 'weekly') maxThreshold = 12;
    if (period === 'monthly') maxThreshold = 18;

    // Calculate Intensity (0 to 1)
    // Using a square root curve to make smaller moves slightly more visible than linear
    const ratio = Math.min(percentage / maxThreshold, 1);
    const intensity = Math.pow(ratio, 0.8); 

    // Calculate Alpha (Opacity)
    // Min: 0.1 (Subtle glass) -> Max: 0.6 (Rich glass, not fully solid)
    const minAlpha = 0.1;
    const maxAlpha = 0.6;
    const alpha = minAlpha + (intensity * (maxAlpha - minAlpha));

    let bg = '';
    let color = '';

    if (isZero) {
        bg = 'rgba(255, 255, 255, 0.05)';
        color = '#9ca3af'; // gray-400
    } else if (isProfit) {
        // Emerald Green
        // Interpolate background alpha
        bg = `rgba(16, 185, 129, ${alpha.toFixed(2)})`; 
        // Text gets slightly brighter/whiter as intensity increases
        color = intensity > 0.8 ? '#ecfdf5' : '#34d399'; 
    } else {
        // Red
        bg = `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
        color = intensity > 0.8 ? '#fef2f2' : '#f87171';
    }

    return (
        <Chip 
            label={`${isZero ? '' : (isProfit ? '▲' : '▼')} ${percentage.toFixed(2)}%`}
            size="small"
            sx={{ 
                fontWeight: intensity > 0.8 ? 800 : 700, 
                fontSize: '0.75rem',
                height: '24px',
                backgroundColor: bg,
                color: color,
                minWidth: '70px',
                border: '1px solid transparent',
                // Add a subtle border for high intensity to make it pop
                borderColor: intensity > 0.5 ? (isProfit ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)') : 'transparent',
                '& .MuiChip-label': {
                    paddingLeft: '8px',
                    paddingRight: '8px',
                }
            }} 
        />
    );
});
