import type { FieldWithOptions } from '../registrations/answers';
import { parseMemberRows, templateHeaders } from './group-import';

const field = (over: Partial<FieldWithOptions>): FieldWithOptions =>
  ({
    id: over.key ?? 'f',
    eventId: 'e',
    key: 'shirt',
    labelTh: 'ขนาดเสื้อ',
    fieldType: 'SELECT',
    isRequired: false,
    helpText: null,
    maxLength: null,
    sortOrder: 0,
    isActive: true,
    options: [],
    ...over,
  }) as FieldWithOptions;

const spec = {
  fields: [
    field({ id: 'f1', key: 'shirt', labelTh: 'ขนาดเสื้อ', isRequired: true, options: [{ id: 'o1', fieldId: 'f1', value: 'M', labelTh: 'กลาง', sortOrder: 0 }, { id: 'o2', fieldId: 'f1', value: 'L', labelTh: 'ใหญ่', sortOrder: 1 }] }),
    field({ id: 'f2', key: 'food', labelTh: 'อาหาร', fieldType: 'CHECKBOX', options: [{ id: 'o3', fieldId: 'f2', value: 'veg', labelTh: 'มังสวิรัติ', sortOrder: 0 }, { id: 'o4', fieldId: 'f2', value: 'halal', labelTh: 'ฮาลาล', sortOrder: 1 }] }),
  ],
  participantTypes: [
    { code: 'EXTERNAL', nameTh: 'บุคคลภายนอก' },
    { code: 'SCHOOL_STUDENT', nameTh: 'นักเรียน' },
  ],
};
const header = templateHeaders(spec);

describe('group member import parser', () => {
  it('builds the template header with required markers and event questions', () => {
    expect(header).toEqual([
      'คำนำหน้า', 'ชื่อ *', 'นามสกุล *', 'อีเมล *', 'โทรศัพท์', 'ประเภทผู้เข้าร่วม *', 'รหัสนักศึกษา/บุคลากร', 'หน่วยงาน/สังกัด', 'หลักสูตร/สาขา/ชั้นเรียน', 'ขนาดเสื้อ *', 'อาหาร',
    ]);
  });

  it('parses a valid row: type by Thai name, option by label, multi-values, phone leading zero', () => {
    const { rows } = parseMemberRows([header, ['ด.ช.', 'สมชาย', 'ใจดี', 'a@x.com', 812345678, 'นักเรียน', '', 'โรงเรียน ก', 'ม.6', 'กลาง', 'veg, ฮาลาล']], spec);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errors).toBeNull();
    expect(rows[0]!.member).toMatchObject({
      participantTypeCode: 'SCHOOL_STUDENT',
      phone: '0812345678',
      answers: [{ key: 'shirt', value: 'กลาง' }, { key: 'food', value: ['veg', 'ฮาลาล'] }],
    });
    expect(rows[0]!.rowNo).toBe(2);
  });

  it('reports every problem of a row and duplicate e-mails within the file', () => {
    const { rows } = parseMemberRows(
      [
        header,
        ['', 'ก', 'ข', 'a@x.com', '', 'EXTERNAL', '', '', '', 'XXL', ''],
        ['', '', 'ค', 'A@X.com', '12', 'ครู', '', '', '', '', ''],
        [],
      ],
      spec,
    );
    expect(rows).toHaveLength(2); // blank line skipped
    expect(rows[0]!.errors).toEqual({ ขนาดเสื้อ: 'ตัวเลือกไม่ถูกต้อง' });
    expect(rows[1]!.errors).toMatchObject({ ชื่อ: 'จำเป็นต้องกรอก', อีเมล: 'ซ้ำกับแถวที่ 2', โทรศัพท์: 'เบอร์โทรศัพท์ไม่ถูกต้อง' });
    expect(rows[1]!.errors!['ประเภทผู้เข้าร่วม']).toContain('ไม่รู้จัก');
    expect(rows[1]!.member).toBeNull();
  });

  it('accepts reordered columns and rejects a sheet without required columns', () => {
    const { rows } = parseMemberRows([['อีเมล', 'นามสกุล', 'ชื่อ', 'ประเภทผู้เข้าร่วม'], ['b@x.com', 'ข', 'ก', 'EXTERNAL']], { ...spec, fields: [] });
    expect(rows[0]!.member).toMatchObject({ email: 'b@x.com', firstName: 'ก', lastName: 'ข' });
    expect(parseMemberRows([['ชื่อ', 'นามสกุล']], spec).headerErrors).toEqual(['ไม่พบคอลัมน์ "อีเมล"', 'ไม่พบคอลัมน์ "ประเภทผู้เข้าร่วม"']);
  });
});
