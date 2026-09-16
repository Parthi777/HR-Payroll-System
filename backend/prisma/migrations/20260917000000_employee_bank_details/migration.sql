-- Where an employee's salary is actually sent.
--
-- Payroll computed what everyone was owed and stopped there; the transfer file
-- the bank ingests needs a beneficiary, an account and an IFSC. All three are
-- nullable on purpose: an employee paid in cash, or not yet onboarded to the
-- bank, has none, and the bank file names them as unpayable rather than
-- exporting a row the bank would reject.
--
-- Additive and nullable, so this changes nothing about existing rows or any
-- payroll already run.
ALTER TABLE "Employee" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "Employee" ADD COLUMN "bankAccountNo" TEXT;
ALTER TABLE "Employee" ADD COLUMN "bankIfsc" TEXT;
