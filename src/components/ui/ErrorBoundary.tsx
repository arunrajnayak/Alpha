'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faRefresh } from '@fortawesome/free-solid-svg-icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Component name for error reporting */
  componentName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component to catch JavaScript errors in child components.
 * Prevents the entire app from crashing when a component fails.
 * 
 * Usage:
 * <ErrorBoundary componentName="EquityCurve">
 *   <EquityCurve data={data} />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console in development
    console.error(`[ErrorBoundary${this.props.componentName ? ` - ${this.props.componentName}` : ''}] Caught error:`, error);
    console.error('Component stack:', errorInfo.componentStack);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            textAlign: 'center',
            backgroundColor: 'rgba(244, 67, 54, 0.05)',
            border: '1px solid rgba(244, 67, 54, 0.2)',
            borderRadius: 2,
            minHeight: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <FontAwesomeIcon 
            icon={faExclamationTriangle} 
            style={{ fontSize: 32, color: '#f44336' }} 
          />
          <Box>
            <Typography variant="h6" color="error" gutterBottom>
              {this.props.componentName 
                ? `Failed to load ${this.props.componentName}`
                : 'Something went wrong'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            startIcon={<FontAwesomeIcon icon={faRefresh} />}
            onClick={this.handleRetry}
          >
            Try Again
          </Button>
        </Paper>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight error boundary for chart components.
 * Shows a minimal error state that doesn't disrupt the layout.
 */
export function ChartErrorBoundary({ 
  children, 
  componentName 
}: { 
  children: ReactNode; 
  componentName: string;
}) {
  return (
    <ErrorBoundary
      componentName={componentName}
      fallback={
        <Box
          sx={{
            width: '100%',
            height: '100%',
            minHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
            borderRadius: 1,
            border: '1px dashed rgba(0, 0, 0, 0.1)',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Unable to load {componentName}
          </Typography>
        </Box>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
