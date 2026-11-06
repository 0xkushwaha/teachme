'use client';
import { Activity, BookOpen, CalendarRange, CreditCard, GraduationCap, HandCoins, LayoutDashboard, LifeBuoy, Mail, Megaphone, ScrollText, Settings2, TrendingUp, Users } from 'lucide-react';
import { DashboardShell } from '@/layouts/dashboard-shell';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/students', label: 'Students & admins', icon: Users },
  { href: '/admin/teachers', label: 'Toppers', icon: GraduationCap },
  { href: '/admin/subjects', label: 'Subjects', icon: BookOpen },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarRange },
  { href: '/admin/payments', label: 'Payments & refunds', icon: CreditCard },
  { href: '/admin/finance', label: 'Finance reports', icon: TrendingUp },
  { href: '/admin/payouts', label: 'Topper payouts', icon: HandCoins },
  { href: '/admin/integrations', label: 'Integration health', icon: Activity },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/admin/templates', label: 'Notification templates', icon: Mail },
  { href: '/admin/support', label: 'Support tickets', icon: LifeBuoy },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/settings', label: 'System settings', icon: Settings2 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell role="ADMIN" nav={NAV}>{children}</DashboardShell>;
}
