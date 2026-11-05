import type { EventSummaryDto } from '@sru/shared-types';

export function seatsText(e: Pick<EventSummaryDto, 'capacity' | 'seatsTaken'>) {
  if (e.capacity == null) return 'ไม่จำกัดจำนวน';
  const left = Math.max(e.capacity - e.seatsTaken, 0);
  return left === 0 ? 'ที่นั่งเต็ม' : `เหลือ ${left.toLocaleString('th-TH')} / ${e.capacity.toLocaleString('th-TH')} ที่นั่ง`;
}
