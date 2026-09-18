/**
 * Subscription tiers, by dealership size.
 *
 * PLACEHOLDER PRICES. These are what the public pages display; change them here
 * and the pricing page, the signup flow and the plan summary all follow. When a
 * client signs up, the amount charged is taken from the server's copy of this
 * table (backend/src/services/subscription/plans.ts) and never from the
 * browser, so a tampered page cannot buy a cheaper plan — but the two are meant
 * to agree, and the signup page shows the server's figure before payment.
 */
export interface Plan {
  code: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  name: string;
  /** Rupees per month, excluding GST. */
  priceMonthly: number;
  /** Active employees included; null means no cap. */
  staffLimit: number | null;
  blurb: string;
  highlights: string[];
  /** The one drawn attention to on the pricing page. */
  featured?: boolean;
}

export const PLANS: Plan[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    priceMonthly: 1499,
    staffLimit: 25,
    blurb: 'A single showroom or workshop finding its feet.',
    highlights: [
      'Up to 25 active employees',
      'One branch, one geofence',
      'Selfie attendance and GPS check-in',
      'Shifts, leave and monthly payroll',
      'Payslip PDFs and the bank transfer file',
      'Email support',
    ],
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    priceMonthly: 3999,
    staffLimit: 100,
    blurb: 'A dealership group running several branches at once.',
    highlights: [
      'Up to 100 active employees',
      'Unlimited branches and geofences',
      'Everything in Starter',
      'WhatsApp alerts and two-way commands',
      'Expense claims with voucher numbering',
      'Full reports, exports and the audit trail',
      'Priority support',
    ],
    featured: true,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 7999,
    staffLimit: null,
    blurb: 'Large groups, or anyone who wants us on the phone.',
    highlights: [
      'Unlimited employees and branches',
      'Everything in Growth',
      'Onboarding and data migration help',
      'Salary structures set up with you',
      'A named contact for support',
    ],
  },
];

export const planByCode = (code: string): Plan | undefined =>
  PLANS.find((p) => p.code === code);

/** "₹3,999" — Indian digit grouping, no decimals. */
export const rupees = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;
