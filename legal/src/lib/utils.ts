import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, letting later classes win over earlier ones.
 * Every ui/ primitive takes a `className` prop and merges it through this, so
 * call sites can override any default without fighting specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
