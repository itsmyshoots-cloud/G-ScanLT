-- Allow hourly output to exceed the scheduled target after the user
-- explicitly confirms the over-target quantity in the application.
-- Keep plan/hour existence, plan status, rejection, serial and sticker
-- validations unchanged.

CREATE OR REPLACE FUNCTION public.pm_validate_hourly_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan_status text;
  v_exception jsonb;
BEGIN
  SELECT p.status
    INTO v_plan_status
  FROM public.pm_production_plans p
  JOIN public.pm_plan_hour_targets t
    ON t.plan_id = p.id AND t.hour_index = NEW.hour_index
  WHERE p.id = NEW.plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan hour target was not found';
  END IF;

  IF v_plan_status NOT IN ('published', 'completed') THEN
    RAISE EXCEPTION 'Hourly production can only be recorded against a published plan';
  END IF;

  -- The application confirms any quantity above the hourly target.
  -- The database retains all other hourly-entry validation.

  IF NEW.rejected_qty < 0 OR NEW.rejected_qty > NEW.actual_qty THEN
    RAISE EXCEPTION 'Rejected quantity cannot exceed actual quantity';
  END IF;

  IF NEW.actual_qty > 0
     AND (NULLIF(btrim(NEW.serial_start),'') IS NULL
       OR NULLIF(btrim(NEW.serial_end),'') IS NULL) THEN
    RAISE EXCEPTION 'Serial start and end are required when actual quantity is greater than zero';
  END IF;

  IF NEW.rejected_qty > 0
     AND NEW.rejection_reason NOT IN ('IQC Rejection','LQC Rejection') THEN
    RAISE EXCEPTION 'Select IQC Rejection or LQC Rejection';
  END IF;

  IF NEW.missing_serial_qty < 0 OR NEW.missing_serial_qty > NEW.actual_qty THEN
    RAISE EXCEPTION 'Missing serial quantity must be between zero and actual quantity';
  END IF;

  IF NEW.missing_serial_qty = 0
     AND jsonb_array_length(NEW.serial_exceptions) <> 0 THEN
    RAISE EXCEPTION 'Serial exception details require a missing sticker quantity';
  END IF;

  IF NEW.missing_serial_qty > 0 THEN
    IF NULLIF(btrim(NEW.missing_serial_start),'') IS NULL
       OR NULLIF(btrim(NEW.missing_serial_end),'') IS NULL
       OR NULLIF(btrim(NEW.alternate_serial_start),'') IS NULL
       OR NULLIF(btrim(NEW.alternate_serial_end),'') IS NULL THEN
      RAISE EXCEPTION 'Enter missing and alternate serial ranges';
    END IF;

    IF jsonb_typeof(NEW.serial_exceptions) <> 'array'
       OR jsonb_array_length(NEW.serial_exceptions) <> NEW.missing_serial_qty THEN
      RAISE EXCEPTION 'Enter one missing and alternate serial pair for every missing sticker';
    END IF;

    FOR v_exception IN SELECT value FROM jsonb_array_elements(NEW.serial_exceptions)
    LOOP
      IF NULLIF(btrim(v_exception->>'missing_serial_number'),'') IS NULL
         OR NULLIF(btrim(v_exception->>'alternate_serial_number'),'') IS NULL THEN
        RAISE EXCEPTION 'Every missing serial must have an alternate serial number';
      END IF;
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.recorded_by <> OLD.recorded_by THEN
    RAISE EXCEPTION 'The original hourly record owner cannot be changed';
  END IF;

  RETURN NEW;
END;
$function$;
