'use client';

import dynamic from 'next/dynamic';
import { MarketCapAreaChartProps } from './MarketCapAreaChart';

const MarketCapAreaChart = dynamic(() => import('./MarketCapAreaChart'), {
  loading: () => <div className="h-[500px] glass-card animate-pulse" />,
  ssr: false
});

export default function MarketCapAreaChartWrapper(props: MarketCapAreaChartProps) {
  return <MarketCapAreaChart {...props} />;
}
