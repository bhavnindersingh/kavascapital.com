import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-eyebrow font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-background text-muted-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        // Domain variants: P&L sign, trigger state and tags read green/red/amber.
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        // Tinted forms, for dense tables where a solid fill would dominate.
        successSoft: 'border-success/30 bg-success/10 text-success-400',
        dangerSoft: 'border-destructive/30 bg-destructive/10 text-danger-400',
        warningSoft: 'border-warning/30 bg-warning/10 text-warning-400',
        // Categorical tags. These say "these five things are different from
        // each other" and nothing more — never use one to mean good/bad, and
        // never on a control. See the --cat-N note in index.css.
        cat1: 'border-cat-1/30 bg-cat-1/10 text-cat-1',
        cat2: 'border-cat-2/30 bg-cat-2/10 text-cat-2',
        cat3: 'border-cat-3/30 bg-cat-3/10 text-cat-3',
        cat4: 'border-cat-4/30 bg-cat-4/10 text-cat-4',
        cat5: 'border-cat-5/30 bg-cat-5/10 text-cat-5',
        cat6: 'border-cat-6/30 bg-cat-6/10 text-cat-6',
        cat7: 'border-cat-7/30 bg-cat-7/10 text-cat-7',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
