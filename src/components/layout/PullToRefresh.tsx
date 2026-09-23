'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import { haptic, hapticNotification } from '@/lib/mobile';

const PULL_THRESHOLD = 70;
const MAX_PULL = 110;

interface PullToRefreshProps {
  children: React.ReactNode;
}

export default function PullToRefresh({ children }: PullToRefreshProps) {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const parentScroll = containerRef.current?.parentElement;
    const isAtTop = !parentScroll || parentScroll.scrollTop <= 0;

    if (isAtTop && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;

    const parentScroll = containerRef.current?.parentElement;
    if (parentScroll && parentScroll.scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;

    if (deltaY > 0) {
      // Apply rubber-band damping
      const distance = Math.min(MAX_PULL, deltaY * 0.45);
      setPullDistance(distance);

      // Subtle haptic tick when crossing the threshold
      if (distance >= PULL_THRESHOLD && pullDistance < PULL_THRESHOLD) {
        haptic('light');
      }
    }
  };

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(50); // Hold at active spinner position
      haptic('medium');

      try {
        await router.refresh();
        await new Promise((resolve) => setTimeout(resolve, 600));
        hapticNotification('success');
      } catch {
        // ignore
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, router]);

  // Reset pull distance on route change or when scrolling happens
  useEffect(() => {
    setPullDistance(0);
    setIsRefreshing(false);
  }, []);

  const progress = Math.min(1, pullDistance / PULL_THRESHOLD);
  const rotation = isRefreshing ? 'animate-spin' : '';

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative w-full"
    >
      {/* Pull Indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="absolute top-0 left-0 right-0 flex justify-center items-center pointer-events-none z-30 transition-all"
          style={{
            height: `${pullDistance}px`,
            opacity: Math.max(0.2, progress),
          }}
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800/90 border border-slate-700/80 shadow-lg text-blue-400">
            <FontAwesomeIcon
              icon={faRotate}
              className={`text-sm ${rotation}`}
              style={{
                transform: !isRefreshing ? `rotate(${pullDistance * 3.5}deg)` : undefined,
              }}
            />
          </div>
        </div>
      )}

      {/* Main Content with smooth spring transform */}
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: isPulling.current ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
