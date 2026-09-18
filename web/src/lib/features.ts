import { ScanFace, MapPin, Clock, Wallet, MessageSquare, ShieldCheck, type LucideIcon } from 'lucide-react';

/**
 * The public feature pages, as content rather than markup.
 *
 * One file so the landing page, the index and each detail page can never
 * describe the same feature differently, and so the copy can be corrected
 * without touching a component.
 *
 * Everything here describes behaviour this system actually has — the numbers
 * are the defaults the code ships with (face-match threshold, grace period,
 * PF cap, and so on), and anything configurable says so. A marketing page that
 * promises what the product does not do is a support ticket with a countdown.
 */
export interface FeatureSection {
  title: string;
  copy: string;
}

export interface Feature {
  slug: string;
  name: string;
  icon: LucideIcon;
  /** One line, on the landing card. */
  summary: string;
  /** One line, under the title on its own page. */
  tagline: string;
  /** Two or three sentences setting up the problem. */
  intro: string[];
  /** The flow, in the order it happens. */
  steps: FeatureSection[];
  /** The specifics — defaults, limits, the rules it enforces. */
  rules: FeatureSection[];
  /** What each side actually sees. */
  employee: string[];
  admin: string[];
  /** The honest caveat. Every feature has one. */
  note: string;
}

export const FEATURES: Feature[] = [
  {
    slug: 'selfie-attendance',
    name: 'Selfie attendance',
    icon: ScanFace,
    summary: 'Check-in verified against the enrolled face — nobody clocks in for anyone else.',
    tagline: 'A punch that belongs to the person who made it.',
    intro: [
      'Buddy punching is the oldest attendance problem there is: a card, a code or a shared phone can be handed to a colleague, and the register still balances at the end of the month.',
      'Here every check-in and check-out carries a selfie taken at that moment, matched against the face enrolled for that employee. A punch that does not match is refused outright, not flagged for someone to notice later.',
    ],
    steps: [
      { title: 'Enrol once', copy: 'HR uploads one clear photo per employee from Master Control. It becomes that person’s reference face. The photo is held by the face-matching service, not sitting in a shared folder.' },
      { title: 'Open the app and check in', copy: 'The employee opens the app at the branch. The front camera comes up with a liveness prompt — blink, smile, turn — so a photograph of a photograph does not pass.' },
      { title: 'Match, then mark', copy: 'The selfie is compared with the enrolled face. At or above the confidence threshold the day is marked, with the time, the coordinates and the device recorded beside it.' },
      { title: 'Confirm on WhatsApp', copy: 'The employee gets a confirmation with the time and branch, so a punch that was not theirs is visible to them within seconds.' },
    ],
    rules: [
      { title: 'Match or nothing', copy: 'Check-in and check-out both require an enrolled face and a match at or above the threshold. Below it, the punch is refused with a clear message rather than saved as “suspicious”.' },
      { title: 'Threshold you set', copy: 'The default confidence is 85 out of 100, adjustable per dealership. Raise it where lighting is good and faces are consistent; lower it and you accept more borderline matches.' },
      { title: 'One face per selfie', copy: 'Exactly one face must be in frame. Group selfies at the gate are rejected.' },
      { title: 'A way through when it fails', copy: 'Glasses, a cracked lens, a new beard: staff can raise a manual punch with the times typed by hand. It skips the face and geofence checks, and is held for the reporting manager — unpaid until approved, so the exception is visible rather than silent.' },
      { title: 'Yesterday’s open day blocks today', copy: 'Forgetting to check out is caught on the next check-in: the app asks for the missing check-out time before it will let the new day start, with a cut-off time so a whole evening cannot be claimed the next morning.' },
      { title: 'Every punch is evidence', copy: 'The selfie, the coordinates, the device and the match score are all kept against the day. Any disputed attendance can be opened and looked at months later.' },
    ],
    employee: [
      'Front-camera check-in with a liveness prompt',
      'Instant confirmation of the time and branch',
      'A manual punch to fall back on, with the manager notified',
      'Their own attendance history for the last 30 days',
    ],
    admin: [
      'A live feed of who has arrived, with the selfie thumbnail beside each punch',
      'The match score on every punch, so weak matches stand out',
      'Face enrolment and re-enrolment per employee',
      'Approvals for every manual and out-of-zone punch',
    ],
    note: 'Face matching runs in the cloud, so check-in needs a connection at the moment of the punch. Where a branch has no signal, the manual punch is the path — and it is approved by a person rather than by a camera.',
  },
  {
    slug: 'gps-geofencing',
    name: 'GPS geofencing',
    icon: MapPin,
    summary: 'Punches tied to a branch boundary, with every exception raised for sign-off.',
    tagline: 'Present means present at the branch.',
    intro: [
      'A face match proves who checked in. It says nothing about where they were when they did it.',
      'Each branch gets a boundary drawn on a map. Punches inside it are ordinary; punches outside it are either refused or held for approval, and either way they are recorded with the distance.',
    ],
    steps: [
      { title: 'Draw the boundary', copy: 'Set each branch’s centre on the map — by clicking, dragging the pin, or using your current location while standing there — and choose a radius.' },
      { title: 'Choose how strict it is', copy: 'Strict mode blocks a punch made outside the boundary. Soft mode allows it and flags it for the manager. Strict for a showroom, soft for staff who genuinely move.' },
      { title: 'The app checks before it asks for a selfie', copy: 'Location is read at the moment of the punch, and the employee sees where they are relative to the branch before anything is submitted.' },
      { title: 'Exceptions reach a person', copy: 'Anything outside the boundary lands in the approvals queue with its distance and map position, for the reporting manager to allow or refuse.' },
    ],
    rules: [
      { title: 'A radius that fits the site', copy: 'The default is 100 metres, and each branch can be set anywhere from about 20 metres for a single showroom to several kilometres for a yard or a service area.' },
      { title: 'Poor GPS is treated as poor GPS', copy: 'When the reported accuracy is worse than about 50 metres, the punch is allowed but flagged rather than silently trusted — a phone indoors can be wrong by more than the boundary is wide.' },
      { title: 'Borderline is its own answer', copy: 'Within about 10 metres of the edge the punch is marked borderline instead of being forced to inside or outside, because that is the honest description of it.' },
      { title: 'Location during the shift', copy: 'For field staff, position is logged periodically through the shift so the day can be reconstructed, not just its two ends.' },
      { title: 'Violations are a report, not a rumour', copy: 'Every out-of-zone punch and every exit from the boundary during a shift is listed with a time and a distance, per branch and per person.' },
      { title: 'Unapproved means unpaid', copy: 'An out-of-zone punch that nobody signs off is not paid, and shows as pending in the month’s grid. The decision is a manager’s, and it is recorded.' },
    ],
    employee: [
      'A map showing where they are against the branch boundary',
      'A clear refusal, with the distance, rather than a punch that silently fails',
      'A warning if they leave the zone during a shift',
    ],
    admin: [
      'A drawing tool per branch: centre, radius, strict or soft',
      'Live positions of staff on shift',
      'A geofence violation report by branch, person and date range',
      'The distance on every exception in the approvals queue',
    ],
    note: 'Phone GPS can be fooled by mock-location apps, and no consumer phone is immune to that. The boundary is one of three checks — face, location and a manager’s approval on anything unusual — and the combination is what makes it hard to game, not the map alone.',
  },
  {
    slug: 'shift-monitor',
    name: 'Shift monitor',
    icon: Clock,
    summary: 'Live hours, breaks and overtime against the roster someone is actually on.',
    tagline: 'The roster, and what really happened against it.',
    intro: [
      'A dealership runs on shifts that do not match each other: a morning service bay, a showroom on general hours, a night security post that crosses midnight.',
      'Every punch is judged against the shift that person is actually on — late, half day, overtime and weekly off all follow from it, rather than from one company-wide rule.',
    ],
    steps: [
      { title: 'Define the shifts', copy: 'Start and end times, a grace period, and whether the shift crosses midnight. Morning, general, evening and night are there from the start and can be changed.' },
      { title: 'Assign them', copy: 'Per employee, or in bulk for a branch or department, with rotations for teams that move between shifts.' },
      { title: 'The day classifies itself', copy: 'Each punch is read against the shift: on time, late past the grace period, a half day if it lands in the midday window, overtime past the end of the shift.' },
      { title: 'Everyone sees the same day', copy: 'One classifier answers “what kind of day was this?” for the muster grid, every report, the employee’s calendar and the payroll run — so no two screens disagree.' },
    ],
    rules: [
      { title: 'Grace period', copy: 'Late is counted past the grace period, 15 minutes by default and set per shift, so ordinary traffic does not become a discipline problem.' },
      { title: 'Half days are a window, not a guess', copy: 'Arriving after the shift started or leaving before it ended, within the midday window (12:30–14:00 by default), marks a half day. A punch outside that window is a full day.' },
      { title: 'Night shifts belong to the day they started', copy: 'A shift that crosses midnight is recorded against its start date, and the check-out the following morning is matched to it rather than opening a new day.' },
      { title: 'Overtime starts after a margin', copy: 'Overtime counts from a configurable margin past the end of the shift, so someone finishing a job five minutes late does not generate a claim.' },
      { title: 'Breaks are tracked, not assumed', copy: 'Staff mark break start and end from the app, and the hours worked reflect it.' },
      { title: 'Anomalies surface weekly', copy: 'Arriving more than an hour early, leaving more than two hours late, or punching from two distant locations on the same day are all flagged for review.' },
    ],
    employee: [
      'Today’s shift, a live timer of hours worked, and the break tracker',
      'The next seven days of roster',
      'An overtime indicator, so the claim is never a surprise',
      'Their own history for the last 30 days',
    ],
    admin: [
      'Shift definitions, assignment in bulk, and rotation schedules',
      'A day-by-day muster grid for any month',
      'Late arrival and overtime reports, filterable by branch and department',
      'A holiday calendar that the whole system reads',
    ],
    note: 'Rosters here are shift patterns, not a scheduling engine: the system records and judges the shift someone is on, and does not try to decide who should work when.',
  },
  {
    slug: 'payroll-engine',
    name: 'Payroll engine',
    icon: Wallet,
    summary: 'Attendance straight through to net salary, payslips and the bank transfer file.',
    tagline: 'Every rupee traced back to the days behind it.',
    intro: [
      'Payroll in most small groups is an export, a spreadsheet and an evening of arithmetic, and the number that reaches the bank cannot be explained back to the attendance it came from.',
      'Here one calculation produces both the payslip and the report. Open any month and the days behind the figure are on the same screen as the figure.',
    ],
    steps: [
      { title: 'The month is built from the days', copy: 'Present, half, absent, leave, weekly off, holiday and awaiting-approval are counted per person from the same classifier the attendance screens use.' },
      { title: 'Earnings are worked out', copy: 'Earned salary, overtime and Sunday duty are calculated against the basis that person is on, with a mid-month joiner paid pro-rata for the days served.' },
      { title: 'Statutory deductions apply', copy: 'PF and ESI where they apply, professional tax and any advances, each shown as its own line rather than folded into a total.' },
      { title: 'Payslips and the bank file', copy: 'A PDF per employee, and a transfer file for the bank with the beneficiary details, ready to upload.' },
    ],
    rules: [
      { title: 'Two bases, side by side', copy: 'Monthly salary, or paid for days actually worked. Each employee can be on either, so a showroom team and daily-wage workshop staff run in the same payroll.' },
      { title: 'A day is a thirtieth', copy: 'The per-day rate is the monthly salary divided by 30 regardless of the month’s length, so February and March pay the same day at the same rate.' },
      { title: 'Sunday duty pays extra', copy: 'Sundays and listed holidays are paid weekly offs. Working a Sunday earns a full extra day’s pay on top — and no overtime on that day, because the extra day is the rate for it.' },
      { title: 'Half a day is half a day, twice', copy: 'A half day pays 0.5 and adds 0.5 to the absence count, so two absences and a half day report as 2.5 rather than hiding one of them.' },
      { title: 'Leave has a quota', copy: 'Casual leave is paid up to 12 days a calendar year; beyond that it becomes loss of pay. Approved leave is paid, loss of pay never is.' },
      { title: 'Nothing unapproved is paid', copy: 'An out-of-zone, late, manual or selfie punch pays only once a manager has approved it. Until then the day is unpaid and shown as pending, not quietly counted.' },
      { title: 'The arithmetic is checked', copy: 'Paid, absent, loss-of-pay and unpaid days must add up to the days served in the month. The run enforces it rather than trusting it.' },
    ],
    employee: [
      'Their payslip each month, with the attendance summary behind it',
      'The deduction breakdown — PF, ESI, tax, advances — line by line',
      'A WhatsApp message when salary is processed',
    ],
    admin: [
      'A one-click run for the whole company, with a preview before anything is saved',
      'A salary sheet for the owner, and a day-by-day performance grid',
      'Statutory outputs for PF and ESI, and a NEFT/RTGS transfer file',
      'Salary revision history and advance management',
    ],
    note: 'The engine computes and documents payroll; it does not file your returns or move money. The bank file is produced for you to upload, and the statutory reports are prepared for your accountant to submit.',
  },
  {
    slug: 'whatsapp-alerts',
    name: 'WhatsApp alerts',
    icon: MessageSquare,
    summary: 'Check-in confirmations, leave decisions and payslips where staff already read.',
    tagline: 'The channel your staff actually open.',
    intro: [
      'Email goes unread and a notice board is only seen by whoever walks past it. On a dealership floor, WhatsApp is where a message is read within minutes.',
      'Attendance confirmations, leave decisions and salary notifications are sent there automatically, and staff can ask the system simple questions back.',
    ],
    steps: [
      { title: 'Connect a business number', copy: 'Your WhatsApp Business account is connected once. Messages come from your dealership’s number, not from an unknown sender.' },
      { title: 'Events send themselves', copy: 'Check-in, check-out, leave approval or rejection, a shift change, an absence, a payslip — each has a template and a trigger.' },
      { title: 'Staff can ask back', copy: 'An employee sends STATUS, BALANCE or SLIP and gets today’s attendance, their leave balance or their latest salary figure.' },
      { title: 'Delivery is visible', copy: 'Every message is logged with sent, delivered and read status, so “I never got it” is a question with an answer.' },
    ],
    rules: [
      { title: 'Templates, approved in advance', copy: 'Automated messages use templates approved by WhatsApp, which is what keeps a business number in good standing.' },
      { title: 'Retries, then an honest failure', copy: 'A send that fails is retried up to three times and then marked failed in the log, rather than disappearing.' },
      { title: 'Incoming messages are verified', copy: 'Every inbound message is checked against a cryptographic signature before it is acted on, so nobody can post attendance to your system by guessing a web address.' },
      { title: 'A number that could be two people is refused', copy: 'If the same phone number belongs to staff at two different dealerships, the system answers neither rather than guessing — a wrong guess would hand someone else’s attendance or salary over.' },
      { title: 'Unknown senders get silence', copy: 'A message from a number that is not on the payroll gets no reply at all. Any answer, even a refusal, would confirm which numbers are registered.' },
      { title: 'No payslip PDFs over chat', copy: 'The salary reply gives the figure and points at the app, which authenticates. A PDF forwarded in a group chat cannot be recalled.' },
    ],
    employee: [
      'Check-in and check-out confirmations with time and branch',
      'Leave decisions as soon as they are made',
      'Salary processed notifications',
      'Simple commands: STATUS, BALANCE, SLIP',
    ],
    admin: [
      'A composer for one person, a group or everyone',
      'Trigger configuration per event',
      'Message logs with delivery and read status',
      'Broadcast lists per branch or department',
    ],
    note: 'This needs a WhatsApp Business account and templates approved by Meta, which takes a few days and is done once. Until it is connected, the same events are still recorded in the system — they are simply not sent as messages.',
  },
  {
    slug: 'audit-trail',
    name: 'Audited throughout',
    icon: ShieldCheck,
    summary: 'Every approval, correction and payroll run recorded with who did it and when.',
    tagline: 'Who changed what, and when they changed it.',
    intro: [
      'Attendance and payroll are exactly the records people are tempted to adjust quietly: a late mark removed, a salary edited, a punch approved by someone who should not have.',
      'Every administrative action inside a workspace is written down as it happens — who did it, what changed, and from where.',
    ],
    steps: [
      { title: 'The action happens', copy: 'An approval, a correction, a salary change, a payroll run, a face enrolment, a new admin account.' },
      { title: 'It is recorded after it succeeds', copy: 'The entry is written once the change has actually gone through, so a refused action never leaves a record claiming otherwise.' },
      { title: 'It keeps the old value', copy: 'A corrected attendance day records what it was as well as what it became, and a reason is required.' },
      { title: 'You read it on one page', copy: 'The activity page lists it all, filterable by person, by action and by date.' },
    ],
    rules: [
      { title: 'Corrections are times, not verdicts', copy: 'HR corrects a day by correcting its times; present, late and half day are then re-derived. Nobody types “present” over a day that was not.' },
      { title: 'A reason is not optional', copy: 'Every manual correction carries a reason, recorded beside the old and new values.' },
      { title: 'Credentials are never recorded', copy: 'A password reset is logged as having happened. The password itself never reaches the log.' },
      { title: 'Only the owner reads the trail', copy: 'The log gathers salary changes and payroll totals in one place, so it is restricted more tightly than the screens it describes.' },
      { title: 'One dealership never sees another', copy: 'Every entry belongs to the workspace it happened in, enforced at the database layer rather than by a filter someone could forget.' },
      { title: 'Approvals name their approver', copy: 'Every punch that needed sign-off records who signed it off, which is what makes the payroll run defensible months later.' },
    ],
    employee: [
      'Their own attendance history, including corrections made to it',
      'Leave decisions with the approver’s name and remarks',
    ],
    admin: [
      'A filterable activity log for the whole workspace',
      'Old and new values on every correction',
      'Role-based access: super admin, HR, branch manager, payroll, cashier',
      'A separate platform-level log for account and workspace changes',
    ],
    note: 'An audit trail records what happened inside the system. It is evidence for a dispute, not a guarantee that nobody will ever try — which is why approvals sit with a second person and the trail is readable by the owner.',
  },
];

export const featureBySlug = (slug: string): Feature | undefined =>
  FEATURES.find((f) => f.slug === slug);
