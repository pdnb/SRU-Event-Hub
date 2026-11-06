'use client';

import { CheckCircleFilled, CloseCircleFilled, CloudSyncOutlined, ExclamationCircleFilled, PrinterOutlined, SearchOutlined, TeamOutlined, UndoOutlined, WifiOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Checkbox, Col, Descriptions, Empty, Flex, Input, Modal, Popconfirm, Row, Segmented, Select, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { List } from '@/components/SimpleList';
import { StatusTag } from '@/components/StatusTag';
import { printPdf } from '@/features/badges/print';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { useOfflineCheckin, type OfflineRegistrant } from './offline';
import { QrScanner } from './QrScanner';
import { ATTENDANCE_META, type CheckinResult, type CheckinSettings, type GroupRoster, type Registrant, type ScanResponse } from './types';

type Shown =
  | { tone: 'ok' | 'warn'; title: string; result: CheckinResult }
  | { tone: 'error'; title: string; message: string; registration?: Registrant }
  | { tone: 'offline'; title: string; registrant: OfflineRegistrant };

interface DeskPoint {
  locationId?: string;
  scheduleId?: string;
  action: 'CHECK_IN' | 'CHECK_OUT';
  autoPrint: boolean;
}

const pointKey = (eventId: string) => `sru-checkin-point:${eventId}`;

/** Short audible cue so staff do not need to look at the screen for every scan. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    o.onended = () => void ctx.close();
  } catch {
    /* no audio */
  }
}

export function CheckinDesk({ eventId, settings }: { eventId: string; settings: CheckinSettings }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const { modal } = App.useApp();
  const [point, setPoint] = useState<DeskPoint>(() => {
    try {
      return { action: 'CHECK_IN', autoPrint: false, ...(JSON.parse(localStorage.getItem(pointKey(eventId)) ?? '{}') as Partial<DeskPoint>) };
    } catch {
      return { action: 'CHECK_IN', autoPrint: false };
    }
  });
  const [shown, setShown] = useState<Shown | null>(null);
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupRoster | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const wedge = useRef<HTMLInputElement>(null);
  const offline = useOfflineCheckin(eventId, can('checkin:create'));
  const busy = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(pointKey(eventId), JSON.stringify(point));
    } catch {
      /* ignore */
    }
  }, [eventId, point]);

  const templates = useQuery({
    queryKey: ['badge-templates', eventId],
    queryFn: () => api.get<{ id: string; nameTh: string; isDefault: boolean }[]>(`/events/${eventId}/badge-templates`),
    enabled: can('badge:print'),
  });
  const defaultTemplate = templates.data?.find((t) => t.isDefault) ?? templates.data?.[0];

  const found = useQuery({
    queryKey: ['checkin-search', eventId, search],
    queryFn: () => api.get<Registrant[]>(`/events/${eventId}/checkin/search`, { q: search }),
    enabled: search.trim().length >= 2 && offline.online,
  });

  const activeLocations = settings.locations.filter((l) => l.isActive);
  const sessionOfPoint = point.scheduleId ?? activeLocations.find((l) => l.id === point.locationId)?.scheduleId ?? undefined;
  const body = { locationId: point.locationId, scheduleId: point.scheduleId, action: point.action };

  const refresh = () => {
    for (const k of ['checkin-stats', 'checkin-records', 'checkin-search', 'attendance']) void qc.invalidateQueries({ queryKey: [k, eventId] });
  };

  const printBadge = async (registrationId: string, reprintReason?: string) => {
    if (!defaultTemplate) {
      msg.error(new ApiError(0, 'NO_TEMPLATE', 'ยังไม่มีแม่แบบป้ายชื่อของกิจกรรมนี้'));
      return;
    }
    const job = await api.post<{ id: string }>(`/events/${eventId}/badge-print-jobs`, {
      templateId: defaultTemplate.id,
      mode: reprintReason ? 'REPRINT' : 'INSTANT',
      registrationIds: [registrationId],
      reason: reprintReason,
    });
    const how = await printPdf(`/badge-print-jobs/${job.id}/pdf`);
    if (how === 'tab') msg.success('เปิดป้ายชื่อในแท็บใหม่แล้ว กรุณาสั่งพิมพ์');
    setShown((s) => (s && 'result' in s ? { ...s, result: { ...s.result, registration: { ...s.result.registration, badgePrints: s.result.registration.badgePrints + 1 } } } : s));
  };

  const show = (r: CheckinResult) => {
    const name = r.registration.fullName;
    if (r.outcome === 'CHECKED_IN') setShown({ tone: 'ok', title: `เช็กอินสำเร็จ: ${name}`, result: r });
    else if (r.outcome === 'CHECKED_OUT') setShown({ tone: 'ok', title: `เช็กเอาต์แล้ว: ${name}`, result: r });
    else setShown({ tone: 'warn', title: `เช็กอินไปแล้ว: ${name}`, result: r });
    beep(r.outcome !== 'ALREADY_CHECKED_IN');
    refresh();
    if (point.autoPrint && r.outcome === 'CHECKED_IN' && !r.replayed && r.registration.badgePrints === 0 && can('badge:print')) {
      printBadge(r.registration.id).catch((e) => {
        if (!(e instanceof ApiError && e.code === 'ALREADY_PRINTED')) msg.error(e);
      });
    }
  };

  const fail = (e: unknown) => {
    beep(false);
    if (e instanceof ApiError) {
      const reg = (e.details as { registration?: Registrant } | undefined)?.registration;
      setShown({ tone: 'error', title: reg ? `${reg.fullName}` : 'ไม่สามารถเช็กอินได้', message: e.message, registration: reg });
    } else setShown({ tone: 'error', title: 'ไม่สามารถเช็กอินได้', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  };

  /** Offline path: verify the QR against the local roster and queue the check-in. */
  const offlineScan = async (text: string) => {
    const r = await offline.lookup(text);
    if (!r) return fail(new ApiError(0, 'QR_NOT_FOUND', offline.pack ? 'ไม่พบ QR นี้ในรายชื่อที่บันทึกไว้ในเครื่อง' : 'ยังไม่มีรายชื่อในเครื่องสำหรับโหมดออฟไลน์'));
    if (r.status !== 'CONFIRMED') return fail(new ApiError(0, 'NOT_CONFIRMED', r.status === 'PENDING_PAYMENT' ? 'ยังไม่ได้ชำระค่าลงทะเบียน กรุณาติดต่อจุดรับชำระเงิน' : 'การลงทะเบียนยังไม่ได้รับการยืนยัน'));
    if (r.checkedInAt || offline.alreadyQueued(r.id)) {
      beep(false);
      return setShown({ tone: 'offline', title: `เช็กอินไปแล้ว: ${r.fullName}`, registrant: r });
    }
    offline.enqueue(r, { locationId: point.locationId, scheduleId: point.scheduleId });
    beep(true);
    setShown({ tone: 'offline', title: `บันทึกออฟไลน์: ${r.fullName}`, registrant: r });
  };

  const handleCode = async (text: string) => {
    const value = text.trim();
    if (!value || busy.current) return;
    busy.current = true;
    try {
      if (!offline.online) return await offlineScan(value);
      const res = await api.post<ScanResponse>(`/events/${eventId}/checkin/scan`, { code: value, ...body });
      if (res.kind === 'GROUP') {
        beep(true);
        setGroup(res.group);
        setPicked(res.group.members.filter((m) => m.status === 'CONFIRMED' && !m.attendance).map((m) => m.id));
      } else show(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK_ERROR') await offlineScan(value);
      else fail(e);
    } finally {
      busy.current = false;
      setCode('');
      wedge.current?.focus();
    }
  };

  const manual = useMutation({
    mutationFn: (registrationId: string) => api.post<CheckinResult>(`/events/${eventId}/checkin/manual`, { registrationId, ...body }),
    onSuccess: (r) => {
      show(r);
      setSearch('');
    },
    onError: fail,
  });

  const groupCheckin = useMutation({
    mutationFn: () => api.post<{ checkedIn: number; results: { registrationId: string; error?: { message: string } }[]; group: GroupRoster }>(`/events/${eventId}/checkin/group`, { groupId: group!.id, registrationIds: picked, locationId: point.locationId, scheduleId: point.scheduleId }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => x.error);
      msg.success(`เช็กอินแล้ว ${r.checkedIn} คน${failed.length ? ` (ไม่สำเร็จ ${failed.length} คน)` : ''}`);
      beep(true);
      setGroup(failed.length ? r.group : null);
      setPicked([]);
      refresh();
    },
    onError: msg.error,
  });

  const undo = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/checkin/records/${id}/undo`, { reason }),
    onSuccess: () => {
      msg.success('ยกเลิกรายการแล้ว');
      setShown(null);
      refresh();
    },
    onError: msg.error,
  });

  const askReason = (title: string, onOk: (reason: string) => Promise<unknown>) => {
    let reason = '';
    modal.confirm({
      title,
      content: <Input.TextArea autoFocus rows={3} maxLength={500} placeholder="ระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)" onChange={(e) => (reason = e.target.value)} />,
      okText: 'ยืนยัน',
      cancelText: 'ยกเลิก',
      onOk: () => {
        if (reason.trim().length < 3) {
          msg.error(new ApiError(0, 'VALIDATION', 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'));
          return Promise.reject(new Error('reason'));
        }
        return onOk(reason.trim()).catch((e) => {
          msg.error(e);
        });
      },
    });
  };

  const syncNow = async () => {
    try {
      const r = await offline.sync();
      if (r.synced) msg.success(`ส่งรายการออฟไลน์แล้ว ${r.synced} รายการ`);
      if (r.failed) msg.error(new ApiError(0, 'SYNC', `มี ${r.failed} รายการที่ระบบไม่รับ กรุณาตรวจสอบ`));
      refresh();
    } catch (e) {
      msg.error(e);
    }
  };

  // Replay the offline queue automatically when the network comes back.
  const pendingCount = offline.queue.filter((q) => q.state === 'pending').length;
  useEffect(() => {
    if (offline.online && pendingCount && !offline.syncing) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline.online, pendingCount]);

  const reg = shown && 'result' in shown ? shown.result.registration : shown && 'registration' in shown ? shown.registration : undefined;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card size="small" title="ตั้งค่าจุดนี้">
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Select
              allowClear
              placeholder="จุดเช็กอิน (ไม่ระบุได้)"
              style={{ width: '100%' }}
              value={point.locationId}
              onChange={(locationId) => setPoint({ ...point, locationId })}
              options={activeLocations.map((l) => ({ value: l.id, label: l.nameTh }))}
            />
            {settings.schedules.length > 0 && (
              <Select
                allowClear
                placeholder={sessionOfPoint ? 'ตามช่วงกิจกรรมของจุดนี้' : 'ทั้งกิจกรรม (ไม่แยกช่วง)'}
                style={{ width: '100%' }}
                value={point.scheduleId}
                onChange={(scheduleId) => setPoint({ ...point, scheduleId })}
                options={settings.schedules.map((s) => ({ value: s.id, label: s.title }))}
              />
            )}
            <Segmented
              block
              value={point.action}
              onChange={(action) => setPoint({ ...point, action: action as DeskPoint['action'] })}
              options={[
                { value: 'CHECK_IN', label: 'เช็กอิน (เข้า)' },
                { value: 'CHECK_OUT', label: 'เช็กเอาต์ (ออก)' },
              ]}
            />
            {can('badge:print') && (
              <Flex align="center" gap={8}>
                <Switch checked={point.autoPrint} onChange={(autoPrint) => setPoint({ ...point, autoPrint })} disabled={!defaultTemplate} />
                <Typography.Text>พิมพ์ป้ายชื่อทันทีเมื่อเช็กอิน{!defaultTemplate && templates.isSuccess && ' (ยังไม่มีแม่แบบ)'}</Typography.Text>
              </Flex>
            )}
          </Space>
        </Card>

        {!offline.online && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            icon={<WifiOutlined />}
            title="ออฟไลน์ — บันทึกในเครื่องชั่วคราว"
            description={offline.pack ? `ตรวจ QR จากรายชื่อในเครื่อง (${offline.pack.registrants.length} คน ณ ${new Date(offline.pack.generatedAt).toLocaleTimeString('th-TH')}) แล้วส่งเข้าระบบเมื่อกลับมาออนไลน์` : 'ยังไม่มีรายชื่อในเครื่อง — โหมดออฟไลน์ใช้ไม่ได้'}
          />
        )}
        {offline.queue.length > 0 && (
          <Card size="small" style={{ marginTop: 12 }} title={<Space><CloudSyncOutlined />รายการรอส่ง ({offline.queue.length})</Space>} extra={offline.online && <Button size="small" loading={offline.syncing} onClick={() => void syncNow()}>ส่งเดี๋ยวนี้</Button>}>
            <List
              dataSource={offline.queue}
              renderItem={(q) => (
                <List.Item actions={q.state === 'failed' ? [<Button key="d" size="small" type="link" onClick={() => offline.dismiss(q.clientKey)}>นำออก</Button>] : []}>
                  <List.Item.Meta title={q.fullName} description={q.state === 'failed' ? <Typography.Text type="danger">{q.error}</Typography.Text> : `${q.referenceNo} · ${new Date(q.occurredAt).toLocaleTimeString('th-TH')}`} />
                </List.Item>
              )}
            />
          </Card>
        )}

        <Card size="small" style={{ marginTop: 12 }} title="สแกน QR">
          <Input
            ref={(el) => {
              wedge.current = el?.input ?? null;
            }}
            autoFocus
            size="large"
            placeholder="ยิงเครื่องสแกน หรือพิมพ์รหัส QR แล้วกด Enter"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onPressEnter={() => void handleCode(code)}
            style={{ marginBottom: 12 }}
          />
          <QrScanner onCode={(t) => void handleCode(t)} paused={!!group} />
        </Card>
      </Col>

      <Col xs={24} lg={14}>
        <Card
          style={{
            borderWidth: 2,
            borderColor: !shown ? undefined : shown.tone === 'ok' ? '#16a34a' : shown.tone === 'error' ? '#dc2626' : '#d97706',
            minHeight: 220,
          }}
        >
          {!shown ? (
            <Empty description="ผลการสแกนจะแสดงที่นี่" />
          ) : (
            <>
              <Flex align="center" gap={12} style={{ marginBottom: 12 }}>
                {shown.tone === 'ok' ? (
                  <CheckCircleFilled style={{ fontSize: 40, color: '#16a34a' }} />
                ) : shown.tone === 'error' ? (
                  <CloseCircleFilled style={{ fontSize: 40, color: '#dc2626' }} />
                ) : (
                  <ExclamationCircleFilled style={{ fontSize: 40, color: '#d97706' }} />
                )}
                <div>
                  <Typography.Title level={3} style={{ margin: 0 }}>
                    {shown.title}
                  </Typography.Title>
                  {shown.tone === 'error' && <Typography.Text type="danger" style={{ fontSize: 16 }}>{shown.message}</Typography.Text>}
                  {shown.tone === 'warn' && (
                    <Typography.Text style={{ fontSize: 16 }}>
                      เมื่อ <ThaiDate value={shown.result.firstCheckinAt} time />
                    </Typography.Text>
                  )}
                  {shown.tone === 'offline' && <Typography.Text type="warning">บันทึกไว้ในเครื่อง จะส่งเข้าระบบเมื่อออนไลน์</Typography.Text>}
                </div>
              </Flex>
              {(reg || shown.tone === 'offline') && (
                <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
                  <Descriptions.Item label="เลขอ้างอิง">{reg?.referenceNo ?? (shown.tone === 'offline' ? shown.registrant.referenceNo : '')}</Descriptions.Item>
                  <Descriptions.Item label="ประเภท">{reg?.participantType ?? (shown.tone === 'offline' ? shown.registrant.participantType : '')}</Descriptions.Item>
                  <Descriptions.Item label="หน่วยงาน">{(reg?.affiliation ?? (shown.tone === 'offline' ? shown.registrant.affiliation : null)) || '-'}</Descriptions.Item>
                  <Descriptions.Item label="กลุ่ม">{reg?.groupNo ? `${reg.groupNo} ${reg.groupName ?? ''}` : '-'}</Descriptions.Item>
                  {reg && (
                    <Descriptions.Item label="สถานะลงทะเบียน">
                      <StatusTag status={reg.status} />
                    </Descriptions.Item>
                  )}
                  {shown.tone !== 'error' && shown.tone !== 'offline' && shown.result.attendance && (
                    <Descriptions.Item label="การเข้าร่วม">
                      <Tag color={ATTENDANCE_META[shown.result.attendance.status].color}>{ATTENDANCE_META[shown.result.attendance.status].label}</Tag>
                    </Descriptions.Item>
                  )}
                  {reg && can('badge:view') && <Descriptions.Item label="ป้ายชื่อ">{reg.badgePrints ? `พิมพ์แล้ว ${reg.badgePrints} ครั้ง` : 'ยังไม่พิมพ์'}</Descriptions.Item>}
                </Descriptions>
              )}
              {shown.tone !== 'error' && shown.tone !== 'offline' && (
                <Flex gap={8} wrap style={{ marginTop: 12 }}>
                  {can('badge:print') && shown.result.registration.badgePrints === 0 && (
                    <Button type="primary" icon={<PrinterOutlined />} disabled={!defaultTemplate} onClick={() => printBadge(shown.result.registration.id).catch(msg.error)}>
                      พิมพ์ป้ายชื่อ
                    </Button>
                  )}
                  {can('badge:reprint') && shown.result.registration.badgePrints > 0 && (
                    <Button icon={<PrinterOutlined />} disabled={!defaultTemplate} onClick={() => askReason('พิมพ์ป้ายชื่อซ้ำ', (reason) => printBadge(shown.result.registration.id, reason))}>
                      พิมพ์ซ้ำ
                    </Button>
                  )}
                  {can('checkin:update') && shown.result.record && (
                    <Button icon={<UndoOutlined />} danger onClick={() => askReason('ยกเลิกรายการนี้ (สแกนผิดคน)?', (reason) => undo.mutateAsync({ id: shown.result.record!.id, reason }))}>
                      ยกเลิกรายการนี้
                    </Button>
                  )}
                  {shown.result.registration.groupId && (
                    <Button
                      icon={<TeamOutlined />}
                      onClick={async () => {
                        const g = await api.get<GroupRoster>(`/events/${eventId}/checkin/groups/${shown.result.registration.groupId}`, { scheduleId: sessionOfPoint });
                        setGroup(g);
                        setPicked(g.members.filter((m) => m.status === 'CONFIRMED' && !m.attendance).map((m) => m.id));
                      }}
                    >
                      เช็กอินทั้งกลุ่ม
                    </Button>
                  )}
                </Flex>
              )}
            </>
          )}
        </Card>

        <Card size="small" style={{ marginTop: 12 }} title="ค้นหาด้วยชื่อ / เลขอ้างอิง / รหัสนักศึกษา / เลขที่กลุ่ม (กรณีไม่มี QR)">
          <Input allowClear prefix={<SearchOutlined />} placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!offline.online} />
          {search.trim().length >= 2 && (
            <List
              loading={found.isFetching}
              dataSource={found.data ?? []}
              locale={{ emptyText: 'ไม่พบรายชื่อ' }}
              renderItem={(r) => (
                <List.Item
                  actions={[
                    r.attendance ? (
                      <Tag key="a" color={ATTENDANCE_META[r.attendance.status].color}>
                        {ATTENDANCE_META[r.attendance.status].label}
                      </Tag>
                    ) : null,
                    can('checkin:create') && r.status === 'CONFIRMED' && (point.action === 'CHECK_OUT' || !r.attendance) ? (
                      <Popconfirm key="c" title={`${point.action === 'CHECK_OUT' ? 'เช็กเอาต์' : 'เช็กอิน'} ${r.fullName}?`} okText="ยืนยัน" cancelText="ไม่" onConfirm={() => manual.mutate(r.id)}>
                        <Button size="small" type="primary">
                          {point.action === 'CHECK_OUT' ? 'เช็กเอาต์' : 'เช็กอิน'}
                        </Button>
                      </Popconfirm>
                    ) : (
                      <StatusTag key="s" status={r.status} />
                    ),
                  ].filter(Boolean)}
                >
                  <List.Item.Meta title={r.fullName} description={`${r.referenceNo} · ${r.participantType}${r.groupNo ? ` · ${r.groupNo}` : ''}${r.affiliation ? ` · ${r.affiliation}` : ''}`} />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>

      <Modal
        open={!!group}
        title={group && `${group.groupNo} ${group.name} — ${group.organizationName}`}
        onCancel={() => setGroup(null)}
        okText={`เช็กอิน ${picked.length} คน`}
        okButtonProps={{ disabled: !picked.length, loading: groupCheckin.isPending }}
        cancelText="ปิด"
        onOk={() => groupCheckin.mutate()}
        width={640}
      >
        {group && (
          <>
            <Flex justify="space-between" style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">เลือกสมาชิกที่มาถึงแล้ว</Typography.Text>
              <Badge count={`${group.members.filter((m) => m.attendance).length}/${group.members.length} เช็กอินแล้ว`} color="green" />
            </Flex>
            <Checkbox.Group style={{ width: '100%' }} value={picked} onChange={(v) => setPicked(v as string[])}>
              <List
                dataSource={group.members}
                renderItem={(m) => (
                  <List.Item extra={m.attendance ? <Tag color="green">เช็กอินแล้ว</Tag> : m.status !== 'CONFIRMED' ? <StatusTag status={m.status} /> : undefined}>
                    <Checkbox value={m.id} disabled={m.status !== 'CONFIRMED' || !!m.attendance}>
                      {m.fullName} <Typography.Text type="secondary">({m.participantType})</Typography.Text>
                    </Checkbox>
                  </List.Item>
                )}
              />
            </Checkbox.Group>
          </>
        )}
      </Modal>
    </Row>
  );
}
