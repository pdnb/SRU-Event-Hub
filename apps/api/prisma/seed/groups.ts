import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Group registration demo (P3): the paid conference accepts groups of 2–30, and the demo
 * coordinator account owns a sample school. Idempotent.
 */
export async function seedGroupsDemo(prisma: PrismaClient) {
  const event = await prisma.event.findFirst({ where: { titleTh: { startsWith: 'ประชุมวิชาการระดับชาติ' }, deletedAt: null } });
  if (event) {
    await prisma.eventGroupSetting.upsert({
      where: { eventId: event.id },
      create: { eventId: event.id, isEnabled: true, minMembers: 2, maxMembers: 30, allowImport: true, allowInviteLinks: true },
      update: {},
    });
  }
  const coordinator = await prisma.user.findUnique({ where: { username: 'coordinator' } });
  if (!coordinator || (await prisma.organizationCoordinator.count({ where: { userId: coordinator.id } }))) return;
  await prisma.participantOrganization.create({
    data: {
      nameTh: 'โรงเรียนตัวอย่างวิทยา (ข้อมูลตัวอย่าง)',
      orgType: 'SCHOOL',
      province: 'สุราษฎร์ธานี',
      address: '1 ถนนตัวอย่าง ตำบลมะขามเตี้ย อำเภอเมือง จังหวัดสุราษฎร์ธานี 84000',
      phone: '077000000',
      createdById: coordinator.id,
      coordinators: { create: { userId: coordinator.id, position: 'ครูผู้ประสานงาน', isPrimary: true, createdById: coordinator.id } },
    },
  });
}
