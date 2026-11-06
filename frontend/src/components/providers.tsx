'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/hooks/use-auth';
import { ApiError, isGatewayError } from '@/lib/api';

const GATEWAY_RETRY_DELAY_MS = 5_000;
const GATEWAY_MAX_RETRIES = 30;

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            // A sleeping API can take a minute or two to wake, so keep the page loading through it.
            retry: (count, err) => {
              if (isGatewayError(err)) return count < GATEWAY_MAX_RETRIES;
              return !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;
            },
            retryDelay: (count, err) => (isGatewayError(err) ? GATEWAY_RETRY_DELAY_MS : Math.min(1000 * 2 ** count, 30_000)),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <AuthProvider>{children}</AuthProvider>
        <Toaster position="top-right" richColors closeButton toastOptions={{ className: 'rounded-xl' }} />
      </MotionConfig>
    </QueryClientProvider>
  );
}
