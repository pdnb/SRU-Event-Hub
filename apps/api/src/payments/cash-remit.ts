import { businessDayDeadline } from '@sru/shared-utils';
import { registerSettingValidator, SettingsService } from '../common/settings.service';

/**
 * FIN-7 (answered 2026-11-07): cash collected on site is remitted by the end of the next business
 * day after the cashier session closes. Business days = Mon–Fri minus `finance.holidays`.
 */
export const CASH_REMIT_DAYS_KEY = 'finance.cashRemitBusinessDays';
export const HOLIDAYS_KEY = 'finance.holidays';
export const DEFAULT_CASH_REMIT_DAYS = 1;

const isDays = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 30;
const isHolidays = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 400 && v.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)));

registerSettingValidator(CASH_REMIT_DAYS_KEY, (v) => (isDays(v) ? null : 'ต้องเป็นจำนวนวันทำการ 0–30'));
registerSettingValidator(HOLIDAYS_KEY, (v) => (isHolidays(v) ? null : 'ต้องเป็นรายการวันที่แบบ ค.ศ. "YYYY-MM-DD" เช่น ["2026-12-07", "2026-12-10"]'));

/** Returns a function computing the remittance deadline of a session closed at `closedAt`. */
export async function cashRemitDeadline(settings: SettingsService): Promise<(closedAt: Date) => Date> {
  const [days, holidays] = await Promise.all([
    settings.get(CASH_REMIT_DAYS_KEY, DEFAULT_CASH_REMIT_DAYS, isDays),
    settings.get<string[]>(HOLIDAYS_KEY, [], isHolidays),
  ]);
  return (closedAt) => businessDayDeadline(closedAt, days, holidays);
}
