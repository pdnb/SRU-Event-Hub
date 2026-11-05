'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import thTH from 'antd/locale/th_TH';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@sru/api-client';
import '@/services/dayjs';
import { theme } from '@/styles/theme';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Do not retry client errors (403/404/422…); retry network/5xx once.
            retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 1,
          },
        },
      }),
  );
  return (
    <AntdRegistry>
      <ConfigProvider locale={thTH} theme={theme}>
        <App>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
