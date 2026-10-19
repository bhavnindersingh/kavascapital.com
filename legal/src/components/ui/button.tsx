import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// NOTE: deliberately no `[&_svg]:h-4 w-4` here, unlike upstream shadcn. This
// app sizes every lucide icon explicitly via `size={N}` (10-48px), and a
// blanket rule would silently flatten all of them to 16px.
const buttonVariants = cva(
  // Nimai: a button is an UPPERCASE TRACKED LABEL in a ruled box, not a filled
  // pill. Metrics copied from `.tk-btn` in components/tasks/tasks.css.
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border text-eyebrow font-semibold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10',
        // Domain variant: confirming a buy/entry reads green across the app.
        success: 'border-success/40 bg-transparent text-success hover:bg-success/10',
        outline: 'border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary: 'border-border bg-card text-foreground hover:bg-accent',
        ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
        // For the dense trading surfaces: contributes no geometry, so a
        // chip-sized control keeps its own height/padding while still picking
        // up the focus ring, disabled handling and transitions.
        inline: 'h-auto p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a react-router <Link>) instead of <button>. */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
