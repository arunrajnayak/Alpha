'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface AnimatedBarProps {
  targetWidth: number;
  duration?: number;
  delay?: number;
  className?: string;
  title?: string;
}

export default function AnimatedBar({
  targetWidth,
  duration = 1000,
  delay = 0,
  className = '',
  title
}: AnimatedBarProps) {
  const [width, setWidth] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  const animateWidth = useCallback(() => {
    const startTime = Date.now();

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function - easeOutCubic
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      const currentWidth = targetWidth * easeOutCubic;
      setWidth(currentWidth);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [targetWidth, duration]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated) {
            setHasAnimated(true);
            setTimeout(() => animateWidth(), delay);
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasAnimated, delay, animateWidth]);

  return (
    <div
      ref={elementRef}
      className={className}
      style={{ width: `${width}%` }}
      title={title}
    />
  );
}
