'use client';

import { CopyOutlined, DeleteOutlined, EyeOutlined, FontSizeOutlined, PictureOutlined, PlusOutlined, QrcodeOutlined, SaveOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, ColorPicker, Dropdown, Empty, Flex, Input, InputNumber, Radio, Row, Segmented, Select, Space, Switch, Typography, Upload } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { clampMm as clamp, LayoutCanvas } from '@/components/LayoutCanvas';
import { openPdf } from '@/features/badges/print';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { fetchObjectUrl } from '@/services/download';
import { ROLE_LABEL, type CertField, type CertTemplate, type PersonnelRole } from './types';

const SAMPLE: Record<string, string> = {
  fullName: 'นางสาวสมใจ ตั้งใจเรียน',
  prefix: 'นางสาว',
  firstName: 'สมใจ',
  lastName: 'ตั้งใจเรียน',
  affiliation: 'คณะวิทยาศาสตร์และเทคโนโลยี',
  role: 'ผู้เข้าร่วม',
  participantType: 'นักศึกษา',
  eventCode: 'EVT-2570-000010',
  eventDate: '15 ธ.ค. 2569',
  venue: 'หอประชุมใหญ่',
  organizationName: 'คณะวิทยาศาสตร์และเทคโนโลยี',
  hours: '6',
  certificateNo: 'CERT-2570-000123',
  verifyCode: 'AB12-CD34-EF56',
  verifyUrl: 'https://events.sru.ac.th/verify/AB12-CD34-EF56',
  issueDate: '16 ธ.ค. 2569',
};
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
const hex6 = (h: string) => `#${h.slice(0, 6)}`;

type Draft = Omit<CertTemplate, 'id' | 'eventId' | 'version' | 'backgroundFileId' | 'issuedCount'>;

export function CertificateDesigner({ template, eventTitle }: { template: CertTemplate; eventTitle: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const editable = can('certificate:update');
  const [draft, setDraft] = useState<Draft>(() => {
    const { id: _i, eventId: _e, version: _v, backgroundFileId: _b, issuedCount: _c, ...rest } = template;
    return { ...rest, fields: template.fields.map(({ kind, content, xMm, yMm, wMm, hMm, fontSize, bold, align, color }) => ({ kind, content, xMm, yMm, wMm, hMm, fontSize, bold, align, color })) };
  });
  const [version, setVersion] = useState(template.version);
  const [bgFileId, setBgFileId] = useState(template.backgroundFileId);
  const [removeBg, setRemoveBg] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const meta = useQuery({ queryKey: ['certificate-placeholders'], queryFn: () => api.get<{ placeholders: Record<string, string> }>('/certificates/placeholders'), staleTime: Infinity });
  const bg = useQuery({
    queryKey: ['certificate-background', template.id, bgFileId],
    queryFn: async () => (await fetchObjectUrl(`/certificate-templates/${template.id}/background`)).url,
    enabled: !!bgFileId,
    staleTime: Infinity,
    gcTime: 0,
  });
  useEffect(() => {
    const url = bg.data;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [bg.data]);
  const bgUrl = removeBg ? null : (bg.data ?? null);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const updateField = (i: number, patch: Partial<CertField>) => update({ fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const field = sel !== null ? draft.fields[sel] : undefined;
  const vars = { ...SAMPLE, eventTitle };

  const addField = (kind: CertField['kind']) => {
    const w = kind === 'QR' ? 25 : draft.widthMm - 60;
    const h = kind === 'QR' ? 25 : 12;
    const f: CertField = { kind, content: kind === 'QR' ? null : 'ข้อความ', xMm: (draft.widthMm - w) / 2, yMm: (draft.heightMm - h) / 2, wMm: w, hMm: h, fontSize: 16, bold: false, align: 'center', color: '#111111' };
    update({ fields: [...draft.fields, f] });
    setSel(draft.fields.length);
  };
  const removeField = (i: number) => {
    update({ fields: draft.fields.filter((_, j) => j !== i) });
    setSel(null);
  };
  const duplicate = (i: number) => {
    const f = draft.fields[i]!;
    update({ fields: [...draft.fields, { ...f, xMm: clamp(f.xMm + 3, 0, draft.widthMm - f.wMm), yMm: clamp(f.yMm + 3, 0, draft.heightMm - f.hMm) }] });
    setSel(draft.fields.length);
  };
  const rotate = () => update({ widthMm: draft.heightMm, heightMm: draft.widthMm, fields: draft.fields.map((f) => ({ ...f, xMm: clamp(f.xMm, 0, Math.max(0, draft.heightMm - f.wMm)), yMm: clamp(f.yMm, 0, Math.max(0, draft.widthMm - f.hMm)), wMm: Math.min(f.wMm, draft.heightMm), hMm: Math.min(f.hMm, draft.widthMm) })) });

  const payload = () => {
    const { nameTh, audience, personnelRoles, widthMm, heightMm, backgroundColor, fields, requireAttendance, countLate, minSessionPercent, requireEvaluation, allowSelfClaim } = draft;
    return { nameTh, audience, personnelRoles, widthMm, heightMm, backgroundColor, fields: fields.map((f) => ({ ...f, content: f.kind === 'QR' ? null : f.content })), requireAttendance, countLate, minSessionPercent, requireEvaluation, allowSelfClaim };
  };
  const showErrors = (e: unknown) => {
    if (e instanceof ApiError && Array.isArray(e.details)) msg.error(new ApiError(e.status, e.code, (e.details as string[]).join(' · ')));
    else msg.error(e);
  };
  const save = useMutation({
    mutationFn: () => api.put<CertTemplate>(`/certificate-templates/${template.id}`, { ...payload(), version, removeBackground: removeBg || undefined }),
    onSuccess: (t) => {
      msg.success('บันทึกแม่แบบแล้ว');
      setVersion(t.version);
      setBgFileId(t.backgroundFileId);
      setRemoveBg(false);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['certificate-templates', template.eventId] });
      qc.setQueryData(['certificate-template', template.id], t);
    },
    onError: showErrors,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (dirty) throw new ApiError(0, 'UNSAVED', 'กรุณาบันทึกการแก้ไขก่อนอัปโหลดภาพพื้นหลัง');
      const fd = new FormData();
      fd.append('file', file);
      return api.post<CertTemplate>(`/certificate-templates/${template.id}/background`, fd);
    },
    onSuccess: (t) => {
      msg.success('อัปโหลดภาพพื้นหลังแล้ว');
      setVersion(t.version);
      setBgFileId(t.backgroundFileId);
      setRemoveBg(false);
    },
    onError: msg.error,
  });
  const preview = () =>
    openPdf(api.http.post(`/events/${template.eventId}/certificate-templates/preview`, { template: payload(), templateId: bgFileId && !removeBg ? template.id : undefined }, { responseType: 'blob' })).catch(showErrors);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const placeholders = meta.data?.placeholders ?? {};
  const participant = draft.audience === 'PARTICIPANT';

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card
          title={
            <Flex gap={8} align="center" wrap>
              {draft.widthMm}×{draft.heightMm} มม.
              {dirty && <Typography.Text type="warning">• ยังไม่บันทึก</Typography.Text>}
            </Flex>
          }
          extra={
            <Space wrap>
              <Button icon={<EyeOutlined />} onClick={() => void preview()}>
                ตัวอย่าง PDF
              </Button>
              {editable && (
                <Button type="primary" icon={<SaveOutlined />} loading={save.isPending} disabled={!dirty && !removeBg} onClick={() => save.mutate()}>
                  บันทึก
                </Button>
              )}
            </Space>
          }
        >
          {editable && (
            <Space wrap style={{ marginBottom: 12 }}>
              <Button icon={<FontSizeOutlined />} onClick={() => addField('TEXT')}>
                ข้อความ
              </Button>
              <Button icon={<QrcodeOutlined />} onClick={() => addField('QR')}>
                QR ตรวจสอบ
              </Button>
            </Space>
          )}
          <LayoutCanvas
            widthMm={draft.widthMm}
            heightMm={draft.heightMm}
            fields={draft.fields}
            selected={sel}
            onSelect={setSel}
            onChange={updateField}
            onRemove={removeField}
            editable={editable}
            background={draft.backgroundColor}
            backgroundImage={bgUrl}
            maxWidth={760}
            qrMinMm={15}
            ariaLabel="พื้นที่ออกแบบเกียรติบัตร ใช้ปุ่มลูกศรเลื่อนองค์ประกอบที่เลือก"
            renderBox={(f, { scale, ptToPx }) => ({
              content: f.kind === 'QR' ? <QRCodeSVG value={SAMPLE.verifyUrl!} size={Math.min(f.wMm, f.hMm) * scale} marginSize={2} /> : <span style={{ padding: '0 2px', whiteSpace: 'pre-line', width: '100%' }}>{fill(f.content ?? '', vars)}</span>,
              style: {
                color: f.color ?? '#000',
                fontSize: ptToPx(f.fontSize),
                fontWeight: f.bold ? 700 : 400,
                justifyContent: f.align === 'left' ? 'flex-start' : f.align === 'right' ? 'flex-end' : 'center',
                textAlign: f.align,
              },
            })}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            ลากเพื่อย้าย · มุมขวาล่างเพื่อปรับขนาด · ลูกศรเพื่อเลื่อนละเอียด · ลายเซ็น/ตราสัญลักษณ์ให้อยู่ในภาพพื้นหลัง · ตรวจผลจริงด้วย “ตัวอย่าง PDF”
          </Typography.Paragraph>
        </Card>
      </Col>

      <Col xs={24} xl={10}>
        <Card title="องค์ประกอบที่เลือก" style={{ marginBottom: 16 }}>
          {!field ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="คลิกองค์ประกอบบนเกียรติบัตรเพื่อแก้ไข" />
          ) : (
            <Flex vertical gap={12}>
              <Flex justify="space-between" align="center">
                <Typography.Text strong>{field.kind === 'QR' ? 'QR สำหรับตรวจสอบความถูกต้อง' : 'ข้อความ'}</Typography.Text>
                {editable && (
                  <Space>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(sel!)}>
                      ทำสำเนา
                    </Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeField(sel!)}>
                      ลบ
                    </Button>
                  </Space>
                )}
              </Flex>
              {field.kind === 'TEXT' && (
                <div>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                    <Typography.Text>ข้อความ (ขึ้นบรรทัดใหม่ได้)</Typography.Text>
                    <Dropdown
                      disabled={!editable}
                      menu={{
                        items: Object.entries(placeholders).map(([k, label]) => ({ key: k, label: `{${k}} — ${label}` })),
                        onClick: ({ key }) => updateField(sel!, { content: `${field.content ?? ''}{${key}}` }),
                        style: { maxHeight: 320, overflow: 'auto' },
                      }}
                    >
                      <Button size="small" icon={<PlusOutlined />}>
                        แทรกข้อมูล
                      </Button>
                    </Dropdown>
                  </Flex>
                  <Input.TextArea disabled={!editable} rows={3} maxLength={1000} value={field.content ?? ''} onChange={(e) => updateField(sel!, { content: e.target.value })} />
                </div>
              )}
              <Row gutter={[8, 8]}>
                {(['xMm', 'yMm', 'wMm', 'hMm'] as const).map((k) => (
                  <Col key={k} span={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {{ xMm: 'ซ้าย (มม.)', yMm: 'บน (มม.)', wMm: 'กว้าง', hMm: 'สูง' }[k]}
                    </Typography.Text>
                    <InputNumber
                      disabled={!editable}
                      size="small"
                      min={k === 'wMm' || k === 'hMm' ? 1 : 0}
                      max={k === 'xMm' || k === 'wMm' ? draft.widthMm : draft.heightMm}
                      step={0.5}
                      value={field[k]}
                      onChange={(v) => {
                        if (v === null) return;
                        if (field.kind === 'QR' && (k === 'wMm' || k === 'hMm')) updateField(sel!, { wMm: v, hMm: v });
                        else updateField(sel!, { [k]: v });
                      }}
                      style={{ width: '100%' }}
                    />
                  </Col>
                ))}
              </Row>
              {field.kind === 'TEXT' && (
                <Flex gap={12} align="center" wrap>
                  <Space size={4}>
                    <Typography.Text>ขนาด</Typography.Text>
                    <InputNumber disabled={!editable} size="small" min={4} max={120} step={0.5} value={field.fontSize} onChange={(v) => v && updateField(sel!, { fontSize: v })} suffix="pt" style={{ width: 110 }} />
                  </Space>
                  <Checkbox disabled={!editable} checked={field.bold} onChange={(e) => updateField(sel!, { bold: e.target.checked })}>
                    ตัวหนา
                  </Checkbox>
                  <Segmented
                    disabled={!editable}
                    size="small"
                    value={field.align}
                    onChange={(align) => updateField(sel!, { align: align as CertField['align'] })}
                    options={[
                      { value: 'left', label: 'ซ้าย' },
                      { value: 'center', label: 'กลาง' },
                      { value: 'right', label: 'ขวา' },
                    ]}
                  />
                  <ColorPicker disabled={!editable} size="small" value={field.color ?? '#000000'} onChange={(c) => updateField(sel!, { color: hex6(c.toHex()) })} />
                </Flex>
              )}
              {field.kind === 'QR' && <Alert type="info" showIcon title="QR พาไปหน้าตรวจสอบเกียรติบัตรสาธารณะ — ขนาดอย่างน้อย 15 มม." />}
            </Flex>
          )}
        </Card>

        <Card title="ตั้งค่าแม่แบบ" style={{ marginBottom: 16 }}>
          <Flex vertical gap={12}>
            <div>
              <Typography.Text>ชื่อแม่แบบ</Typography.Text>
              <Input disabled={!editable} maxLength={200} value={draft.nameTh} onChange={(e) => update({ nameTh: e.target.value })} />
            </div>
            <Flex gap={12} wrap align="center">
              <Button disabled={!editable} onClick={rotate}>
                {draft.widthMm >= draft.heightMm ? 'แนวนอน → แนวตั้ง' : 'แนวตั้ง → แนวนอน'}
              </Button>
              <Space size={4}>
                <Typography.Text>สีพื้น</Typography.Text>
                <ColorPicker disabled={!editable} allowClear value={draft.backgroundColor ?? undefined} onChange={(c) => update({ backgroundColor: hex6(c.toHex()) })} onClear={() => update({ backgroundColor: null })} />
              </Space>
            </Flex>
            <div>
              <Typography.Text style={{ display: 'block' }}>ภาพพื้นหลัง (PNG/JPG ไม่เกิน 8 MB — กรอบ ตราสัญลักษณ์ และลายเซ็น สัดส่วนเท่ากระดาษ)</Typography.Text>
              <Space wrap>
                <Upload accept="image/png,image/jpeg" showUploadList={false} disabled={!editable} beforeUpload={(f) => (upload.mutate(f), false)}>
                  <Button icon={<PictureOutlined />} loading={upload.isPending} disabled={!editable}>
                    {bgFileId && !removeBg ? 'เปลี่ยนภาพ' : 'อัปโหลดภาพ'}
                  </Button>
                </Upload>
                {bgFileId && !removeBg && editable && (
                  <Button
                    danger
                    onClick={() => {
                      setRemoveBg(true);
                      setDirty(true);
                    }}
                  >
                    นำภาพออก
                  </Button>
                )}
              </Space>
            </div>
          </Flex>
        </Card>

        <Card title="ผู้มีสิทธิ์ได้รับ">
          <Flex vertical gap={12}>
            <Radio.Group
              disabled={!editable}
              value={draft.audience}
              onChange={(e) => update({ audience: e.target.value as Draft['audience'] })}
              options={[
                { value: 'PARTICIPANT', label: 'ผู้ลงทะเบียน (ตามเกณฑ์)' },
                { value: 'PERSONNEL', label: 'บุคลากรของงาน' },
              ]}
            />
            {participant ? (
              <>
                <Checkbox disabled={!editable} checked={draft.requireAttendance} onChange={(e) => update({ requireAttendance: e.target.checked })}>
                  ต้องเช็กอินเข้าร่วมกิจกรรม
                </Checkbox>
                {draft.requireAttendance && (
                  <Checkbox disabled={!editable} checked={draft.countLate} onChange={(e) => update({ countLate: e.target.checked })} style={{ marginInlineStart: 24 }}>
                    นับ “มาสาย” ว่าเข้าร่วม
                  </Checkbox>
                )}
                <Flex gap={8} align="center" wrap>
                  <Checkbox disabled={!editable} checked={draft.minSessionPercent != null} onChange={(e) => update({ minSessionPercent: e.target.checked ? 80 : null })}>
                    เข้าร่วมช่วงกิจกรรมอย่างน้อย
                  </Checkbox>
                  {draft.minSessionPercent != null && (
                    <InputNumber disabled={!editable} size="small" min={1} max={100} value={draft.minSessionPercent} onChange={(v) => v && update({ minSessionPercent: v })} suffix="%" style={{ width: 100 }} />
                  )}
                </Flex>
                <Checkbox disabled={!editable} checked={draft.requireEvaluation} onChange={(e) => update({ requireEvaluation: e.target.checked })}>
                  ต้องตอบแบบประเมินที่กำหนดให้ใช้กับเกียรติบัตร
                </Checkbox>
                <Flex gap={8} align="center">
                  <Switch disabled={!editable} checked={draft.allowSelfClaim} onChange={(allowSelfClaim) => update({ allowSelfClaim })} />
                  <Typography.Text>ผู้เข้าร่วมที่ผ่านเกณฑ์ดาวน์โหลดเองได้</Typography.Text>
                </Flex>
              </>
            ) : (
              <div>
                <Typography.Text>บทบาท (ไม่เลือก = ทุกบทบาท)</Typography.Text>
                <Select<PersonnelRole[]>
                  mode="multiple"
                  disabled={!editable}
                  style={{ width: '100%' }}
                  value={draft.personnelRoles}
                  onChange={(personnelRoles) => update({ personnelRoles })}
                  options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </div>
            )}
          </Flex>
        </Card>
      </Col>
    </Row>
  );
}
