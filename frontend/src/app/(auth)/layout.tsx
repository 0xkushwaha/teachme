import Link from 'next/link';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="aurora pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden />
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
      <footer className="pb-6 text-center text-[12.5px] text-muted-foreground">
        <Link href="/legal/terms" className="hover:text-foreground">Terms</Link> · <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link> · <Link href="/contact" className="hover:text-foreground">Help</Link>
      </footer>
    </div>
  );
}
