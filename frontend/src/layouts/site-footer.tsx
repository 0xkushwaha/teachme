import Link from 'next/link';
import { Logo } from '@/components/logo';

const COLS = [
  { title: 'Learn', links: [['Browse subjects', '/subjects'], ['Find a teacher', '/teachers'], ['How it works', '/how-it-works'], ['Pricing & fees', '/pricing']] },
  { title: 'Teach', links: [['Apply to teach', '/register?role=TEACHER'], ['Teacher FAQ', '/faq#teachers'], ['Teacher login', '/login']] },
  { title: 'Support', links: [['Help & FAQ', '/faq'], ['Contact support', '/contact'], ['Report a booking issue', '/contact?category=BOOKING_ISSUE']] },
  { title: 'Legal', links: [['Terms of service', '/legal/terms'], ['Privacy policy', '/legal/privacy'], ['Cancellation & refunds', '/legal/cancellation']] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-2/50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">Live one-to-one lessons with verified teachers, booked in their real availability.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h3 className="text-[13px] font-semibold">{c.title}</h3>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[12.5px] text-muted-foreground sm:px-6">© {new Date().getFullYear()} TeachMe. Payments processed securely by Razorpay.</p>
      </div>
    </footer>
  );
}
