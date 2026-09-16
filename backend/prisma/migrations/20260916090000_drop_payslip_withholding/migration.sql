-- Withholding a payslip is removed as a policy.
--
-- A payslip is the record of what someone earned; refusing to hand them that
-- record was a strange way to run a punctuality policy, and the late-punch
-- counting behind it was itself wrong until recently — punches on Sundays and
-- holidays, days nobody was rostered for, were pushing employees over the
-- threshold. The pay-date shift remains; only the withholding goes.
--
-- Existing rows are moved to FINALIZED rather than left in a status the code no
-- longer produces or understands. This only grants access: the amounts on these
-- payslips are unchanged, and the employees concerned can now see slips they
-- should already have had.
UPDATE "Payslip" SET "status" = 'FINALIZED' WHERE "status" = 'WITHHELD';

-- The threshold that drove it.
ALTER TABLE "CompanySettings" DROP COLUMN "payrollLateWithholdOver";
