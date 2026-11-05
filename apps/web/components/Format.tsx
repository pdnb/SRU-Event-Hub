import { formatMoney, formatThaiDate, formatThaiDateTime } from '@sru/shared-utils';

export function ThaiDate({ value, time = false }: { value: string | Date | null | undefined; time?: boolean }) {
  if (!value) return <>-</>;
  return <>{time ? formatThaiDateTime(value) : formatThaiDate(value)}</>;
}

/** "5 พ.ย. 2569 09:00 – 16:00 น." or a two-date range. */
export function ThaiDateRange({ start, end }: { start: string; end: string }) {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = formatThaiDate(s) === formatThaiDate(e);
  if (sameDay) {
    const t = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(d);
    return <>{`${formatThaiDate(s)} ${t(s)} – ${t(e)} น.`}</>;
  }
  return <>{`${formatThaiDateTime(s)} – ${formatThaiDateTime(e)}`}</>;
}

/** "1,234.00 บาท" */
export function Money({ value, suffix = true }: { value: string | null | undefined; suffix?: boolean }) {
  if (value == null) return <>-</>;
  return <span className="money">{formatMoney(value)}{suffix ? ' บาท' : ''}</span>;
}
