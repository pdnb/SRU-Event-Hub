'use client';

import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Empty, Flex, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { FORM_STATUS, type EvaluationForm, type FormSummaryRow } from './types';

export function EvaluationForms({ eventId }: { eventId: string }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const list = useQuery({ queryKey: ['evaluation-forms', eventId], queryFn: () => api.get<FormSummaryRow[]>(`/events/${eventId}/evaluation-forms`) });
  const create = useMutation({
    mutationFn: () => api.post<EvaluationForm>(`/events/${eventId}/evaluation-forms`, { titleTh: 'แบบประเมินความพึงพอใจต่อการจัดกิจกรรม' }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['evaluation-forms', eventId] });
      router.push(`/admin/evaluations/forms/${f.id}`);
    },
    onError: msg.error,
  });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <Card
      title="แบบประเมิน"
      extra={
        can('evaluation:create') && (
          <Button type="primary" icon={<PlusOutlined />} loading={create.isPending} onClick={() => create.mutate()}>
            สร้างแบบประเมิน
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">แบบประเมินใหม่เริ่มจากชุดคำถามความพึงพอใจมาตรฐาน (มาตรวัด 5 ระดับ + ข้อเสนอแนะ) แล้วปรับแก้ได้ก่อนมีผู้ตอบ</Typography.Paragraph>
      <Table<FormSummaryRow>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data ?? []}
        pagination={false}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="ยังไม่มีแบบประเมิน" /> }}
        columns={[
          { title: 'ชื่อแบบประเมิน', render: (_, f) => <Link href={`/admin/evaluations/forms/${f.id}`}>{f.titleTh}</Link> },
          { title: 'สถานะ', width: 130, render: (_, f) => <Tag color={FORM_STATUS[f.status].color}>{FORM_STATUS[f.status].label}</Tag> },
          {
            title: 'ตั้งค่า',
            width: 220,
            render: (_, f) => (
              <Flex gap={4} wrap>
                {f.isAnonymous && <Tag>ไม่ระบุตัวตน</Tag>}
                {f.requiredForCertificate && <Tag color="blue">ใช้กับเกียรติบัตร</Tag>}
              </Flex>
            ),
          },
          { title: 'คำถาม', width: 80, dataIndex: 'questionCount' },
          { title: 'ผู้ตอบ', width: 80, dataIndex: 'responseCount' },
          { title: 'สร้างเมื่อ', width: 130, render: (_, f) => <ThaiDate value={f.createdAt} /> },
        ]}
      />
    </Card>
  );
}
