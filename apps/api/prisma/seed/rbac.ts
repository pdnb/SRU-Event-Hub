import { ROLE_CODES, type PermissionCode } from '@sru/shared-types';

/** Curated permission catalogue: only meaningful resource/action pairs. */
export const PERMISSION_CATALOGUE: Record<string, string[]> = {
  user: ['view', 'create', 'update', 'delete'],
  role: ['view', 'update'],
  organization: ['view', 'create', 'update', 'delete'],
  event: ['view', 'create', 'update', 'delete', 'export'],
  event_category: ['view', 'create', 'update'],
  approval: ['view', 'approve'],
  registration: ['view', 'create', 'update', 'delete', 'export', 'waive'],
  group: ['view', 'create', 'update', 'approve', 'export'],
  participant_org: ['view', 'create', 'update', 'approve'],
  payment: ['view', 'verify', 'void', 'waive', 'export'],
  cashier: ['view', 'collect', 'void', 'approve'],
  finance_batch: ['view', 'create', 'submit', 'receive', 'reconcile', 'export'],
  receipt: ['view', 'create', 'update', 'void'],
  refund: ['view', 'create', 'approve', 'refund'],
  bank_account: ['view', 'create', 'update'],
  income_code: ['view', 'create', 'update'],
  checkin: ['view', 'create', 'update'],
  attendance: ['view', 'update', 'export'],
  badge: ['view', 'create', 'update', 'print', 'reprint'],
  certificate: ['view', 'create', 'update', 'void', 'export'],
  evaluation: ['view', 'create', 'update', 'export'],
  venue: ['view', 'create', 'update', 'approve'],
  report: ['view', 'export'],
  audit_log: ['view'],
  system_setting: ['view', 'update'],
};

export const ALL_PERMISSIONS = Object.entries(PERMISSION_CATALOGUE).flatMap(([r, actions]) =>
  actions.map((a) => `${r}:${a}` as PermissionCode),
);

const pick = (resources: string[], actions?: string[]) =>
  resources.flatMap((r) =>
    (PERMISSION_CATALOGUE[r] ?? []).filter((a) => !actions || actions.includes(a)).map((a) => `${r}:${a}`),
  );

const EVENT_MGMT = [
  ...pick(['event', 'registration', 'group', 'checkin', 'attendance', 'badge', 'certificate', 'evaluation']),
  ...pick(['participant_org'], ['view', 'approve']),
  ...pick(['venue', 'report', 'organization', 'event_category', 'approval'], ['view', 'export']),
  ...pick(['payment'], ['view']),
];

export const ROLES: { code: string; nameTh: string; description: string; permissions: string[] }[] = [
  { code: ROLE_CODES.SUPER_ADMIN, nameTh: 'ผู้ดูแลระบบสูงสุด', description: 'จัดการระบบทั้งหมด', permissions: ALL_PERMISSIONS },
  {
    code: ROLE_CODES.SYSTEM_ADMIN,
    nameTh: 'ผู้ดูแลระบบ',
    description: 'จัดการบัญชีและตั้งค่าระบบ',
    permissions: [...pick(['user', 'role', 'organization', 'event_category', 'system_setting', 'audit_log', 'venue']), ...pick(['event', 'report'], ['view'])],
  },
  {
    code: ROLE_CODES.EXECUTIVE,
    nameTh: 'ผู้บริหารมหาวิทยาลัย',
    description: 'ดูภาพรวมและอนุมัติ',
    permissions: [...pick(['event', 'registration', 'attendance', 'evaluation', 'organization', 'payment'], ['view']), ...pick(['report'], ['view', 'export']), ...pick(['approval'])],
  },
  { code: ROLE_CODES.CENTRAL_EVENT_ADMIN, nameTh: 'ผู้ดูแลกิจกรรมส่วนกลาง', description: 'จัดการกิจกรรมกลาง', permissions: [...EVENT_MGMT, ...pick(['event_category', 'venue'])] },
  { code: ROLE_CODES.ORG_ADMIN, nameTh: 'ผู้ดูแลกิจกรรมหน่วยงาน', description: 'จัดการกิจกรรมของหน่วยงาน', permissions: [...EVENT_MGMT, ...pick(['user'], ['view']), ...pick(['organization'], ['update'])] },
  { code: ROLE_CODES.EVENT_MANAGER, nameTh: 'ผู้จัดกิจกรรม', description: 'สร้างและบริหารกิจกรรม รวมถึงตั้งค่าค่าลงทะเบียน', permissions: EVENT_MGMT },
  { code: ROLE_CODES.APPROVER, nameTh: 'ผู้อนุมัติ', description: 'พิจารณาอนุมัติกิจกรรม', permissions: [...pick(['approval']), ...pick(['event', 'organization'], ['view'])] },
  {
    code: ROLE_CODES.FINANCE_OFFICER,
    nameTh: 'เจ้าหน้าที่กองคลัง',
    description: 'บัญชีรับเงิน รหัสรายได้ รับชุดนำส่ง บันทึกเลขที่ใบเสร็จ ยืนยันรับเงิน คืนเงิน',
    permissions: [
      ...pick(['bank_account', 'income_code', 'receipt', 'refund']),
      ...pick(['finance_batch'], ['view', 'receive', 'reconcile', 'export']),
      ...pick(['cashier'], ['view', 'approve']),
      ...pick(['payment'], ['view', 'export']),
      ...pick(['approval']),
      ...pick(['event', 'registration', 'report'], ['view', 'export']),
    ],
  },
  {
    code: ROLE_CODES.ORG_FINANCE_OFFICER,
    nameTh: 'เจ้าหน้าที่การเงินหน่วยงาน',
    description: 'ตรวจสอบหลักฐานการโอน จัดทำชุดนำส่ง ใบนำส่งเงิน กระทบยอด',
    permissions: [
      ...pick(['payment'], ['view', 'verify', 'export']),
      ...pick(['finance_batch'], ['view', 'create', 'submit', 'reconcile', 'export']),
      ...pick(['cashier'], ['view', 'approve', 'void']),
      ...pick(['refund'], ['view', 'create']),
      ...pick(['event', 'registration', 'report', 'receipt'], ['view', 'export']),
    ],
  },
  { code: ROLE_CODES.EVENT_CASHIER, nameTh: 'ผู้รับชำระหน้างาน', description: 'เปิด/ปิดกะ รับชำระหน้างาน ส่งมอบใบเสร็จ', permissions: [...pick(['cashier'], ['view', 'collect']), ...pick(['registration', 'event', 'receipt'], ['view']), ...pick(['receipt'], ['update']), ...pick(['checkin'], ['view', 'create'])] },
  { code: ROLE_CODES.EVENT_STAFF, nameTh: 'เจ้าหน้าที่ประจำงาน', description: 'Check-in และพิมพ์ป้ายชื่อ ณ จุดลงทะเบียน', permissions: [...pick(['checkin']), ...pick(['badge'], ['view', 'print']), ...pick(['registration', 'event', 'attendance'], ['view'])] },
  { code: ROLE_CODES.LECTURER_STAFF, nameTh: 'อาจารย์/บุคลากร', description: 'ลงทะเบียนเข้าร่วม', permissions: [] },
  { code: ROLE_CODES.STUDENT, nameTh: 'นักศึกษา', description: 'ลงทะเบียนและตรวจสอบประวัติ', permissions: [] },
  { code: ROLE_CODES.ORG_COORDINATOR, nameTh: 'ผู้ประสานงานองค์กร', description: 'ลงทะเบียนกลุ่มในนามองค์กร (Data Scope เฉพาะกลุ่มที่ตนดูแล)', permissions: [] },
  { code: ROLE_CODES.GUEST, nameTh: 'บุคคลภายนอก', description: 'ลงทะเบียนกิจกรรมที่เปิดรับบุคคลภายนอก', permissions: [] },
];
