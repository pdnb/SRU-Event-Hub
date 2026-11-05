'use client';

import {
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileDoneOutlined,
  FormOutlined,
  HomeOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Badge, Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, Result, Spin, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { PermissionCode } from '@sru/shared-types';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';
import { useUiStore } from '@/stores/ui';
import { brand } from '@/styles/theme';

type Item = { key: string; label: string; icon: ReactNode; perm?: PermissionCode; phase?: string; children?: Item[] };

/** Sidebar per spec §7. Items for modules scheduled in later phases are shown disabled with their phase. */
const MENU: Item[] = [
  { key: '/admin', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: '/admin/events', label: 'จัดการกิจกรรม', icon: <ProjectOutlined />, perm: 'event:view' },
  { key: '/calendar', label: 'ปฏิทินกิจกรรม', icon: <CalendarOutlined /> },
  { key: '/admin/approvals', label: 'รายการรออนุมัติ', icon: <CheckSquareOutlined />, perm: 'approval:approve' },
  {
    key: 'registration',
    label: 'การลงทะเบียน',
    icon: <FormOutlined />,
    children: [
      { key: '/admin/registrations', label: 'รายบุคคล', icon: null, perm: 'registration:view' },
      { key: 'groups', label: 'กลุ่ม / องค์กร', icon: null, phase: 'P3' },
    ],
  },
  { key: '/admin/finance/payments', label: 'การชำระเงิน', icon: <DollarOutlined />, perm: 'payment:view' },
  {
    key: 'finance',
    label: 'การเงิน / กองคลัง',
    icon: <BankOutlined />,
    children: [
      { key: '/admin/finance/batches', label: 'ชุดนำส่งกองคลัง', icon: null, perm: 'finance_batch:view' },
      { key: '/admin/finance/settings', label: 'บัญชีรับเงิน / รหัสรายได้', icon: null, perm: 'bank_account:view' },
      { key: 'cashier', label: 'รับชำระหน้างาน', icon: null, phase: 'P2b' },
      { key: 'refunds', label: 'คืนเงิน', icon: null, phase: 'P2b' },
    ],
  },
  { key: 'checkin', label: 'ตรวจสอบการเข้าร่วม', icon: <QrcodeOutlined />, phase: 'P4' },
  { key: 'badges', label: 'ป้ายชื่อ', icon: <IdcardOutlined />, phase: 'P4' },
  { key: 'certificates', label: 'เกียรติบัตร', icon: <SafetyCertificateOutlined />, phase: 'P5' },
  { key: 'evaluations', label: 'แบบประเมิน', icon: <FileDoneOutlined />, phase: 'P5' },
  { key: 'venues', label: 'สถานที่และทรัพยากร', icon: <HomeOutlined />, phase: 'P5' },
  { key: 'reports', label: 'รายงาน', icon: <BarChartOutlined />, phase: 'P5' },
  { key: '/admin/organizations', label: 'จัดการหน่วยงาน', icon: <ClusterOutlined />, perm: 'organization:view' },
  { key: '/admin/users', label: 'จัดการผู้ใช้งาน', icon: <TeamOutlined />, perm: 'user:view' },
  { key: 'audit', label: 'Audit Log', icon: <AuditOutlined />, phase: 'P2b', perm: 'audit_log:view' },
  { key: 'settings', label: 'ตั้งค่าระบบ', icon: <SettingOutlined />, phase: 'P2b', perm: 'system_setting:view' },
];

function toMenuItems(items: Item[], can: (p: PermissionCode) => boolean): MenuProps['items'] {
  return items
    .filter((i) => (!i.perm || can(i.perm)) && (!i.children || i.children.some((c) => c.perm && can(c.perm))))
    .map((i) =>
      i.children
        ? { key: i.key, icon: i.icon, label: i.label, children: toMenuItems(i.children, can) }
        : i.phase
          ? { key: i.key, icon: i.icon, disabled: true, label: <Flex justify="space-between" align="center">{i.label}<Tag style={{ marginInlineEnd: 0 }}>{i.phase}</Tag></Flex> }
          : { key: i.key, icon: i.icon, label: <Link href={i.key}>{i.label}</Link> },
    );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const screens = Grid.useBreakpoint();
  const { siderCollapsed, toggleSider } = useUiStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    void useUiStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (me.isError) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.isError, pathname, router]);

  if (me.isPending || me.isError) {
    return (
      <Flex style={{ minHeight: '100vh' }} align="center" justify="center">
        <Spin size="large" />
      </Flex>
    );
  }
  const perms = new Set(me.data.permissions);
  if (!perms.size) {
    return (
      <Result
        status="403"
        title="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานส่วนผู้ดูแล"
        subTitle="ท่านยังใช้งานลงทะเบียนกิจกรรมผ่านหน้าเว็บไซต์ได้ตามปกติ"
        extra={<Link href="/"><Button type="primary">ไปหน้าแรก</Button></Link>}
      />
    );
  }

  const items = toMenuItems(MENU, (p) => perms.has(p));
  const selected = MENU.flatMap((m) => [m, ...(m.children ?? [])])
    .map((m) => m.key)
    .filter((k) => k.startsWith('/') && (k === '/admin' ? pathname === '/admin' : pathname.startsWith(k.split('?')[0]!)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);
  const isMobile = !screens.lg;

  const logout = async () => {
    await api.auth.logout().catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  const menu = <Menu theme="dark" mode="inline" selectedKeys={selected} defaultOpenKeys={['registration']} items={items} onClick={() => setMobileOpen(false)} />;
  const logo = (collapsed: boolean) => (
    <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', color: '#fff', textDecoration: 'none' }}>
      <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 8, background: brand.accent, color: brand.sidebar, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>SRU</span>
      {!collapsed && <strong style={{ fontSize: 16 }}>SRU Event Hub</strong>}
    </Link>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" styles={{ body: { padding: 0, background: brand.sidebar }, header: { display: 'none' } }} size={260}>
          {logo(false)}
          {menu}
        </Drawer>
      ) : (
        <Layout.Sider width={260} collapsible collapsed={siderCollapsed} trigger={null} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          {logo(siderCollapsed)}
          {menu}
        </Layout.Sider>
      )}
      <Layout>
        <Layout.Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
          <Flex align="center" gap={12} style={{ minWidth: 0 }}>
            <Button
              type="text"
              aria-label="สลับเมนู"
              icon={isMobile || siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => (isMobile ? setMobileOpen(true) : toggleSider())}
            />
            <Typography.Text strong ellipsis style={{ fontSize: 16 }}>
              ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี
            </Typography.Text>
          </Flex>
          <Flex align="center" gap={16}>
            <Badge count={0} size="small">
              <Button type="text" shape="circle" aria-label="การแจ้งเตือน" icon={<BellOutlined />} />
            </Badge>
            <Dropdown
              menu={{
                items: [
                  { key: 'home', icon: <HomeOutlined />, label: <Link href="/">หน้าเว็บไซต์กิจกรรม</Link> },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: 'ออกจากระบบ', danger: true, onClick: logout },
                ],
              }}
            >
              <Flex align="center" gap={8} style={{ cursor: 'pointer' }}>
                <Avatar style={{ background: brand.primary }} icon={<UserOutlined />} />
                {!isMobile && (
                  <span style={{ lineHeight: 1.2 }}>
                    <div style={{ fontWeight: 600 }}>{me.data.displayName}</div>
                    <small style={{ color: '#6b7280' }}>{me.data.roles.map((r) => r.code).join(', ')}</small>
                  </span>
                )}
              </Flex>
            </Dropdown>
          </Flex>
        </Layout.Header>
        <Layout.Content style={{ padding: isMobile ? 16 : 24 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
