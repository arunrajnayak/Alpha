'use client';

import { useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/format';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  formatOptions?: Intl.NumberFormatOptions;
}

export default function AnimatedNumber({
  value,
  duration = 400,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = '',
  formatOptions
}: AnimatedNumberProps) {
  const displayRef = useRef<HTMLSpanElement>(null);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number>(0);

  const format = (v: number) =>
    formatOptions
      ? v.toLocaleString('en-IN', formatOptions)
      : formatNumber(v, decimals, decimals);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;

    // Skip animation if no change or first render with same value
    if (from === to) {
      if (displayRef.current) {
        displayRef.current.textContent = `${prefix}${format(to)}${suffix}`;
      }
      return;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;

      if (displayRef.current) {
        displayRef.current.textContent = `${prefix}${format(current)}${suffix}`;
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = to;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [value, duration, decimals, prefix, suffix, formatOptions]);

  return (
    <span ref={displayRef} className={className}>
      {prefix}{format(value)}{suffix}
    </span>
  );
}
