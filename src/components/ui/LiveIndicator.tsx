'use client';

import React from 'react';
import { useLiveData } from '@/context/LiveDataContext';
import Tooltip from '@mui/material/Tooltip';

interface LiveIndicatorProps {
  showStreamingStatus?: boolean;
}

/**
 * Live indicator component that shows streaming status.
 */
export default function LiveIndicator({ showStreamingStatus = true }: LiveIndicatorProps) {
  const { isStreaming, streamStatus, streamingEnabled } = useLiveData();

  // Determine indicator style based on streaming status
  const getIndicatorStyle = () => {
    if (!streamingEnabled) {
      // Polling mode - blue indicator
      return {
        bgClass: 'bg-blue-500/10',
        borderClass: 'border-blue-500/20',
        dotClass: 'bg-blue-400',
        dotPingClass: 'bg-blue-400',
        textClass: 'text-blue-400',
        label: 'Polling',
      };
    }
    
    switch (streamStatus) {
      case 'connected':
        return {
          bgClass: 'bg-green-500/10',
          borderClass: 'border-green-500/20',
          dotClass: 'bg-green-500',
          dotPingClass: 'bg-green-400',
          textClass: 'text-green-400',
          label: 'Live',
        };
      case 'connecting':
      case 'reconnecting':
        return {
          bgClass: 'bg-yellow-500/10',
          borderClass: 'border-yellow-500/20',
          dotClass: 'bg-yellow-500',
          dotPingClass: 'bg-yellow-400',
          textClass: 'text-yellow-400',
          label: streamStatus === 'connecting' ? 'Connecting' : 'Reconnecting',
        };
      case 'error':
        return {
          bgClass: 'bg-red-500/10',
          borderClass: 'border-red-500/20',
          dotClass: 'bg-red-500',
          dotPingClass: 'bg-red-400',
          textClass: 'text-red-400',
          label: 'Error',
        };
      default:
        return {
          bgClass: 'bg-gray-500/10',
          borderClass: 'border-gray-500/20',
          dotClass: 'bg-gray-500',
          dotPingClass: 'bg-gray-400',
          textClass: 'text-gray-400',
          label: 'Offline',
        };
    }
  };

  const style = getIndicatorStyle();
  const shouldPing = streamStatus === 'connected' || streamStatus === 'connecting' || streamStatus === 'reconnecting';

  const tooltipText = isStreaming 
    ? 'Real-time streaming via WebSocket' 
    : streamingEnabled 
      ? `Stream status: ${streamStatus}`
      : 'Polling mode (updates every 30s)';

  const indicator = (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${style.bgClass} border ${style.borderClass}`}>
      <span className="relative flex h-2 w-2">
        {shouldPing && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotPingClass} opacity-75`}></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotClass}`}></span>
      </span>
      <span className={`text-xs font-semibold ${style.textClass} tracking-wide uppercase`}>
        {showStreamingStatus ? style.label : 'Live'}
      </span>
    </div>
  );

  return (
    <Tooltip title={tooltipText} arrow placement="bottom">
      {indicator}
    </Tooltip>
  );
}
