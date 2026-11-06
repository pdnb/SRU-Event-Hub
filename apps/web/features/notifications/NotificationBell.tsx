'use client';

import { BellOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Empty, Flex, Popover, Spin, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { api } from '@/services/api';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Bell with unread count (polled every minute) and the latest notifications. */
export function NotificationBell({ type = 'text' }: { type?: 'text' | 'default' }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: ['notifications-unread'], queryFn: () => api.get<{ unread: number }>('/me/notifications/unread-count'), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const list = useQuery({ queryKey: ['notifications', 'latest'], queryFn: () => api.getPage<NotificationItem>('/me/notifications', { perPage: 8 }), enabled: open });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const read = useMutation({ mutationFn: (id?: string) => api.post(id ? `/me/notifications/${id}/read` : '/me/notifications/read-all'), onSuccess: refresh });

  const content = (
    <div style={{ width: 340, maxWidth: 'calc(100vw - 32px)' }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Typography.Text strong>การแจ้งเตือน</Typography.Text>
        <Button size="small" type="link" disabled={!count.data?.unread} onClick={() => read.mutate(undefined)}>
          อ่านทั้งหมด
        </Button>
      </Flex>
      {list.isPending ? (
        <Spin style={{ display: 'block', margin: '16px auto' }} />
      ) : !list.data?.items.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีการแจ้งเตือน" />
      ) : (
        <div style={{ maxHeight: 380, overflow: 'auto' }}>
          {list.data.items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.readAt) read.mutate(n.id);
                setOpen(false);
                if (n.link) router.push(n.link);
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f0f0f0', padding: '8px 4px', background: n.readAt ? 'transparent' : '#eff6ff', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: n.readAt ? 400 : 600, fontSize: 14 }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 13, color: '#4b5563', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.body}</div>}
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                <ThaiDate value={n.createdAt} time />
              </div>
            </button>
          ))}
        </div>
      )}
      <Flex justify="center" style={{ marginTop: 8 }}>
        <Link href="/my/notifications" onClick={() => setOpen(false)}>
          ดูทั้งหมด / ตั้งค่าการแจ้งเตือน
        </Link>
      </Flex>
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight">
      <Badge count={count.data?.unread ?? 0} size="small" overflowCount={99}>
        <Button type={type} shape="circle" aria-label={`การแจ้งเตือน${count.data?.unread ? ` ยังไม่อ่าน ${count.data.unread} รายการ` : ''}`} icon={<BellOutlined />} />
      </Badge>
    </Popover>
  );
}
