'use client';

import { DownloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Flex, Space, Tag, Typography } from 'antd';
import { ThaiDate } from '@/components/Format';
import { List } from '@/components/SimpleList';
import type { MyCertificates } from './types';

/**
 * A participant's certificates: issued ones (download + verify link) and ones they may claim
 * (with the reasons when not yet eligible). Used on /my/certificates and in the guest status page.
 */
export function MyCertificateList({
  data,
  onDownload,
  onClaim,
  claiming,
  showEvent = true,
}: {
  data: MyCertificates;
  onDownload: (id: string) => void;
  onClaim: (c: MyCertificates['claimable'][number]) => void;
  claiming?: string | null;
  showEvent?: boolean;
}) {
  if (!data.issued.length && !data.claimable.length) return <Empty description="ยังไม่มีเกียรติบัตร" />;
  return (
    <Flex vertical gap={16}>
      {!!data.claimable.length && (
        <List
          dataSource={data.claimable}
          renderItem={(c) => (
            <List.Item
              actions={[
                c.eligible ? (
                  <Button key="c" type="primary" icon={<SafetyCertificateOutlined />} loading={claiming === c.templateId + c.registrationId} onClick={() => onClaim(c)}>
                    รับเกียรติบัตร
                  </Button>
                ) : (
                  <Tag key="n" color="orange">
                    ยังไม่ผ่านเกณฑ์
                  </Tag>
                ),
              ]}
            >
              <List.Item.Meta
                title={c.nameTh}
                description={
                  <>
                    {showEvent && <div>{c.event.titleTh}</div>}
                    {!c.eligible && <Alert type="warning" showIcon style={{ marginTop: 6 }} title={c.reasons.join(' · ')} />}
                  </>
                }
              />
            </List.Item>
          )}
        />
      )}
      {!!data.issued.length && (
        <List
          dataSource={data.issued}
          renderItem={(c) => (
            <List.Item
              actions={[
                <Button key="d" icon={<DownloadOutlined />} onClick={() => onDownload(c.id)}>
                  ดาวน์โหลด PDF
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    {c.template.nameTh}
                    <Tag color="green">ออกแล้ว</Tag>
                  </Space>
                }
                description={
                  <>
                    {showEvent && <div>{c.event.titleTh}</div>}
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      เลขที่ {c.certificateNo} · ออกเมื่อ <ThaiDate value={c.issuedAt} /> · รหัสตรวจสอบ{' '}
                      <Typography.Link href={c.verifyUrl} target="_blank">
                        {c.verifyCode}
                      </Typography.Link>
                    </Typography.Text>
                  </>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Flex>
  );
}
