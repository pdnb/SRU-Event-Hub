'use client';

import { Segmented, Table } from 'antd';
import { useMemo, useState, type ReactNode } from 'react';

/**
 * Minimal SVG charts for reports (no chart dependency). Rules (dataviz skill):
 * one axis, thin bars (≤ 24px, 4px rounded data-end, square at the baseline), 2px surface gap
 * between neighbouring bars, recessive grid, legend for ≥ 2 series, hover tooltip on every mark,
 * text in ink colours (never the series colour), and a table view for every chart.
 * Categorical slots validated (light surface): slot 1 blue, slot 2 orange.
 */
export const SERIES = ['#2a78d6', '#eb6834'] as const;
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#8a8984', grid: '#ecebe8', surface: '#ffffff' };

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Path for a bar with a 4px rounded top and square bottom. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface ColumnSeries {
  key: string;
  label: string;
}

/** Grouped columns over categories (e.g. months). */
export function ColumnChart<T extends Record<string, unknown>>({
  data,
  category,
  series,
  formatCategory = (c) => c,
  height = 240,
  ariaLabel,
}: {
  data: T[];
  category: keyof T & string;
  series: ColumnSeries[];
  formatCategory?: (c: string) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { l: 48, r: 8, t: 12, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))), [data, series]);
  const band = data.length ? plotW / data.length : plotW;
  const barW = Math.max(3, Math.min(24, (band * 0.7 - (series.length - 1) * 2) / series.length));
  const groupW = barW * series.length + (series.length - 1) * 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;

  const legend =
    series.length > 1 ? (
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: INK.secondary, flexWrap: 'wrap' }}>
        {series.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: SERIES[i] }} />
            {s.label}
          </span>
        ))}
      </div>
    ) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        {legend ?? <span />}
        <Segmented size="small" value={view} onChange={(v) => setView(v as 'chart' | 'table')} options={[{ value: 'chart', label: 'กราฟ' }, { value: 'table', label: 'ตาราง' }]} />
      </div>
      {view === 'table' ? (
        <Table
          size="small"
          pagination={false}
          rowKey={(r) => String(r[category])}
          dataSource={data}
          scroll={{ x: 360 }}
          columns={[
            { title: '', render: (_: unknown, r: T) => formatCategory(String(r[category])) },
            ...series.map((s) => ({ title: s.label, align: 'right' as const, render: (_: unknown, r: T) => fmt(Number(r[s.key]) || 0) })),
          ]}
        />
      ) : !data.length ? (
        <div style={{ padding: 32, textAlign: 'center', color: INK.muted }}>ไม่มีข้อมูลในช่วงเวลานี้</div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: 'block', overflow: 'visible' }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.muted : INK.grid} strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = pad.l + i * band + (band - groupW) / 2;
              return (
                <g key={String(d[category])}>
                  {series.map((s, j) => {
                    const v = Number(d[s.key]) || 0;
                    const h = Math.max(v > 0 ? 1 : 0, (v / max) * plotH);
                    return <path key={s.key} d={barPath(x0 + j * (barW + 2), pad.t + plotH - h, barW, h)} fill={SERIES[j]} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  {(data.length <= 12 || i % Math.ceil(data.length / 12) === 0) && (
                    <text x={pad.l + i * band + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={INK.secondary}>
                      {formatCategory(String(d[category]))}
                    </text>
                  )}
                  {/* hit target: the whole band */}
                  <rect x={pad.l + i * band} y={pad.t} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${formatCategory(String(d[category]))}: ${series.map((s) => `${s.label} ${fmt(Number(d[s.key]) || 0)}`).join(', ')}`} />
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <Tooltip leftPct={((pad.l + hover * band + band / 2) / width) * 100}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{formatCategory(String(data[hover][category]))}</div>
              {series.map((s, j) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[j] }} />
                  <span style={{ color: INK.secondary }}>{s.label}</span>
                  <span style={{ marginInlineStart: 'auto', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(data[hover]![s.key]) || 0)}</span>
                </div>
              ))}
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

function Tooltip({ leftPct, children }: { leftPct: number; children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute', top: 0, left: `${Math.min(80, Math.max(2, leftPct))}%`, transform: 'translateX(-50%)', pointerEvents: 'none',
        background: INK.surface, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,.12)', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: INK.primary, minWidth: 150,
      }}
    >
      {children}
    </div>
  );
}

/** Ranked horizontal bars (one series) with the value as a label — e.g. by organization. */
export function BarList({ items, valueLabel, format = fmt, max: maxItems = 10 }: { items: { name: string; value: number; hint?: string }[]; valueLabel: string; format?: (n: number) => string; max?: number }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const shown = items.slice(0, maxItems);
  const max = Math.max(1, ...shown.map((i) => i.value));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Segmented size="small" value={view} onChange={(v) => setView(v as 'chart' | 'table')} options={[{ value: 'chart', label: 'กราฟ' }, { value: 'table', label: 'ตาราง' }]} />
      </div>
      {view === 'table' ? (
        <Table size="small" pagination={false} rowKey="name" dataSource={items} columns={[{ title: '', dataIndex: 'name' }, { title: valueLabel, align: 'right', render: (_, r) => format(r.value) }]} />
      ) : !shown.length ? (
        <div style={{ padding: 24, textAlign: 'center', color: INK.muted }}>ไม่มีข้อมูล</div>
      ) : (
        <div role="list" aria-label={valueLabel} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((it) => (
            <div key={it.name} role="listitem" title={`${it.name}: ${format(it.value)}${it.hint ? ` · ${it.hint}` : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: INK.secondary, marginBottom: 3 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                <span style={{ color: INK.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {format(it.value)}
                  {it.hint && <span style={{ color: INK.muted }}> · {it.hint}</span>}
                </span>
              </div>
              <div style={{ height: 8, background: INK.grid, borderRadius: 4 }}>
                <div style={{ width: `${(it.value / max) * 100}%`, minWidth: it.value > 0 ? 4 : 0, height: '100%', background: SERIES[0], borderRadius: 4 }} />
              </div>
            </div>
          ))}
          {items.length > maxItems && <div style={{ fontSize: 12, color: INK.muted }}>และอีก {items.length - maxItems} รายการ (ดูในมุมมองตาราง)</div>}
        </div>
      )}
    </div>
  );
}
