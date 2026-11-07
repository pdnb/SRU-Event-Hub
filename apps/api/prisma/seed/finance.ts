import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Finance reference data (FIN-4, FIN-5). The values below are PLACEHOLDERS for development:
 * the real receiving account, PromptPay id and income codes must come from กองคลัง
 * (docs/OPEN_QUESTIONS.md) and are entered through the finance settings screen.
 * FIN-4: money is received into the university's central account (organizationId = null),
 * which only university-wide finance staff may reconcile.
 */
export async function seedFinance(prisma: PrismaClient) {
  const incomeCodes = [
    ['INC-REG', 'รายได้ค่าลงทะเบียนอบรม/สัมมนา (ตัวอย่าง)'],
    ['INC-CONF', 'รายได้ค่าลงทะเบียนประชุมวิชาการ (ตัวอย่าง)'],
    ['INC-SVC', 'รายได้จากการให้บริการวิชาการ (ตัวอย่าง)'],
  ];
  for (const [code, nameTh] of incomeCodes) {
    await prisma.incomeCode.upsert({ where: { code: code! }, create: { code: code!, nameTh: nameTh! }, update: {} });
  }
  if (!(await prisma.bankAccount.count())) {
    await prisma.bankAccount.create({
      data: {
        organizationId: null, // บัญชีรับเงินกลาง (FIN-4)
        bankName: 'ธนาคารกรุงไทย (ตัวอย่าง)',
        branch: 'สาขาสุราษฎร์ธานี',
        accountNo: '000-0-00000-0',
        accountName: 'มหาวิทยาลัยราชภัฏสุราษฎร์ธานี (บัญชีตัวอย่าง ห้ามโอนจริง)',
        // Placeholder 13-digit id → a syntactically valid PromptPay QR for UI testing only.
        promptPayId: '0000000000000',
      },
    });
  }
}

/** Demo only: turns the seeded national conference into a paid event with early-bird pricing. */
export async function seedFinanceDemo(prisma: PrismaClient) {
  const event = await prisma.event.findFirst({ where: { titleTh: { startsWith: 'ประชุมวิชาการระดับชาติ' }, deletedAt: null } });
  if (!event || (await prisma.eventFeeRate.count({ where: { eventId: event.id } }))) return;
  const [bank, income, student] = await Promise.all([
    prisma.bankAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.incomeCode.findUnique({ where: { code: 'INC-CONF' } }),
    prisma.participantType.findUnique({ where: { code: 'STUDENT' } }),
  ]);
  const now = Date.now();
  const day = 86_400_000;
  await prisma.event.update({
    where: { id: event.id },
    data: {
      isPaid: true,
      bankAccountId: bank?.id ?? null,
      incomeCodeId: income?.id ?? null,
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
