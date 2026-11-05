'use client';

import { Button, Empty, Result, Skeleton } from 'antd';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@sru/api-client';
import type { ReactNode } from 'react';

/** Standard loading / error / empty states for a query (spec §7). */
export function QueryState<T>({
  query,
  children,
  isEmpty,
  emptyText = 'ไม่พบข้อมูล',
  skeletonRows = 6,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  skeletonRows?: number;
}) {
  if (query.isPending) return <Skeleton active paragraph={{ rows: skeletonRows }} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data)) return <Empty description={emptyText} />;
  return <>{children(query.data)}</>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 403) return <Result status="403" title="ไม่มีสิทธิ์เข้าถึง" subTitle="บัญชีของท่านไม่มีสิทธิ์ใช้งานส่วนนี้" />;
  if (e?.status === 404) return <Result status="404" title="ไม่พบข้อมูล" subTitle={e.message} />;
  return (
    <Result
      status="error"
      title="เกิดข้อผิดพลาด"
      subTitle={
        <>
          {e?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
          {e?.requestId && <div style={{ fontSize: 12, marginTop: 4 }}>รหัสอ้างอิง: {e.requestId}</div>}
        </>
      }
      extra={onRetry && <Button onClick={onRetry}>ลองใหม่</Button>}
    />
  );
}
