'use client';

import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';


interface RecomputeContextType {
    isRecomputing: boolean;
    progress: number;
    message: string;
    triggerRecompute: (fromDate?: string) => Promise<void>;
}

const RecomputeContext = createContext<RecomputeContextType | undefined>(undefined);

export function RecomputeProvider({ children }: { children: ReactNode }) {
    const [isRecomputing, setIsRecomputing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState('');
    const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

    const triggerRecompute = useCallback(async (fromDate?: string) => {
        if (isRecomputing) return;
        setIsRecomputing(true);
        setProgress(0);
        setMessage('Starting recomputation...');

        try {
            const response = await fetch('/api/recompute', {
                method: 'POST',
                body: JSON.stringify({ fromDate }),
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.ok || !response.body) {
                throw new Error(`Recomputation failed: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.message) setMessage(data.message);
                            if (data.progress !== undefined) setProgress(data.progress);
                            if (data.error) throw new Error(data.error);
                        } catch (e) {
                            console.error("Failed to parse SSE message", e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Recomputation failed", error);
            setMessage('Failed to recompute.');
        } finally {
            setIsRecomputing(false);
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
            resetTimerRef.current = setTimeout(() => {
                setProgress(0);
                setMessage('');
                resetTimerRef.current = null;
            }, 3000);
        }
    }, [isRecomputing]);

    return (
        <RecomputeContext.Provider value={{ isRecomputing, progress, message, triggerRecompute }}>
            {children}
        </RecomputeContext.Provider>
    );
}

export function useRecompute() {
    const context = useContext(RecomputeContext);
    if (context === undefined) {
        throw new Error('useRecompute must be used within a RecomputeProvider');
    }
    return context;
}
