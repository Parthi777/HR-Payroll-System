/**
 * An employee's monthly statement: every day's punches and the month's leave,
 * as a PDF they can keep. Same look as the payslip.
 *
 * Built from `employeeMonthDetail` — the classifier's counts, the same that
 * the muster, the payroll report and the payslip use — so the statement can
 * never disagree with what the employee is paid for.
 */
import PDFDocument from 'pdfkit';
import type { employeeMonthDetail } from './employee-month.service.js';

type MonthDetail = Awaited<ReturnType<typeof employeeMonthDetail>>;

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BRAND = '#00835E';
const INK = '#171C20';
const MUTED = '#66716D';
const LINE = '#E6EEEA';
const TINT = '#F4F7F6';

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  PENDING: 'Awaiting approval',
  ON_LEAVE: 'Leave',
  LOP: 'Loss of pay',
  WEEKLY_OFF: 'Weekly off',
  WEEKLY_OFF_WORKED: 'Sunday worked',
  HOLIDAY: 'Holiday',
  HOLIDAY_WORKED: 'Holiday worked',
  NOT_JOINED: '-',
};
const STATUS_COLOR: Record<string, string> = {
  PRESENT: '#16A34A',
  LATE: '#B45309',
  HALF_DAY: '#0284C7',
  ABSENT: '#E11D48',
  PENDING: '#8A5A00',
  ON_LEAVE: '#4F46E5',
  LOP: '#E11D48',
  WEEKLY_OFF_WORKED: BRAND,
  HOLIDAY_WORKED: BRAND,
};
const LEAVE_LABEL: Record<string, string> = { CL: 'Casual leave', SL: 'Sick leave', EL: 'Earned leave', LOP: 'Loss of pay', HALF_DAY: 'Half day' };
const PUNCH_LABEL: Record<string, string> = { GEO: 'App', MANUAL: 'Manual', SELFIE: 'Selfie', KIOSK: 'Kiosk' };

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const short = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth() + 1].slice(0, 3)}`;
};

export function generateStatementPdf(d: MonthDetail, company: { name: string; address: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const right = doc.page.width - 40;
    const width = right - left;
    const bottom = doc.page.height - 50;
    const e = d.employee;
    const s = d.attendance.summary;
    const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
    let page = 1;

    // Drawn as each page finishes. Writing every footer at the end (buffered
    // pages) rendered blank in Android's PDF viewer.
    const footer = () => {
      const bottomMargin = doc.page.margins.bottom;
      // Below the bottom margin, where pdfkit would otherwise start a new page.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        `Generated ${generated} UTC · counts follow the same rules as payroll · page ${page}`,
        left,
        doc.page.height - 34,
        { width, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = bottomMargin;
    };
    const newPage = () => {
      footer();
      doc.addPage();
      page += 1;
    };

    // ── Header band ──
    doc.rect(0, 0, doc.page.width, 86).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || 'Kayaazh Payroll', left, 20, { width: width - 160 });
    if (company.address) doc.font('Helvetica').fontSize(8).fillColor('#CCE8DE').text(company.address, left, 44, { width: width - 160 });
    doc.font('Helvetica').fontSize(10).fillColor('#E8F7F2').text('Attendance & leave statement', left, 60);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff').text(`${MONTHS[d.month]} ${d.year}`, left, 36, { width, align: 'right' });

    // ── Employee ──
    let y = 104;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(e.name, left, y);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(`Employee code: ${e.employeeCode}`, left, y + 20);
    doc.text(`Branch: ${e.branch}   Department: ${e.department ?? '-'}   Designation: ${e.designation ?? '-'}`, left, y + 33);
    doc.text(`Shift: ${e.shift.name} (${e.shift.startTime}-${e.shift.endTime})   Joined: ${ymd(e.joiningDate)}`, left, y + 46);

    // ── Summary strip ──
    y += 70;
    const cells: [string, string][] = [
      ['Present', num(s.present)],
      ['Late', num(s.late)],
      ['Half day', num(s.half)],
      ['Absent', num(s.absent)],
      ['Leave', num(s.leave)],
      ['LOP', num(s.lop)],
      ['Awaiting', num(s.pending)],
      ['Hours', num(s.workedHours)],
    ];
    const cw = width / cells.length;
    doc.roundedRect(left, y, width, 46, 8).fill(TINT);
    cells.forEach(([label, value], i) => {
      const x = left + i * cw;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(value, x, y + 8, { width: cw, align: 'center' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, x, y + 27, { width: cw, align: 'center' });
    });
    y += 62;

    // ── Day table ──
    const cols = [
      { h: 'Date', w: 0.16 },
      { h: 'Day', w: 0.08 },
      { h: 'Status', w: 0.24 },
      { h: 'Check-in', w: 0.13 },
      { h: 'Check-out', w: 0.13 },
      { h: 'Hours', w: 0.1 },
      { h: 'Punch', w: 0.16 },
    ].map((c) => ({ ...c, w: c.w * width }));
    const rowH = 18;

    const tableHeader = (title: string) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(title, left, y);
      y += 16;
    };
    const header = (columns: { h: string; w: number }[]) => {
      doc.rect(left, y, width, rowH).fill(BRAND);
      let x = left;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      for (const c of columns) {
        doc.text(c.h, x + 6, y + 5, { width: c.w - 8, lineBreak: false });
        x += c.w;
      }
      y += rowH;
    };
    const ensureRoom = (columns: { h: string; w: number }[]) => {
      if (y + rowH > bottom) {
        newPage();
        y = 40;
        header(columns);
      }
    };

    tableHeader('Day by day');
    header(cols);
    const served = d.attendance.days.filter((day) => day.status !== 'NOT_JOINED');
    served.forEach((day, i) => {
      ensureRoom(cols);
      if (i % 2 === 1) doc.rect(left, y, width, rowH).fill(TINT);
      const values = [
        `${d.year}-${String(d.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`,
        WEEKDAYS[day.weekday] ?? '',
        STATUS_LABEL[day.status] ?? day.status,
        day.checkIn ?? '--:--',
        day.checkOut ?? '--:--',
        day.workedHours != null ? num(day.workedHours) : '-',
        day.punchMode ? PUNCH_LABEL[day.punchMode] ?? day.punchMode : '-',
      ];
      let x = left;
      values.forEach((v, ci) => {
        doc.font(ci === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
          .fillColor(ci === 2 ? STATUS_COLOR[day.status] ?? MUTED : INK)
          .text(v, x + 6, y + 5, { width: cols[ci].w - 8, lineBreak: false });
        x += cols[ci].w;
      });
      y += rowH;
    });
    if (served.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No days in this month yet.', left + 6, y + 5);
      y += rowH;
    }
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();

    // ── Leave ──
    y += 18;
    const leaveCols = [
      { h: 'Type', w: 0.2 },
      { h: 'From', w: 0.14 },
      { h: 'To', w: 0.14 },
      { h: 'Days', w: 0.08 },
      { h: 'Status', w: 0.14 },
      { h: 'Reason', w: 0.3 },
    ].map((c) => ({ ...c, w: c.w * width }));
    if (y + 16 + rowH * 2 > bottom) { newPage(); y = 40; }
    tableHeader('Leave');
    header(leaveCols);
    if (d.leaves.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No leave in this month.', left + 6, y + 5);
      y += rowH;
    }
    d.leaves.forEach((l, i) => {
      ensureRoom(leaveCols);
      if (i % 2 === 1) doc.rect(left, y, width, rowH).fill(TINT);
      const values = [
        LEAVE_LABEL[l.type] ?? l.type,
        short(l.fromDate),
        short(l.toDate),
        num(l.days),
        l.status.charAt(0) + l.status.slice(1).toLowerCase(),
        l.reason ?? '',
      ];
      let x = left;
      values.forEach((v, ci) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(v, x + 6, y + 5, { width: leaveCols[ci].w - 8, lineBreak: false, ellipsis: true });
        x += leaveCols[ci].w;
      });
      y += rowH;
    });

    footer();
    doc.end();
  });
}
