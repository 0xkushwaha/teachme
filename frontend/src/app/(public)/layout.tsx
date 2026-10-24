import { SiteFooter } from '@/layouts/site-footer';
import { SiteHeader } from '@/layouts/site-header';
import { serverGet } from '@/lib/server-api';
import type { PlatformConfig } from '@/types/api';

/**
 * Rendered per request (never prerendered at build time, when the API may be unreachable).
 * Backend reads still go through Next's data cache (`revalidate: 60` in serverGet).
 */
export const dynamic = 'force-dynamic';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const config = await serverGet<PlatformConfig>('/platform/config');
  return (
    <>
      {config?.maintenanceBanner && <div className="bg-warning-soft px-4 py-2 text-center text-[13px]">{config.maintenanceBanner}</div>}
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
