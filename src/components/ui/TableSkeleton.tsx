import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import Skeleton from './Skeleton';

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string; // For the outer container
  showHeader?: boolean;
}

export default function TableSkeleton({
  rows = 10,
  cols = 5,
  className = "",
  showHeader = true
}: TableSkeletonProps) {
  return (
    <TableContainer 
      component={Paper} 
      className={`glass-card ${className}`} 
      sx={{ 
        backgroundColor: 'transparent', 
        backgroundImage: 'none', 
        boxShadow: 'none' 
      }}
    >
      <Table sx={{ minWidth: 650 }}>
        {showHeader && (
          <TableHead sx={{ background: 'linear-gradient(to right, rgba(59, 130, 246, 0.1), rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1))' }}>
            <TableRow>
              {[...Array(cols)].map((_, i) => (
                <TableCell key={i} sx={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <Skeleton variant="text" className="w-full h-4" />
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
        )}
        <TableBody>
          {[...Array(rows)].map((_, i) => (
            <TableRow key={i}>
              {[...Array(cols)].map((_, j) => (
                <TableCell key={j} sx={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <Skeleton variant="text" className="w-full h-6" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
