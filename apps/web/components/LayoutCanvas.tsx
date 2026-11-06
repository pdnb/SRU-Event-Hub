'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/** A positioned box on a printed layout (badge / certificate). Geometry in millimetres. */
export interface LayoutBox {
  kind: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

const snap = (n: number) => Math.round(n * 2) / 2;
export const clampMm = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const PT_PER_MM = 72 / 25.4;

/**
 * WYSIWYG-ish layout canvas shared by the badge and certificate designers: drag to move, the corner
 * handle to resize (square for QR boxes), arrow keys to nudge (Shift = 0.5 mm), Delete to remove.
 * Pointer events, so mouse, pen and touch all work. Rendering of each box is up to the caller.
 */
export function LayoutCanvas<F extends LayoutBox>({
  widthMm,
  heightMm,
  fields,
  selected,
  onSelect,
  onChange,
  onRemove,
  editable,
  background,
  backgroundImage,
  maxWidth = 560,
  qrMinMm = 12,
  ariaLabel,
  renderBox,
}: {
  widthMm: number;
  heightMm: number;
  fields: F[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  onChange: (i: number, patch: Partial<F>) => void;
  onRemove: (i: number) => void;
  editable: boolean;
  background: string | null;
  backgroundImage: string | null;
  maxWidth?: number;
  qrMinMm?: number;
  ariaLabel: string;
  /** Content + extra style of one box; `scale` is px per mm, `ptToPx` converts font points. */
  renderBox: (f: F, ctx: { scale: number; ptToPx: (pt: number) => number }) => { content: ReactNode; style?: CSSProperties };
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Math.min(480, maxWidth));

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(maxWidth, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  const scale = width / widthMm; // px per mm
  const ptToPx = (pt: number) => (pt / PT_PER_MM) * scale;

  const drag = useRef<{ i: number; mode: 'move' | 'resize'; x: number; y: number; f: F } | null>(null);
  const onPointerDown = (e: ReactPointerEvent, i: number, mode: 'move' | 'resize') => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(i);
    drag.current = { i, mode, x: e.clientX, y: e.clientY, f: fields[i]! };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    if (d.mode === 'move') {
      onChange(d.i, { xMm: snap(clampMm(d.f.xMm + dx, 0, widthMm - d.f.wMm)), yMm: snap(clampMm(d.f.yMm + dy, 0, heightMm - d.f.hMm)) } as Partial<F>);
    } else if (d.f.kind === 'QR') {
      const side = snap(clampMm(Math.max(d.f.wMm + dx, d.f.hMm + dy), qrMinMm, Math.min(widthMm - d.f.xMm, heightMm - d.f.yMm)));
      onChange(d.i, { wMm: side, hMm: side } as Partial<F>);
    } else {
      onChange(d.i, { wMm: snap(clampMm(d.f.wMm + dx, 2, widthMm - d.f.xMm)), hMm: snap(clampMm(d.f.hMm + dy, 2, heightMm - d.f.yMm)) } as Partial<F>);
    }
  };
  const onPointerUp = () => (drag.current = null);

  const onKeyDown = (e: KeyboardEvent) => {
    const f = selected !== null ? fields[selected] : undefined;
    if (selected === null || !f || !editable) return;
    const step = e.shiftKey ? 0.5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key]!;
      onChange(selected, { xMm: clampMm(f.xMm + dx, 0, widthMm - f.wMm), yMm: clampMm(f.yMm + dy, 0, heightMm - f.hMm) } as Partial<F>);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onRemove(selected);
    }
  };

  return (
    <div style={{ overflow: 'auto', padding: 1 }}>
      <div
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => onSelect(null)}
        style={{
          position: 'relative',
          width,
          height: heightMm * scale,
          margin: '0 auto',
          background: background ?? '#ffffff',
          backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
          backgroundSize: '100% 100%',
          boxShadow: '0 1px 6px rgba(0,0,0,.25)',
          overflow: 'hidden',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        {fields.map((f, i) => {
          const { content, style } = renderBox(f, { scale, ptToPx });
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
                lineHeight: 1.15,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                outline: selected === i ? '2px solid #2563eb' : '1px dashed rgba(37,99,235,.35)',
                cursor: editable ? 'move' : 'default',
                userSelect: 'none',
                ...style,
              }}
            >
              {content}
              {editable && selected === i && (
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
  );
}
