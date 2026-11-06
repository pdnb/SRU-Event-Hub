'use client';

import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Flex, Progress, Row, Statistic, Typography } from 'antd';
import { QueryState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { downloadFile } from '@/services/download';
import type { Summary } from './types';

/** Horizontal bar: one value of a distribution, labelled with count and share. */
function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <Flex gap={8} align="center">
      <span style={{ minWidth: 140, fontSize: 13 }}>{label}</span>
      <Progress percent={pct} showInfo={false} style={{ flex: 1, margin: 0 }} />
      <span style={{ minWidth: 70, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {count} ({pct}%)
      </span>
    </Flex>
  );
}

export function EvaluationSummary({ formId }: { formId: string }) {
  const can = useCan();
  const msg = useApiMessage();
  const summary = useQuery({ queryKey: ['evaluation-summary', formId], queryFn: () => api.get<Summary>(`/evaluation-forms/${formId}/summary`), refetchInterval: 60_000 });

  return (
    <QueryState query={summary}>
      {(s) => {
        let no = 0;
        return (
          <Flex vertical gap={16}>
            <Card
              extra={
                can('evaluation:export') && (
                  <Button icon={<DownloadOutlined />} onClick={() => void downloadFile(`/evaluation-forms/${formId}/export`, 'evaluation.xlsx').catch(msg.error)}>
                    Excel (สรุป + รายบุคคล)
                  </Button>
                )
              }
              title="ภาพรวม"
            >
              <Row gutter={16}>
                <Col xs={12} md={6}>
                  <Statistic title="ผู้ตอบ" value={s.responses} suffix={`/ ${s.expected}`} />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic title="อัตราการตอบ" value={s.responseRate ?? '-'} suffix={s.responseRate != null ? '%' : undefined} />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic title="ค่าเฉลี่ยรวม" value={s.overallMean ?? '-'} precision={s.overallMean != null ? 2 : undefined} />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic title="ระดับ" value={s.overallLevel ?? '-'} />
                </Col>
              </Row>
            </Card>
            {!s.responses ? (
              <Card>
                <Empty description="ยังไม่มีผู้ตอบ" />
              </Card>
            ) : (
              s.questions.map((q) => {
                if (q.kind === 'SECTION') {
                  return (
                    <Typography.Title key={q.id} level={5} style={{ margin: '8px 0 0' }}>
                      {q.labelTh}
                    </Typography.Title>
                  );
                }
                no++;
                return (
                  <Card key={q.id} size="small" title={`${no}. ${q.labelTh}`} extra={<Typography.Text type="secondary">ตอบ {q.n} คน</Typography.Text>}>
                    {q.kind === 'RATING' && (
                      <Flex vertical gap={4}>
                        <Typography.Text>
                          ค่าเฉลี่ย <b>{q.mean?.toFixed(2) ?? '-'}</b>
                          {q.sd != null && ` · S.D. ${q.sd.toFixed(2)}`}
                          {q.level && ` · ระดับ${q.level}`}
                        </Typography.Text>
                        {[...q.distribution].reverse().map((d) => (
                          <Bar key={d.value} label={`ระดับ ${d.value}`} count={d.count} total={q.n} />
                        ))}
                      </Flex>
                    )}
                    {(q.kind === 'SINGLE' || q.kind === 'MULTI') && (
                      <Flex vertical gap={4}>
                        {q.options.map((o) => (
                          <Bar key={o.id} label={o.labelTh} count={o.count} total={q.n} />
                        ))}
                      </Flex>
                    )}
                    {(q.kind === 'TEXT' || q.kind === 'TEXTAREA') &&
                      (q.texts.length ? (
                        <ul style={{ margin: 0, paddingInlineStart: 20, maxHeight: 320, overflow: 'auto' }}>
                          {q.texts.map((t, i) => (
                            <li key={i} style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
                              {t}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Typography.Text type="secondary">ไม่มีคำตอบ</Typography.Text>
                      ))}
                  </Card>
                );
              })
            )}
          </Flex>
        );
      }}
    </QueryState>
  );
}
