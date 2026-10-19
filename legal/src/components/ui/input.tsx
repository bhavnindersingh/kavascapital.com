import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-lg border border-input bg-background px-2.5 py-[7px] text-body transition-colors file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
