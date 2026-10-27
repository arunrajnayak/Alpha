'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';

interface RebalanceStepperProps {
  activeStep: 1 | 2 | 3;
  onStepClick?: (step: 1 | 2 | 3) => void;
  canNavigateToStep?: (step: 1 | 2 | 3) => boolean;
}

const STEPS = [
  { step: 1, title: 'Plan & Fund' },
  { step: 2, title: 'Refine & Execute' },
  { step: 3, title: 'Track & Settle' },
] as const;

export default function RebalanceStepper({ 
  activeStep, 
  onStepClick,
  canNavigateToStep 
}: RebalanceStepperProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
      {STEPS.map((s, idx) => {
        const isCurrent = activeStep === s.step;
        const isCompleted = activeStep > s.step;
        const isClickable = canNavigateToStep ? canNavigateToStep(s.step as 1 | 2 | 3) : s.step <= activeStep;

        return (
          <Box key={s.step} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
            <Box 
              onClick={() => isClickable && onStepClick?.(s.step as 1 | 2 | 3)}
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1,
                cursor: isClickable ? 'pointer' : 'default',
                opacity: isCurrent || isCompleted ? 1 : 0.45,
                transition: 'all 0.2s',
                '&:hover': isClickable ? { opacity: 0.9 } : {}
              }}
            >
              {/* Step indicator circle */}
              <Box sx={{ 
                width: 24, 
                height: 24, 
                borderRadius: '50%', 
                bgcolor: isCompleted ? 'rgba(34, 197, 94, 0.2)' : isCurrent ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                color: isCompleted ? '#4ade80' : '#fff',
                border: isCompleted ? '1px solid rgba(74, 222, 128, 0.4)' : isCurrent ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                boxShadow: isCurrent ? '0 0 10px rgba(37, 99, 235, 0.4)' : 'none'
              }}>
                {isCompleted ? <FontAwesomeIcon icon={faCheck} size="xs" /> : s.step}
              </Box>

              {/* Title */}
              <Typography sx={{ 
                display: { xs: isCurrent ? 'block' : 'none', sm: 'block' },
                fontSize: '0.8rem', 
                fontWeight: isCurrent ? 700 : 500, 
                color: isCurrent ? '#fff' : isCompleted ? '#cbd5e1' : '#64748b',
                lineHeight: 1
              }}>
                {s.step}. {s.title}
              </Typography>
            </Box>

            {/* Connecting arrow */}
            {idx < STEPS.length - 1 && (
              <Box sx={{ 
                width: { xs: 12, sm: 20 }, 
                height: 1, 
                bgcolor: isCompleted ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255, 255, 255, 0.1)' 
              }} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
