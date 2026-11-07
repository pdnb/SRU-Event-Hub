/**
 * Seed / demo data (spec §12). Idempotent: safe to run repeatedly.
 *
 * Demo account password: SEED_DEMO_PASSWORD env var, otherwise a random one is
 * generated and printed once. Nothing secret is hard-coded. Never run the demo
 * part in production: set SEED_DEMO=false to load only reference data.
 */
import { seedFinance, seedFinanceDemo } from './finance';
import { seedGroupsDemo } from './groups';
import { DEFAULT_BATCH_TEMPLATE, DEFAULT_CASH_TEMPLATE } from '../../src/payments/documents/templates';
import { DEFAULT_STATEMENT_COLUMNS } from '../../src/payments/reconciliation/statement-parser';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { fiscalYearBE, formatReference } from '@sru/shared-utils';
import { DataScope, OrganizationType, PrismaClient, UserType } from '../../src/generated/prisma/client';
import { ALL_PERMISSIONS, ROLES } from './rbac';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DEMO = process.env.SEED_DEMO !== 'false';
if (DEMO && process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo accounts in production (set SEED_DEMO=false).');
}

async function seedRbac() {
  for (const code of ALL_PERMISSIONS) {
    const [resource, action] = code.split(':') as [string, string];
    await prisma.permission.upsert({ where: { code }, create: { code, resource, action }, update: {} });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      create: { code: r.code, nameTh: r.nameTh, description: r.description, isSystem: true },
      update: { nameTh: r.nameTh, description: r.description },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: [...new Set(r.permissions)].map((c) => ({ roleId: role.id, permissionId: perms.get(c)! })),
    });
  }
}

type OrgSeed = { code: string; nameTh: string; nameEn?: string; shortName?: string; type: OrganizationType; finance?: boolean; children?: OrgSeed[] };
const ORG_TREE: OrgSeed = {
  code: 'SRU', nameTh: 'มหาวิทยาลัยราชภัฏสุราษฎร์ธานี', nameEn: 'Suratthani Rajabhat University', shortName: 'มรส.', type: 'UNIVERSITY',
  children: [
    { code: 'EDU', nameTh: 'คณะครุศาสตร์', nameEn: 'Faculty of Education', type: 'FACULTY' },
    { code: 'HUSO', nameTh: 'คณะมนุษยศาสตร์และสังคมศาสตร์', nameEn: 'Faculty of Humanities and Social Sciences', type: 'FACULTY' },
    {
      code: 'SCI', nameTh: 'คณะวิทยาศาสตร์และเทคโนโลยี', nameEn: 'Faculty of Science and Technology', type: 'FACULTY',
      children: [{ code: 'SCI-CS', nameTh: 'สาขาวิชาวิทยาการคอมพิวเตอร์', type: 'OTHER' }],
    },
    { code: 'MS', nameTh: 'คณะวิทยาการจัดการ', nameEn: 'Faculty of Management Sciences', type: 'FACULTY' },
    { code: 'AGI', nameTh: 'คณะนวัตกรรมการเกษตรและประมง', type: 'FACULTY' },
    { code: 'NURS', nameTh: 'คณะพยาบาลศาสตร์', type: 'FACULTY' },
    { code: 'ARIT', nameTh: 'สำนักวิทยบริการและเทคโนโลยีสารสนเทศ', type: 'OFFICE' },
    { code: 'RDI', nameTh: 'สถาบันวิจัยและพัฒนา', type: 'INSTITUTE' },
    {
      code: 'OP', nameTh: 'สำนักงานอธิการบดี', type: 'OFFICE',
      children: [
        { code: 'FIN', nameTh: 'กองคลัง', nameEn: 'Finance Division', type: 'DIVISION', finance: true },
        { code: 'SA', nameTh: 'กองพัฒนานักศึกษา', type: 'DIVISION' },
        { code: 'PLAN', nameTh: 'กองนโยบายและแผน', type: 'DIVISION' },
      ],
    },
    { code: 'LANG', nameTh: 'ศูนย์ภาษา', type: 'CENTER' },
  ],
};

async function seedOrgs(node: OrgSeed, parentId: string | null, ids: Map<string, string>, order = 0) {
  const org = await prisma.organization.upsert({
    where: { code: node.code },
    create: { code: node.code, nameTh: node.nameTh, nameEn: node.nameEn, shortName: node.shortName, type: node.type, parentId, isFinanceDivision: !!node.finance, sortOrder: order },
    update: { nameTh: node.nameTh, nameEn: node.nameEn, parentId, isFinanceDivision: !!node.finance, sortOrder: order },
  });
  ids.set(node.code, org.id);
  for (const [i, c] of (node.children ?? []).entries()) await seedOrgs(c, org.id, ids, i);
}

async function seedLookups() {
  const types = [
    ['TRAINING', 'อบรม/สัมมนา'], ['CONFERENCE', 'ประชุมวิชาการ'], ['ACTIVITY', 'กิจกรรมนักศึกษา'],
    ['CULTURE', 'ทำนุบำรุงศิลปวัฒนธรรม'], ['SERVICE', 'บริการวิชาการ'], ['SPORT', 'กีฬา'], ['COMPETITION', 'การแข่งขัน'],
  ];
  for (const [i, [code, nameTh]] of types.entries()) {
    await prisma.eventType.upsert({ where: { code: code! }, create: { code: code!, nameTh: nameTh!, sortOrder: i }, update: {} });
  }
  const cats = [
    ['ACADEMIC', 'วิชาการ', '#1d4ed8'], ['STUDENT_DEV', 'พัฒนานักศึกษา', '#0f766e'], ['CULTURE', 'ศิลปวัฒนธรรม', '#b45309'],
    ['COMMUNITY', 'บริการชุมชน', '#15803d'], ['PERSONNEL', 'พัฒนาบุคลากร', '#7c3aed'], ['HEALTH', 'สุขภาพ', '#be123c'],
  ];
  for (const [i, [code, nameTh, color]] of cats.entries()) {
    await prisma.eventCategory.upsert({ where: { code: code! }, create: { code: code!, nameTh: nameTh!, color, sortOrder: i }, update: {} });
  }
  const pts = [['STUDENT', 'นักศึกษา'], ['STAFF', 'บุคลากร'], ['EXTERNAL', 'บุคคลภายนอก'], ['SCHOOL_STUDENT', 'นักเรียน']];
  for (const [i, [code, nameTh]] of pts.entries()) {
    await prisma.participantType.upsert({ where: { code: code! }, create: { code: code!, nameTh: nameTh!, sortOrder: i }, update: {} });
  }
}

async function seedVenues(orgIds: Map<string, string>) {
  const b = await prisma.building.upsert({ where: { code: 'B-CC' }, create: { code: 'B-CC', nameTh: 'อาคารศูนย์ประชุม', campus: 'วิทยาเขตขุนทะเล' }, update: {} });
  const b2 = await prisma.building.upsert({ where: { code: 'B-SCI' }, create: { code: 'B-SCI', nameTh: 'อาคารคณะวิทยาศาสตร์และเทคโนโลยี', campus: 'วิทยาเขตขุนทะเล' }, update: {} });
  const venues = [
    { code: 'CC-HALL', nameTh: 'หอประชุมใหญ่', venueType: 'AUDITORIUM' as const, capacity: 1200, buildingId: b.id },
    { code: 'CC-201', nameTh: 'ห้องประชุม 201', venueType: 'MEETING_ROOM' as const, capacity: 80, buildingId: b.id },
    { code: 'SCI-LAB1', nameTh: 'ห้องปฏิบัติการคอมพิวเตอร์ 1', venueType: 'LAB' as const, capacity: 40, buildingId: b2.id, organizationId: orgIds.get('SCI') ?? null },
    { code: 'SCI-301', nameTh: 'ห้องประชุมคณะวิทยาศาสตร์ 301', venueType: 'MEETING_ROOM' as const, capacity: 30, buildingId: b2.id, organizationId: orgIds.get('SCI') ?? null, autoApprove: true },
    { code: 'FIELD', nameTh: 'ลานกิจกรรมกลาง', venueType: 'OUTDOOR' as const, capacity: 2000, buildingId: null },
  ];
  // Managing unit is (re)applied so existing databases get it too; central rooms stay null (approved centrally).
  for (const v of venues) await prisma.venue.upsert({ where: { code: v.code }, create: v, update: { organizationId: (v as { organizationId?: string | null }).organizationId ?? null } });
  const lab = await prisma.venue.findUniqueOrThrow({ where: { code: 'SCI-LAB1' } });
  const resources = [
    { code: 'EQ-PROJ', nameTh: 'เครื่องฉายโปรเจกเตอร์แบบเคลื่อนที่', resourceType: 'โสตทัศนูปกรณ์', quantity: 5, organizationId: null, venueId: null },
    { code: 'EQ-MIC', nameTh: 'ไมโครโฟนไร้สาย', resourceType: 'เครื่องเสียง', quantity: 10, organizationId: null, venueId: null },
    { code: 'EQ-TENT', nameTh: 'เต็นท์ 3×3 เมตร', resourceType: 'อุปกรณ์จัดงาน', quantity: 20, organizationId: null, venueId: null },
    { code: 'SCI-NB', nameTh: 'โน้ตบุ๊กสำหรับอบรม', resourceType: 'คอมพิวเตอร์', quantity: 40, organizationId: orgIds.get('SCI') ?? null, venueId: lab.id },
  ];
  for (const x of resources) await prisma.resource.upsert({ where: { code: x.code }, create: x, update: {} });
}

async function seedSettings() {
  const settings: [string, unknown, string][] = [
    ['site.name', { th: 'ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี', en: 'SRU Event Hub' }, 'ชื่อระบบ'],
    ['pdpa.consentVersion', '2569-1', 'เวอร์ชันข้อความยินยอม PDPA ปัจจุบัน'],
    ['finance.submissionLeadDays', 7, 'จำนวนวันก่อนวันจัดกิจกรรมที่ต้องส่งรายงานนำส่งกองคลัง (FIN-3: กองคลังยืนยัน 7 วัน)'],
    ['payment.defaultDueHours', 48, 'ระยะเวลาชำระเงินหลังลงทะเบียน (ชั่วโมง)'],
    // P2c — placeholders until กองคลัง confirms the official forms (FIN-1) and bank formats.
    ['finance.remittanceReportTemplate', DEFAULT_BATCH_TEMPLATE, 'แม่แบบรายงานนำส่งเงิน (PDF/Excel) — แบบชั่วคราว รอแบบฟอร์มจริงจากกองคลัง (FIN-1)'],
    ['finance.cashRemittanceTemplate', DEFAULT_CASH_TEMPLATE, 'แม่แบบใบนำส่งเงินสดของกะรับเงินหน้างาน — แบบชั่วคราว (FIN-1)'],
    ['finance.statementColumns', DEFAULT_STATEMENT_COLUMNS, 'ชื่อหัวคอลัมน์ของไฟล์ statement ธนาคาร (CSV/XLSX) ที่ใช้กระทบยอด'],
    ['finance.reconcileToleranceMinutes', 15, 'ช่วงเวลา (นาที) ที่ยอมให้เวลาโอนต่างจากเวลาใน statement เมื่อจับคู่อัตโนมัติ'],
  ];
  for (const [key, value, description] of settings) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never, description }, update: { description } });
  }
}

async function seedWorkflow(orgIds: Map<string, string>) {
  const approverRole = await prisma.role.findUniqueOrThrow({ where: { code: 'APPROVER' } });
  const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: 'FINANCE_OFFICER' } });
  const wf = await prisma.approvalWorkflow.upsert({
    where: { code: 'DEFAULT' },
    create: { code: 'DEFAULT', nameTh: 'ขั้นตอนอนุมัติมาตรฐานของมหาวิทยาลัย', organizationId: null },
    update: {},
  });
  const steps = [
    { stepOrder: 1, nameTh: 'หัวหน้าหน่วยงานผู้จัดพิจารณา', approverType: 'ORG_HEAD' as const },
    { stepOrder: 2, nameTh: 'กองคลังตรวจสอบอัตราค่าลงทะเบียน บัญชีรับเงิน และรหัสรายได้', approverType: 'ROLE' as const, approverRoleId: financeRole.id, isFinanceReview: true, paidEventsOnly: true },
    { stepOrder: 3, nameTh: 'ผู้อนุมัติส่วนกลางพิจารณา', approverType: 'ROLE' as const, approverRoleId: approverRole.id },
  ];
  for (const s of steps) {
    await prisma.approvalStep.upsert({
      where: { workflowId_stepOrder: { workflowId: wf.id, stepOrder: s.stepOrder } },
      create: { workflowId: wf.id, ...s },
      update: s,
    });
  }
  void orgIds;
}

async function seedDemo(orgIds: Map<string, string>) {
  const password = process.env.SEED_DEMO_PASSWORD || randomBytes(9).toString('base64url');
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const org = (c: string) => orgIds.get(c)!;

  const users: { username: string; displayName: string; type: UserType; roles: [string, string | null, DataScope][]; head?: string; staffCode?: string; studentCode?: string }[] = [
    { username: 'superadmin', displayName: 'ผู้ดูแลระบบสูงสุด', type: 'STAFF', roles: [['SUPER_ADMIN', null, 'ALL']] },
    { username: 'sysadmin', displayName: 'นายระบบ ดูแลดี', type: 'STAFF', roles: [['SYSTEM_ADMIN', null, 'ALL']] },
    { username: 'executive', displayName: 'รศ.ดร.ผู้บริหาร ใจกว้าง', type: 'STAFF', roles: [['EXECUTIVE', null, 'ALL'], ['APPROVER', null, 'ALL']] },
    { username: 'central', displayName: 'นางสาวกลาง กิจกรรม', type: 'STAFF', roles: [['CENTRAL_EVENT_ADMIN', null, 'ALL']] },
    { username: 'sci.dean', displayName: 'ผศ.ดร.คณบดี วิทยาศาสตร์', type: 'STAFF', roles: [['APPROVER', org('SCI'), 'ORGANIZATION_TREE']], head: 'SCI', staffCode: 'S1001' },
    { username: 'sci.admin', displayName: 'นายสมชาย ดูแลงาน', type: 'STAFF', roles: [['ORG_ADMIN', org('SCI'), 'ORGANIZATION_TREE']], staffCode: 'S1002' },
    { username: 'sci.manager', displayName: 'อาจารย์สมหญิง จัดกิจกรรม', type: 'STAFF', roles: [['EVENT_MANAGER', org('SCI'), 'ORGANIZATION_TREE']], staffCode: 'S1003' },
    { username: 'sa.manager', displayName: 'นายพัฒนา นักศึกษา', type: 'STAFF', roles: [['EVENT_MANAGER', org('SA'), 'ORGANIZATION']], staffCode: 'S2001' },
    { username: 'sa.head', displayName: 'นางหัวหน้า กองพัฒนานักศึกษา', type: 'STAFF', roles: [], head: 'SA', staffCode: 'S2000' },
    { username: 'finance', displayName: 'นางสาวการเงิน กองคลัง', type: 'STAFF', roles: [['FINANCE_OFFICER', null, 'ALL']], staffCode: 'F0001' },
    { username: 'sci.finance', displayName: 'นางบัญชี คณะวิทย์', type: 'STAFF', roles: [['ORG_FINANCE_OFFICER', org('SCI'), 'ORGANIZATION_TREE']], staffCode: 'S1004' },
    { username: 'cashier', displayName: 'นายรับเงิน หน้างาน', type: 'STAFF', roles: [['EVENT_CASHIER', org('SCI'), 'ORGANIZATION_TREE']], staffCode: 'S1005' },
    { username: 'staff', displayName: 'นางสาวเช็กอิน ประจำจุด', type: 'STAFF', roles: [['EVENT_STAFF', org('SCI'), 'ORGANIZATION_TREE']], staffCode: 'S1006' },
    { username: 'lecturer', displayName: 'อาจารย์ใจดี สอนเก่ง', type: 'STAFF', roles: [['LECTURER_STAFF', org('EDU'), 'OWN']], staffCode: 'E3001' },
    { username: 'student', displayName: 'นายนักศึกษา ตั้งใจเรียน', type: 'STUDENT', roles: [['STUDENT', org('SCI'), 'OWN']], studentCode: '6612345001' },
    { username: 'coordinator', displayName: 'ครูประสาน โรงเรียนตัวอย่าง', type: 'EXTERNAL', roles: [['ORG_COORDINATOR', null, 'OWN']] },
  ];

  const ids = new Map<string, string>();
  for (const u of users) {
    const email = `${u.username}@demo.sru.ac.th`;
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email, username: u.username, displayName: u.displayName, userType: u.type, passwordHash: hash, emailVerifiedAt: new Date(),
        profile: { create: { staffCode: u.staffCode, studentCode: u.studentCode } },
      },
      update: { passwordHash: hash, displayName: u.displayName, status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
    });
    ids.set(u.username, user.id);
    for (const [roleCode, organizationId, scope] of u.roles) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
      const exists = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id, organizationId } });
      if (!exists) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId, scope } });
    }
    if (u.head) {
      await prisma.organization.update({ where: { code: u.head }, data: { headUserId: user.id } });
      await prisma.userOrganization.upsert({
        where: { userId_organizationId_memberRole: { userId: user.id, organizationId: org(u.head), memberRole: 'HEAD' } },
        create: { userId: user.id, organizationId: org(u.head), memberRole: 'HEAD', isPrimary: true },
        update: {},
      });
    }
  }
  for (const [username, code, memberRole] of [['sci.manager', 'SCI', 'PROPOSER'], ['sci.finance', 'SCI', 'FINANCE_OFFICER'], ['sci.admin', 'SCI', 'STAFF'], ['finance', 'FIN', 'FINANCE_OFFICER']] as const) {
    await prisma.userOrganization.upsert({
      where: { userId_organizationId_memberRole: { userId: ids.get(username)!, organizationId: org(code), memberRole } },
      create: { userId: ids.get(username)!, organizationId: org(code), memberRole, isPrimary: true },
      update: {},
    });
  }

  await seedDemoEvents(orgIds, ids);
  return password;
}

async function seedDemoEvents(orgIds: Map<string, string>, users: Map<string, string>) {
  if (await prisma.event.count()) return; // only on an empty database
  const day = 86400_000;
  const now = Date.now();
  const at = (days: number, hour = 9) => {
    const d = new Date(now + days * day);
    d.setUTCHours(hour - 7, 0, 0, 0); // hour in Bangkok
    return d;
  };
  const type = async (code: string) => (await prisma.eventType.findUniqueOrThrow({ where: { code } })).id;
  const cat = async (code: string) => (await prisma.eventCategory.findUniqueOrThrow({ where: { code } })).id;
  const venue = async (code: string) => (await prisma.venue.findUniqueOrThrow({ where: { code } })).id;
  const fy = fiscalYearBE();
  let n = 0;
  const code = () => formatReference('EVT', fy, ++n);
  const manager = users.get('sci.manager')!;

  const events = [
    {
      titleTh: 'อบรมเชิงปฏิบัติการ การพัฒนาเว็บแอปพลิเคชันด้วย Next.js', titleEn: 'Next.js Web Application Workshop',
      organizationId: orgIds.get('SCI')!, eventTypeId: await type('TRAINING'), categoryId: await cat('ACADEMIC'), venueId: await venue('SCI-LAB1'), venueText: 'ห้องปฏิบัติการคอมพิวเตอร์ 1 อาคารคณะวิทยาศาสตร์และเทคโนโลยี',
      description: 'อบรมเชิงปฏิบัติการสำหรับนักศึกษาและบุคลากรที่สนใจการพัฒนาเว็บสมัยใหม่ ครอบคลุม App Router, Server Components และการเชื่อมต่อ REST API',
      objectives: '1. เข้าใจสถาปัตยกรรม Next.js App Router\n2. สร้างเว็บแอปพลิเคชันที่เชื่อมต่อ API ได้จริง', targetAudience: 'นักศึกษาและบุคลากร',
      startAt: at(14), endAt: at(14, 16), registrationOpenAt: new Date(now - 2 * day), registrationCloseAt: at(12, 23),
      capacity: 40, status: 'REGISTRATION_OPEN' as const, approvalStatus: 'APPROVED' as const, allowGuestRegistration: true, isFeatured: true, tags: ['เทคโนโลยี', 'เว็บ'],
    },
    {
      titleTh: 'ประชุมวิชาการระดับชาติ วิทยาศาสตร์และเทคโนโลยี ครั้งที่ 10', titleEn: 'The 10th National Conference on Science and Technology',
      organizationId: orgIds.get('SCI')!, eventTypeId: await type('CONFERENCE'), categoryId: await cat('ACADEMIC'), venueId: await venue('CC-HALL'), venueText: 'หอประชุมใหญ่ อาคารศูนย์ประชุม',
      description: 'เวทีนำเสนอผลงานวิจัยด้านวิทยาศาสตร์และเทคโนโลยีของนักวิจัยทั่วประเทศ', startAt: at(45), endAt: at(46, 16),
      registrationOpenAt: at(5), registrationCloseAt: at(40), capacity: 500, status: 'PUBLISHED' as const, approvalStatus: 'APPROVED' as const, allowGuestRegistration: true, isFeatured: true, tags: ['วิจัย'],
    },
    {
      titleTh: 'กิจกรรมไหว้ครู ประจำปีการศึกษา 2569', organizationId: orgIds.get('SA')!, eventTypeId: await type('CULTURE'), categoryId: await cat('CULTURE'),
      venueId: await venue('CC-HALL'), venueText: 'หอประชุมใหญ่', description: 'พิธีไหว้ครูเพื่อแสดงความกตัญญูต่อครูบาอาจารย์', startAt: at(-30), endAt: at(-30, 12),
      registrationOpenAt: at(-45), registrationCloseAt: at(-31), capacity: 1000, status: 'COMPLETED' as const, approvalStatus: 'APPROVED' as const, tags: ['ประเพณี'],
    },
    {
      titleTh: 'ค่ายพัฒนาทักษะผู้นำนักศึกษา', organizationId: orgIds.get('SA')!, eventTypeId: await type('ACTIVITY'), categoryId: await cat('STUDENT_DEV'),
      venueText: 'ลานกิจกรรมกลาง', description: 'ค่ายพัฒนาภาวะผู้นำสำหรับคณะกรรมการนักศึกษา', startAt: at(30), endAt: at(31, 16),
      capacity: 120, status: 'DRAFT' as const, approvalStatus: 'NOT_SUBMITTED' as const, tags: ['ผู้นำ'],
    },
    {
      titleTh: 'สัมมนาการใช้ AI เพื่อการเรียนการสอน', organizationId: orgIds.get('SCI')!, eventTypeId: await type('TRAINING'), categoryId: await cat('PERSONNEL'),
      venueId: await venue('CC-201'), venueText: 'ห้องประชุม 201', description: 'สัมมนาสำหรับคณาจารย์เรื่องการประยุกต์ใช้ปัญญาประดิษฐ์ในการจัดการเรียนการสอน', startAt: at(21), endAt: at(21, 12),
      registrationOpenAt: at(3), registrationCloseAt: at(19), capacity: 80, status: 'DRAFT' as const, approvalStatus: 'NOT_SUBMITTED' as const, tags: ['AI'],
    },
  ];

  const allTypes = await prisma.participantType.findMany();
  for (const { tags, ...e } of events) {
    const created = await prisma.event.create({
      data: {
        ...e, code: code(), ownerUserId: e.organizationId === orgIds.get('SA') ? users.get('sa.manager')! : manager,
        createdById: e.organizationId === orgIds.get('SA') ? users.get('sa.manager')! : manager,
        publishedAt: ['DRAFT'].includes(e.status) ? null : new Date(now - 3 * day),
        participantTypes: { create: allTypes.filter((t) => t.code !== 'SCHOOL_STUDENT').map((t) => ({ participantTypeId: t.id })) },
        statusHistory: { create: { toStatus: e.status, reason: 'ข้อมูลตัวอย่าง' } },
        tags: { create: await Promise.all(tags.map(async (name) => ({ tag: { connect: { id: (await prisma.tag.upsert({ where: { name }, create: { name }, update: {} })).id } } }))) },
      },
    });
    if (created.titleTh.startsWith('อบรมเชิงปฏิบัติการ')) {
      await prisma.registrationField.create({
        data: {
          eventId: created.id, key: 'laptop', labelTh: 'นำคอมพิวเตอร์โน้ตบุ๊กมาเอง', fieldType: 'RADIO', isRequired: true, sortOrder: 0,
          options: { create: [{ value: 'yes', labelTh: 'นำมาเอง', sortOrder: 0 }, { value: 'no', labelTh: 'ขอใช้เครื่องของห้องปฏิบัติการ', sortOrder: 1 }] },
        },
      });
      await prisma.registrationField.create({ data: { eventId: created.id, key: 'expectation', labelTh: 'สิ่งที่คาดหวังจากการอบรม', fieldType: 'TEXTAREA', sortOrder: 1 } });
    }
  }
  await prisma.documentSequence.upsert({
    where: { prefix_fiscalYear: { prefix: 'EVT', fiscalYear: fy } },
    create: { prefix: 'EVT', fiscalYear: fy, lastValue: n },
    update: { lastValue: n },
  });
}

async function main() {
  await seedRbac();
  const orgIds = new Map<string, string>();
  await seedOrgs(ORG_TREE, null, orgIds);
  await seedLookups();
  await seedVenues(orgIds);
  await seedSettings();
  await seedWorkflow(orgIds);
  await seedFinance(prisma, orgIds);
  if (DEMO) {
    const pw = await seedDemo(orgIds);
    await seedFinanceDemo(prisma);
    await seedGroupsDemo(prisma);
    console.log('\n✔ Seed complete. Demo accounts: <username>@demo.sru.ac.th or username');
    console.log('  usernames: superadmin, sysadmin, executive, central, sci.dean, sci.admin, sci.manager, sa.manager, sa.head,');
    console.log('             finance, sci.finance, cashier, staff, lecturer, student, coordinator');
    if (!process.env.SEED_DEMO_PASSWORD) console.log(`  generated demo password (shown once): ${pw}`);
  } else console.log('✔ Reference data seeded (no demo accounts).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
