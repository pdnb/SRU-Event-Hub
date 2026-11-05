'use client';

import { Breadcrumb, Flex, Typography } from 'antd';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Crumb {
  title: string;
  href?: string;
}

/** Every admin page has a title, short description, breadcrumb and action area (spec §7). */
export function PageHeader({
  title,
  description,
  breadcrumb = [],
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Breadcrumb
        style={{ marginBottom: 8 }}
        items={[{ title: <Link href="/admin">หน้าหลัก</Link> }, ...breadcrumb.map((c) => ({ title: c.href ? <Link href={c.href}>{c.title}</Link> : c.title }))]}
      />
      <Flex justify="space-between" align="flex-start" gap={16} wrap>
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {description && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              {description}
            </Typography.Text>
          )}
        </div>
        {actions && (
          <Flex gap={8} wrap>
            {actions}
          </Flex>
        )}
      </Flex>
    </div>
  );
}
