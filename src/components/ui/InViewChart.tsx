'use client';

import React, { useState, useEffect, useRef } from 'react';

interface InViewChartProps {
  children: React.ReactNode;
  height?: number | string;
  minHeight?: number | string;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * Viewport-deferred chart container.
 * Only mounts and renders heavy SVG charts (Recharts / Nivo) when within
 * 250px of the visible viewport, preventing massive main-thread CPU thrashing
 * on initial page load.
 */
export default function InViewChart({
  children,
  height,
  minHeight = '360px',
  className = '',
  fallback,
}: InViewChartProps) {
  const [isInView, setIsInView] = useState(() => typeof window === 'undefined' || typeof IntersectionObserver === 'undefined');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isInView) return;

    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '250px 0px',
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isInView]);

  const style: React.CSSProperties = {
    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
    ...(height ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
  };

  return (
    <div
      ref={containerRef}
      className={`w-full transition-opacity duration-300 ${className}`}
      style={style}
    >
      {isInView ? (
        children
      ) : fallback ? (
        fallback
      ) : (
        <div
          className="w-full h-full bg-slate-800/30 rounded-xl animate-pulse"
          style={style}
        />
      )}
    </div>
  );
}
