import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Finance reference data. The account below is a PLACEHOLDER for development: the real receiving
 * account must come from กองคลัง and are entered through the finance settings screen.
 * FIN-4: money is received into the university's central account (organizationId = null),
 * which only university-wide finance staff may reconcile.
 * FIN-5: กองคลังไม่ใช้รหัสรายได้ — no income codes are seeded (the optional feature stays available).
 */
export async function seedFinance(prisma: PrismaClient) {
  if (!(await prisma.bankAccount.count())) {
    await prisma.bankAccount.create({
      data: {
        organizationId: null, // บัญชีรับเงินกลาง (FIN-4)
        bankName: 'ธนาคารกรุงไทย (ตัวอย่าง)',
        branch: 'สาขาสุราษฎร์ธานี',
        accountNo: '000-0-00000-0',
        accountName: 'มหาวิทยาลัยราชภัฏสุราษฎร์ธานี (บัญชีตัวอย่าง ห้ามโอนจริง)',
        // FIN-4: PromptPay is not supported → no PromptPay id.
      },
    });
  }
}

/** Demo only: turns the seeded national conference into a paid event with early-bird pricing. */
export async function seedFinanceDemo(prisma: PrismaClient) {
  const event = await prisma.event.findFirst({ where: { titleTh: { startsWith: 'ประชุมวิชาการระดับชาติ' }, deletedAt: null } });
  if (!event || (await prisma.eventFeeRate.count({ where: { eventId: event.id } }))) return;
  const [bank, student] = await Promise.all([
    prisma.bankAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.participantType.findUnique({ where: { code: 'STUDENT' } }),
  ]);
  const now = Date.now();
  const day = 86_400_000;
  await prisma.event.update({
    where: { id: event.id },
    data: {
      isPaid: true,
      bankAccountId: bank?.id ?? null,
      paymentWindowHours: 72,
      // open now so the payment flow can be tried immediately
      status: 'REGISTRATION_OPEN',
      registrationOpenAt: new Date(now - day),
      feeRates: {
        create: [
          { nameTh: 'อัตราทั่วไป', amount: '1500.00', sortOrder: 0 },
          { nameTh: 'Early bird', amount: '1200.00', validUntil: new Date(now + 20 * day), sortOrder: 1 },
          ...(student ? [{ nameTh: 'นักศึกษา', amount: '500.00', participantTypeId: student.id, sortOrder: 2 }] : []),
        ],
      },
    },
  });
}
