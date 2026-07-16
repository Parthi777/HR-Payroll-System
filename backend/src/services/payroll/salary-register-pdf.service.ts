import PDFDocument from 'pdfkit';

export interface RegisterRow {
  employeeCode: string;
  name: string;
  branch: string;
  presentDays: number;
  lateDays: number;
  otHours: number;
  otPay: number;
  sundayPay: number;
  basicSalary: number;
  hra: number;
  da: number;
  otherAllowances: number;
  grossSalary: number;
  pfDeduction: number;
  esiDeduction: number;
  netSalary: number;
  payDate: Date | null;
  status: string;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "Rs." not ₹ — standard PDF fonts lack the rupee glyph.
const rs = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '-';

interface Col { key: string; label: string; w: number; align?: 'right' | 'left'; }
const COLS: Col[] = [
  { key: 'emp', label: 'Employee', w: 128 },
  { key: 'presentDays', label: 'Days', w: 30, align: 'right' },
  { key: 'lateDays', label: 'Late', w: 28, align: 'right' },
  { key: 'otHours', label: 'OT h', w: 32, align: 'right' },
  { key: 'extra', label: 'OT+Sun', w: 52, align: 'right' },
  { key: 'basicSalary', label: 'Basic', w: 55, align: 'right' },
  { key: 'hra', label: 'HRA', w: 50, align: 'right' },
  { key: 'da', label: 'DA', w: 48, align: 'right' },
  { key: 'otherAllowances', label: 'Other', w: 55, align: 'right' },
  { key: 'grossSalary', label: 'Gross', w: 60, align: 'right' },
  { key: 'pfDeduction', label: 'PF', w: 45, align: 'right' },
  { key: 'esiDeduction', label: 'ESI', w: 42, align: 'right' },
  { key: 'netSalary', label: 'Net (Rs.)', w: 62, align: 'right' },
  { key: 'payDate', label: 'Pay Date', w: 50 },
  { key: 'status', label: '', w: 30 },
];

/** Landscape A4 salary register: one row per employee + totals, for accounts/bank use. */
export function generateSalaryRegisterPdf(month: number, year: number, rows: RegisterRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#2F55F4';
    const left = 28;
    const company = process.env.COMPANY_NAME ?? 'AI HR Payroll';

    const drawHeader = () => {
      doc.fillColor('#1c1b2e').fontSize(15).font('Helvetica-Bold').text(company, left, 26);
      doc.fontSize(10).font('Helvetica').fillColor('#555')
        .text(`Salary Register — ${MONTHS[month]} ${year} · ${rows.length} employee(s) · amounts in Rs.`, left, 46);
      let x = left;
      const y = 68;
      doc.rect(left, y, COLS.reduce((s, c) => s + c.w, 0), 16).fill(brand);
      doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
      for (const c of COLS) {
        doc.text(c.label, x + 3, y + 4.5, { width: c.w - 6, align: c.align ?? 'left' });
        x += c.w;
      }
      doc.font('Helvetica');
      return y + 16;
    };

    let y = drawHeader();
    const rowH = 15;

    const cell = (r: RegisterRow, key: string): string => {
      switch (key) {
        case 'emp': return `${r.employeeCode}  ${r.name}`;
        case 'extra': return rs(r.otPay + r.sundayPay);
        case 'payDate': return fmtDate(r.payDate);
        case 'status': return r.status === 'WITHHELD' ? 'WH*' : '';
        case 'otHours': return r.otHours ? String(r.otHours) : '-';
        case 'lateDays': return r.lateDays ? String(r.lateDays) : '-';
        case 'presentDays': return String(r.presentDays);
        default: return rs((r as unknown as Record<string, number>)[key] ?? 0);
      }
    };

    rows.forEach((r, i) => {
      if (y > 545) {
        doc.addPage();
        y = drawHeader();
      }
      if (i % 2 === 1) doc.rect(left, y, COLS.reduce((s, c) => s + c.w, 0), rowH).fill('#f3f5fb');
      doc.fillColor(r.status === 'WITHHELD' ? '#b91c1c' : '#1c1b2e').fontSize(7.5);
      let x = left;
      for (const c of COLS) {
        doc.text(cell(r, c.key), x + 3, y + 4, { width: c.w - 6, align: c.align ?? 'left', lineBreak: false });
        x += c.w;
      }
      y += rowH;
    });

    // Totals row
    const sum = (f: (r: RegisterRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    doc.rect(left, y, COLS.reduce((s, c) => s + c.w, 0), rowH + 2).fill('#e8edff');
    doc.fillColor('#1c1b2e').font('Helvetica-Bold').fontSize(7.5);
    let x = left;
    const totals: Record<string, string> = {
      emp: `TOTAL (${rows.length})`,
      extra: rs(sum((r) => r.otPay + r.sundayPay)),
      basicSalary: rs(sum((r) => r.basicSalary)),
      hra: rs(sum((r) => r.hra)),
      da: rs(sum((r) => r.da)),
      otherAllowances: rs(sum((r) => r.otherAllowances)),
      grossSalary: rs(sum((r) => r.grossSalary)),
      pfDeduction: rs(sum((r) => r.pfDeduction)),
      esiDeduction: rs(sum((r) => r.esiDeduction)),
      netSalary: rs(sum((r) => r.netSalary)),
    };
    for (const c of COLS) {
      doc.text(totals[c.key] ?? '', x + 3, y + 5, { width: c.w - 6, align: c.align ?? 'left', lineBreak: false });
      x += c.w;
    }
    y += rowH + 12;
    doc.font('Helvetica').fontSize(7).fillColor('#777')
      .text('* WH = payslip withheld under the late-punch policy (amounts computed, payment held — contact HR).', left, y);

    doc.end();
  });
}
