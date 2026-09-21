-- Who staff ring from the phone app's "Contact HR" button.
--
-- Separate from the company phone already on this table, which is the number
-- printed on a payslip. This is a person an employee should call about their
-- own attendance or salary, and it is the first company contact detail the
-- Android app has ever been able to read.
--
-- Additive with empty defaults, so every existing dealer keeps working and the
-- button simply stays hidden until someone fills these in.
ALTER TABLE "CompanySettings" ADD COLUMN "hrContactName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN "hrContactPhone" TEXT NOT NULL DEFAULT '';
