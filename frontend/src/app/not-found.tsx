import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <Logo />
        <p className="mt-10 font-mono text-sm text-accent">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="mt-2 text-muted-foreground">The link may be broken, or the page may have moved.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild><Link href="/">Go home</Link></Button>
          <Button asChild variant="secondary"><Link href="/teachers">Find a teacher</Link></Button>
        </div>
      </div>
    </main>
  );
}
