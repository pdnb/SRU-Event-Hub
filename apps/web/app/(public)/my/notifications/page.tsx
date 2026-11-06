'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Empty, Flex, Pagination, Segmented, Skeleton, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import type { NotificationItem } from '@/features/notifications/NotificationBell';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function MyNotificationsPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState({ page: 1, perPage: 20, unread: 'false' as 'true' | 'false' });
  const list = useQuery({ queryKey: ['notifications', q], queryFn: () => api.getPage<NotificationItem>('/me/notifications', q), enabled: !!me.data, placeholderData: keepPreviousData });
  const read = useMutation({
    mutationFn: (id?: string) => api.post(id ? `/me/notifications/${id}/read` : '/me/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  useEffect(() => {
    if (me.isError) router.replace('/login?next=/my/notifications');
  }, [me.isError, router]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>การแจ้งเตือน</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>ข่าวสารเกี่ยวกับกิจกรรมที่ท่านลงทะเบียนและงานที่รอดำเนินการ</p>
      <Flex vertical gap={16}>
        <Card
          title={
            <Segmented
              value={q.unread}
              onChange={(v) => setQ({ ...q, page: 1, unread: v as 'true' | 'false' })}
              options={[
                { value: 'false', label: 'ทั้งหมด' },
                { value: 'true', label: 'ยังไม่อ่าน' },
              ]}
            />
          }
          extra={
            <Button size="small" onClick={() => read.mutate(undefined)}>
              ทำเครื่องหมายว่าอ่านทั้งหมด
            </Button>
          }
        >
          {me.isPending || list.isPending ? (
            <Skeleton active />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data.items.length ? (
            <Empty description="ไม่มีการแจ้งเตือน" />
          ) : (
            <>
              {list.data.items.map((n) => (
                <div key={n.id} style={{ padding: '12px 4px', borderBottom: '1px solid #f0f0f0', background: n.readAt ? undefined : '#eff6ff' }}>
                  <Flex justify="space-between" gap={12} align="start">
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text strong={!n.readAt}>{n.title}</Typography.Text>
                      {n.body && <div style={{ color: '#4b5563', whiteSpace: 'pre-wrap' }}>{n.body}</div>}
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>
                        <ThaiDate value={n.createdAt} time />
                      </div>
                    </div>
                    <Flex gap={4} vertical align="end">
                      {n.link && (
                        <Button
                          size="small"
                          onClick={() => {
                            if (!n.readAt) read.mutate(n.id);
                            router.push(n.link!);
                          }}
                        >
                          เปิด
                        </Button>
                      )}
                      {!n.readAt && (
                        <Button size="small" type="link" onClick={() => read.mutate(n.id)}>
                          อ่านแล้ว
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                </div>
              ))}
              <Flex justify="end" style={{ marginTop: 12 }}>
                <Pagination size="small" current={q.page} pageSize={q.perPage} total={list.data.meta.total} onChange={(page) => setQ({ ...q, page })} showSizeChanger={false} />
              </Flex>
            </>
          )}
        </Card>
        {me.data && <NotificationSettings />}
      </Flex>
    </div>
  );
}
