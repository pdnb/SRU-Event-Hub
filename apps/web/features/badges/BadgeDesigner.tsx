'use client';

import { BgColorsOutlined, CopyOutlined, DeleteOutlined, EyeOutlined, FontSizeOutlined, PictureOutlined, PlusOutlined, QrcodeOutlined, SaveOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, ColorPicker, Dropdown, Empty, Flex, Input, InputNumber, Row, Segmented, Select, Space, Table, Typography, Upload } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { fetchObjectUrl } from '@/services/download';
import { openPdf } from './print';
import { ROLE_LABEL, type BadgeField, type BadgeTemplate, type ColorRule } from './types';

const SAMPLE: Record<string, string> = {
  fullName: 'นางสาวสมใจ ตั้งใจเรียน',
  prefix: 'นางสาว',
  firstName: 'สมใจ',
  lastName: 'ตั้งใจเรียน',
  affiliation: 'คณะวิทยาศาสตร์และเทคโนโลยี',
  program: 'วิทยาการคอมพิวเตอร์',
  position: 'อาจารย์',
  participantType: 'นักศึกษา',
  label: 'นักศึกษา',
  referenceNo: 'REG-2570-000123',
  code: '6612345001',
  groupNo: 'GRP-2570-000004',
  groupName: 'คณะครูโรงเรียนตัวอย่าง',
  organizationName: 'โรงเรียนตัวอย่าง',
  eventCode: 'EVT-2570-000010',
  eventDate: '15 ธ.ค. 2569',
  venue: 'หอประชุมใหญ่',
};
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
const PT_PER_MM = 72 / 25.4;
/** The API stores #rrggbb; alpha from the picker is dropped. */
const hex6 = (h: string) => `#${h.slice(0, 6)}`;
const snap = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type Draft = Omit<BadgeTemplate, 'id' | 'eventId' | 'perSheet' | 'version' | 'backgroundFileId'>;

const contrast = (hex: string) => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 140 ? '#000' : '#fff';
};

export function BadgeDesigner({ template, eventTitle }: { template: BadgeTemplate; eventTitle: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const editable = can('badge:update');
  const toDraft = (t: BadgeTemplate): Draft => ({
    nameTh: t.nameTh, paper: t.paper, widthMm: t.widthMm, heightMm: t.heightMm, backgroundColor: t.backgroundColor, isDefault: t.isDefault,
    fields: t.fields.map(({ kind, content, xMm, yMm, wMm, hMm, fontSize, bold, align, color }) => ({ kind, content, xMm, yMm, wMm, hMm, fontSize, bold, align, color })),
    colorRules: t.colorRules.map(({ matchType, matchValue, color, label }) => ({ matchType, matchValue, color, label })),
  });
  const [draft, setDraft] = useState<Draft>(() => toDraft(template));
  const [version, setVersion] = useState(template.version);
  const [bgFileId, setBgFileId] = useState(template.backgroundFileId);
  const [removeBg, setRemoveBg] = useState(false);
  const [sel, setSel] = useState<number | null>(0);
  const [dirty, setDirty] = useState(false);
  const [sampleRule, setSampleRule] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);

  const meta = useQuery({ queryKey: ['badge-placeholders'], queryFn: () => api.get<{ placeholders: Record<string, string> }>('/badges/placeholders'), staleTime: Infinity });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 600_000 });

  // The saved background image is a private file → fetched as an object URL (revoked when replaced).
  const bg = useQuery({
    queryKey: ['badge-background', template.id, bgFileId],
    queryFn: async () => (await fetchObjectUrl(`/badge-templates/${template.id}/background`)).url,
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

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(560, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = width / draft.widthMm; // px per mm
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const updateField = (i: number, patch: Partial<BadgeField>) => update({ fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const field = sel !== null ? draft.fields[sel] : undefined;

  // Sample colour rule (cycles through rules so each band colour can be checked).
  const rule = draft.colorRules[sampleRule % Math.max(1, draft.colorRules.length)];
  const vars = useMemo(() => {
    const v: Record<string, string> = { ...SAMPLE, eventTitle };
    return { ...v, label: rule?.label ? fill(rule.label, v) : v.participantType };
  }, [eventTitle, rule]);

  // ── drag / resize with pointer events (works with mouse, pen and touch) ──
  const drag = useRef<{ i: number; mode: 'move' | 'resize'; x: number; y: number; f: BadgeField } | null>(null);
  const onPointerDown = (e: ReactPointerEvent, i: number, mode: 'move' | 'resize') => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSel(i);
    drag.current = { i, mode, x: e.clientX, y: e.clientY, f: draft.fields[i]! };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    if (d.mode === 'move') {
      updateField(d.i, { xMm: snap(clamp(d.f.xMm + dx, 0, draft.widthMm - d.f.wMm)), yMm: snap(clamp(d.f.yMm + dy, 0, draft.heightMm - d.f.hMm)) });
    } else if (d.f.kind === 'QR') {
      const side = snap(clamp(Math.max(d.f.wMm + dx, d.f.hMm + dy), 12, Math.min(draft.widthMm - d.f.xMm, draft.heightMm - d.f.yMm)));
      updateField(d.i, { wMm: side, hMm: side });
    } else {
      updateField(d.i, { wMm: snap(clamp(d.f.wMm + dx, 2, draft.widthMm - d.f.xMm)), hMm: snap(clamp(d.f.hMm + dy, 2, draft.heightMm - d.f.yMm)) });
    }
  };
  const onPointerUp = () => (drag.current = null);

  // Arrow keys nudge the selected element (Shift = 0.5 mm).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (sel === null || !field || !editable) return;
    const step = e.shiftKey ? 0.5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key]!;
      updateField(sel, { xMm: clamp(field.xMm + dx, 0, draft.widthMm - field.wMm), yMm: clamp(field.yMm + dy, 0, draft.heightMm - field.hMm) });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      removeField(sel);
    }
  };

  const addField = (kind: BadgeField['kind']) => {
    const w = kind === 'QR' ? Math.min(25, draft.widthMm - 4, draft.heightMm - 4) : kind === 'BAND' ? draft.widthMm : draft.widthMm - 10;
    const h = kind === 'QR' ? w : kind === 'BAND' ? 8 : 8;
    const f: BadgeField = { kind, content: kind === 'QR' ? null : kind === 'BAND' ? '{label}' : '{fullName}', xMm: kind === 'BAND' ? 0 : (draft.widthMm - w) / 2, yMm: Math.max(0, (draft.heightMm - h) / 2), wMm: w, hMm: h, fontSize: kind === 'BAND' ? 11 : 12, bold: kind === 'BAND', align: 'center', color: kind === 'BAND' ? '#1f3a8a' : '#111111' };
    update({ fields: [...draft.fields, f] });
    setSel(draft.fields.length);
  };
  const removeField = (i: number) => {
    update({ fields: draft.fields.filter((_, j) => j !== i) });
    setSel(null);
  };
  const duplicate = (i: number) => {
    const f = draft.fields[i]!;
    update({ fields: [...draft.fields, { ...f, xMm: clamp(f.xMm + 2, 0, draft.widthMm - f.wMm), yMm: clamp(f.yMm + 2, 0, draft.heightMm - f.hMm) }] });
    setSel(draft.fields.length);
  };

  const payload = () => ({ ...draft, fields: draft.fields.map((f) => ({ ...f, content: f.kind === 'QR' ? null : f.content })) });

  const save = useMutation({
    mutationFn: () => api.put<BadgeTemplate>(`/badge-templates/${template.id}`, { ...payload(), version, removeBackground: removeBg || undefined }),
    onSuccess: (t) => {
      msg.success('บันทึกแม่แบบแล้ว');
      setVersion(t.version);
      setBgFileId(t.backgroundFileId);
      setRemoveBg(false);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['badge-templates', template.eventId] });
      qc.setQueryData(['badge-template', template.id], t);
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) msg.error(new ApiError(e.status, e.code, (e.details as string[]).join(' · ')));
      else msg.error(e);
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (dirty) throw new ApiError(0, 'UNSAVED', 'กรุณาบันทึกการแก้ไขก่อนอัปโหลดภาพพื้นหลัง');
      const fd = new FormData();
      fd.append('file', file);
      return api.post<BadgeTemplate>(`/badge-templates/${template.id}/background`, fd);
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
    openPdf(api.http.post(`/events/${template.eventId}/badge-templates/preview`, { template: payload(), templateId: bgFileId && !removeBg ? template.id : undefined }, { responseType: 'blob' })).catch(async (e: unknown) => {
      msg.error(e);
    });

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const ptToPx = (pt: number) => (pt / PT_PER_MM) * scale;
  const placeholders = meta.data?.placeholders ?? {};
  const matchOptions = (t: ColorRule['matchType']) =>
    t === 'PARTICIPANT_TYPE' ? (lookups.data?.participantTypes ?? []).map((p) => ({ value: p.code, label: p.nameTh })) : t === 'PERSONNEL_ROLE' ? Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) : [];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12}>
        <Card
          title={
            <Flex gap={8} align="center" wrap>
              ป้าย {draft.widthMm}×{draft.heightMm} มม.
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
              <Button icon={<BgColorsOutlined />} onClick={() => addField('BAND')}>
                แถบสี
              </Button>
              <Button icon={<QrcodeOutlined />} onClick={() => addField('QR')}>
                QR เช็กอิน
              </Button>
            </Space>
          )}
          <div style={{ overflow: 'auto', padding: 1 }}>
            <div
              ref={canvas}
              tabIndex={0}
              role="application"
              aria-label="พื้นที่ออกแบบป้ายชื่อ ใช้ปุ่มลูกศรเลื่อนองค์ประกอบที่เลือก"
              onKeyDown={onKeyDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={() => setSel(null)}
              style={{
                position: 'relative',
                width,
                height: draft.heightMm * scale,
                margin: '0 auto',
                background: draft.backgroundColor ?? '#ffffff',
                backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
                backgroundSize: '100% 100%',
                boxShadow: '0 1px 6px rgba(0,0,0,.25)',
                overflow: 'hidden',
                touchAction: 'none',
                outline: 'none',
              }}
            >
              {draft.fields.map((f, i) => {
                const bandColor = f.kind === 'BAND' ? (rule?.color ?? f.color ?? '#1f3a8a') : undefined;
                const text = f.kind === 'QR' ? '' : fill(f.content ?? '', vars);
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => onPointerDown(e, i, 'move')}
                    style={{
                      position: 'absolute',
                      left: f.xMm * scale,
                      top: f.yMm * scale,
                      width: f.wMm * scale,
                      height: f.hMm * scale,
                      background: bandColor,
                      color: bandColor ? contrast(bandColor) : (f.color ?? '#000'),
                      fontSize: ptToPx(f.fontSize),
                      fontWeight: f.bold ? 700 : 400,
                      lineHeight: 1.15,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: f.align === 'left' ? 'flex-start' : f.align === 'right' ? 'flex-end' : 'center',
                      textAlign: f.align,
                      overflow: 'hidden',
                      outline: sel === i ? '2px solid #2563eb' : '1px dashed rgba(37,99,235,.35)',
                      cursor: editable ? 'move' : 'default',
                      userSelect: 'none',
                    }}
                  >
                    {f.kind === 'QR' ? <QRCodeSVG value="SRU1.PREVIEW-DESIGNER-QR" size={Math.min(f.wMm, f.hMm) * scale} marginSize={2} /> : <span style={{ padding: '0 2px' }}>{text}</span>}
                    {editable && sel === i && (
                      <div
                        onPointerDown={(e) => onPointerDown(e, i, 'resize')}
                        aria-label="ปรับขนาด"
                        style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, background: '#2563eb', cursor: 'nwse-resize', borderRadius: 2 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <Flex justify="space-between" align="center" style={{ marginTop: 12 }} wrap gap={8}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              ลากเพื่อย้าย · มุมขวาล่างเพื่อปรับขนาด · ลูกศรเพื่อเลื่อนละเอียด · ภาพนี้เป็นตัวอย่างโดยประมาณ ตรวจผลจริงด้วย “ตัวอย่าง PDF”
            </Typography.Text>
            {draft.colorRules.length > 1 && (
              <Button size="small" onClick={() => setSampleRule((n) => n + 1)}>
                ดูสีถัดไป ({rule?.label ? fill(rule.label, { ...SAMPLE }) : '-'})
              </Button>
            )}
          </Flex>
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card title="องค์ประกอบที่เลือก" style={{ marginBottom: 16 }}>
          {!field ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="คลิกองค์ประกอบบนป้ายเพื่อแก้ไข" />
          ) : (
            <Flex vertical gap={12}>
              <Flex justify="space-between" align="center">
                <Typography.Text strong>{{ TEXT: 'ข้อความ', BAND: 'แถบสี (สีตามกฎด้านล่าง)', QR: 'QR สำหรับเช็กอิน' }[field.kind]}</Typography.Text>
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
              {field.kind !== 'QR' && (
                <div>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                    <Typography.Text>ข้อความ</Typography.Text>
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
                  <Input.TextArea disabled={!editable} rows={2} maxLength={500} value={field.content ?? ''} onChange={(e) => updateField(sel!, { content: e.target.value })} />
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
              {field.kind !== 'QR' && (
                <Flex gap={12} align="center" wrap>
                  <Space size={4}>
                    <Typography.Text>ขนาดอักษร</Typography.Text>
                    <InputNumber disabled={!editable} size="small" min={4} max={96} step={0.5} value={field.fontSize} onChange={(v) => v && updateField(sel!, { fontSize: v })} suffix="pt" style={{ width: 110 }} />
                  </Space>
                  <Checkbox disabled={!editable} checked={field.bold} onChange={(e) => updateField(sel!, { bold: e.target.checked })}>
                    ตัวหนา
                  </Checkbox>
                  <Segmented
                    disabled={!editable}
                    size="small"
                    value={field.align}
                    onChange={(align) => updateField(sel!, { align: align as BadgeField['align'] })}
                    options={[
                      { value: 'left', label: 'ชิดซ้าย' },
                      { value: 'center', label: 'กลาง' },
                      { value: 'right', label: 'ชิดขวา' },
                    ]}
                  />
                  {field.kind === 'TEXT' && (
                    <Space size={4}>
                      <Typography.Text>สี</Typography.Text>
                      <ColorPicker disabled={!editable} size="small" value={field.color ?? '#000000'} onChange={(c) => updateField(sel!, { color: hex6(c.toHex()) })} />
                    </Space>
                  )}
                </Flex>
              )}
              {field.kind === 'QR' && <Alert type="info" showIcon title="QR เฉพาะของผู้ลงทะเบียนแต่ละคน ใช้สแกนเช็กอิน — ขนาดอย่างน้อย 12 มม. (แนะนำ 20 มม. ขึ้นไป) บุคลากรของงานจะไม่มี QR" />}
            </Flex>
          )}
        </Card>

        <Card title="ตั้งค่าแม่แบบ" style={{ marginBottom: 16 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <Typography.Text>ชื่อแม่แบบ</Typography.Text>
              <Input disabled={!editable} maxLength={200} value={draft.nameTh} onChange={(e) => update({ nameTh: e.target.value })} />
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text>การพิมพ์</Typography.Text>
              <Select
                disabled={!editable}
                style={{ width: '100%' }}
                value={draft.paper}
                onChange={(paper) => update({ paper })}
                options={[
                  { value: 'A4_SHEET', label: 'กระดาษ A4 หลายป้ายต่อแผ่น (มีเส้นตัด)' },
                  { value: 'LABEL', label: 'เครื่องพิมพ์บัตร/ฉลาก (1 ป้ายต่อหน้า)' },
                ]}
              />
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text>กว้าง (มม.)</Typography.Text>
              <InputNumber disabled={!editable} min={20} max={300} value={draft.widthMm} onChange={(v) => v && update({ widthMm: v })} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text>สูง (มม.)</Typography.Text>
              <InputNumber disabled={!editable} min={20} max={300} value={draft.heightMm} onChange={(v) => v && update({ heightMm: v })} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text style={{ display: 'block' }}>สีพื้น</Typography.Text>
              <ColorPicker disabled={!editable} allowClear value={draft.backgroundColor ?? undefined} onChange={(c) => update({ backgroundColor: hex6(c.toHex()) })} onClear={() => update({ backgroundColor: null })} />
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text style={{ display: 'block' }}>ใช้เป็นค่าเริ่มต้น</Typography.Text>
              <Checkbox disabled={!editable || template.isDefault} checked={draft.isDefault} onChange={(e) => update({ isDefault: e.target.checked })}>
                แม่แบบหลัก
              </Checkbox>
            </Col>
            <Col span={24}>
              <Typography.Text style={{ display: 'block' }}>ภาพพื้นหลัง (PNG/JPG ไม่เกิน 5 MB — เช่น โลโก้ / กรอบตาม Brand Guideline ควรมีสัดส่วนเท่าป้าย)</Typography.Text>
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
            </Col>
          </Row>
        </Card>

        <Card
          title="กฎสีของแถบ (ตามประเภทผู้เข้าร่วม / บทบาท)"
          extra={
            editable && (
              <Button size="small" icon={<PlusOutlined />} onClick={() => update({ colorRules: [...draft.colorRules, { matchType: 'PARTICIPANT_TYPE', matchValue: null, color: '#047857', label: '{participantType}' }] })}>
                เพิ่มกฎ
              </Button>
            )
          }
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            ใช้กฎแรกที่ตรง (จากบนลงล่าง) — “ทุกคน” ใช้เป็นค่าสุดท้าย ข้อความกำหนดค่า {'{label}'} ที่ใช้บนแถบ
          </Typography.Paragraph>
          <Table<ColorRule & { i: number }>
            rowKey="i"
            size="small"
            pagination={false}
            dataSource={draft.colorRules.map((r, i) => ({ ...r, i }))}
            scroll={{ x: 560 }}
            columns={[
              {
                title: 'เมื่อ',
                width: 150,
                render: (_, r) => (
                  <Select
                    disabled={!editable}
                    size="small"
                    style={{ width: '100%' }}
                    value={r.matchType}
                    onChange={(matchType) => update({ colorRules: draft.colorRules.map((x, j) => (j === r.i ? { ...x, matchType, matchValue: null } : x)) })}
                    options={[
                      { value: 'PARTICIPANT_TYPE', label: 'ประเภทผู้เข้าร่วม' },
                      { value: 'PERSONNEL_ROLE', label: 'บทบาทบุคลากร' },
                      { value: 'ANY', label: 'ทุกคน' },
                    ]}
                  />
                ),
              },
              {
                title: 'เท่ากับ',
                width: 150,
                render: (_, r) =>
                  r.matchType !== 'ANY' && (
                    <Select disabled={!editable} size="small" style={{ width: '100%' }} value={r.matchValue ?? undefined} onChange={(matchValue) => update({ colorRules: draft.colorRules.map((x, j) => (j === r.i ? { ...x, matchValue } : x)) })} options={matchOptions(r.matchType)} />
                  ),
              },
              { title: 'สี', width: 60, render: (_, r) => <ColorPicker disabled={!editable} size="small" value={r.color} onChange={(c) => update({ colorRules: draft.colorRules.map((x, j) => (j === r.i ? { ...x, color: hex6(c.toHex()) } : x)) })} /> },
              { title: 'ข้อความบนแถบ', render: (_, r) => <Input disabled={!editable} size="small" maxLength={100} value={r.label ?? ''} onChange={(e) => update({ colorRules: draft.colorRules.map((x, j) => (j === r.i ? { ...x, label: e.target.value } : x)) })} /> },
              {
                title: '',
                width: 40,
                render: (_, r) => editable && <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="ลบกฎ" onClick={() => update({ colorRules: draft.colorRules.filter((_, j) => j !== r.i) })} />,
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
