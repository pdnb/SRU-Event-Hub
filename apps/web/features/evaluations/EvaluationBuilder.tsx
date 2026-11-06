'use client';

import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Dropdown, Flex, Input, InputNumber, Popconfirm, Row, Space, Switch, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { FORM_STATUS, KIND_LABEL, type EvaluationForm, type Question, type QuestionKind } from './types';

type Draft = Pick<EvaluationForm, 'titleTh' | 'description' | 'isAnonymous' | 'requireAttendance' | 'requiredForCertificate' | 'opensAt' | 'closesAt' | 'questions'>;

const blank = (kind: QuestionKind): Question => ({
  kind,
  labelTh: kind === 'SECTION' ? 'หัวข้อใหม่' : 'คำถามใหม่',
  helpText: null,
  isRequired: kind !== 'SECTION' && kind !== 'TEXTAREA',
  scaleMax: 5,
  options: kind === 'SINGLE' || kind === 'MULTI' ? [{ labelTh: 'ตัวเลือก 1' }, { labelTh: 'ตัวเลือก 2' }] : [],
});

/** Form settings + question editor. Questions lock once anyone has answered (results stay comparable). */
export function EvaluationBuilder({ form }: { form: EvaluationForm }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const editable = can('evaluation:update');
  const locked = form.responseCount > 0;
  const toDraft = (f: EvaluationForm): Draft => ({
    titleTh: f.titleTh, description: f.description, isAnonymous: f.isAnonymous, requireAttendance: f.requireAttendance, requiredForCertificate: f.requiredForCertificate,
    opensAt: f.opensAt, closesAt: f.closesAt, questions: f.questions,
  });
  const [draft, setDraft] = useState<Draft>(() => toDraft(form));
  const [version, setVersion] = useState(form.version);
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setQ = (i: number, patch: Partial<Question>) => update({ questions: draft.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, d: -1 | 1) => {
    const qs = [...draft.questions];
    [qs[i], qs[i + d]] = [qs[i + d]!, qs[i]!];
    update({ questions: qs });
  };

  const refresh = (f: EvaluationForm) => {
    setVersion(f.version);
    setDirty(false);
    qc.setQueryData(['evaluation-form', form.id], f);
    void qc.invalidateQueries({ queryKey: ['evaluation-forms', form.eventId] });
  };
  const errors = (e: unknown) => {
    if (e instanceof ApiError && Array.isArray(e.details)) msg.error(new ApiError(e.status, e.code, (e.details as string[]).join(' · ')));
    else msg.error(e);
  };
  const save = useMutation({
    mutationFn: () =>
      api.put<EvaluationForm>(`/evaluation-forms/${form.id}`, {
        titleTh: draft.titleTh, description: draft.description, requireAttendance: draft.requireAttendance, requiredForCertificate: draft.requiredForCertificate,
        opensAt: draft.opensAt, closesAt: draft.closesAt, version,
        ...(locked ? {} : { isAnonymous: draft.isAnonymous, questions: draft.questions.map(({ kind, labelTh, helpText, isRequired, scaleMax, options }) => ({ kind, labelTh, helpText, isRequired, scaleMax, options: options.map((o) => o.labelTh) })) }),
      }),
    onSuccess: (f) => {
      msg.success('บันทึกแบบประเมินแล้ว');
      setDraft(toDraft(f));
      refresh(f);
    },
    onError: errors,
  });
  const status = useMutation({
    mutationFn: (s: 'PUBLISHED' | 'CLOSED') => api.post<EvaluationForm>(`/evaluation-forms/${form.id}/status`, { status: s }),
    onSuccess: (f) => {
      msg.success(f.status === 'PUBLISHED' ? 'เปิดรับคำตอบแล้ว' : 'ปิดรับคำตอบแล้ว');
      refresh(f);
    },
    onError: errors,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/evaluation-forms/${form.id}`),
    onSuccess: () => {
      msg.success('ลบแบบประเมินแล้ว');
      void qc.invalidateQueries({ queryKey: ['evaluation-forms', form.eventId] });
      router.push(`/admin/evaluations/${form.eventId}`);
    },
    onError: msg.error,
  });

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const st = qc.getQueryData<EvaluationForm>(['evaluation-form', form.id])?.status ?? form.status;
  const qEditable = editable && !locked;
  let no = 0;

  return (
    <Flex vertical gap={16}>
      <Card
        title={
          <Space wrap>
            ตั้งค่า
            <Tag color={FORM_STATUS[st].color}>{FORM_STATUS[st].label}</Tag>
            {dirty && <Typography.Text type="warning">• ยังไม่บันทึก</Typography.Text>}
          </Space>
        }
        extra={
          editable && (
            <Space wrap>
              {st !== 'PUBLISHED' && (
                <Button disabled={dirty} loading={status.isPending} onClick={() => status.mutate('PUBLISHED')}>
                  {st === 'CLOSED' ? 'เปิดรับอีกครั้ง' : 'เผยแพร่'}
                </Button>
              )}
              {st === 'PUBLISHED' && (
                <Button danger disabled={dirty} loading={status.isPending} onClick={() => status.mutate('CLOSED')}>
                  ปิดรับคำตอบ
                </Button>
              )}
              {!locked && (
                <Popconfirm title="ลบแบบประเมินนี้?" okText="ลบ" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
                  <Button danger type="text" icon={<DeleteOutlined />} aria-label="ลบแบบประเมิน" />
                </Popconfirm>
              )}
              <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                บันทึก
              </Button>
            </Space>
          )
        }
      >
        {dirty && st === 'DRAFT' && <Alert type="info" showIcon style={{ marginBottom: 12 }} title="บันทึกก่อนเผยแพร่" />}
        <Row gutter={[12, 12]}>
          <Col xs={24} md={14}>
            <Typography.Text>ชื่อแบบประเมิน</Typography.Text>
            <Input disabled={!editable} maxLength={300} value={draft.titleTh} onChange={(e) => update({ titleTh: e.target.value })} />
          </Col>
          <Col xs={12} md={5}>
            <Typography.Text>เปิดรับตั้งแต่</Typography.Text>
            <DatePicker showTime disabled={!editable} style={{ width: '100%' }} placeholder="เมื่อกิจกรรมเริ่ม" value={draft.opensAt ? dayjs(draft.opensAt) : null} onChange={(d) => update({ opensAt: d ? d.toISOString() : null })} />
          </Col>
          <Col xs={12} md={5}>
            <Typography.Text>ปิดรับเมื่อ</Typography.Text>
            <DatePicker showTime disabled={!editable} style={{ width: '100%' }} placeholder="จนกว่าจะปิดเอง" value={draft.closesAt ? dayjs(draft.closesAt) : null} onChange={(d) => update({ closesAt: d ? d.toISOString() : null })} />
          </Col>
          <Col span={24}>
            <Typography.Text>คำชี้แจง</Typography.Text>
            <Input.TextArea disabled={!editable} rows={2} maxLength={3000} value={draft.description ?? ''} onChange={(e) => update({ description: e.target.value })} />
          </Col>
          <Col span={24}>
            <Flex gap={24} wrap>
              <Space>
                <Switch disabled={!editable || locked} checked={draft.isAnonymous} onChange={(isAnonymous) => update({ isAnonymous })} />
                ไม่ระบุตัวตนผู้ตอบ
              </Space>
              <Space>
                <Switch disabled={!editable} checked={draft.requireAttendance} onChange={(requireAttendance) => update({ requireAttendance })} />
                ตอบได้เฉพาะผู้ที่เช็กอินแล้ว
              </Space>
              <Space>
                <Switch disabled={!editable} checked={draft.requiredForCertificate} onChange={(requiredForCertificate) => update({ requiredForCertificate })} />
                ใช้เป็นเงื่อนไขรับเกียรติบัตร
              </Space>
            </Flex>
            {draft.isAnonymous && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 13, margin: '8px 0 0' }}>
                ไม่บันทึกว่าใครตอบอะไร — ระบบเก็บเพียงรหัสที่เข้ารหัสทางเดียวเพื่อกันการตอบซ้ำและตรวจเงื่อนไขเกียรติบัตร
              </Typography.Paragraph>
            )}
          </Col>
        </Row>
      </Card>

      <Card
        title={`คำถาม (${draft.questions.filter((q) => q.kind !== 'SECTION').length} ข้อ)`}
        extra={
          qEditable && (
            <Dropdown menu={{ items: (Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => ({ key: k, label: KIND_LABEL[k] })), onClick: ({ key }) => update({ questions: [...draft.questions, blank(key as QuestionKind)] }) }}>
              <Button icon={<PlusOutlined />}>เพิ่ม</Button>
            </Dropdown>
          )
        }
      >
        {locked && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={`มีผู้ตอบแล้ว ${form.responseCount} คน — แก้ไขคำถามไม่ได้ (สร้างแบบประเมินใหม่หากต้องการเปลี่ยน)`} />}
        <Flex vertical gap={12}>
          {draft.questions.map((q, i) => {
            if (q.kind !== 'SECTION') no++;
            return (
              <Card key={i} size="small" style={{ background: q.kind === 'SECTION' ? '#f8fafc' : undefined }}>
                <Flex gap={8} align="start">
                  <Typography.Text strong style={{ minWidth: 28, paddingTop: 5 }}>
                    {q.kind === 'SECTION' ? '§' : `${no}.`}
                  </Typography.Text>
                  <Flex vertical gap={8} style={{ flex: 1 }}>
                    <Input disabled={!qEditable} value={q.labelTh} maxLength={500} onChange={(e) => setQ(i, { labelTh: e.target.value })} style={{ fontWeight: q.kind === 'SECTION' ? 600 : undefined }} />
                    <Input disabled={!qEditable} size="small" placeholder="คำอธิบายเพิ่มเติม (ไม่บังคับ)" value={q.helpText ?? ''} maxLength={1000} onChange={(e) => setQ(i, { helpText: e.target.value || null })} />
                    {(q.kind === 'SINGLE' || q.kind === 'MULTI') && (
                      <Flex vertical gap={4} style={{ paddingInlineStart: 12 }}>
                        {q.options.map((o, j) => (
                          <Flex key={j} gap={4}>
                            <Input disabled={!qEditable} size="small" value={o.labelTh} maxLength={300} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? { ...x, labelTh: e.target.value } : x)) })} />
                            {qEditable && q.options.length > 2 && <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="ลบตัวเลือก" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })} />}
                          </Flex>
                        ))}
                        {qEditable && (
                          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setQ(i, { options: [...q.options, { labelTh: `ตัวเลือก ${q.options.length + 1}` }] })} style={{ alignSelf: 'flex-start' }}>
                            ตัวเลือก
                          </Button>
                        )}
                      </Flex>
                    )}
                    <Flex gap={12} align="center" wrap>
                      <Tag>{KIND_LABEL[q.kind]}</Tag>
                      {q.kind === 'RATING' && (
                        <Space size={4}>
                          <span>ระดับ 1 –</span>
                          <InputNumber disabled={!qEditable} size="small" min={2} max={10} value={q.scaleMax} onChange={(v) => v && setQ(i, { scaleMax: v })} style={{ width: 64 }} />
                        </Space>
                      )}
                      {q.kind !== 'SECTION' && (
                        <Checkbox disabled={!qEditable} checked={q.isRequired} onChange={(e) => setQ(i, { isRequired: e.target.checked })}>
                          ต้องตอบ
                        </Checkbox>
                      )}
                    </Flex>
                  </Flex>
                  {qEditable && (
                    <Flex vertical>
                      <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="เลื่อนขึ้น" />
                      <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === draft.questions.length - 1} onClick={() => move(i, 1)} aria-label="เลื่อนลง" />
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => update({ questions: draft.questions.filter((_, j) => j !== i) })} aria-label="ลบคำถาม" />
                    </Flex>
                  )}
                </Flex>
              </Card>
            );
          })}
        </Flex>
      </Card>
    </Flex>
  );
}
