-- Make rejection category optional for hourly production entries.
-- New hourly captures record rejected quantity only. Existing IQC/LQC values
-- remain in place for historical rows and continue to be validated if set.

ALTER TABLE public.pm_hourly_production
  DROP CONSTRAINT IF EXISTS pm_hourly_production_check2;

ALTER TABLE public.pm_hourly_production
  DROP CONSTRAINT IF EXISTS pm_hourly_production_rejection_reason_optional_check;

ALTER TABLE public.pm_hourly_production
  ADD CONSTRAINT pm_hourly_production_rejection_reason_optional_check
  CHECK (
    rejection_reason IS NULL
    OR btrim(rejection_reason) IN ('IQC Rejection', 'LQC Rejection')
  );
