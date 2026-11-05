import { decodeText, parseCsv, parseStatementAmount, parseStatementDate, parseStatementRows, planAutoMatches } from './statement-parser';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseStatementDate (Asia/Bangkok wall clock)', () => {
  it.each([
    ['05/11/2569', undefined, '2026-11-04T17:00:00.000Z'],
    ['05/11/2026', undefined, '2026-11-04T17:00:00.000Z'],
    ['05/11/69', '14:30', '2026-11-05T07:30:00.000Z'],
    ['05-11-26 09.15', undefined, '2026-11-05T02:15:00.000Z'],
    ['2026-11-05 14:30:15', undefined, '2026-11-05T07:30:15.000Z'],
    ['2569-11-05', '08:00:00', '2026-11-05T01:00:00.000Z'],
  ])('%s %s', (d, t, expected) => {
    expect(iso(parseStatementDate(d, t))).toBe(expected);
  });

  it('reads spreadsheet dates and Excel serials as wall-clock time', () => {
    expect(iso(parseStatementDate(new Date(Date.UTC(2026, 10, 5, 14, 30))))).toBe('2026-11-05T07:30:00.000Z');
    expect(iso(parseStatementDate(46331.5))).toBe('2026-11-05T05:00:00.000Z');
  });

  it('rejects impossible dates and times', () => {
    expect(parseStatementDate('31/02/2569')).toBeNull();
    expect(parseStatementDate('05/11/2569', '25:00')).toBeNull();
    expect(parseStatementDate('yesterday')).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it.each([
    ['1,500.00', '1500.00'],
    ['฿1,500', '1500.00'],
    ['1500.5', '1500.50'],
    ['(200.00)', '-200.00'],
    ['-35', '-35.00'],
    [1500, '1500.00'],
    ['', null],
    ['-', null],
    ['1.234', undefined],
    ['abc', undefined],
  ])('%s → %s', (v, expected) => {
    expect(parseStatementAmount(v)).toBe(expected);
  });
});

describe('parseStatementRows', () => {
  it('finds the header below a preamble, keeps credits only, skips summaries', () => {
    const rows = [
      ['ธนาคารตัวอย่าง', 'Statement'],
      ['เลขที่บัญชี', '000-0-00000-0'],
      ['วันที่', 'เวลา', 'รายละเอียด', 'ถอน', 'ฝาก', 'คงเหลือ', 'เลขอ้างอิง'],
      ['01/11/2569', '09:15', 'โอนเข้า นาย ก', '', '1,500.00', '10,000.00', 'REF1'],
      ['01/11/2569', '09:20', 'ค่าธรรมเนียม', '10.00', '', '9,990.00', ''],
      ['', '', 'ยอดยกไป', '', '', '9,990.00', ''],
      ['02/11/2569', '10:00:30', 'โอนเข้า นาง ข', '', '800', '10,790.00', 'REF2'],
      [],
    ];
    const r = parseStatementRows(rows);
    expect(r.errors).toEqual([]);
    expect(r.skippedDebit).toBe(1);
    expect(r.lines.map((l) => [l.row, iso(l.txnAt), l.amount, l.reference])).toEqual([
      [4, '2026-11-01T02:15:00.000Z', '1500.00', 'REF1'],
      [7, '2026-11-02T03:00:30.000Z', '800.00', 'REF2'],
    ]);
  });

  it('supports a single signed amount column (English headers)', () => {
    const r = parseStatementRows([
      ['Date', 'Description', 'Amount'],
      ['2026-11-01 08:00', 'IN', '500.00'],
      ['2026-11-01 09:00', 'OUT', '-20.00'],
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.skippedDebit).toBe(1);
  });

  it('reports unreadable rows instead of importing half a file', () => {
    const r = parseStatementRows([
      ['วันที่', 'ฝาก'],
      ['01/11/2569', '1.234'],
      ['99/99/2569', '100'],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it('fails clearly without a header row', () => {
    expect(parseStatementRows([['a', 'b']]).errors[0]!.row).toBe(0);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, CRLF and semicolons', () => {
    expect(parseCsv('a;"b;c";"say ""hi"""\r\n1;2;3\r\n')).toEqual([
      ['a', 'b;c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
  it('decodes UTF-8 with BOM and falls back to Windows-874', () => {
    expect(decodeText(Buffer.from('﻿วันที่', 'utf8'))).toBe('วันที่');
    // "ฝาก" in TIS-620: ฝ=0xBD า=0xD2 ก=0xA1
    expect(decodeText(Buffer.from([0xbd, 0xd2, 0xa1]))).toBe('ฝาก');
  });
});

describe('planAutoMatches', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 5, h, m));
  const tol = 15 * 60_000;

  it('pairs same amount within the tolerance, closest first, one-to-one', () => {
    const out = planAutoMatches(
      [
        { id: 'L1', txnAt: at(9, 0), amount: '1500.00' },
        { id: 'L2', txnAt: at(9, 10), amount: '1500.00' },
        { id: 'L3', txnAt: at(12, 0), amount: '800.00' },
      ],
      [
        { id: 'P1', amount: '1500.00', transferredAt: at(9, 9), submittedAt: at(9, 30) },
        { id: 'P2', amount: '1500.00', transferredAt: at(9, 2), submittedAt: at(9, 30) },
        { id: 'P3', amount: '800.00', transferredAt: at(13, 0), submittedAt: at(13, 5) },
      ],
      tol,
    );
    expect(out).toEqual(
      expect.arrayContaining([
        { lineId: 'L2', paymentId: 'P1' },
        { lineId: 'L1', paymentId: 'P2' },
      ]),
    );
    expect(out).toHaveLength(2); // P3 is an hour off
  });

  it('uses the 24 h before the slip upload when the transfer time is unknown', () => {
    const out = planAutoMatches(
      [{ id: 'L1', txnAt: at(8), amount: '500.00' }],
      [{ id: 'P1', amount: '500.00', transferredAt: null, submittedAt: at(20) }],
      tol,
    );
    expect(out).toEqual([{ lineId: 'L1', paymentId: 'P1' }]);
  });

  it('leaves ties for an officer', () => {
    const out = planAutoMatches(
      [{ id: 'L1', txnAt: at(9), amount: '500.00' }],
      [
        { id: 'P1', amount: '500.00', transferredAt: at(9, 5), submittedAt: at(10) },
        { id: 'P2', amount: '500.00', transferredAt: at(8, 55), submittedAt: at(10) },
      ],
      tol,
    );
    expect(out).toEqual([]);
  });
});
