'use client';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6', // Blue from globals
    },
    secondary: {
      main: '#6366f1', // Indigo from globals
    },
    background: {
      default: '#0a0f1a', // --bg-primary
      paper: '#1f2937',   // --bg-tertiary
    },
    text: {
      primary: '#f9fafb',
      secondary: '#9ca3af',
    },
    // Custom colors if needed, but palette fits most.
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), "Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: '8px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none', // Remove default overlapping gradients in dark mode
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(31, 41, 55, 0.8)', // Semi-transparent like glass-card
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
    },
  },
});

export default theme;
