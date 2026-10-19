import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Two label roles, and only two.
 *
 * `field` is Nimai's label band — 10px, semibold, uppercase, 0.16em, muted —
 * copied from `.tk-label` in components/tasks/tasks.css. It names the control
 * BELOW it, and it is the default because that is what a form label almost
 * always is here.
 *
 * `inline` is the exception: text sitting BESIDE a checkbox or radio, where it
 * is the readable content of the row rather than a heading for it. Uppercasing
 * a sentence like "Skip non-10 strikes" would be wrong.
 */
const labelVariants = cva('peer-disabled:cursor-not-allowed peer-disabled:opacity-70', {
  variants: {
    variant: {
      field:
        'block text-micro font-semibold uppercase tracking-widest leading-none text-muted-foreground',
      inline: 'text-body font-medium leading-none text-foreground',
    },
  },
  defaultVariants: {
    variant: 'field',
  },
});

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, variant, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants({ variant }), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label, labelVariants };
