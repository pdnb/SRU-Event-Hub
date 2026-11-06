'use client';

import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Skeleton, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ThaiDateRange } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { List } from '@/components/SimpleList';
import type { MyEvaluation } from '@/features/evaluations/types';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function MyEvaluationsPage() {
  const me = useMe();
  const router = useRouter();
  const list = useQuery({ queryKey: ['my-evaluations'], queryFn: () => api.get<MyEvaluation[]>('/me/evaluations'), enabled: !!me.data });

  useEffect(() => {
    if (me.isError) router.replace('/login?next=/my/evaluations');
  }, [me.isError, router]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>แบบประเมินกิจกรรม</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>ความคิดเห็นของท่านช่วยพัฒนากิจกรรมครั้งต่อไป — บางกิจกรรมกำหนดให้ตอบแบบประเมินก่อนรับเกียรติบัตร</p>
      <Card>
        {me.isPending || list.isPending ? (
          <Skeleton active />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data.length ? (
          <Empty description="ยังไม่มีแบบประเมิน" />
        ) : (
          <List
            dataSource={list.data}
            renderItem={(f) => (
              <List.Item
                actions={[
                  f.answered ? (
                    <Tag key="a" color="green">
                      ตอบแล้ว
                    </Tag>
                  ) : f.canAnswer ? (
                    <Link key="g" href={`/my/evaluations/${f.formId}?registrationId=${f.registrationId}`}>
                      <Button type="primary">ตอบแบบประเมิน</Button>
                    </Link>
                  ) : (
                    <Typography.Text key="r" type="secondary">
                      {f.reason}
                    </Typography.Text>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <>
                      {f.titleTh} {f.requiredForCertificate && <Tag color="blue">ใช้รับเกียรติบัตร</Tag>}
                    </>
                  }
                  description={
                    <>
                      {f.event.titleTh} · <ThaiDateRange start={f.event.startAt} end={f.event.endAt} />
                    </>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
