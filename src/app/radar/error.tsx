'use client';

import { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';

export default function RadarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the console for debugging.
    console.error('[Radar] render error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center text-center gap-4 py-20">
      <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/20">
        <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5 text-red-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Radar hit a snag</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md">
          {error?.message || 'Something went wrong while rendering the scanner.'}
        </p>
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors text-sm font-medium"
      >
        <FontAwesomeIcon icon={faArrowsRotate} className="w-3.5 h-3.5" />
        Try again
      </button>
    </div>
  );
}
