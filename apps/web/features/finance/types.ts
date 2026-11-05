/** Wire shapes of the P2b finance endpoints (kept next to the screens that use them). */

export interface CashierSessionDto {
  id: string;
  sessionNo: string;
  status: string;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  cashierId: string;
  cashierName: string;
  openingFloat: string;
  collectedAmount: string;
  collectedText: string;
  paymentCount: number;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  closeNote: string | null;
  remittanceNo: string | null;
  openedAt: string;
  closedAt: string | null;
  remittedAt: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface CashPaymentDto {
  id: string;
  paymentNo: string;
  status: string;
  amount: string;
  submittedAt: string;
  orderNo: string;
  payerName: string;
  referenceNo: string | null;
  voidReason: string | null;
}

export interface PayableDto {
  orderId: string;
  orderNo: string;
  referenceNo: string | null;
  payerName: string;
  payerEmail: string;
  phone: string | null;
  feeName: string;
  amount: string;
  dueAt: string;
}

export interface RefundDto {
  id: string;
  refundNo: string;
  status: string;
  amount: string;
  amountText: string;
  reason: string;
  payeeName: string;
  bankName: string;
  accountNoMasked: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  referenceNo: string | null;
  eventCode: string;
  eventTitle: string;
  requestedById: string;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  paidAt: string | null;
  paidRef: string | null;
  createdAt: string;
}

export interface RefundableDto {
  orderId: string;
  orderNo: string;
  status: string;
  payerName: string;
  referenceNo: string | null;
  registrationStatus: string | null;
  eventCode: string;
  eventTitle: string;
  paid: string;
  refundable: string;
}
