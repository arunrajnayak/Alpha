import type { ReactNode } from 'react';

interface ShimmerTextProps {
  children: ReactNode;
  className?: string;
  /** Show a small pulsing dot before the text (Cursor-style status indicator). */
  withDot?: boolean;
}

/**
 * Continuously-animating "shimmer" text — a highlight band sweeps across the
 * text, mimicking the processing indicator shown while an action is in flight
 * (e.g. "Editing README.md"). Purely presentational; safe to use anywhere.
 */
export default function ShimmerText({ children, className = '', withDot = false }: ShimmerTextProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {withDot && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400/70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
        </span>
      )}
      <span className="shimmer-text font-medium">{children}</span>
    </span>
  );
}
