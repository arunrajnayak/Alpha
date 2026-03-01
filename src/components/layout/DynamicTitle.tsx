'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useLiveData } from '@/context/LiveDataContext';
import { formatCurrency, formatNumber } from '@/lib/format';

const DEFAULT_TITLE = 'A🏃lpha';
const ROTATION_INTERVAL = 5000; // 5 seconds

export default function DynamicTitle() {
  const { data, showDynamicTitle } = useLiveData();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const isLivePage = pathname === '/';

  // Group titles into a memoized array
  const titles = useMemo(() => {
    if (!isLivePage || !data || !showDynamicTitle || isMobile) return [DEFAULT_TITLE];

    const items: string[] = [];

    // 1. Day's P/L
    const plSign = data.dayGain >= 0 ? '+' : '';
    items.push(`${plSign}${formatCurrency(data.dayGain, 0, 0)} (${plSign}${data.dayGainPercent.toFixed(2)}%)`);

    // 2. Nifty Value
    const nifty = data.indices.find(i => i.name === 'Nifty 50');
    if (nifty) {
      const niftySign = nifty.percentChange >= 0 ? '+' : '';
      items.push(`Nifty: ${formatNumber(nifty.currentPrice, 0, 0)} (${niftySign}${nifty.percentChange.toFixed(2)}%)`);
    }

    // 3. Breadth
    items.push(`${data.advances}↑ | ${data.declines}↓`);

    return items.length > 0 ? items : [DEFAULT_TITLE];
  }, [data, isLivePage, showDynamicTitle, isMobile]);

  // Effect to cycle through indices
  useEffect(() => {
    // Only rotate if there's more than one title
    if (titles.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % titles.length);
    }, ROTATION_INTERVAL);

    return () => clearInterval(timer);
  }, [titles.length]);

  // Compute safe index - handles bounds when titles length changes
  const safeIndex = index >= titles.length ? 0 : index;

  // Effect to update document title
  useEffect(() => {
    document.title = titles[safeIndex];
  }, [safeIndex, titles]);

  return null;
}
