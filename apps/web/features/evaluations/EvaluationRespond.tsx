'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Flex, Input, Radio, Result, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDateRange } from '@/components/Format';
import { useApiMessage } from '@/hooks/useApiMessage';
import type { RespondView } from './types';

type Answer = { value?: number; optionIds?: string[]; text?: string };

/**
 * Fills in one evaluation form. `submit` hides who is answering (signed-in registration id, or a
 * guest's reference + token) from this component.
 */
export function EvaluationRespond({ view, submit, onDone }: { view: RespondView; submit: (answers: (Answer & { questionId: string })[]) => Promise<unknown>; onDone?: () => void }) {
  const msg = useApiMessage();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(view.answered);
  const set = (id: string, a: Answer) => {
    setAnswers((x) => ({ ...x, [id]: a }));
    setMissing((m) => {
      const n = new Set(m);
      n.delete(id);
      return n;
    });
  };
  const send = useMutation({
    mutationFn: () => submit(Object.entries(answers).map(([questionId, a]) => ({ questionId, ...a }))),
    onSuccess: () => {
      setDone(true);
      onDone?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) msg.error(new ApiError(e.status, e.code, (e.details as string[]).join(' · ')));
      else msg.error(e);
    },
  });
  const onSubmit = () => {
    const miss = new Set(
      view.questions
        .filter((q) => q.isRequired && q.kind !== 'SECTION')
        .filter((q) => {
          const a = answers[q.id];
          return q.kind === 'RATING' ? a?.value == null : q.kind === 'SINGLE' || q.kind === 'MULTI' ? !a?.optionIds?.length : !a?.text?.trim();
        })
        .map((q) => q.id),
    );
    setMissing(miss);
    if (miss.size) {
      document.getElementById(`q-${[...miss][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    send.mutate();
  };

  if (done) {
    return (
      <Card>
        <Result icon={<CheckCircleFilled style={{ color: '#16a34a' }} />} title="ขอบคุณที่ตอบแบบประเมิน" subTitle={view.event.titleTh} />
      </Card>
    );
  }

  let no = 0;
  return (
    <Flex vertical gap={16}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {view.titleTh}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          {view.event.titleTh} · <ThaiDateRange start={view.event.startAt} end={view.event.endAt} />
        </Typography.Paragraph>
        {view.description && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{view.description}</Typography.Paragraph>}
        {view.isAnonymous && <Alert type="info" showIcon title="แบบประเมินนี้ไม่ระบุตัวตน — ผู้จัดไม่เห็นว่าท่านตอบอะไร" />}
        {!view.canAnswer && view.reason && <Alert type="warning" showIcon title={view.reason} style={{ marginTop: 12 }} />}
      </Card>
      {view.questions.map((q) => {
        if (q.kind === 'SECTION') {
          return (
            <div key={q.id}>
              <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
                {q.labelTh}
              </Typography.Title>
              {q.helpText && <Typography.Text type="secondary">{q.helpText}</Typography.Text>}
            </div>
          );
        }
        no++;
        const a = answers[q.id] ?? {};
        const bad = missing.has(q.id);
        return (
          <Card key={q.id} id={`q-${q.id}`} size="small" style={bad ? { borderColor: '#dc2626' } : undefined}>
            <Typography.Text strong>
              {no}. {q.labelTh}
              {q.isRequired && <span style={{ color: '#dc2626' }}> *</span>}
            </Typography.Text>
            {q.helpText && <div style={{ fontSize: 13, color: '#6b7280' }}>{q.helpText}</div>}
            <div style={{ marginTop: 8 }}>
              {q.kind === 'RATING' && (
                <Radio.Group
                  disabled={!view.canAnswer}
                  optionType="button"
                  value={a.value}
                  onChange={(e) => set(q.id, { value: e.target.value as number })}
                  options={Array.from({ length: q.scaleMax }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
                  aria-label={q.labelTh}
                />
              )}
              {q.kind === 'RATING' && (
                <Flex justify="space-between" style={{ maxWidth: q.scaleMax * 44, fontSize: 12, color: '#6b7280' }}>
                  <span>น้อยที่สุด</span>
                  <span>มากที่สุด</span>
                </Flex>
              )}
              {q.kind === 'SINGLE' && (
                <Radio.Group disabled={!view.canAnswer} value={a.optionIds?.[0]} onChange={(e) => set(q.id, { optionIds: [e.target.value as string] })}>
                  <Flex vertical gap={6}>
                    {q.options.map((o) => (
                      <Radio key={o.id} value={o.id}>
                        {o.labelTh}
                      </Radio>
                    ))}
                  </Flex>
                </Radio.Group>
              )}
              {q.kind === 'MULTI' && (
                <Checkbox.Group disabled={!view.canAnswer} value={a.optionIds ?? []} onChange={(v) => set(q.id, { optionIds: v as string[] })}>
                  <Flex vertical gap={6}>
                    {q.options.map((o) => (
                      <Checkbox key={o.id} value={o.id}>
                        {o.labelTh}
                      </Checkbox>
                    ))}
                  </Flex>
                </Checkbox.Group>
              )}
              {q.kind === 'TEXT' && <Input disabled={!view.canAnswer} maxLength={500} value={a.text ?? ''} onChange={(e) => set(q.id, { text: e.target.value })} />}
              {q.kind === 'TEXTAREA' && <Input.TextArea disabled={!view.canAnswer} rows={3} maxLength={5000} showCount value={a.text ?? ''} onChange={(e) => set(q.id, { text: e.target.value })} />}
            </div>
            {bad && <Typography.Text type="danger">กรุณาตอบข้อนี้</Typography.Text>}
          </Card>
        );
      })}
      {view.canAnswer && (
        <Button type="primary" size="large" loading={send.isPending} onClick={onSubmit}>
          ส่งแบบประเมิน
        </Button>
      )}
    </Flex>
  );
}
