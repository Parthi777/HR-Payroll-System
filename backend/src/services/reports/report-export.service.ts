/**
 * Report exporters — real .xlsx (ExcelJS) and real .pdf (PDFKit) for the two
 * monthly reports. CSV stays available client-side; these two are what payroll
 * and the owner actually file.
 *
 * PDF note: the built-in Helvetica has no rupee glyph, so amounts are labelled
 * "Rs." rather than "₹" (same convention as the salary register).
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { PayrollReport, PayrollReportRow } from './payroll-report.service.js';
import type { MusterCode, MusterReport } from './muster-report.service.js';

const BRAND = 'FF2F55F4';
const BRAND_HEX = '#2F55F4';
const INK = '#1c1b2e';

const rs = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** Fractional day counts read better as "2.5" / "20" than "20.00". */
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ─────────────────────────────────────────────────────────────
// Generic table export — used by the simple reports (daily, monthly,
// late punches, per-employee) so every report offers xlsx and pdf too.
// ─────────────────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  /** Relative width. Used for the xlsx column width and the pdf column share. */
  width?: number;
  align?: 'left' | 'right';
}

export interface TableExport {
  title: string;
  subtitle?: string;
  company?: { name: string; address: string };
  columns: TableColumn[];
  rows: (string | number | null)[][];
  /** Rendered under the table. */
  note?: string;
}

export async function tableXlsx(t: TableExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = t.company?.name ?? 'AI HR Payroll';
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 30).replace(/[\\/*?:[\]]/g, '-'), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = t.columns.map((c) => ({ width: c.width ?? Math.max(12, c.header.length + 4) }));
  const lastCol = t.columns.length;

  const title = ws.addRow([t.company?.name || t.title]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, lastCol);
  const sub = ws.addRow([[t.title, t.subtitle].filter(Boolean).join(' — ')]);
  sub.font = { size: 10, color: { argb: 'FF666666' } };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.addRow([]);

  const head = ws.addRow(t.columns.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 24;
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  });

  for (const r of t.rows) {
    const row = ws.addRow(r.map((v) => v ?? ''));
    row.eachCell((cell, i) => {
      if (t.columns[i - 1]?.align === 'right') cell.alignment = { horizontal: 'right' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } };
    });
  }

  if (t.note) {
    ws.addRow([]);
    const note = ws.addRow([t.note]);
    note.font = { size: 8, italic: true, color: { argb: 'FF666666' } };
    ws.mergeCells(note.number, 1, note.number, lastCol);
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function tablePdf(t: TableExport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 28;
    const tableW = 842 - left * 2;
    const totalWeight = t.columns.reduce((s, c) => s + (c.width ?? 14), 0);
    const widths = t.columns.map((c) => ((c.width ?? 14) / totalWeight) * tableW);

    const drawHeader = (): number => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(t.company?.name || t.title, left, 22);
      if (t.company?.address) {
        doc.font('Helvetica').fontSize(8).fillColor('#777').text(t.company.address, left, 40);
      }
      doc.font('Helvetica').fontSize(9.5).fillColor('#555')
        .text([t.title, t.subtitle].filter(Boolean).join(' — '), left, t.company?.address ? 52 : 44);
      const y = 68;
      doc.rect(left, y, tableW, 17).fill(BRAND_HEX);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
      let x = left;
      t.columns.forEach((c, i) => {
        doc.text(c.header, x + 3, y + 5, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false });
        x += widths[i];
      });
      doc.font('Helvetica');
      return y + 17;
    };

    let y = drawHeader();
    const rowH = 15;

    t.rows.forEach((r, ri) => {
      if (y > 540) {
        doc.addPage();
        y = drawHeader();
      }
      if (ri % 2 === 1) doc.rect(left, y, tableW, rowH).fill('#f3f5fb');
      doc.fillColor(INK).font('Helvetica').fontSize(7.5);
      let x = left;
      t.columns.forEach((c, i) => {
        doc.text(String(r[i] ?? ''), x + 3, y + 4.5, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false });
        x += widths[i];
      });
      y += rowH;
    });

    if (t.note) {
      doc.font('Helvetica').fontSize(7).fillColor('#777').text(t.note, left, y + 10, { width: tableW });
    }
    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────
// Payroll summary
// ─────────────────────────────────────────────────────────────

interface PayrollCol {
  header: string;
  width: number;
  value: (r: PayrollReportRow) => string | number;
  numeric?: boolean;
  money?: boolean;
}

const PAYROLL_COLS: PayrollCol[] = [
  { header: 'Emp Code', width: 12, value: (r) => r.employeeCode },
  { header: 'Employee Name', width: 24, value: (r) => r.name },
  { header: 'Branch', width: 18, value: (r) => r.branch },
  { header: 'Designation', width: 18, value: (r) => r.designation },
  { header: 'Department', width: 16, value: (r) => r.department },
  { header: 'Days in Month', width: 12, value: (r) => r.daysInMonth, numeric: true },
  { header: 'Days Served', width: 11, value: (r) => r.servedDays, numeric: true },
  { header: 'Present Days', width: 12, value: (r) => r.presentDays, numeric: true },
  { header: 'Absent Days', width: 12, value: (r) => r.absentDays, numeric: true },
  { header: 'Held (PN)', width: 10, value: (r) => r.pendingDays, numeric: true },
  { header: 'CL Days', width: 10, value: (r) => r.clDays, numeric: true },
  { header: 'Leave Deduction', width: 15, value: (r) => r.leaveDeduction, numeric: true, money: true },
  { header: 'OT Hours', width: 10, value: (r) => r.otHours, numeric: true },
  { header: 'Sun Duty', width: 10, value: (r) => r.sundayDays, numeric: true },
  { header: 'Salary', width: 14, value: (r) => r.salary, numeric: true, money: true },
  { header: 'Per Day Salary', width: 14, value: (r) => r.perDaySalary, numeric: true, money: true },
  { header: 'OT Salary', width: 14, value: (r) => r.otSalary, numeric: true, money: true },
  { header: 'Payable', width: 15, value: (r) => r.payable, numeric: true, money: true },
];

export async function payrollReportXlsx(report: PayrollReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.company.name;
  wb.created = new Date();
  const ws = wb.addWorksheet(`Payroll ${report.label}`, {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = PAYROLL_COLS.map((c) => ({ width: c.width }));
  const lastCol = PAYROLL_COLS.length;

  const title = ws.addRow([report.company.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, lastCol);
  const sub = ws.addRow([`Payroll Summary — ${report.label} · ${report.rows.length} active employee(s) · amounts in INR`]);
  sub.font = { size: 10, color: { argb: 'FF666666' } };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.addRow([]);

  const head = ws.addRow(PAYROLL_COLS.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 26;
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
  });

  for (const r of report.rows) {
    const row = ws.addRow(PAYROLL_COLS.map((c) => c.value(r)));
    row.eachCell((cell, i) => {
      const col = PAYROLL_COLS[i - 1];
      if (col?.money) cell.numFmt = '#,##0.00';
      if (col?.numeric) cell.alignment = { horizontal: 'right' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } };
    });
    if (r.withheld) {
      row.font = { color: { argb: 'FFB91C1C' } };
    }
  }

  const t = report.totals;
  // Positional — keep in step with PAYROLL_COLS above.
  const totalRow = ws.addRow([
    '', `TOTAL (${t.employees})`, '', '', '', '', '', '', t.absentDays, '', '', t.leaveDeduction,
    t.otHours, '', t.salary, '', t.otSalary, t.payable,
  ]);
  totalRow.font = { bold: true };
  totalRow.eachCell((cell, i) => {
    const col = PAYROLL_COLS[i - 1];
    if (col?.money) cell.numFmt = '#,##0.00';
    if (col?.numeric) cell.alignment = { horizontal: 'right' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDFF' } };
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function payrollReportPdf(report: PayrollReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 24;
    // Widths must total <= A4 landscape minus margins (842 - 2*24 = 794), or the
    // right-hand money columns fall off the page.
    const cols: { label: string; w: number; align?: 'left' | 'right'; get: (r: PayrollReportRow) => string }[] = [
      { label: 'Code', w: 60, get: (r) => r.employeeCode },
      { label: 'Employee', w: 90, get: (r) => r.name },
      { label: 'Branch', w: 66, get: (r) => r.branch },
      { label: 'Designation', w: 58, get: (r) => r.designation },
      { label: 'Department', w: 50, get: (r) => r.department },
      { label: 'Served', w: 30, align: 'right', get: (r) => String(r.servedDays) },
      { label: 'Present', w: 34, align: 'right', get: (r) => days(r.presentDays) },
      { label: 'Absent', w: 34, align: 'right', get: (r) => days(r.absentDays) },
      { label: 'Held', w: 26, align: 'right', get: (r) => (r.pendingDays ? String(r.pendingDays) : '-') },
      { label: 'CL', w: 22, align: 'right', get: (r) => days(r.clDays) },
      { label: 'Leave Ded.', w: 52, align: 'right', get: (r) => rs(r.leaveDeduction) },
      { label: 'OT h', w: 30, align: 'right', get: (r) => days(r.otHours) },
      { label: 'Sun', w: 22, align: 'right', get: (r) => String(r.sundayDays) },
      { label: 'Salary', w: 58, align: 'right', get: (r) => rs(r.salary) },
      { label: 'Per Day', w: 46, align: 'right', get: (r) => rs(r.perDaySalary) },
      { label: 'OT Salary', w: 52, align: 'right', get: (r) => rs(r.otSalary) },
      { label: 'Payable', w: 62, align: 'right', get: (r) => rs(r.payable) },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);

    const drawHeader = (): number => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(report.company.name, left, 20);
      if (report.company.address) {
        doc.font('Helvetica').fontSize(8).fillColor('#777').text(report.company.address, left, 38);
      }
      doc.font('Helvetica').fontSize(9.5).fillColor('#555').text(
        `Payroll Summary — ${report.label} · ${report.rows.length} active employee(s) · amounts in Rs.`,
        left,
        report.company.address ? 50 : 42,
      );
      const y = 66;
      doc.rect(left, y, tableW, 17).fill(BRAND_HEX);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.8);
      let x = left;
      for (const c of cols) {
        doc.text(c.label, x + 2, y + 5, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
        x += c.w;
      }
      doc.font('Helvetica');
      return y + 17;
    };

    let y = drawHeader();
    const rowH = 14;

    report.rows.forEach((r, i) => {
      if (y > 540) {
        doc.addPage();
        y = drawHeader();
      }
      if (i % 2 === 1) doc.rect(left, y, tableW, rowH).fill('#f3f5fb');
      doc.fillColor(r.withheld ? '#b91c1c' : INK).font('Helvetica').fontSize(7);
      let x = left;
      for (const c of cols) {
        doc.text(c.get(r), x + 2, y + 4, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
        x += c.w;
      }
      y += rowH;
    });

    // Totals
    if (y > 535) {
      doc.addPage();
      y = drawHeader();
    }
    const t = report.totals;
    const totals: Record<string, string> = {
      Employee: `TOTAL (${t.employees})`,
      Absent: days(t.absentDays),
      'Leave Ded.': rs(t.leaveDeduction),
      'OT h': days(t.otHours),
      Salary: rs(t.salary),
      'OT Salary': rs(t.otSalary),
      Payable: rs(t.payable),
    };
    doc.rect(left, y, tableW, rowH + 2).fill('#e8edff');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7);
    let x = left;
    for (const c of cols) {
      doc.text(totals[c.label] ?? '', x + 2, y + 5, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
      x += c.w;
    }
    y += rowH + 12;
    doc.font('Helvetica').fontSize(6.8).fillColor('#777').text(
      'Served = days of the month the employee was on the rolls (a mid-month joiner is paid pro-rata; days before joining are neither paid nor absent). ' +
        'Absent days include the unworked half of a half day (e.g. 2 absences + 1 half day = 2.5) and Held days. ' +
        'Held = punches awaiting approval — unpaid until signed off, then re-run payroll to pay them. ' +
        'Sundays are paid weekly-offs; Sunday duty pays one extra full day, included in OT Salary. ' +
        'Red rows = payslip withheld under the late-punch policy.',
      left,
      y,
      { width: tableW },
    );

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────
// Monthly performance (muster roll)
// ─────────────────────────────────────────────────────────────

/** Grid colours, mirroring the on-screen status chips. */
const CODE_COLOR: Record<string, { pdf: string; argb: string }> = {
  P: { pdf: '#15803d', argb: 'FF15803D' },
  'HL*': { pdf: '#15803d', argb: 'FF15803D' },
  'WO*': { pdf: '#15803d', argb: 'FF15803D' },
  HD: { pdf: '#b45309', argb: 'FFB45309' },
  PN: { pdf: '#b45309', argb: 'FFB45309' },
  A: { pdf: '#dc2626', argb: 'FFDC2626' },
  LOP: { pdf: '#dc2626', argb: 'FFDC2626' },
  WO: { pdf: '#2563eb', argb: 'FF2563EB' },
  HL: { pdf: '#7c3aed', argb: 'FF7C3AED' },
  LV: { pdf: '#7c3aed', argb: 'FF7C3AED' },
};
const codeColor = (c: MusterCode) => CODE_COLOR[c] ?? { pdf: INK, argb: 'FF1C1B2E' };

const LEGEND =
  'P = Present · HD = Half day (0.5) · A = Absent · WO = Weekly off (Sunday, paid) · WO* = Sunday duty (pays one extra full day) · ' +
  'HL = Holiday · HL* = Holiday worked · LV = Paid leave · LOP = Loss of pay (unpaid) · ' +
  'PN = Awaiting approval (unpaid, counted under Absent until signed off) · # = manual/selfie punch · ' +
  'blank = before joining, or a date still to come.   Present + Absent + WO + HL + LV + LOP = days served this month.';

export async function musterReportXlsx(report: MusterReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.company.name;
  wb.created = new Date();
  const ws = wb.addWorksheet(`Performance ${report.label}`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const n = report.daysInMonth;
  // Column 1 = row label, columns 2..n+1 = the days of the month.
  ws.getColumn(1).width = 16;
  for (let i = 0; i < n; i++) ws.getColumn(i + 2).width = 6.5;

  for (const emp of report.employees) {
    // Block header 1 — department / company / report month
    const h1 = ws.addRow(['Dept. Name', emp.department, '', '', 'CompName', report.company.name, '', '', 'Report Month', report.label]);
    h1.font = { bold: true, size: 9 };
    h1.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF5' } };
    });

    // Block header 2 — identity + monthly totals
    const h2 = ws.addRow([
      'Empcode', emp.employeeCode, 'Name', emp.name, 'Branch', emp.branch, 'Designation', emp.designation,
      'Present', emp.present, 'WO', emp.weeklyOff, 'HL', emp.holidays, 'LV', emp.leave, 'LOP', emp.lop,
      'PN', emp.pending, 'Absent', emp.absent, 'Paid Days', emp.paidDays, 'Sun Duty', emp.sundayDuty,
      'Served', emp.servedDays, 'Tot. Work+OT', emp.totalWorkPlusOt, 'Total OT', emp.totalOt,
    ]);
    h2.font = { size: 9 };
    h2.eachCell((cell, i) => {
      if (i % 2 === 1) cell.font = { bold: true, size: 9 };
    });

    ws.addRow(['', ...emp.days.map((d) => d.day)]).font = { bold: true, size: 8 };
    ws.addRow(['', ...emp.days.map((d) => d.weekday)]).font = { size: 8, color: { argb: 'FF666666' } };

    const grid: [string, (d: MusterReport['employees'][number]['days'][number]) => string][] = [
      ['IN', (d) => d.inTime],
      ['OUT', (d) => d.outTime],
      ['WORK', (d) => d.work],
      ['Break', (d) => d.break],
      ['OT', (d) => d.ot],
    ];
    for (const [label, get] of grid) {
      const row = ws.addRow([label, ...emp.days.map(get)]);
      row.font = { size: 8 };
      row.getCell(1).font = { bold: true, size: 8 };
      row.alignment = { horizontal: 'center' };
    }

    const statusRow = ws.addRow(['Status', ...emp.days.map((d) => (d.manual && d.status ? `${d.status}#` : d.status))]);
    statusRow.getCell(1).font = { bold: true, size: 8 };
    statusRow.alignment = { horizontal: 'center' };
    emp.days.forEach((d, i) => {
      statusRow.getCell(i + 2).font = { bold: true, size: 8, color: { argb: codeColor(d.status).argb } };
    });

    ws.addRow([]);
  }

  const legend = ws.addRow([LEGEND]);
  legend.font = { size: 8, italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(legend.number, 1, legend.number, n + 1);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function musterReportPdf(report: MusterReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 18 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 18;
    const labelW = 44;
    const n = report.daysInMonth;
    const dayW = (842 - left * 2 - labelW) / n; // A4 landscape is 842 x 595 pt
    const tableW = labelW + dayW * n;
    const pageBottom = 560;

    const rowH = 11;
    // 2 header rows + day + weekday + 5 grid rows + status = 10 rows, then the gap.
    const blockH = rowH * 10 + 14;

    const drawPageHeader = (): number => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(report.company.name, left, 16);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(
        `Monthly Performance — ${report.label} · ${report.employees.length} active employee(s)`,
        left,
        33,
      );
      return 50;
    };

    let y = drawPageHeader();

    const cellText = (text: string, x: number, yy: number, w: number, color = INK, bold = false) => {
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(text, x, yy, { width: w, align: 'center', lineBreak: false });
    };

    for (const emp of report.employees) {
      if (y + blockH > pageBottom) {
        doc.addPage();
        y = drawPageHeader();
      }

      // ── Block header: identity + totals ──
      doc.rect(left, y, tableW, rowH).fill('#edeff5');
      doc.fillColor(INK).fontSize(7).font('Helvetica-Bold');
      doc.text(`Dept: ${emp.department}`, left + 3, y + 3.5, { width: tableW / 3, lineBreak: false });
      doc.text(`${report.company.name}`, left + tableW / 3, y + 3.5, { width: tableW / 3, align: 'center', lineBreak: false });
      doc.text(`Report Month: ${report.label}`, left + (tableW * 2) / 3, y + 3.5, { width: tableW / 3 - 4, align: 'right', lineBreak: false });
      y += rowH;

      doc.fontSize(7).font('Helvetica');
      doc.fillColor(INK);
      const idLine =
        `Empcode: ${emp.employeeCode}   Name: ${emp.name}   Branch: ${emp.branch}   Designation: ${emp.designation}`;
      const totLine =
        `Present ${days(emp.present)}  ·  WO ${emp.weeklyOff}  ·  HL ${emp.holidays}  ·  LV ${emp.leave}  ·  ` +
        (emp.lop ? `LOP ${days(emp.lop)}  ·  ` : '') +
        (emp.pending ? `PN ${emp.pending}  ·  ` : '') +
        `Absent ${days(emp.absent)}  ·  Paid ${days(emp.paidDays)}  ·  Sun Duty ${emp.sundayDuty}  ·  ` +
        `Served ${emp.servedDays}  ·  Work+OT ${emp.totalWorkPlusOt}  ·  OT ${emp.totalOt}`;
      doc.font('Helvetica-Bold').text(idLine, left + 3, y + 3, { width: tableW * 0.5, lineBreak: false });
      doc.font('Helvetica').fillColor('#333').text(totLine, left + tableW * 0.5, y + 3, {
        width: tableW * 0.5 - 4,
        align: 'right',
        lineBreak: false,
      });
      y += rowH;

      // ── Day / weekday header ──
      doc.rect(left, y, tableW, rowH).fill(BRAND_HEX);
      doc.fontSize(5.6);
      cellText('', left, y, labelW, '#ffffff', true);
      emp.days.forEach((d, i) => cellText(String(d.day), left + labelW + i * dayW, y + 3.5, dayW, '#ffffff', true));
      y += rowH;

      doc.fontSize(5.2);
      emp.days.forEach((d, i) =>
        cellText(d.weekday, left + labelW + i * dayW, y + 3.5, dayW, d.isSunday ? '#2563eb' : '#777'),
      );
      y += rowH;

      // ── IN / OUT / WORK / Break / OT ──
      const grid: [string, (d: (typeof emp.days)[number]) => string][] = [
        ['IN', (d) => d.inTime],
        ['OUT', (d) => d.outTime],
        ['WORK', (d) => d.work],
        ['Break', (d) => d.break],
        ['OT', (d) => d.ot],
      ];
      grid.forEach(([label, get], gi) => {
        if (gi % 2 === 1) doc.rect(left, y, tableW, rowH).fill('#f6f7fb');
        doc.fontSize(5.4).fillColor(INK).font('Helvetica-Bold');
        doc.text(label, left + 3, y + 3.5, { width: labelW - 6, lineBreak: false });
        emp.days.forEach((d, i) => cellText(get(d), left + labelW + i * dayW, y + 3.5, dayW, '#333'));
        y += rowH;
      });

      // ── Status letters ──
      doc.fontSize(5.4).fillColor(INK).font('Helvetica-Bold');
      doc.text('Status', left + 3, y + 3.5, { width: labelW - 6, lineBreak: false });
      emp.days.forEach((d, i) =>
        cellText(
          d.manual && d.status ? `${d.status}#` : d.status,
          left + labelW + i * dayW,
          y + 3.5,
          dayW,
          codeColor(d.status).pdf,
          true,
        ),
      );
      y += rowH;

      doc.rect(left, y, tableW, 0.6).fill('#dddddd');
      y += 14;
    }

    if (y + 20 > pageBottom) {
      doc.addPage();
      y = drawPageHeader();
    }
    doc.font('Helvetica').fontSize(6).fillColor('#777').text(LEGEND, left, y, { width: tableW });

    doc.end();
  });
}
