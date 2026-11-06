'use client';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, Menu, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Alert, Avatar, Skeleton } from '@/components/ui/primitives';
import { useAuth, useRequireRole } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { announcementService, notificationService } from '@/services/account';
import { authService } from '@/services/auth';
import type { Role } from '@/types/api';
import { cn } from '@/utils/cn';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

export function DashboardShell({ role, nav, children }: { role: Role; nav: NavItem[]; children: React.ReactNode }) {
  const { user, loading } = useRequireRole(role);
  const { logout } = useAuth();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const base = `/${role.toLowerCase()}`;
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: notificationService.unreadCount, enabled: !!user, refetchInterval: 60_000 });
  const announcements = useQuery({ queryKey: ['announcements'], queryFn: announcementService.active, enabled: !!user, staleTime: 5 * 60_000 });
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tm_dismissed_announcements') ?? '[]');
    } catch {
      return [];
    }
  });
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem('tm_dismissed_announcements', JSON.stringify(next));
    } catch {
      /* storage unavailable: dismissal lasts for this page view only */
    }
  };
  const resend = useMutation({
    mutationFn: authService.resendVerification,
    onSuccess: () => toast.success('Verification email sent. Check your inbox.'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Dashboard pages are client components and can't export metadata, so name the browser tab after
  // the active section (detail pages such as /student/sessions/[id] take their parent's name).
  // The rendered <title> (hoisted into <head> by React 19) wins over the default title Next.js
  // streams in on a full page load; the effect covers client-side navigation, where Next.js
  // re-inserts its own <title> ahead of ours.
  const section = nav.find((n) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`)));
  const tabTitle = section ? `${section.label} · TeachMe` : null;
  const title = tabTitle ? <title>{tabTitle}</title> : null;
  useEffect(() => {
    if (!tabTitle) return;
    const apply = () => {
      if (document.title !== tabTitle) document.title = tabTitle;
    };
    apply();
    // Next.js can restore its default title after this effect, so keep ours applied.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [tabTitle]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh">
        {title}
        <div className="hidden w-64 border-r border-border p-4 lg:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-6 h-40" />
        </div>
      </div>
    );
  }

  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));
  const navList = (
    <nav aria-label="Dashboard" className="space-y-0.5">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setMobile(false)}
          aria-current={isActive(n) ? 'page' : undefined}
          className={cn(
            'group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            isActive(n) && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
          )}
        >
          <n.icon className="size-4 shrink-0" />
          {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      {title}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-4 lg:flex">
        <div className="px-2 pb-6">
          <Logo href={base} />
        </div>
        {navList}
        <div className="mt-auto rounded-xl border border-border bg-surface p-3">
          <p className="text-[12px] text-muted-foreground">Signed in as</p>
          <p className="truncate text-[13px] font-medium">{user.email}</p>
        </div>
      </aside>

      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface p-4 shadow-lift">
            <div className="mb-6 flex items-center justify-between">
              <Logo href={base} />
              <button onClick={() => setMobile(false)} className="rounded-lg p-2 hover:bg-muted" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {navList}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Link href={`${base}/notifications`} className="relative grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`}>
              <Bell className="size-4" />
              {!!unread.data && (
                <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground">{unread.data > 9 ? '9+' : unread.data}</span>
              )}
            </Link>
            <Dropdown.Root>
              <Dropdown.Trigger className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-muted" aria-label="Account menu">
                <Avatar name={user.fullName} size={30} />
                <span className="hidden max-w-36 truncate text-sm font-medium sm:block">{user.fullName}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lift">
                  <Dropdown.Item asChild>
                    <Link href={`${base}/settings`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted">
                      <Settings className="size-4" /> Settings
                    </Link>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => logout()} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
                    <LogOut className="size-4" /> Log out
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {!user.emailVerified && (
            <Alert
              tone="warning"
              title="Verify your email address"
              className="mb-6"
              action={
                <button onClick={() => resend.mutate()} disabled={resend.isPending} className="text-sm font-medium underline underline-offset-4">
                  {resend.isPending ? 'Sending…' : 'Resend email'}
                </button>
              }
            >
              We sent a link to {user.email}. You need a verified email to book sessions.
            </Alert>
          )}
          {(announcements.data ?? []).filter((a) => !dismissed.includes(a.id)).map((a) => (
            <Alert
              key={a.id}
              tone="info"
              title={a.title}
              className="mb-4"
              action={<button onClick={() => dismiss(a.id)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={`Dismiss announcement: ${a.title}`}><X className="size-4" /></button>}
            >
              <span className="whitespace-pre-line">{a.body}</span>
            </Alert>
          ))}
          {role === 'TEACHER' && user.teacherProfile && user.teacherProfile.approvalStatus !== 'APPROVED' && !pathname.startsWith('/teacher/application') && (
            <Alert
              tone={user.teacherProfile.approvalStatus === 'SUSPENDED' ? 'danger' : 'info'}
              title={user.teacherProfile.approvalStatus === 'PENDING' ? 'Finish and submit your application' : user.teacherProfile.approvalStatus === 'REJECTED' ? 'Your application needs changes' : 'Your profile is suspended'}
              className="mb-6"
              action={user.teacherProfile.approvalStatus !== 'SUSPENDED' ? <Link href="/teacher/application" className="text-sm font-medium underline underline-offset-4">Open application</Link> : undefined}
            >
              {user.teacherProfile.approvalStatus === 'SUSPENDED'
                ? 'Students cannot see or book your profile. Contact support for details.'
                : 'Students can book you once an administrator approves your application. Track its status and upload documents on the application page.'}
            </Alert>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
