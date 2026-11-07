/**
 * FIN-4 (answered 2026-11-07): กองคลังไม่รองรับพร้อมเพย์ — payers transfer to the central account
 * shown on the payment page and upload a slip. With this off no QR is generated (even from older
 * order snapshots), no PromptPay id is snapshotted into new orders, and the bank account API
 * refuses a PromptPay id. Flip to true (and add the id in finance settings) if that ever changes.
 */
export const PROMPTPAY_SUPPORTED = false;
