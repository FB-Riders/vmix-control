import { cn } from '@/lib/utils';

/** Small spaced-out section label used across the panel. */
export function Caption({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('text-xs font-semibold tracking-widest', className)} {...props} />;
}
