import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { themeScript } from '@/hooks/use-theme';
import '@/styles/globals.css';

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'TeachMe — Live 1:1 tutoring with verified teachers', template: '%s · TeachMe' },
  description: 'Find a verified teacher by subject, book a live Google Meet session in their real availability, and pay securely. Reminders, rescheduling and refunds built in.',
  openGraph: { type: 'website', siteName: 'TeachMe' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#16151c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before hydration; ignore those. */}
      <body className={`${sans.variable} ${mono.variable} min-h-dvh font-sans antialiased`} suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lift">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
