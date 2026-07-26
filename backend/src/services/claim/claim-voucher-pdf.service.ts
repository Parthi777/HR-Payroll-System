/**
 * Expense-claim voucher PDF — A5 landscape (exactly half an A4 sheet, to save
 * paper when printing).
 *
 * Carries everything the cashier needs before disbursing: the running Voucher No
 * and Claim ID, who claimed it, who approved it, the expense head, the branch,
 * the amount (figures + words) and the description.
 *
 * Pure black-and-white — no fills or colours, so it is cheap to print and
 * photocopy-safe.
 */
import PDFDocument from 'pdfkit';
import { claimTypeLabel } from './claim-types.js';
import { formatDocNo } from './claim-number.js';

export interface VoucherData {
  id: string;
  claimNo: number | null;
  voucherNo: number | null;
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
  /** From CompanySettings; falls back to COMPANY_NAME / COMPANY_ADDRESS env vars. */
  company?: { name: string; address: string } | null;
}

const FALLBACK_COMPANY_NAME = process.env.COMPANY_NAME ?? 'AI HR Payroll';
const FALLBACK_COMPANY_ADDRESS = process.env.COMPANY_ADDRESS ?? '';

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

/** Indian-system words for a whole number (crore / lakh / thousand). */
function wholeInWords(n: number): string {
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
  return parts.join(' ');
}

/**
 * Indian-system amount in words, including paise.
 *
 * On a cash voucher the words are the legal fallback if the figures are
 * altered, so they must agree with the figures exactly — 18750.50 reads
 * "Eighteen Thousand Seven Hundred Fifty Rupees and Fifty Paise Only",
 * never a rounded "…Fifty One Rupees".
 */
export function amountInWords(amount: number): string {
  // Work in paise to avoid float drift (0.1 + 0.2 style) on the split.
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const rupeeWords = rupees > 0 ? `${wholeInWords(rupees)} Rupees` : '';
  const paiseWords = paise > 0 ? `${twoDigits(paise)} Paise` : '';
  const joined = [rupeeWords, paiseWords].filter(Boolean).join(' and ');
  return `${joined} Only`;
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

    const W = doc.page.width;
    const left = 28;
    const right = W - 28;
    doc.fillColor('#000000').strokeColor('#000000');

    const companyName = c.company?.name || FALLBACK_COMPANY_NAME;
    const companyAddress = c.company?.address || FALLBACK_COMPANY_ADDRESS;

    // Header: company block left, document title right, ruled off below.
    doc.font('Helvetica-Bold').fontSize(15).text(companyName, left, 16, { width: 300, lineBreak: false });
    if (companyAddress) {
      doc.font('Helvetica').fontSize(7.5)
        .text(companyAddress, left, 34, { width: 300, height: 10, ellipsis: true, lineBreak: false });
    }
    doc.font('Helvetica-Bold').fontSize(12)
      .text('EXPENSE CLAIM VOUCHER', left, 18, { width: right - left, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9)
      .text(STATUS_LABEL[c.status] ?? c.status, left, 34, { width: right - left, align: 'right', lineBreak: false });

    let y = 52;
    doc.lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 8;

    // Reference row. The Voucher No is issued only on approval; the Claim ID is
    // allocated the moment the claim is received, so it always prints.
    const voucherNo = formatDocNo(c.voucherNo);
    const claimNo = formatDocNo(c.claimNo);
    doc.font('Helvetica-Bold').fontSize(10)
      .text(`Voucher No: ${voucherNo ?? '—'}`, left, y, { width: 130, lineBreak: false });
    if (!voucherNo) {
      doc.font('Helvetica-Oblique').fontSize(6.5)
        .text('(issued on approval)', left + 88, y + 3, { width: 90, lineBreak: false });
    }
    doc.font('Helvetica-Bold').fontSize(10)
      .text(`Claim ID: ${claimNo ?? c.id.slice(-6).toUpperCase()}`, left + 182, y, { width: 130, lineBreak: false });
    doc.font('Helvetica').fontSize(8)
      .text(`Submitted: ${fmtDateTime(c.createdAt)}`, left, y + 2, { width: right - left, align: 'right', lineBreak: false });

    y += 17;
    doc.lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
    y += 7;

    // Detail grid — small caps label above the value, two columns.
    const label = (t: string, x: number, yy: number, w: number) =>
      doc.font('Helvetica').fontSize(6.5).text(t.toUpperCase(), x, yy, { width: w, lineBreak: false });
    const value = (t: string, x: number, yy: number, w: number, bold = false) =>
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        .text(t, x, yy + 8, { width: w, ellipsis: true, height: 12, lineBreak: false });

    const gap = 18;
    const colW = (right - left - gap) / 2;
    const col2 = left + colW + gap;
    const ROW = 27;

    label('Claimed By', left, y, colW);
    value(`${c.employee.name} (${c.employee.employeeCode})`, left, y, colW, true);
    label('Branch', col2, y, colW);
    value(c.employee.branch?.name ?? '—', col2, y, colW, true);
    y += ROW;

    label('Claim Type', left, y, colW);
    value(claimTypeLabel(c.type), left, y, colW, true);
    label('Claim Title', col2, y, colW);
    value(c.title, col2, y, colW);
    y += ROW;

    // Approved By — the line the cashier checks before handing over cash.
    const approvedBy =
      c.status === 'REJECTED'
        ? `Rejected by ${c.reviewerName ?? '—'}`
        : (c.reviewerName ?? 'Pending approval');
    label('Approved By', left, y, colW);
    value(approvedBy, left, y, colW, true);
    if (c.reviewedAt) {
      doc.font('Helvetica').fontSize(6.5)
        .text(fmtDateTime(c.reviewedAt), left, y + 19, { width: colW, lineBreak: false });
    }
    label(c.status === 'PAID' ? 'Paid By' : 'Payment', col2, y, colW);
    value(c.status === 'PAID' ? (c.paidByName ?? '—') : 'Not yet disbursed', col2, y, colW, c.status === 'PAID');
    if (c.status === 'PAID' && c.paidAt) {
      doc.font('Helvetica').fontSize(6.5)
        .text(fmtDateTime(c.paidAt), col2, y + 19, { width: colW, lineBreak: false });
    }
    y += ROW + 8; // this row carries a timestamp sub-line under the value

    label('Description', left, y, right - left);
    doc.font('Helvetica').fontSize(8.5)
      .text(c.description?.trim() || '—', left, y + 8, { width: right - left, height: 20, ellipsis: true });
    y += 32;

    // Voucher amount box — plain border, no fill.
    doc.lineWidth(1).rect(left, y, right - left, 38).stroke();
    doc.font('Helvetica').fontSize(7).text('VOUCHER AMOUNT', left + 12, y + 6, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(15).text(inr(c.amount), left + 12, y + 16, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(8)
      .text(amountInWords(c.amount), left + 170, y + 20, { width: right - left - 182, align: 'right', lineBreak: false });
    y += 46;

    // Signature lines — the printed copy is signed on collection.
    const sigW = (right - left - gap) / 2;
    doc.lineWidth(0.5)
      .moveTo(left, y + 12).lineTo(left + sigW, y + 12).stroke()
      .moveTo(col2, y + 12).lineTo(col2 + sigW, y + 12).stroke();
    doc.font('Helvetica').fontSize(6.5)
      .text('Received by (Employee)', left, y + 15, { width: sigW, lineBreak: false })
      .text('Paid by (Cashier)', col2, y + 15, { width: sigW, lineBreak: false });

    doc.font('Helvetica').fontSize(6).text(
      `System-generated voucher · Ref ${c.id} · Printed ${fmtDateTime(new Date())} · ` +
        'Verify the bill and these details against the app before disbursement',
      left,
      doc.page.height - 18,
      { width: right - left, align: 'center', lineBreak: false },
    );

    doc.end();
  });
}
