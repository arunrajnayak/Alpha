'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  format?: (val: number) => string;
  className?: string;
  prefix?: string;
  suffix?: string;
  downloading?: boolean;
  highlightOnChange?: boolean;
}

/**
 * Modern animated number component with Framer Motion and tick flash highlights.
 * Highlights green on price increase and red on decrease, fading back to default.
 */
function AnimatedNumberInner({
  value,
  format,
  className = '',
  prefix = '',
  suffix = '',
  downloading = false,
  highlightOnChange = true,
}: AnimatedNumberProps) {
  const prevValueRef = useRef<number>(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (downloading || !highlightOnChange) return;

    if (value > prevValueRef.current) {
      setFlash('up');
      const t = setTimeout(() => setFlash(null), 850);
      prevValueRef.current = value;
      return () => clearTimeout(t);
    } else if (value < prevValueRef.current) {
      setFlash('down');
      const t = setTimeout(() => setFlash(null), 850);
      prevValueRef.current = value;
      return () => clearTimeout(t);
    }
  }, [value, downloading, highlightOnChange]);

  const formatted = format ? format(value) : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  if (downloading) {
    return (
      <span className={`tabular-nums font-mono ${className}`}>
        {prefix}{formatted}{suffix}
      </span>
    );
  }

  const flashClasses = flash === 'up'
    ? 'bg-emerald-500/25 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
    : flash === 'down'
    ? 'bg-rose-500/25 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.35)]'
    : '';

  return (
    <motion.span
      className={`inline-block tabular-nums font-mono px-1 py-0.5 rounded transition-colors duration-500 ${flashClasses} ${className}`}
      initial={false}
      animate={{ scale: flash ? [1, 1.05, 1] : 1 }}
      transition={{ duration: 0.3 }}
    >
      {prefix}{formatted}{suffix}
    </motion.span>
  );
}

export default memo(AnimatedNumberInner);
