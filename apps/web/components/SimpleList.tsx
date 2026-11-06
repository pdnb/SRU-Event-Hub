'use client';

import { Empty, Flex, Spin, theme, Typography } from 'antd';
import { Fragment, type ReactNode } from 'react';

/**
 * Minimal replacement for antd's deprecated `List` (removed in the next antd major).
 * Supports only what the app uses: dataSource / renderItem / loading / empty text,
 * items with `actions` / `extra`, and a title + description meta block.
 */
function SimpleList<T>({
  dataSource,
  renderItem,
  loading,
  locale,
}: {
  dataSource?: T[];
  renderItem: (item: T, index: number) => ReactNode;
  loading?: boolean;
  locale?: { emptyText?: ReactNode };
}) {
  const items = dataSource ?? [];
  return (
    <Spin spinning={!!loading}>
      {items.length ? (
        <div role="list">{items.map((item, i) => <Fragment key={i}>{renderItem(item, i)}</Fragment>)}</div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={locale?.emptyText ?? 'ไม่มีข้อมูล'} />
      )}
    </Spin>
  );
}

function Item({ children, actions, extra }: { children: ReactNode; actions?: ReactNode[]; extra?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex role="listitem" align="center" justify="space-between" gap={16} wrap style={{ padding: '12px 0', borderBottom: `1px solid ${token.colorSplit}` }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>{children}</div>
      {(actions?.length || extra) && (
        <Flex gap={8} align="center" wrap>
          {actions}
          {extra}
        </Flex>
      )}
    </Flex>
  );
}

function Meta({ title, description }: { title?: ReactNode; description?: ReactNode }) {
  return (
    <div>
      {title && <div style={{ fontWeight: 500 }}>{title}</div>}
      {description && <Typography.Text type="secondary">{description}</Typography.Text>}
    </div>
  );
}

Item.Meta = Meta;
SimpleList.Item = Item;

export { SimpleList as List };
