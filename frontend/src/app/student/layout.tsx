'use client';
import { Bell, CalendarDays, History, LayoutDashboard, Search, Settings } from 'lucide-react';
import { DashboardShell } from '@/layouts/dashboard-shell';

const NAV = [
  { href: '/student', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/student/find', label: 'Find a teacher', icon: Search },
  { href: '/student/sessions', label: 'Sessions', icon: History },
  { href: '/student/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/student/notifications', label: 'Notifications', icon: Bell },
  { href: '/student/settings', label: 'Settings', icon: Settings },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell role="STUDENT" nav={NAV}>{children}</DashboardShell>;
}
