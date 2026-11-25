-- Remove the table-level requirement for a rework resolution remark.
-- Preserve the pending/resolved timestamp and final-status consistency checks.
ALTER TABLE public.pm_rework_units
  DROP CONSTRAINT IF EXISTS pm_rework_units_check;

ALTER TABLE public.pm_rework_units
  ADD CONSTRAINT pm_rework_units_check
  CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR
    (status IN ('completed', 'finally_rejected') AND resolved_at IS NOT NULL)
  );