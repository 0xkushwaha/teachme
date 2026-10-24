import { cn } from '@/utils/cn';

/**
 * Subtle fade-up entrance. Pure CSS (see `.reveal` in globals.css), so content is never left
 * hidden if JavaScript or IntersectionObserver is unavailable. Reduced motion shows it instantly.
 */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cn('reveal', className)} style={{ animationDelay: `${Math.round(delay * 1000)}ms` }}>
      {children}
    </div>
  );
}
