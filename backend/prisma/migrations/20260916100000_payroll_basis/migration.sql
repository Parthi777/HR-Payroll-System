-- Payroll basis: how an employee's monthly pay is arrived at.
--
--   MONTHLY      — a monthly salary. Weekly-offs and approved leave are paid;
--                  unpaid days are deducted. What everyone was on before this.
--   PRESENT_DAYS — paid for days actually worked. An unworked Sunday, holiday
--                  or leave day pays nothing.
--
-- Every column is additive with a default, and the default is MONTHLY, so this
-- migration changes nobody's pay. An employee's own basis is nullable and
-- inherits the dealer's default until someone sets it deliberately.
ALTER TABLE "Employee" ADD COLUMN "payrollBasis" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "defaultPayrollBasis" TEXT NOT NULL DEFAULT 'MONTHLY';

-- Payslips record the basis they were computed under, so a slip still explains
-- itself after an employee is moved between structures. Rows that predate this
-- were all computed on the monthly rules.
ALTER TABLE "Payslip" ADD COLUMN "payrollBasis" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "Payslip" ADD COLUMN "unpaidDays" DOUBLE PRECISION NOT NULL DEFAULT 0;
