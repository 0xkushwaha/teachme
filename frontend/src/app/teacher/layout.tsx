'use client';
import { Bell, CalendarDays, CalendarRange, ClipboardList, FileCheck2, LayoutDashboard, Link2, Settings, UserRound, Wallet } from 'lucide-react';
import { DashboardShell } from '@/layouts/dashboard-shell';

const NAV = [
  { href: '/teacher', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/teacher/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/teacher/bookings', label: 'Bookings', icon: ClipboardList },
  { href: '/teacher/availability', label: 'Availability', icon: CalendarRange },
  { href: '/teacher/earnings', label: 'Earnings & payouts', icon: Wallet },
  { href: '/teacher/profile', label: 'Profile & subjects', icon: UserRound },
  { href: '/teacher/application', label: 'Application & documents', icon: FileCheck2 },
  { href: '/teacher/integrations', label: 'Google Calendar', icon: Link2 },
  { href: '/teacher/notifications', label: 'Notifications', icon: Bell },
  { href: '/teacher/settings', label: 'Settings', icon: Settings },
];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell role="TEACHER" nav={NAV}>{children}</DashboardShell>;
}
