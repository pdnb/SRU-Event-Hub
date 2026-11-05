import dayjs from 'dayjs';
import 'dayjs/locale/th';
import buddhistEra from 'dayjs/plugin/buddhistEra';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(buddhistEra);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');
dayjs.tz.setDefault('Asia/Bangkok');

/** DatePicker display formats with Buddhist Era year (BBBB). Values stay ISO/UTC. */
export const DATE_FMT = 'D MMM BBBB';
export const DATETIME_FMT = 'D MMM BBBB HH:mm';

export default dayjs;
