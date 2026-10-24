import Link from 'next/link';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 font-semibold tracking-tight" aria-label="TeachMe home">
      <span className="relative grid size-8 place-items-center overflow-hidden rounded-[10px] bg-accent text-accent-foreground shadow-soft">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7l8-4 8 4-8 4-8-4z" />
          <path d="M8 9.5V14c0 1.5 1.8 3 4 3s4-1.5 4-3V9.5" />
        </svg>
        <span className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/25 to-white/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      </span>
      <span className="text-[17px]">
        Teach<span className="text-accent">Me</span>
      </span>
    </Link>
  );
}
