import { HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: 'rectangular' | 'circular' | 'text';
  width?: string | number;
  height?: string | number;
}

export default function Skeleton({ 
  className = '', 
  variant = 'rectangular', 
  width, 
  height,
  ...props 
}: SkeletonProps) {
  const baseClasses = "bg-gray-800 animate-pulse";
  const variantClasses = {
    rectangular: "rounded-md",
    circular: "rounded-full",
    text: "rounded h-4 w-full"
  };

  return (
    <div 
      className={`${baseClasses} ${variantClasses[variant]} ${className}`.trim()}
      style={{ width, height }}
      {...props}
    />
  );
}
