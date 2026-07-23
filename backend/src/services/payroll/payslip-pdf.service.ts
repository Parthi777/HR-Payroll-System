import PDFDocument from 'pdfkit';

export interface PayslipPdfData {
  month: number;
  year: number;
  presentDays: number;
  absentDays: number;
  lopDays: number;
  basicSalary: number;
  hra: number;
  da: number;
  otherAllowances: number;
  grossSalary: number;
  pfDeduction: number;
  esiDeduction: number;
  ptDeduction: number;
  tdsDeduction: number;
  otherDeductions: number;
  netSalary: number;
  employee: { name: string; employeeCode: string; branch?: { name: string } | null };
  company?: { name: string; address: string };
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = (n: number) => 'INR ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Render a single-page payslip PDF and resolve the bytes. */
export function generatePayslipPdf(p: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#5b4fc4';
    const left = 50;
    const right = 545;

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill(brand);
    doc.fillColor('#ffffff').fontSize(20).text(p.company?.name || 'AI HR Payroll', left, 22);
    if (p.company?.address) doc.fontSize(8).fillColor('#d9d5f5').text(p.company.address, left, 46);
    doc.fontSize(11).fillColor('#e7e4fa').text('Payslip', left, p.company?.address ? 60 : 58);
    doc.fillColor('#ffffff').fontSize(13).text(`${MONTHS[p.month] ?? ''} ${p.year}`, 0, 40, { align: 'right', width: right });

    // Employee block
    let y = 120;
    doc.fillColor('#1c1b2e').fontSize(14).text(p.employee.name, left, y);
    doc.fillColor('#666').fontSize(10)
      .text(`Employee Code: ${p.employee.employeeCode}`, left, y + 20)
      .text(`Branch: ${p.employee.branch?.name ?? '-'}`, left, y + 34);
    doc.fillColor('#666').fontSize(10)
      .text(`Present: ${p.presentDays}d`, right - 150, y + 20, { width: 150, align: 'right' })
      .text(`Absent: ${p.absentDays}d   LOP: ${p.lopDays}d`, right - 200, y + 34, { width: 200, align: 'right' });

    y += 70;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e5e5').stroke();
    y += 20;

    // Two columns: earnings (left) / deductions (right)
    const colW = 230;
    // No HRA/DA structure split (owner policy) — salary + OT/Sunday extra only.
    const earnings: [string, number][] = [
      ['Salary (earned)', p.basicSalary],
      ['OT + Sunday pay', p.otherAllowances],
    ];
    // Only show deductions that actually apply to this employee.
    const deductions: [string, number][] = (
      [
        ['Provident Fund (PF)', p.pfDeduction],
        ['ESI', p.esiDeduction],
        ['Professional Tax', p.ptDeduction],
        ['TDS', p.tdsDeduction],
        ['Other', p.otherDeductions],
      ] as [string, number][]
    ).filter(([, v]) => v > 0);
    if (deductions.length === 0) deductions.push(['No deductions', 0]);

    const renderColumn = (x: number, title: string, rows: [string, number][], total: [string, number]) => {
      let yy = y;
      doc.fillColor(brand).fontSize(12).text(title, x, yy);
      yy += 22;
      doc.fontSize(10).fillColor('#1c1b2e');
      for (const [label, val] of rows) {
        doc.fillColor('#444').text(label, x, yy, { width: colW - 90 });
        doc.fillColor('#1c1b2e').text(inr(val), x + colW - 110, yy, { width: 110, align: 'right' });
        yy += 18;
      }
      yy += 4;
      doc.moveTo(x, yy).lineTo(x + colW, yy).strokeColor('#e5e5e5').stroke();
      yy += 8;
      doc.fontSize(10).fillColor('#000').text(total[0], x, yy, { width: colW - 110 });
      doc.text(inr(total[1]), x + colW - 110, yy, { width: 110, align: 'right' });
    };

    const totalDed = p.pfDeduction + p.esiDeduction + p.ptDeduction + p.tdsDeduction + p.otherDeductions;
    renderColumn(left, 'Earnings', earnings, ['Gross Salary', p.grossSalary]);
    renderColumn(left + colW + 35, 'Deductions', deductions, ['Total Deductions', totalDed]);

    // Net salary band
    const netY = y + 180;
    doc.rect(left, netY, right - left, 46).fill('#eef0ff');
    doc.fillColor(brand).fontSize(13).text('Net Salary', left + 16, netY + 15);
    doc.fillColor(brand).fontSize(16).text(inr(p.netSalary), right - 220, netY + 13, { width: 200, align: 'right' });

    doc.fillColor('#999').fontSize(8).text(
      'This is a system-generated payslip and does not require a signature.',
      left,
      netY + 70,
      { align: 'center', width: right - left },
    );

    doc.end();
  });
}
