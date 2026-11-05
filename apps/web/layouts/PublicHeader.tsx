'use client';

import { CalendarOutlined, LoginOutlined, MenuOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Drawer, Flex, Grid, Menu } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/hooks/useMe';
import { brand } from '@/styles/theme';

const NAV = [
  { key: '/', label: 'หน้าแรก' },
  { key: '/events', label: 'กิจกรรมทั้งหมด' },
  { key: '/events?tab=open', label: 'เปิดรับสมัคร' },
  { key: '/events?tab=upcoming', label: 'กำลังจะจัด' },
  { key: '/events?tab=past', label: 'กิจกรรมย้อนหลัง' },
  { key: '/calendar', label: 'ปฏิทินกิจกรรม', icon: <CalendarOutlined /> },
  { key: '/registration/status', label: 'ตรวจสอบสถานะ', icon: <SearchOutlined /> },
];

export function PublicHeader() {
  const path = usePathname();
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  const me = useMe();
  const items = NAV.map((n) => ({ key: n.key, icon: n.icon, label: <Link href={n.key}>{n.label}</Link> }));
  const selected = NAV.filter((n) => n.key === path).map((n) => n.key);

  const account = me.data ? (
    <Link href="/admin">
      <Button type="primary" icon={<UserOutlined />}>
        {me.data.displayName}
      </Button>
    </Link>
  ) : (
    <Link href="/login">
      <Button type="primary" icon={<LoginOutlined />}>
        เข้าสู่ระบบ
      </Button>
    </Link>
  );

  return (
    <header style={{ background: '#fff', borderBottom: `3px solid ${brand.accent}`, position: 'sticky', top: 0, zIndex: 100 }}>
      <Flex className="page-container" align="center" justify="space-between" style={{ height: 68 }} gap={16}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{ width: 40, height: 40, borderRadius: 10, background: brand.primary, color: brand.accent, display: 'grid', placeItems: 'center', fontWeight: 700 }}
          >
            SRU
          </span>
          <span style={{ lineHeight: 1.15 }}>
            <strong style={{ color: brand.primary, fontSize: 18 }}>SRU Event Hub</strong>
            <br />
            <small style={{ color: '#6b7280' }}>ระบบบริหารจัดการกิจกรรม มรส.</small>
          </span>
        </Link>
        {screens.lg ? (
          <Flex align="center" gap={8} style={{ flex: 1, justifyContent: 'flex-end', minWidth: 0 }}>
            <Menu mode="horizontal" selectedKeys={selected} items={items} style={{ borderBottom: 'none', flex: 1, justifyContent: 'flex-end', minWidth: 0 }} />
            {account}
          </Flex>
        ) : (
          <>
            <Button aria-label="เมนู" icon={<MenuOutlined />} onClick={() => setOpen(true)} />
            <Drawer open={open} onClose={() => setOpen(false)} title="เมนู" placement="right">
              <Menu mode="inline" selectedKeys={selected} items={items} onClick={() => setOpen(false)} style={{ borderInlineEnd: 'none' }} />
              <div style={{ marginTop: 16 }}>{account}</div>
            </Drawer>
          </>
        )}
      </Flex>
    </header>
  );
}
