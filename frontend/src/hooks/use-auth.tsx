'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { ApiError } from '@/lib/api';
import { authService } from '@/services/auth';
import type { Me, Role } from '@/types/api';
import { browserTimezone } from '@/utils/format';

interface AuthState {
  user: Me | null;
  loading: boolean;
  timezone: string;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  setUser: (u: Me) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await authService.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const logout = useCallback(async () => {
    await authService.logout().catch(() => undefined);
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'public' });
    router.push('/login');
  }, [qc, router]);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data ?? null,
      loading: me.isLoading,
      timezone: me.data?.timezone ?? browserTimezone(),
      refresh: () => me.refetch(),
      logout,
      setUser: (u) => qc.setQueryData(['me'], u),
    }),
    [me, logout, qc],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function homeFor(role: Role) {
  return role === 'ADMIN' ? '/admin' : role === 'TEACHER' ? '/teacher' : '/student';
}

/**
 * UX-only route guard: redirects anonymous users to login and wrong roles to their home.
 * Real enforcement happens in the backend on every request.
 */
export function useRequireRole(role: Role) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    else if (user.role !== role) router.replace(homeFor(user.role));
  }, [user, loading, role, router]);
  return { user: user?.role === role ? user : null, loading: loading || !user || user.role !== role };
}
