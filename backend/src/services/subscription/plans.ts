/**
 * What a dealership pays, by size.
 *
 * The authority. The public site has its own copy for display
 * (web/src/lib/plans.ts) and the two are meant to agree, but the amount that
 * reaches a payment gateway is always taken from here — a browser that asks to
 * be charged for a cheaper plan is asking the wrong party.
 *
 * Amounts are in paise, so money is only ever integer arithmetic. GST is not
 * included: it is added by the gateway's tax handling, not invented here.
 */
export interface Plan {
  code: PlanCode;
  name: string;
  /** Rupees per month, excluding GST. */
  priceMonthly: number;
  /** Active employees included; null means no cap. */
  staffLimit: number | null;
}

export type PlanCode = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export const PLANS: Plan[] = [
  { code: 'STARTER', name: 'Starter', priceMonthly: 1499, staffLimit: 25 },
  { code: 'GROWTH', name: 'Growth', priceMonthly: 3999, staffLimit: 100 },
  { code: 'ENTERPRISE', name: 'Enterprise', priceMonthly: 7999, staffLimit: null },
];

export const PLAN_CODES = PLANS.map((p) => p.code) as [PlanCode, ...PlanCode[]];

export function planByCode(code: string): Plan | undefined {
  return PLANS.find((p) => p.code === code);
}

export function amountPaise(plan: Plan): number {
  return plan.priceMonthly * 100;
}
