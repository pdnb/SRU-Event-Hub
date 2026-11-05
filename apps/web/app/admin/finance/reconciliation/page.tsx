'use client';

import { DownloadOutlined, LinkOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Input, Modal, Row, Segmented, Select, Space, Statistic, Table, Tabs, Typography, Upload } from 'antd';
import { useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { downloadFile } from '@/services/download';

interface Account {
  id: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  organizationName: string;
  isActive: boolean;
  unmatched: number;
  matched: number;
  ignored: number;
  coveredUntil: string | null;
}
interface LinePayment {
  id: string;
  paymentNo: string;
  status: string;
  orderNo: string;
  payerName: string;
  eventCode: string;
}
interface Line {
  id: string;
  statementNo: string;
  lineNo: number;
  txnAt: string;
  amount: string;
  description: string | null;
  reference: string | null;
  matchStatus: string;
  note: string | null;
  matchedByName: string | null;
  payment: LinePayment | null;
}
interface Candidate extends LinePayment {
  amount: string;
  transferredAt: string | null;
  submittedAt: string;
  eventTitle: string;
  minutesApart: number;
}
interface Statement {
  id: string;
  statementNo: string;
  fileName: string;
  periodFrom: string;
  periodTo: string;
  lineCount: number;
  duplicateCount: number;
  totalCredit: string;
  uploadedByName: string;
  createdAt: string;
}
interface Report {
  from: string | null;
  to: string | null;
  lines: Record<'total' | 'matched' | 'unmatched' | 'ignored', { count: number; amount: string }> | null;
  unmatchedLines: Line[];
  missingPayments: { id: string; paymentNo: string; amount: string; transferredAt: string | null; submittedAt: string; orderNo: string; payerName: string; eventCode: string; verifiedByName: string | null }[];
  invalidMatches: Line[];
}

const STATUS_FILTERS = [
  { value: 'UNMATCHED', label: 'ยังไม่พบรายการ' },
  { value: 'MATCHED', label: 'จับคู่แล้ว' },
  { value: 'IGNORED', label: 'ไม่เกี่ยวข้อง' },
  { value: '', label: 'ทั้งหมด' },
];

/** กระทบยอดกับ statement ธนาคาร: เงินเข้าบัญชีจริง ↔ รายการชำระในระบบ. */
export default function ReconciliationPage() {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [accountId, setAccountId] = useState<string>();
  const [status, setStatus] = useState('UNMATCHED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [matching, setMatching] = useState<Line | null>(null);
  const [reasonFor, setReasonFor] = useState<{ line: Line; action: 'unmatch' | 'ignore' } | null>(null);
  const [reason, setReason] = useState('');

  const accounts = useQuery({ queryKey: ['recon-accounts'], queryFn: () => api.get<Account[]>('/finance/reconciliation/accounts') });
  const account = accounts.data?.find((a) => a.id === accountId) ?? (accountId ? undefined : accounts.data?.[0]);
  const aid = account?.id;
  const lines = useQuery({
    queryKey: ['recon-lines', aid, status, search, page],
    queryFn: () => api.getPage<Line>('/finance/reconciliation/lines', { bankAccountId: aid, status: status || undefined, search: search || undefined, page, perPage: 20 }),
    enabled: !!aid,
    placeholderData: keepPreviousData,
  });
  const statements = useQuery({ queryKey: ['recon-statements', aid], queryFn: () => api.get<Statement[]>('/finance/reconciliation/statements', { bankAccountId: aid }), enabled: !!aid });
  const report = useQuery({ queryKey: ['recon-report', aid], queryFn: () => api.get<Report>('/finance/reconciliation/report', { bankAccountId: aid }), enabled: !!aid });
  const candidates = useQuery({
    queryKey: ['recon-candidates', matching?.id],
    queryFn: () => api.get<Candidate[]>(`/finance/reconciliation/lines/${matching!.id}/candidates`),
    enabled: !!matching,
  });

  const refresh = () => {
    for (const k of ['recon-accounts', 'recon-lines', 'recon-statements', 'recon-report']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('bankAccountId', aid!);
      fd.append('file', file);
      return api.post<{ statementNo: string; imported: number; duplicates: number; skippedDebit: number; autoMatched: number }>('/finance/reconciliation/statements', fd);
    },
    onSuccess: (r) => {
      msg.success(`นำเข้า ${r.statementNo}: ${r.imported} รายการ (ซ้ำ ${r.duplicates}) · จับคู่อัตโนมัติ ${r.autoMatched} รายการ`);
      refresh();
    },
    onError: msg.error,
  });
  const autoMatch = useMutation({
    mutationFn: () => api.post<{ matched: number }>('/finance/reconciliation/auto-match', { bankAccountId: aid }),
    onSuccess: (r) => {
      msg.success(`จับคู่อัตโนมัติเพิ่ม ${r.matched} รายการ`);
      refresh();
    },
    onError: msg.error,
  });
  const match = useMutation({
    mutationFn: (paymentId: string) => api.post(`/finance/reconciliation/lines/${matching!.id}/match`, { paymentId }),
    onSuccess: () => {
      msg.success('จับคู่แล้ว');
      setMatching(null);
      refresh();
    },
    onError: msg.error,
  });
  const withReason = useMutation({
    mutationFn: () => api.post(`/finance/reconciliation/lines/${reasonFor!.line.id}/${reasonFor!.action}`, { reason }),
    onSuccess: () => {
      msg.success(reasonFor?.action === 'ignore' ? 'บันทึกว่าไม่เกี่ยวข้องแล้ว' : 'ยกเลิกการจับคู่แล้ว');
      setReasonFor(null);
      setReason('');
      refresh();
    },
    onError: msg.error,
  });

  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;
  const r = report.data;

  const lineColumns = [
    { title: 'วันเวลา (statement)', dataIndex: 'txnAt', width: 160, render: (v: string) => <ThaiDate value={v} time /> },
    { title: 'จำนวนเงิน', dataIndex: 'amount', width: 120, align: 'right' as const, render: (v: string) => <Money value={v} /> },
    {
      title: 'รายละเอียด',
      render: (_: unknown, l: Line) => (
        <>
          {l.description ?? '-'}
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {l.reference ? `อ้างอิง ${l.reference} · ` : ''}
              {l.statementNo} แถว {l.lineNo}
            </Typography.Text>
          </div>
        </>
      ),
    },
    {
      title: 'รายการชำระในระบบ',
      render: (_: unknown, l: Line) =>
        l.payment ? (
          <>
            {l.payment.paymentNo} <StatusTag status={l.payment.status} kind="payment" />
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {l.payment.payerName} · {l.payment.eventCode}
              </Typography.Text>
            </div>
          </>
        ) : (
          (l.note ?? '-')
        ),
    },
    {
      title: 'สถานะ',
      width: 170,
      render: (_: unknown, l: Line) => (
        <>
          <StatusTag status={l.matchStatus} />
          {l.matchedByName && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {l.matchedByName}
              </Typography.Text>
            </div>
          )}
        </>
      ),
    },
    {
      title: '',
      width: 190,
      render: (_: unknown, l: Line) =>
        l.matchStatus === 'UNMATCHED' ? (
          <Space size={4}>
            <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => setMatching(l)}>
              จับคู่
            </Button>
            <Button size="small" onClick={() => setReasonFor({ line: l, action: 'ignore' })}>
              ไม่เกี่ยวข้อง
            </Button>
          </Space>
        ) : (
          <Button size="small" danger onClick={() => setReasonFor({ line: l, action: 'unmatch' })}>
            ยกเลิก
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="กระทบยอดกับ statement ธนาคาร"
        description="นำเข้ารายการเงินเข้าบัญชีรับเงิน (CSV/Excel) แล้วจับคู่กับรายการชำระในระบบ — ยอดเงินเข้าที่ไม่พบรายการ และรายการที่ไม่พบเงินเข้าจะแสดงในรายงาน"
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'กระทบยอดธนาคาร' }]}
        actions={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => downloadFile('/finance/reconciliation/template', 'statement-template.csv').catch(msg.error)}>
              ไฟล์ตัวอย่าง
            </Button>
            <Upload
              accept=".csv,.xlsx"
              showUploadList={false}
              disabled={!aid}
              beforeUpload={(f) => {
                upload.mutate(f);
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={upload.isPending} disabled={!aid}>
                นำเข้า statement
              </Button>
            </Upload>
          </Space>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Typography.Text>บัญชีรับเงิน</Typography.Text>
          <Select
            style={{ minWidth: 360 }}
            loading={accounts.isPending}
            value={aid}
            onChange={(v) => {
              setAccountId(v);
              setPage(1);
            }}
            options={accounts.data?.map((a) => ({ value: a.id, label: `${a.bankName} ${a.accountNo} — ${a.organizationName}${a.isActive ? '' : ' (ปิดใช้งาน)'}` }))}
            notFoundContent={<Empty description="ไม่มีบัญชีที่ท่านกระทบยอดได้" />}
          />
          {account?.coveredUntil && (
            <Typography.Text type="secondary">
              statement ล่าสุดถึง <ThaiDate value={account.coveredUntil} time />
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} disabled={!aid} loading={autoMatch.isPending} onClick={() => autoMatch.mutate()}>
            จับคู่อัตโนมัติอีกครั้ง
          </Button>
        </Space>
      </Card>

      {r?.lines && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}><Card><Statistic title="เงินเข้าทั้งหมด (บาท)" value={r.lines.total.amount} precision={2} suffix={<Typography.Text type="secondary" style={{ fontSize: 13 }}>{r.lines.total.count} รายการ</Typography.Text>} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="จับคู่แล้ว (บาท)" value={r.lines.matched.amount} precision={2} suffix={<Typography.Text type="secondary" style={{ fontSize: 13 }}>{r.lines.matched.count}</Typography.Text>} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="เงินเข้าที่ยังไม่พบรายการ" value={r.lines.unmatched.amount} precision={2} valueStyle={r.lines.unmatched.count ? { color: '#cf1322' } : undefined} suffix={<Typography.Text type="secondary" style={{ fontSize: 13 }}>{r.lines.unmatched.count}</Typography.Text>} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="ตรวจแล้วแต่ไม่พบเงินเข้า" value={r.missingPayments.length} valueStyle={r.missingPayments.length ? { color: '#d46b08' } : undefined} suffix="รายการ" /></Card></Col>
        </Row>
      )}

      <Card>
        <Tabs
          items={[
            {
              key: 'lines',
              label: 'รายการใน statement',
              children: (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Segmented options={STATUS_FILTERS} value={status} onChange={(v) => { setStatus(String(v)); setPage(1); }} />
                    <Input.Search allowClear enterButton={<SearchOutlined />} placeholder="อ้างอิง / รายละเอียด / ยอดเงิน / PAY-" onSearch={(v) => { setSearch(v.trim()); setPage(1); }} style={{ width: 320 }} />
                  </Space>
                  <Table<Line>
                    rowKey="id"
                    loading={lines.isFetching}
                    dataSource={lines.data?.items}
                    columns={lineColumns}
                    scroll={{ x: 1000 }}
                    pagination={{ current: page, pageSize: 20, total: lines.data?.meta.total, onChange: setPage, showSizeChanger: false }}
                    locale={{ emptyText: <Empty description={aid ? 'ไม่มีรายการ' : 'เลือกบัญชีรับเงิน'} /> }}
                  />
                </>
              ),
            },
            {
              key: 'missing',
              label: `ไม่พบเงินเข้า (${r?.missingPayments.length ?? 0})`,
              children: (
                <>
                  <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="รายการโอนที่ตรวจสอบผ่านแล้ว แต่ไม่พบยอดเงินเข้าใน statement ช่วงเดียวกัน" description="ตรวจสอบว่าเงินเข้าบัญชีจริง หรือ statement ยังไม่ครอบคลุมช่วงเวลา (ไม่นับวันแรกและวันสุดท้ายของ statement)" />
                  <Table
                    rowKey="id"
                    dataSource={r?.missingPayments}
                    pagination={false}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: 'เลขที่รายการ', dataIndex: 'paymentNo', width: 150 },
                      { title: 'ผู้ชำระ', render: (_, p) => <>{p.payerName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.orderNo} · {p.eventCode}</Typography.Text></div></> },
                      { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 120, render: (v: string) => <Money value={v} /> },
                      { title: 'วันเวลาที่โอน (ผู้ชำระแจ้ง)', width: 180, render: (_, p) => <ThaiDate value={p.transferredAt ?? p.submittedAt} time /> },
                      { title: 'ผู้ตรวจสอบ', dataIndex: 'verifiedByName', width: 160 },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'invalid',
              label: `จับคู่กับรายการที่ยกเลิก (${r?.invalidMatches.length ?? 0})`,
              children: <Table<Line> rowKey="id" dataSource={r?.invalidMatches} columns={lineColumns} pagination={false} scroll={{ x: 1000 }} />,
            },
            {
              key: 'statements',
              label: 'ไฟล์ที่นำเข้า',
              children: (
                <Table<Statement>
                  rowKey="id"
                  dataSource={statements.data}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: 'เลขที่', dataIndex: 'statementNo', width: 150 },
                    { title: 'ไฟล์', dataIndex: 'fileName' },
                    { title: 'ช่วงเวลา', width: 260, render: (_, s) => <><ThaiDate value={s.periodFrom} /> – <ThaiDate value={s.periodTo} /></> },
                    { title: 'รายการ', width: 130, render: (_, s) => <>{s.lineCount}{s.duplicateCount ? <Typography.Text type="secondary"> (ซ้ำ {s.duplicateCount})</Typography.Text> : null}</> },
                    { title: 'ยอดเงินเข้า', dataIndex: 'totalCredit', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
                    { title: 'นำเข้าโดย', width: 200, render: (_, s) => <>{s.uploadedByName}<div><ThaiDate value={s.createdAt} time /></div></> },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal open={!!matching} width={860} title="เลือกรายการชำระที่ตรงกับยอดเงินเข้า" footer={null} onCancel={() => setMatching(null)} destroyOnHidden>
        {matching && (
          <Typography.Paragraph>
            <Money value={matching.amount} /> · <ThaiDate value={matching.txnAt} time /> · {matching.description ?? ''} {matching.reference ?? ''}
          </Typography.Paragraph>
        )}
        <Table<Candidate>
          rowKey="id"
          loading={candidates.isFetching}
          dataSource={candidates.data}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="ไม่พบรายการโอนยอดเท่ากันที่ยังไม่จับคู่ (±3 วัน)" /> }}
          columns={[
            { title: 'เลขที่รายการ', render: (_, c) => <>{c.paymentNo} <StatusTag status={c.status} kind="payment" /></> },
            { title: 'ผู้ชำระ', render: (_, c) => <>{c.payerName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{c.eventCode} {c.eventTitle}</Typography.Text></div></> },
            { title: 'เวลาโอนที่แจ้ง', width: 160, render: (_, c) => <ThaiDate value={c.transferredAt ?? c.submittedAt} time /> },
            { title: 'ห่าง', width: 90, render: (_, c) => (c.minutesApart < 120 ? `${c.minutesApart} นาที` : `${Math.round(c.minutesApart / 60)} ชม.`) },
            { title: '', width: 90, render: (_, c) => <Button size="small" type="primary" loading={match.isPending && match.variables === c.id} onClick={() => match.mutate(c.id)}>เลือก</Button> },
          ]}
        />
      </Modal>

      <Modal
        open={!!reasonFor}
        title={reasonFor?.action === 'ignore' ? 'บันทึกว่าไม่ใช่เงินค่าลงทะเบียน' : 'ยกเลิกการจับคู่'}
        okText="บันทึก"
        cancelText="ปิด"
        onCancel={() => setReasonFor(null)}
        onOk={() => withReason.mutate()}
        okButtonProps={{ disabled: reason.trim().length < 3, loading: withReason.isPending, danger: reasonFor?.action === 'unmatch' }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" maxLength={1000} showCount />
      </Modal>
    </>
  );
}
