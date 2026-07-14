/**
 * Expense-claim voucher PDF — A5 landscape (exactly half an A4 sheet, to save
 * paper when printing). Contains the company details, claim reference, employee,
 * title/description/amount (figures + words), submitted date-time, approver and
 * payment details, plus signature lines so the cashier can verify the printed
 * copy against the application in the app.
 */
import PDFDocument from 'pdfkit';

export interface VoucherData {
  id: string;
  type: string;
  title: string;
  description: string | null;
  amount: number;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewerName: string | null;
  paidAt: Date | null;
  paidByName: string | null;
  employee: { name: string; employeeCode: string; branch?: { name: string } | null };
}

const COMPANY_NAME = process.env.COMPANY_NAME ?? 'AI HR Payroll';
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS ?? '';

const fmtDateTime = (d: Date) =>
  d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: process.env.COMPANY_TZ ?? 'Asia/Kolkata',
  });

// Standard PDF fonts have no ₹ glyph, so amounts are prefixed "Rs." (like the payslip).
const inr = (n: number) =>
  'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

/** Indian-system amount in words (crore/lakh/thousand), rupees only. */
export function amountInWords(amount: number): string {
  const n = Math.round(amount);
  if (n === 0) return 'Zero Rupees';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return `${parts.join(' ')} Rupees Only`;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'PENDING APPROVAL',
  NEEDS_CLARIFICATION: 'CLARIFICATION REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
};

/** Render the A5-landscape claim voucher and resolve the PDF bytes. */
export function generateClaimVoucherPdf(c: VoucherData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // A5 landscape = 595.28 × 419.53 pt — half of a portrait A4 sheet.
    const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (ch) => chunks.push(ch as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#5b4fc4';
    const W = doc.page.width;
    const left = 28;
    const right = W - 28;

    // Header band: company + document title
    doc.rect(0, 0, W, 62).fill(brand);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(COMPANY_NAME, left, 14);
    if (COMPANY_ADDRESS) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#e7e4fa').text(COMPANY_ADDRESS, left, 36, { width: 300 });
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text('EXPENSE CLAIM VOUCHER', left, 16, { width: right - left, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#e7e4fa')
      .text(STATUS_LABEL[c.status] ?? c.status, left, 34, { width: right - left, align: 'right' });

    // Reference row
    let y = 74;
    const ref = `CLM-${c.id.slice(-8).toUpperCase()}`;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1c1b2e').text(`Voucher No: ${ref}`, left, y);
    doc.font('Helvetica').fontSize(9).fillColor('#444')
      .text(`Submitted: ${fmtDateTime(c.createdAt)}`, left, y, { width: right - left, align: 'right' });

    y += 18;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#d9d6f0').stroke();
    y += 10;

    // Detail grid — label/value pairs in two columns
    const label = (t: string, x: number, yy: number) =>
      doc.font('Helvetica').fontSize(7.5).fillColor('#888').text(t.toUpperCase(), x, yy);
    const value = (t: string, x: number, yy: number, w: number, bold = false) =>
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#1c1b2e')
        .text(t, x, yy + 10, { width: w, ellipsis: true, height: 12, lineBreak: false });

    const colW = (right - left - 20) / 2;
    const col2 = left + colW + 20;

    label('Claimed By', left, y); value(`${c.employee.name} (${c.employee.employeeCode})`, left, y, colW, true);
    label('Branch', col2, y); value(c.employee.branch?.name ?? '-', col2, y, colW);
    y += 30;
    label('Claim Type', left, y); value(c.type, left, y, colW);
    label('Claim Title', col2, y); value(c.title, col2, y, colW, true);
    y += 30;
    label('Description', left, y);
    doc.font('Helvetica').fontSize(9).fillColor('#1c1b2e')
      .text(c.description?.trim() || '—', left, y + 10, { width: right - left, height: 22, ellipsis: true });
    y += 40;

    // Amount box
    doc.rect(left, y, right - left, 40).fill('#eef0ff');
    doc.fillColor(brand).font('Helvetica').fontSize(8).text('AMOUNT', left + 12, y + 7);
    doc.font('Helvetica-Bold').fontSize(15).text(inr(c.amount), left + 12, y + 17);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555')
      .text(amountInWords(c.amount), left + 160, y + 20, { width: right - left - 172, align: 'right' });
    y += 50;

    // Approval / payment trail
    const approvedLine =
      c.status === 'REJECTED'
        ? `Rejected by ${c.reviewerName ?? '—'}${c.reviewedAt ? ` on ${fmtDateTime(c.reviewedAt)}` : ''}`
        : c.reviewerName
          ? `Approved by ${c.reviewerName}${c.reviewedAt ? ` on ${fmtDateTime(c.reviewedAt)}` : ''}`
          : 'Approval: Pending';
    doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(approvedLine, left, y);
    if (c.status === 'PAID' && c.paidByName) {
      doc.text(`Paid by ${c.paidByName}${c.paidAt ? ` on ${fmtDateTime(c.paidAt)}` : ''}`, left, y + 12);
    }

    // Signature row (fixed near the bottom)
    const sigY = doc.page.height - 64;
    const sigW = (right - left - 40) / 3;
    (['Claimant Signature', 'Approved By', 'Cashier'] as const).forEach((t, i) => {
      const x = left + i * (sigW + 20);
      doc.moveTo(x, sigY).lineTo(x + sigW, sigY).strokeColor('#999').stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#666').text(t, x, sigY + 4, { width: sigW, align: 'center' });
    });

    doc.font('Helvetica').fontSize(6.5).fillColor('#aaa').text(
      `System-generated voucher · Claim ID ${c.id} · Printed ${fmtDateTime(new Date())} · Verify details against the app before disbursement`,
      left,
      doc.page.height - 28,
      { width: right - left, align: 'center' },
    );

    doc.end();
  });
}
